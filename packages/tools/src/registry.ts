import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
import { parseTool, type Category, type Tool } from './schema.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY_DIR = path.join(ROOT, 'registry');
export const TEMPLATES_DIR = path.join(ROOT, 'templates');

let cached: Tool[] | undefined;

export async function loadRegistry(dir = REGISTRY_DIR): Promise<Tool[]> {
  if (cached && dir === REGISTRY_DIR) return cached;

  const entries = (await readdir(dir)).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const tools: Tool[] = [];
  for (const file of entries.sort()) {
    const raw: unknown = parse(await readFile(path.join(dir, file), 'utf8'));
    const tool = parseTool(raw, file);
    if (tool.id !== path.basename(file).replace(/\.ya?ml$/, '')) {
      throw new Error(`${file}: id "${tool.id}" must match the filename`);
    }
    tools.push(tool);
  }

  const ids = new Set<string>();
  for (const t of tools) {
    if (ids.has(t.id)) throw new Error(`duplicate tool id "${t.id}"`);
    ids.add(t.id);
  }

  if (dir === REGISTRY_DIR) cached = tools;
  return tools;
}

export async function findTool(id: string): Promise<Tool | undefined> {
  return (await loadRegistry()).find((t) => t.id === id);
}

/** Tools offered for a flavor. An empty `flavors` list means "every flavor". */
export function forFlavor(tools: Tool[], flavor: string): Tool[] {
  return tools.filter((t) => t.flavors.length === 0 || t.flavors.includes(flavor));
}

export function byCategory(tools: Tool[]): Map<Category, Tool[]> {
  const map = new Map<Category, Tool[]>();
  for (const tool of tools) {
    const list = map.get(tool.category) ?? [];
    list.push(tool);
    map.set(tool.category, list);
  }
  return map;
}

/** Test seam. */
export function clearRegistryCache(): void {
  cached = undefined;
}

/**
 * Expand `requires`, depth-first, so a dependency is always installed before
 * the entry that needs it.
 *
 * Without this, `si add payments-joonapay` writes a module importing a port
 * that was never generated — and the failure surfaces as a type error in the
 * user's app rather than as anything the CLI said.
 *
 * Re-installing an entry that is already present is safe: file writes are
 * overwrites of identical content and anchor insertion is idempotent.
 */
export function withRequires(tools: Tool[], all: Tool[]): Tool[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  const ordered: Tool[] = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();

  const visit = (tool: Tool): void => {
    if (seen.has(tool.id)) return;
    if (visiting.has(tool.id)) {
      throw new Error(`circular requires involving "${tool.id}"`);
    }
    visiting.add(tool.id);
    for (const id of tool.requires ?? []) {
      const required = byId.get(id);
      // The registry test already rejects an unknown id, so this only fires on
      // a hand-edited registry.
      if (!required) throw new Error(`"${tool.id}" requires unknown entry "${id}"`);
      visit(required);
    }
    visiting.delete(tool.id);
    seen.add(tool.id);
    ordered.push(tool);
  };

  for (const tool of tools) visit(tool);
  return ordered;
}
