import path from 'node:path';
import { access } from 'node:fs/promises';
import pc from 'picocolors';
import { generate } from '@simbtech/si-nest';

export interface ScaffoldOptions {
  module?: string;
  fields?: string;
  cqrs?: boolean;
  tenantScoped?: boolean;
  events?: boolean;
  dryRun?: boolean;
  force?: boolean;
  path?: string;
}

/** Walk up for the monorepo root — the directory holding apps/server. */
async function findRoot(from: string): Promise<string> {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    try {
      await access(path.join(dir, 'apps', 'server', 'package.json'));
      return dir;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        'no apps/server found — run this inside a project scaffolded by `si new`, or pass --path',
      );
    }
  }
}

export async function scaffold(entity: string, options: ScaffoldOptions): Promise<void> {
  const root = options.path ? path.resolve(options.path) : await findRoot(process.cwd());

  const result = await generate({
    root,
    entity,
    module: options.module,
    fields: options.fields,
    cqrs: options.cqrs ?? false,
    // Default ON. A SaaS feature table that forgets tenant scoping is a data
    // leak, so opting out has to be the deliberate act.
    tenantScoped: options.tenantScoped ?? true,
    events: options.events ?? true,
    dryRun: options.dryRun ?? false,
    force: options.force ?? false,
  });

  const verb = options.dryRun ? 'would create' : 'created';
  console.log();
  for (const file of result.files) console.log(`  ${pc.green('+')} ${verb} ${file.path}`);
  for (const edit of result.edits) console.log(`  ${pc.cyan('~')} registered in ${edit}`);
  for (const s of result.skipped) console.log(`  ${pc.yellow('•')} exists, left alone: ${s} ${pc.dim('(--force to overwrite)')}`);
  for (const dep of result.installed) console.log(`  ${pc.magenta('↓')} installed ${dep} ${pc.dim('(required by the generated code)')}`);

  if (result.files.length === 0 && result.edits.length === 0) {
    console.log(pc.yellow('  nothing to do'));
    return;
  }
  console.log();
  console.log(pc.dim('  next: review the migration, then `pnpm db:migrate && pnpm verify:rls`'));
  console.log();
}
