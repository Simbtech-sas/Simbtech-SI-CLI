import { readFile, readdir, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';
import {
  addDependencies,
  insertAtAnchor,
  readManifest,
  type TemplateManifest,
} from '@simbtech/si-core';
import type { Tool } from './schema.ts';
import { TEMPLATES_DIR } from './registry.ts';
import { mergeComposeFile } from './compose.ts';
import { appendEnv } from './env.ts';

export interface InstallResult {
  tool: string;
  migrations: string[];
  files: string[];
  registered: string[];
  envKeys: string[];
  composeServices: string[];
  deps: string[];
  /**
   * The same dependencies, split by workspace and left UNINSTALLED.
   *
   * Only populated when the package-manager call was skipped. `pnpm add` is what
   * writes a package.json entry, so skipping it wires in code importing packages
   * nothing recorded — and the `pnpm install` the CLI suggests next cannot
   * install what is not there. The caller has to say so.
   */
  pending?: { server: string[]; web: string[]; dev: string[] };
  /** Things that were already there. Re-running `si add` is a no-op, not an error. */
  skipped: string[];
  notes: string[];
}

export interface InstallOptions {
  root: string;
  manifest: TemplateManifest;
  brand: string;
  /** Resolve and report without touching the filesystem or the package manager. */
  dryRun?: boolean;
  /** Skip the package-manager call. Useful in tests and for offline batching. */
  skipInstall?: boolean;
  /**
   * Whether the target project has tenants.
   *
   * Tool templates are Handlebars, not marker-pruned like the flavor templates,
   * so a tenancy-dependent template branches on `{{#if multiTenant}}`. Defaults
   * to true: every entry was written for SiSAAS, and a template that has not
   * been taught otherwise must keep behaving the way it always has.
   */
  multiTenant?: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** `web:` prefixed destinations go to the web app; everything else to the server. */
/**
 * Where a file lands. Bare paths go to the server app, because that is where
 * almost everything goes.
 *
 * `root:` exists for the shared workspace packages — an event contract belongs
 * to `packages/events`, not inside one app, precisely so a second service can
 * depend on it. Without this prefix it landed at
 * `apps/server/packages/events/...`, which compiles as a stray file nobody
 * imports.
 */
function resolveDest(dest: string, manifest: TemplateManifest): string {
  if (dest.startsWith('root:')) return dest.slice(5);
  if (dest.startsWith('web:')) {
    return path.join(manifest.targets['web'] ?? 'apps/web', dest.slice(4));
  }
  return path.join(manifest.targets['server'] ?? 'apps/server', dest);
}

export async function installTool(tool: Tool, options: InstallOptions): Promise<InstallResult> {
  const { root, manifest, dryRun } = options;
  const result: InstallResult = {
    tool: tool.id,
    migrations: [],
    files: [],
    registered: [],
    envKeys: [],
    composeServices: [],
    deps: [],
    skipped: [],
    notes: tool.notes,
  };
  const context = { brand: options.brand, tool, multiTenant: options.multiTenant ?? true };

  // ── files ─────────────────────────────────────────────────────────────────
  for (const file of tool.files) {
    const rel = resolveDest(file.dest, manifest);
    const abs = path.join(root, rel);
    if (await exists(abs)) {
      result.skipped.push(rel);
      continue;
    }
    const source = await readFile(path.join(TEMPLATES_DIR, tool.id, file.src), 'utf8');
    const rendered = Handlebars.compile(source, { noEscape: true })(context);
    if (!dryRun) {
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, rendered, 'utf8');
    }
    result.files.push(rel);
  }

  // ── migrations ────────────────────────────────────────────────────────────
  // Numbered against what the project already has, so two features added on
  // different days cannot collide on 0003.
  if (tool.migrations && tool.migrations.length > 0) {
    const serverDir = manifest.targets['server'] ?? 'apps/server';
    const migrationDir = path.join(root, serverDir, 'drizzle');
    // What is already applied, by NAME — the number prefix differs per project.
    // Without this, installing an entry twice (which `requires` does routinely)
    // writes its migration again under a new number, and the second run fails on
    // a type that already exists.
    const existing = new Set(
      (await readdir(migrationDir).catch(() => [])).map((f) => f.replace(/^\d+_/, '').replace(/\.sql$/, '')),
    );
    let next = await nextMigrationNumber(path.join(root, serverDir));
    for (const migration of tool.migrations) {
      if (existing.has(migration.name)) {
        result.skipped.push(`migration ${migration.name} (already present)`);
        continue;
      }
      const name = `${String(next).padStart(4, '0')}_${migration.name}.sql`;
      const rel = path.join(serverDir, 'drizzle', name);
      const abs = path.join(root, rel);
      const source = await readFile(path.join(TEMPLATES_DIR, tool.id, migration.src), 'utf8');
      const rendered = Handlebars.compile(source, { noEscape: true })(context);
      if (!dryRun) {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, rendered, 'utf8');
      }
      result.migrations.push(rel);
      if (!dryRun) await appendToJournal(migrationDir, name.replace(/\.sql$/, ''));
      next++;
    }
  }

  // ── compose ───────────────────────────────────────────────────────────────
  if (tool.compose) {
    const composeRel = manifest.targets['compose'];
    const composeAbs = composeRel ? path.join(root, composeRel) : undefined;
    if (composeAbs && (await exists(composeAbs))) {
      const fragment = await readFile(path.join(TEMPLATES_DIR, tool.id, tool.compose), 'utf8');
      const rendered = Handlebars.compile(fragment, { noEscape: true })(context);
      if (dryRun) {
        result.composeServices.push('(dry run)');
      } else {
        const merged = await mergeComposeFile(composeAbs, rendered);
        result.composeServices.push(...merged.added);
        result.skipped.push(...merged.alreadyPresent.map((s) => `compose:${s}`));
      }
    }
  }

  // ── env ───────────────────────────────────────────────────────────────────
  const envRel = manifest.targets['env'];
  if (envRel && (await exists(path.join(root, envRel)))) {
    result.envKeys = dryRun
      ? tool.env.map((e) => e.key)
      : await appendEnv(path.join(root, envRel), tool);
  }

  // ── registrations ─────────────────────────────────────────────────────────
  for (const reg of tool.register) {
    const anchor = manifest.anchors[reg.anchor];
    if (!anchor) {
      result.skipped.push(`anchor "${reg.anchor}" not declared by this template`);
      continue;
    }
    const abs = path.join(root, anchor.file);
    if (!(await exists(abs))) continue;
    if (dryRun) {
      result.registered.push(anchor.file);
      continue;
    }
    const inserted = await insertAtAnchor(abs, anchor.marker, reg.snippet);
    if (!inserted.inserted) {
      result.skipped.push(`${anchor.file} (${inserted.reason})`);
      continue;
    }
    if (reg.import) {
      const contents = await readFile(abs, 'utf8');
      if (!contents.includes(reg.import)) {
        const lines = contents.split('\n');
        const lastImport = lines.reduce((at, l, i) => (l.startsWith('import ') ? i : at), -1);
        lines.splice(lastImport + 1, 0, reg.import);
        await writeFile(abs, lines.join('\n'), 'utf8');
      }
    }
    result.registered.push(anchor.file);
  }

  // ── dependencies ──────────────────────────────────────────────────────────
  const server = tool.deps.server ?? [];
  const web = tool.deps.web ?? [];
  const dev = tool.deps.dev ?? [];
  result.deps = [...server, ...web, ...dev];
  if (options.skipInstall && result.deps.length > 0) {
    result.pending = { server, web, dev };
  }
  if (!dryRun && !options.skipInstall) {
    if (server.length > 0) {
      await addDependencies(root, server, { filter: `@${options.brand}/server` });
    }
    if (web.length > 0) {
      await addDependencies(root, web, { filter: `@${options.brand}/web` });
    }
    if (dev.length > 0) {
      await addDependencies(root, dev, { dev: true, filter: `@${options.brand}/server` });
    }
  }

  return result;
}

export async function readTemplateManifest(root: string): Promise<TemplateManifest> {
  return readManifest(root);
}

/** Highest migration number already present, so a new one lands after it. */
async function nextMigrationNumber(serverDir: string): Promise<number> {
  try {
    const entries = await readdir(path.join(serverDir, 'drizzle'));
    const numbers = entries
      .map((f) => /^(\d+)_/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    return numbers.length === 0 ? 0 : Math.max(...numbers) + 1;
  } catch {
    return 0;
  }
}

/**
 * Record a migration in `drizzle/meta/_journal.json`.
 *
 * `drizzle-kit migrate` reads the journal, NOT the directory. A migration that
 * is written but not journalled is simply never applied — and drizzle-kit exits
 * 1 printing nothing, so it looks like the database is broken rather than like a
 * missing entry.
 */
async function appendToJournal(migrationDir: string, tag: string): Promise<void> {
  const file = path.join(migrationDir, 'meta', '_journal.json');
  interface Journal {
    version: string;
    dialect: string;
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  }
  let journal: Journal;
  try {
    journal = JSON.parse(await readFile(file, 'utf8')) as Journal;
  } catch {
    // A project from before the journal existed, or a template that has none.
    journal = { version: '7', dialect: 'postgresql', entries: [] };
  }
  if (journal.entries.some((e) => e.tag === tag)) return;
  journal.entries.push({
    idx: journal.entries.length,
    version: journal.version,
    when: Date.now(),
    tag,
    breakpoints: true,
  });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
}
