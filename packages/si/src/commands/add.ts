import path from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import pc from 'picocolors';
import { installAll } from '@simbtech/si-core';
import { findTool, installTool, loadRegistry, forFlavor, withRequires } from '@simbtech/si-tools';
import { findProject } from '../project.ts';

/**
 * `pnpm add --filter <pkg>` links only the filtered package. Run against a
 * workspace that was never installed, it leaves the OTHER packages without
 * node_modules, and the failure surfaces later as a baffling
 * "Cannot find module 'zod'" from a package nobody touched. Install first.
 */
async function ensureInstalled(root: string, dryRun: boolean): Promise<void> {
  try {
    await access(path.join(root, 'node_modules'));
    return;
  } catch {
    /* not installed yet */
  }
  if (dryRun) {
    console.log(pc.yellow('  ! dependencies are not installed; `si add` would run `install` first'));
    return;
  }
  console.log(pc.dim('  dependencies not installed yet — running install first'));
  await installAll(root);
}

export interface AddOptions {
  dryRun?: boolean;
  skipInstall?: boolean;
  path?: string;
  /** Suppress per-tool output — `si new` reports the whole set at once. */
  quiet?: boolean;
  /**
   * Whether the project has tenants. `si new` knows before `.si/project.json`
   * exists and passes it; `si add` reads it back off the record.
   */
  multiTenant?: boolean;
}

/**
 * Does this project have tenants?
 *
 * Defaults to TRUE when there is no record — a project scaffolded before
 * `project.json` carried the choice is a SiSAAS one, and every tool template was
 * written for it. Guessing single-tenant would strip a tenant column out of a
 * project that has one.
 */
async function isMultiTenant(root: string): Promise<boolean> {
  try {
    const record = JSON.parse(
      await readFile(path.join(root, '.si', 'project.json'), 'utf8'),
    ) as { choices?: Record<string, string> };
    return record.choices?.['tenancy'] !== 'single';
  } catch {
    return true;
  }
}

/**
 * Record what is installed, so anything that reasons about the project can.
 *
 * `si compliance` needs it: without a record, a requirement whose feature was
 * installed still reports missing, and the report keeps offering to install
 * something it already installed.
 */
async function recordInstalled(root: string, ids: string[]): Promise<void> {
  const file = path.join(root, '.si', 'project.json');
  try {
    const record = JSON.parse(await readFile(file, 'utf8')) as { tools?: string[] };
    const tools = [...new Set([...(record.tools ?? []), ...ids])].sort();
    await writeFile(file, `${JSON.stringify({ ...record, tools }, null, 2)}\n`, 'utf8');
  } catch {
    // A project scaffolded before project.json existed. Not an error.
  }
}

/** Dependencies that were wired in but never recorded, because install was skipped. */
export interface PendingDeps {
  server: string[];
  web: string[];
  dev: string[];
}

export async function addTools(ids: string[], options: AddOptions): Promise<PendingDeps> {
  const project = await findProject(options.path);
  const available = forFlavor(await loadRegistry(), project.manifest.id);

  // Resolve everything before writing anything: a typo in the third tool should
  // not leave the first two half-installed.
  const requested = [];
  for (const id of ids) {
    const tool = await findTool(id);
    if (!tool) {
      const near = available
        .map((t) => t.id)
        .filter((t) => t.startsWith(id.slice(0, 3)))
        .slice(0, 3);
      throw new Error(
        `unknown tool "${id}"${near.length > 0 ? ` — did you mean ${near.join(', ')}?` : ''}\n` +
          `Run \`si list tools\` to see what is available.`,
      );
    }
    if (!available.some((t) => t.id === tool.id)) {
      throw new Error(
        `"${id}" is not offered for the ${project.manifest.label} flavor ` +
          `(available for: ${tool.flavors.join(', ')})`,
      );
    }
    requested.push(tool);
  }

  // Pull in what these entries depend on, dependencies first.
  const tools = withRequires(requested, await loadRegistry());

  if (!options.skipInstall) await ensureInstalled(project.root, options.dryRun ?? false);

  const multiTenant = options.multiTenant ?? (await isMultiTenant(project.root));
  const pending: PendingDeps = { server: [], web: [], dev: [] };

  for (const tool of tools) {
    if (!options.quiet) {
      console.log();
      console.log(`${pc.bold(tool.name)} ${pc.dim(`${tool.license} · ${tool.repo}`)}`);
    }

    const r = await installTool(tool, {
      root: project.root,
      manifest: project.manifest,
      brand: project.brand,
      dryRun: options.dryRun,
      skipInstall: options.skipInstall,
      multiTenant,
    });

    if (r.pending) {
      pending.server.push(...r.pending.server);
      pending.web.push(...r.pending.web);
      pending.dev.push(...r.pending.dev);
    }

    if (options.quiet) continue;
    for (const f of r.files) console.log(`  ${pc.green('+')} ${f}`);
    // A migration nobody notices is a table nobody creates.
    for (const m of r.migrations) console.log(`  ${pc.green('+')} ${m} ${pc.dim('(run pnpm db:migrate)')}`);
    for (const s of r.composeServices) console.log(`  ${pc.green('+')} compose service ${s}`);
    if (r.envKeys.length > 0) console.log(`  ${pc.green('+')} env ${r.envKeys.join(', ')}`);
    for (const reg of r.registered) console.log(`  ${pc.cyan('~')} registered in ${reg}`);
    if (r.deps.length > 0) {
      const verb = options.dryRun || options.skipInstall ? 'needs' : 'installed';
      console.log(`  ${pc.magenta('↓')} ${verb} ${[...new Set(r.deps)].join(', ')}`);
    }
    for (const s of r.skipped) console.log(`  ${pc.yellow('•')} already present: ${s}`);
    for (const note of r.notes) console.log(`  ${pc.yellow('!')} ${note}`);
  }

  // After every tool succeeded, not before: a half-finished install must not
  // leave a record claiming otherwise.
  if (!options.dryRun) await recordInstalled(project.root, tools.map((t) => t.id));

  if (options.quiet) return pending;
  console.log();
  console.log(pc.dim('  next: review the new env values, then `pnpm infra:up`'));
  console.log();
  return pending;
}
