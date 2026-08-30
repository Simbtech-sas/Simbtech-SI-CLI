import path from 'node:path';
import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProject } from '../project.ts';
import { nextFree, planPorts, readPortRequests } from '../ports.ts';

export interface StartOptions {
  /** Bring the stack up and stop, instead of running the app in the foreground. */
  detach?: boolean;
  /** Skip migrations — for when you are debugging the migration itself. */
  skipMigrate?: boolean;
  scale?: string;
}

interface RunResult {
  code: number;
  stderr: string;
}

/**
 * Run a command, keeping its stderr.
 *
 * The pipes are DRAINED, not merely opened. A child whose output nobody reads
 * blocks once the 64KB buffer fills — `docker compose pull` on a cold cache
 * would hang with no message at all. And keeping stderr is what lets a failure
 * say why instead of guessing "is Docker running?" at a Docker that is running.
 */
function run(
  cmd: string,
  args: string[],
  cwd: string,
  quiet = false,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...extraEnv },
    });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    child.stdout?.resume();
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Everything a developer needs, from one command.
 *
 * The ORDER is the whole value. Doing this by hand means `infra:up`, waiting for
 * Postgres to actually accept connections rather than merely having a container,
 * copying `.env.example`, migrating, and only then starting the app — and
 * getting it wrong produces a connection error that looks like a bug in the app.
 *
 * This is docker compose, NOT the cluster. The platform runs k3s and Argo, and
 * reproducing that locally means minutes per iteration; here the app runs on the
 * host against containerised dependencies, and a save reloads in a second. What
 * you lose is the cluster's own behaviour — ingress rules, resource limits,
 * CNPG failover. Test those in the ops repo, not here.
 */
export async function startDev(options: StartOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' si start dev ')));

  const project = await findProject();
  const composePath = path.join(project.root, 'infra', 'docker-compose.yml');
  if (!(await exists(composePath))) {
    throw new Error(`no infra/docker-compose.yml in ${project.root} — nothing to start`);
  }

  // ── ports, before anything binds one ──────────────────────────────────────
  //
  // Read out of the compose file rather than listed here, so a tool added with
  // `si add` gets a port allocated too: its fragment was merged into this same
  // file, and a hardcoded list in the CLI would know nothing about it.
  const composeText = await readFile(composePath, 'utf8');
  const plan = await planPorts(readPortRequests(composeText));

  // The app's own two, which are host processes rather than containers.
  const apiPort = await nextFree(8080, new Set(Object.values(plan.env).map(Number)));
  const webPort = await nextFree(3100, new Set([...Object.values(plan.env).map(Number), apiPort]));

  if (plan.moved.length > 0 || apiPort !== 8080 || webPort !== 3100) {
    const lines = [
      ...plan.moved.map((m) => `${m.label}: ${m.from} → ${m.to}`),
      ...(apiPort === 8080 ? [] : [`api: 8080 → ${apiPort}`]),
      ...(webPort === 3100 ? [] : [`web: 3100 → ${webPort}`]),
    ];
    p.log.info(`Ports in use, moved:\n  ${lines.join('\n  ')}`);
  }

  // ── env, before anything reads it ─────────────────────────────────────────
  const serverDir = path.join(project.root, project.manifest.targets['server'] ?? 'apps/server');
  const env = path.join(serverDir, '.env');
  if (!(await exists(env)) && (await exists(`${env}.example`))) {
    await copyFile(`${env}.example`, env);
    p.log.info(`created ${pc.dim('apps/server/.env')} from the example`);
  }
  // The app connects over the ports we just chose, so the URLs in .env have to
  // agree with them. Rewritten every run: a port that moved yesterday and is
  // free today should move back, or the file drifts from reality.
  if (await exists(env)) await alignEnv(env, plan.env, apiPort, webPort);

  // ── dependencies ──────────────────────────────────────────────────────────
  const spin = p.spinner();
  spin.start('Starting containers');
  const up = ['compose', '-f', composePath, 'up', '-d'];
  if (options.scale) up.push('--scale', options.scale);
  const started = await run('docker', up, project.root, true, plan.env);
  if (started.code !== 0) {
    spin.stop(pc.red('docker compose failed'));
    // The reason, verbatim. "Is Docker running?" is a guess, and it is wrong
    // every time the real cause is something else.
    throw new Error(started.stderr.trim() || 'docker compose exited non-zero with no output');
  }
  const services = countServices(composeText);
  spin.stop(`${services} container${services === 1 ? '' : 's'} up`);

  // ── wait for the database to ANSWER, not merely to exist ──────────────────
  //
  // A container that is "running" is not a Postgres that accepts connections.
  // Migrating too early fails with a connection error that reads like a bug in
  // the app, and that is the single most common way this goes wrong by hand.
  //
  // Every Postgres, not just the first: a per-service layout has several, and
  // the one that is slow to start is the one whose migration fails.
  const databases = postgresServices(composeText);
  spin.start(`Waiting for Postgres${databases.length > 1 ? ` (${databases.length})` : ''}`);
  for (const service of databases) {
    if (!(await waitForPostgres(composePath, project.root, service, plan.env))) {
      spin.stop(pc.red(`${service} did not become ready`));
      throw new Error(`${service} never accepted a connection — check \`pnpm infra:logs\``);
    }
  }
  spin.stop(`Postgres ready${databases.length > 1 ? ` (${databases.length})` : ''}`);

  // ── migrations, one per server app ────────────────────────────────────────
  if (!options.skipMigrate) {
    spin.start('Applying migrations');
    const migrated = await run('pnpm', ['run', 'db:migrate'], project.root, true, plan.env);
    if (migrated.code !== 0) {
      spin.stop(pc.yellow('Migrations failed'));
      p.log.warn(
        `${migrated.stderr.trim().split('\n').slice(-3).join('\n')}\n` +
          'The stack is up; fix the migration and run `pnpm db:migrate`.',
      );
    } else {
      spin.stop('Migrations applied');
    }
  }

  p.note((await runningUrls(composeText, plan.env, apiPort, webPort)).join('\n'), 'Running');

  if (options.detach) {
    p.outro(`Dependencies are up. ${pc.dim('pnpm dev')} to start the app.`);
    return;
  }

  // ── the app: API, worker and web, together ────────────────────────────────
  //
  // `turbo run dev` alone starts the API and the web app but NOT the worker —
  // `worker:dev` is a separate script and turbo never sees it. The worker is
  // where event delivery and background jobs live, so without it the outbox
  // fills up and nothing ever handles a job: the app looks like it works right
  // up until you check whether anything happened.
  p.log.info(`Starting API, worker and web — ${pc.dim('Ctrl-C stops them; containers keep running')}`);

  // Each process gets its own env, which is why this does not just shell out to
  // `turbo run dev`. The API and the web app both read `PORT`, so one shared
  // environment would put them on the same one — and turbo never ran the worker
  // at all, because `worker:dev` is not a task in its graph.
  const webDir = path.join(project.root, project.manifest.targets['web'] ?? 'apps/web');
  const children = [run('pnpm', ['run', 'dev'], serverDir, false, { ...plan.env, PORT: String(apiPort) })];

  if (await hasScript(serverDir, 'worker:dev')) {
    children.push(run('pnpm', ['run', 'worker:dev'], serverDir, false, plan.env));
  }
  if (await hasScript(webDir, 'dev')) {
    children.push(
      run('pnpm', ['run', 'dev'], webDir, false, {
        ...plan.env,
        PORT: String(webPort),
        NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}`,
      }),
    );
  }

  // The first to exit ends the run: if the API dies, sitting in a web-only
  // foreground pretending things are fine is worse than stopping.
  await Promise.race(children);
}

/** Every Postgres in the compose file — a per-service layout has several. */
function postgresServices(compose: string): string[] {
  const found: string[] = [];
  let service: string | null = null;
  for (const line of compose.split('\n')) {
    const svc = / {2}([a-z0-9][\w-]*):\s*$/.exec(line);
    if (/^ {2}[a-z0-9]/.test(line) && svc) service = svc[1]!;
    if (service && /^ {4}image:\s*\S*postgres/i.test(line)) {
      found.push(service);
      service = null;
    }
  }
  return found;
}

function countServices(compose: string): number {
  return compose.split('\n').filter((l) => /^ {2}[a-z0-9][\w-]*:\s*$/.test(l)).length;
}

async function waitForPostgres(
  composePath: string,
  cwd: string,
  service: string,
  env: Record<string, string>,
): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const probe = await run(
      'docker',
      ['compose', '-f', composePath, 'exec', '-T', service, 'pg_isready', '-q'],
      cwd,
      true,
      env,
    );
    if (probe.code === 0) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** Is there such a script here? A flavor without a worker must not be asked for one. */
async function hasScript(dir: string, name: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return Boolean(pkg.scripts?.[name]);
  } catch {
    return false;
  }
}

/**
 * Point the app's `.env` at the ports actually in use.
 *
 * Only the host half of a URL is touched, and only for keys the plan covers —
 * a password or a bucket name in the same file is left exactly as it was.
 */
async function alignEnv(
  file: string,
  ports: Record<string, string>,
  apiPort: number,
  webPort: number,
): Promise<void> {
  const rewrites: Array<[RegExp, string]> = [
    [/^(DATABASE_URL=.*localhost:)\d+/m, `$1${ports['POSTGRES_HOST_PORT'] ?? 5434}`],
    [/^(MIGRATION_DATABASE_URL=.*localhost:)\d+/m, `$1${ports['POSTGRES_HOST_PORT'] ?? 5434}`],
    [/^(ADMIN_DATABASE_URL=.*localhost:)\d+/m, `$1${ports['POSTGRES_HOST_PORT'] ?? 5434}`],
    [/^(REDIS_URL=.*localhost:)\d+/m, `$1${ports['REDIS_HOST_PORT'] ?? 6381}`],
    [/^(S3_ENDPOINT=.*localhost:)\d+/m, `$1${ports['MINIO_HOST_PORT'] ?? 9000}`],
    [/^(SMTP_PORT=)\d+/m, `$1${ports['MAILPIT_SMTP_HOST_PORT'] ?? 1025}`],
    [/^(KAFKA_BROKERS=.*localhost:)\d+/m, `$1${ports['KAFKA_HOST_PORT'] ?? 19092}`],
    [/^(PORT=)\d+/m, `$1${apiPort}`],
    [/^(WEB_PUBLIC_URL=http:\/\/localhost:)\d+/m, `$1${webPort}`],
  ];
  let text = await readFile(file, 'utf8');
  for (const [pattern, replacement] of rewrites) text = text.replace(pattern, replacement);
  await writeFile(file, text, 'utf8');
}

/** What is reachable, and where — from the compose file, not a fixed list. */
async function runningUrls(
  compose: string,
  ports: Record<string, string>,
  apiPort: number,
  webPort: number,
): Promise<string[]> {
  const at = (key: string, fallback: number) => Number(ports[key] ?? fallback);
  const urls: string[] = [
    `${pc.cyan(`http://localhost:${apiPort}`)}   the API`,
    `${pc.cyan(`http://localhost:${webPort}`)}   the web app`,
  ];

  // Only what this project actually runs. Printing a MinIO console for a
  // project scaffolded with `--storage none` sends people to a dead tab.
  const optional: Array<[string, string, number, string]> = [
    ['traefik', 'GATEWAY_HOST_PORT', 8090, 'through the gateway (Traefik)'],
    ['traefik', 'GATEWAY_DASHBOARD_HOST_PORT', 8091, 'Traefik dashboard — routes and backends'],
    ['mailpit', 'MAILPIT_HOST_PORT', 8025, 'Mailpit — every email this app sends'],
    ['redpanda-console', 'KAFKA_CONSOLE_HOST_PORT', 8085, 'Redpanda console — topics and messages'],
    ['minio', 'MINIO_CONSOLE_HOST_PORT', 9001, 'MinIO console'],
  ];
  for (const [service, key, fallback, label] of optional) {
    if (!new RegExp(`^ {2}${service}:\\s*$`, 'm').test(compose)) continue;
    urls.push(`${pc.cyan(`http://localhost:${at(key, fallback)}`)}   ${label}`);
  }

  // Anything else with a published port — the tools the user added. Reported
  // rather than guessed at: the CLI does not know what `si add n8n` publishes.
  const known = new Set([
    'POSTGRES_HOST_PORT', 'REDIS_HOST_PORT', 'MINIO_HOST_PORT', 'MAILPIT_SMTP_HOST_PORT',
    'KAFKA_HOST_PORT', 'KAFKA_ADMIN_HOST_PORT',
    ...optional.map(([, key]) => key),
  ]);
  for (const request of readPortRequests(compose)) {
    if (known.has(request.env)) continue;
    urls.push(`${pc.cyan(`http://localhost:${at(request.env, request.preferred)}`)}   ${request.label}`);
  }
  return urls;
}

export async function stopDev(options: { volumes?: boolean }): Promise<void> {
  const project = await findProject();
  const compose = path.join(project.root, 'infra', 'docker-compose.yml');
  const args = ['compose', '-f', compose, 'down'];
  // `-v` drops the data too. Separate flag because losing a seeded local
  // database to a command you meant as "stop" is a bad afternoon.
  if (options.volumes) args.push('-v');
  await run('docker', args, project.root);
}
