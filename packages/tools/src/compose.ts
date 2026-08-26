import { readFile, writeFile } from 'node:fs/promises';
import { parseDocument, isMap, type Document } from 'yaml';

/**
 * Merge a tool's compose fragment into the project's dev stack.
 *
 * Uses a YAML Document rather than parse/stringify so the existing file keeps its
 * comments and formatting — that file is heavily commented on purpose, and a
 * round-trip through plain objects would silently delete all of it.
 */
export interface ComposeMergeResult {
  added: string[];
  alreadyPresent: string[];
}

const MERGE_KEYS = ['services', 'volumes', 'networks'] as const;

export function mergeComposeDocuments(
  target: Document,
  fragment: Document,
): ComposeMergeResult {
  const result: ComposeMergeResult = { added: [], alreadyPresent: [] };

  for (const key of MERGE_KEYS) {
    const incoming = fragment.get(key);
    if (!isMap(incoming)) continue;

    if (!target.has(key)) target.set(key, target.createNode({}));
    const existing = target.get(key);
    if (!isMap(existing)) continue;

    for (const item of incoming.items) {
      const name = String(item.key);
      if (existing.has(name)) {
        result.alreadyPresent.push(`${key}.${name}`);
        continue;
      }
      existing.add(item);
      result.added.push(key === 'services' ? name : `${key}.${name}`);
    }
  }
  return result;
}

export async function mergeComposeFile(
  targetPath: string,
  fragmentYaml: string,
): Promise<ComposeMergeResult> {
  const target = parseDocument(await readFile(targetPath, 'utf8'));
  const fragment = parseDocument(fragmentYaml);
  const result = mergeComposeDocuments(target, fragment);
  if (result.added.length > 0) await writeFile(targetPath, String(target), 'utf8');
  return result;
}
