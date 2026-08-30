#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import pc from 'picocolors';
import { register, type CommandDef } from './registry.ts';
import { FLAVORS } from './flavors.ts';
import { doctor } from './commands/doctor.ts';
import { newProject, type NewOptions } from './commands/new.ts';
import { scaffold, type ScaffoldOptions } from './commands/scaffold.ts';
import { addApi, type ApiOptions } from './commands/api.ts';
import { startDev, stopDev, type StartOptions } from './commands/start.ts';
import { compliance, type ComplianceOptions } from './commands/compliance.ts';
import { addTools, type AddOptions } from './commands/add.ts';
import { listTools, type ListOptions } from './commands/list.ts';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const commands: CommandDef[] = [
  {
    name: 'new',
    description: 'Scaffold a new project',
    args: [{ name: 'directory', description: 'where to create it', required: false }],
    options: [
      { flags: '-f, --flavor <flavor>', description: FLAVORS.map((f) => f.id).join(' | ') },
      { flags: '-b, --brand <brand>', description: 'brand slug (lowercase, 2-31 chars)' },
      { flags: '-p, --profile <profile>', description: 'mono (single deployable) | identity | service — prompted if omitted' },
      { flags: '--auth <choice>', description: 'builtin | keycloak | zitadel | none' },
      { flags: '--storage <choice>', description: 'minio | s3 | none' },
      { flags: '--uploads <choice>', description: 'presigned | tusd | none' },
      { flags: '--workflows <choice>', description: 'none | temporal' },
      { flags: '--observability <choice>', description: 'none | umami | posthog | openreplay' },
      { flags: '--loadtest <choice>', description: 'k6 | none' },
      { flags: '--payments <choice>', description: 'none | kpay | joonapay | both' },
      { flags: '--tool <id...>', description: 'open-source tools to wire in; skips the picker' },
      { flags: '--data <choice>', description: 'shared | per-service (multi-service layouts)' },
      { flags: '--database <choice>', description: 'SiMICE: sqlite | postgres' },
      { flags: '--mode <choice>', description: 'SiMICE: standalone | lan-server | cloud-sync' },
      { flags: '--blank', description: 'opt out of every choice — just the skeleton' },
      { flags: '--force', description: 'scaffold a flavor that is not finished yet' },
      { flags: '--skip-install', description: 'scaffold without running the package manager' },
      { flags: '--ref <ref>', description: 'template git ref (tag, branch or sha)' },
      { flags: '-y, --yes', description: 'no prompts; fail if an answer is missing' },
    ],
    run: ((directory: string | undefined, options: NewOptions) =>
      newProject(directory, options)) as CommandDef['run'],
  },
  {
    name: 'scaffold',
    aliases: ['s'],
    description: 'Generate a full feature module: schema, migration, repository, service, DTOs, controller',
    args: [{ name: 'entity', description: 'entity name, e.g. Product' }],
    options: [
      { flags: '-m, --module <module>', description: 'module folder (defaults to the plural entity)' },
      { flags: '-f, --fields <spec>', description: 'e.g. "name:string price:money:optional sku:string:unique"' },
      { flags: '--cqrs', description: 'emit command/query handlers instead of a service' },
      { flags: '--no-tenant-scoped', description: 'omit tenant_id, the FK and the RLS policy' },
      { flags: '--no-events', description: 'do not publish domain events to the outbox' },
      { flags: '--dry-run', description: 'print what would be written, write nothing' },
      { flags: '--force', description: 'overwrite files that already exist' },
      { flags: '--path <dir>', description: 'project root (defaults to the nearest one above cwd)' },
    ],
    run: ((entity: string, options: ScaffoldOptions) => scaffold(entity, options)) as CommandDef['run'],
  },
  {
    name: 'api',
    description: 'Add another API service to this project, reusing its decisions',
    args: [{ name: 'name', description: 'service name, e.g. billing' }],
    options: [
      { flags: '--auth <choice>', description: 'keycloak | zitadel | none (inherited when it can be)' },
      { flags: '--tool <id...>', description: 'tools to wire into this service' },
      { flags: '--dir <path>', description: 'where services live (default: services)' },
      { flags: '--skip-install', description: 'write files but do not run the package manager' },
      { flags: '-y, --yes', description: 'accept every default' },
    ],
    run: ((name: string, options: ApiOptions) => addApi(name, options)) as CommandDef['run'],
  },
  {
    name: 'start',
    description: 'Bring up the whole dev stack and run the app — one command',
    args: [{ name: 'what', description: 'dev (default)', required: false }],
    options: [
      { flags: '-d, --detach', description: 'start the dependencies only, do not run the app' },
      { flags: '--skip-migrate', description: 'do not apply migrations' },
      { flags: '--scale <svc=n>', description: 'run N replicas, e.g. server=3, to exercise the balancer' },
    ],
    run: ((what: string | undefined, options: StartOptions) => {
      if (what && what !== 'dev') throw new Error(`unknown target "${what}" — only \`si start dev\` exists`);
      return startDev(options);
    }) as CommandDef['run'],
  },
  {
    name: 'stop',
    description: 'Stop the dev stack',
    options: [{ flags: '--volumes', description: 'delete the data too' }],
    run: ((options: { volumes?: boolean }) => stopDev(options)) as CommandDef['run'],
  },
  {
    name: 'add',
    description: 'Wire an open-source tool into this project (deps, compose, env, module)',
    args: [{ name: 'tools', description: 'tool ids, e.g. livekit blnk', variadic: true }],
    options: [
      { flags: '--dry-run', description: 'show what would change, change nothing' },
      { flags: '--skip-install', description: 'write files but do not run the package manager' },
      { flags: '--path <dir>', description: 'project root (defaults to the nearest one above cwd)' },
    ],
    // The return value is for `si new`, which needs to report what it could not
    // record; the CLI itself has nothing to do with it.
    run: (async (tools: string[], options: AddOptions) => {
      await addTools(tools, options);
    }) as CommandDef['run'],
  },
  {
    name: 'list',
    description: 'Browse the registry of tools and prebuilt features',
    args: [{ name: 'what', description: 'tools | features | all', required: false }],
    options: [
      { flags: '-c, --category <category>', description: 'filter by category' },
      { flags: '-f, --flavor <flavor>', description: 'show what applies to a flavor' },
      { flags: '-a, --all', description: 'ignore the current project and show everything' },
    ],
    run: ((what: string | undefined, options: ListOptions) => listTools(what, options)) as CommandDef['run'],
  },
  {
    name: 'compliance',
    description: 'Report this project against a compliance framework — evidence, not claims',
    options: [
      { flags: '--framework <id>', description: 'which framework (default: the first available)' },
      { flags: '--write', description: 'also write docs/compliance/<id>.md' },
      { flags: '--strict', description: 'exit non-zero if anything is missing' },
      { flags: '--fix', description: 'install every feature that closes a missing requirement' },
    ],
    run: ((options: ComplianceOptions) => compliance(options)) as CommandDef['run'],
  },
  {
    name: 'doctor',
    description: 'Check the local toolchain and report which flavors are ready to scaffold',
    run: doctor,
  },
];

const program = new Command();

program
  .name('si')
  .description(
    `${pc.bold('SIMBTECH project scaffolder')}\n\n` +
      FLAVORS.map((f) => `  ${pc.cyan(f.id.padEnd(18))} ${f.summary}`).join('\n'),
  )
  .version(version, '-v, --version')
  .showHelpAfterError();

for (const def of commands) register(program, def);

// Deliberately no update check on startup: it makes every invocation depend on
// the network and stalls CI.
try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(pc.red('error: ') + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
}
