import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { addDependencies, insertAtAnchor } from '@simbtech/si-core';
import { buildContext, type GenerateOptions, type TemplateContext } from './context.ts';
import { render } from './template.ts';

export interface GeneratedFile {
  /** Path relative to the project root. */
  path: string;
  contents: string;
}

export interface GenerateResult {
  files: GeneratedFile[];
  /** Registrations applied to existing files (module wiring, schema barrel…). */
  edits: string[];
  skipped: string[];
  /** Packages the generated code imports that the project did not already have. */
  installed: string[];
}

/**
 * What each generated shape imports beyond the template's baseline. Generated
 * code that imports a package the project lacks compiles nowhere — so the
 * generator installs it rather than leaving a broken tree behind.
 */
const TEMPLATE_DEPENDENCIES: ReadonlyArray<{ when: (c: TemplateContext) => boolean; packages: string[] }> = [
  { when: (c) => c.cqrs, packages: ['@nestjs/cqrs'] },
];

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Next free migration number, read from the migrations already on disk. Guessing
 * would collide the moment two features are generated in a row.
 */
export async function nextMigrationNumber(serverDir: string): Promise<number> {
  const dir = path.join(serverDir, 'drizzle');
  try {
    const entries = await readdir(dir);
    const numbers = entries
      .map((f) => /^(\d+)_/.exec(f)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    return numbers.length === 0 ? 0 : Math.max(...numbers) + 1;
  } catch {
    return 0;
  }
}

/** Read the npm scope from the target project so `@<brand>/events` resolves. */
export async function detectBrand(serverDir: string): Promise<string | undefined> {
  try {
    const pkg: unknown = JSON.parse(await readFile(path.join(serverDir, 'package.json'), 'utf8'));
    const name = (pkg as { name?: string }).name ?? '';
    return /^@([^/]+)\//.exec(name)?.[1];
  } catch {
    return undefined;
  }
}

/** Which templates produce which files, for a given context. */
function plan(ctx: TemplateContext): Array<{ template: string; to: string }> {
  const m = `src/modules/${ctx.moduleKebab}`;
  const files: Array<{ template: string; to: string }> = [
    { template: 'schema', to: `src/database/schema/${ctx.moduleKebab}.ts` },
    { template: 'domain', to: `${m}/domain/${ctx.entityKebab}.ts` },
    { template: 'repository', to: `${m}/infrastructure/${ctx.moduleKebab}.repository.ts` },
    { template: 'dto', to: `${m}/interface/dto.ts` },
  ];

  if (ctx.cqrs) {
    files.push(
      { template: 'commands', to: `${m}/application/${ctx.moduleKebab}.commands.ts` },
      { template: 'queries', to: `${m}/application/${ctx.moduleKebab}.queries.ts` },
      { template: 'controller-cqrs', to: `${m}/interface/${ctx.moduleKebab}.controller.ts` },
      { template: 'module-cqrs', to: `${m}/${ctx.moduleKebab}.module.ts` },
    );
  } else {
    files.push(
      { template: 'service', to: `${m}/application/${ctx.moduleKebab}.service.ts` },
      { template: 'controller', to: `${m}/interface/${ctx.moduleKebab}.controller.ts` },
      { template: 'module', to: `${m}/${ctx.moduleKebab}.module.ts` },
    );
  }
  return files;
}

export interface GenerateContext extends GenerateOptions {
  /** Project root (the monorepo root, not apps/server). */
  root: string;
  /** Path to the server app relative to root. */
  serverDir?: string;
  /** Report what would be written without touching the filesystem. */
  dryRun?: boolean;
  /** Overwrite files that already exist. Off by default — generation is additive. */
  force?: boolean;
}

export async function generate(options: GenerateContext): Promise<GenerateResult> {
  const serverDir = path.join(options.root, options.serverDir ?? 'apps/server');
  const ctx = buildContext({
    ...options,
    brand: options.brand ?? (await detectBrand(serverDir)),
    migrationNumber: options.migrationNumber ?? (await nextMigrationNumber(serverDir)),
  });

  const result: GenerateResult = { files: [], edits: [], skipped: [], installed: [] };

  for (const { template, to } of plan(ctx)) {
    const abs = path.join(serverDir, to);
    if (!options.force && (await exists(abs))) {
      result.skipped.push(to);
      continue;
    }
    result.files.push({ path: path.relative(options.root, abs), contents: await render(template, ctx) });
  }

  // The migration is numbered, so it can never collide with an existing file.
  const migration = `drizzle/${ctx.migrationNumber}_${ctx.table}.sql`;
  const migrationAbs = path.join(serverDir, migration);
  if (!(await exists(migrationAbs))) {
    result.files.push({
      path: path.relative(options.root, migrationAbs),
      contents: await render('migration', ctx),
    });
  } else {
    result.skipped.push(migration);
  }

  if (options.dryRun) return result;

  for (const file of result.files) {
    const abs = path.join(options.root, file.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.contents, 'utf8');
  }

  await wire(options.root, serverDir, ctx, result);
  await installRequired(options.root, serverDir, ctx, result);
  return result;
}

/**
 * Register the new module where the app can see it. A generated module that is
 * never imported is dead code that typechecks — the worst kind of silent failure,
 * so each registration is reported.
 */
async function wire(
  root: string,
  serverDir: string,
  ctx: TemplateContext,
  result: GenerateResult,
): Promise<void> {
  const barrel = path.join(serverDir, 'src/database/schema/index.ts');
  if (await exists(barrel)) {
    const line = `export * from './${ctx.moduleKebab}';`;
    const contents = await readFile(barrel, 'utf8');
    if (!contents.includes(line)) {
      await writeFile(barrel, contents.trimEnd() + `\n${line}\n`, 'utf8');
      result.edits.push(path.relative(root, barrel));
    }
  }

  const importLine = `import { ${ctx.modulePascal}Module } from './modules/${ctx.moduleKebab}/${ctx.moduleKebab}.module';`;

  for (const file of ['src/app.module.ts', 'src/worker.module.ts']) {
    const abs = path.join(serverDir, file);
    if (!(await exists(abs))) continue;
    const inserted = await insertAtAnchor(abs, '// si:modules', `${ctx.modulePascal}Module,`);
    if (!inserted.inserted) continue;

    // The anchor only covers the module list; the import needs its own placement.
    const contents = await readFile(abs, 'utf8');
    if (!contents.includes(importLine)) {
      const lines = contents.split('\n');
      const lastImport = lines.reduce((at, l, i) => (l.startsWith('import ') ? i : at), -1);
      lines.splice(lastImport + 1, 0, importLine);
      await writeFile(abs, lines.join('\n'), 'utf8');
    }
    result.edits.push(path.relative(root, abs));
  }

  // Event contracts live in the shared package so consumers can depend on them.
  if (ctx.events) {
    const contracts = path.join(root, 'packages/events/src/index.ts');
    if (await exists(contracts)) {
      const contents = await readFile(contracts, 'utf8');
      if (!contents.includes(`${ctx.entity}Created`)) {
        const block = await render('events', ctx);
        const withBlock = contents.replace(
          /\/\*\* Every contract this service knows about, keyed by `type`\. \*\//,
          `${block.trim()}\n\n/** Every contract this service knows about, keyed by \`type\`. */`,
        );
        const registered = withBlock.replace(
          /(export const EVENTS = \{\n)/,
          `$1  ${ctx.entity}Created,\n  ${ctx.entity}Updated,\n  ${ctx.entity}Deleted,\n`,
        );
        await writeFile(contracts, registered, 'utf8');
        result.edits.push(path.relative(root, contracts));
      }
    }
  }
}

/** Install packages the generated code imports but the project does not yet have. */
async function installRequired(
  root: string,
  serverDir: string,
  ctx: TemplateContext,
  result: GenerateResult,
): Promise<void> {
  const required = TEMPLATE_DEPENDENCIES.filter((d) => d.when(ctx)).flatMap((d) => d.packages);
  if (required.length === 0) return;

  const pkgPath = path.join(serverDir, 'package.json');
  let present = new Set<string>();
  let serverName: string | undefined;
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    serverName = pkg.name;
    present = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return;
  }

  const missing = required.filter((p) => !present.has(p));
  if (missing.length === 0) return;

  await addDependencies(root, missing, serverName ? { filter: serverName } : {});
  result.installed.push(...missing);
}
