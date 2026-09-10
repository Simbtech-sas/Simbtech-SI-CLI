import path from 'node:path';
import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProject } from '../project.ts';
import type { TemplateDev } from '@simbtech/si-core';
import { nextFree, parameteriseCompose, planPorts, readPortRequests } from '../ports.ts';
import { lanAddress } from '../lan.ts';
import { hotkeyHelp, onHotkeys, supervise, type Hotkey, type Managed } from '../dev-console.ts';

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

  // What "everything" means is declared by the template, not decided here: it
  // is containers plus three Node processes for a SaaS, a Vite server for a
  // local-first app, `flutter run` for Flutter. Hardcoding the SaaS shape is
  // why this used to refuse on five of the seven flavours.
  const dev = project.manifest.dev ?? {
    compose: 'infra/docker-compose.yml',
    migrate: 'db:migrate',
    processes: [
      { label: 'api', cwd: project.manifest.targets['server'] ?? 'apps/server', run: ['pnpm', 'run', 'dev'], port: 'api' as const },
      { label: 'worker', cwd: project.manifest.targets['server'] ?? 'apps/server', run: ['pnpm', 'run', 'worker:dev'], requires: 'worker:dev' },
      { label: 'web', cwd: project.manifest.targets['web'] ?? 'apps/web', run: ['pnpm', 'run', 'dev'], port: 'web' as const },
    ],
  };

  // Absent is normal, not an error. A SQLite SiMICE build has no infrastructure
  // at all, and a local-first app has none by definition.
  const composePath = dev.compose ? path.join(project.root, dev.compose) : undefined;
  const hasCompose = composePath !== undefined && (await exists(composePath));

  // ── ports, before anything binds one ──────────────────────────────────────
  //
  // Read out of the compose file rather than listed here, so a tool added with
  // `si add` gets a port allocated too: its fragment was merged into this same
  // file, and a hardcoded list in the CLI would know nothing about it.
  let composeText = hasCompose ? await readFile(composePath!, 'utf8') : '';

  // A project scaffolded before ports were allocatable has `- '9000:9000'`
  // written out, and a literal is not something this can move — docker binds
  // what the file says, and the failure is "port is already allocated" with no
  // way to act on it. Migrate the file once, keeping every current port as the
  // default, so from now on they CAN move.
  const migrated = parameteriseCompose(composeText);
  if (hasCompose && migrated.changed.length > 0) {
    await writeFile(composePath!, migrated.compose, 'utf8');
    composeText = migrated.compose;
    p.log.info(
      `Made ${migrated.changed.length} host port(s) in infra/docker-compose.yml movable.\n` +
        'Same ports as before — they are just overridable now, so a collision can be\n' +
        'stepped around instead of stopping the stack.',
    );
  }

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
  if (hasCompose) {
    spin.start('Starting containers');
    const up = ['compose', '-f', composePath!, 'up', '-d'];
    if (options.scale) up.push('--scale', options.scale);
    const started = await run('docker', up, project.root, true, plan.env);
    if (started.code !== 0) {
      spin.stop(pc.red('docker compose failed'));
      throw new Error(composeFailure(started.stderr));
    }
    const services = countServices(composeText);
    spin.stop(`${services} container${services === 1 ? '' : 's'} up`);
  }

  // ── wait for the database to ANSWER, not merely to exist ──────────────────
  //
  // A container that is "running" is not a Postgres that accepts connections.
  // Migrating too early fails with a connection error that reads like a bug in
  // the app, and that is the single most common way this goes wrong by hand.
  //
  // Every Postgres, not just the first: a per-service layout has several, and
  // the one that is slow to start is the one whose migration fails.
  const databases = hasCompose ? postgresServices(composeText) : [];
  if (databases.length > 0) {
    spin.start(`Waiting for Postgres${databases.length > 1 ? ` (${databases.length})` : ''}`);
    for (const service of databases) {
      if (!(await waitForPostgres(composePath!, project.root, service, plan.env))) {
        spin.stop(pc.red(`${service} did not become ready`));
        throw new Error(`${service} never accepted a connection — check the container logs`);
      }
    }
    spin.stop(`Postgres ready${databases.length > 1 ? ` (${databases.length})` : ''}`);
  }

  // ── migrations, one per server app ────────────────────────────────────────
  if (!options.skipMigrate && dev.migrate && (await hasScript(project.root, dev.migrate))) {
    spin.start('Applying migrations');
    const migrated = await run('pnpm', ['run', dev.migrate], project.root, true, plan.env);
    if (migrated.code !== 0) {
      spin.stop(pc.yellow('Migrations failed'));
      p.log.warn(
        `${migrated.stderr.trim().split('\n').slice(-3).join('\n')}\n` +
          `The stack is up; fix the migration and run \`pnpm ${dev.migrate}\`.`,
      );
    } else {
      spin.stop('Migrations applied');
    }
  }

  // Where a phone on the same Wi-Fi reaches this machine. Falls back to
  // loopback when there is no LAN, or when the flavour opts out.
  const onLan = dev.lan !== false;
  const host = (onLan ? lanAddress() : undefined) ?? 'localhost';

  const urls = runningUrls(dev, composeText, plan.env, apiPort, webPort, host);
  if (urls.length > 0) p.note(urls.join('\n'), 'Running');

  if (options.detach) {
    p.outro(
      hasCompose
        ? `Dependencies are up. ${pc.dim('pnpm dev')} to start the app.`
        : 'Nothing to detach from — this flavour has no containers.',
    );
    return;
  }

  // ── the app itself ────────────────────────────────────────────────────────
  //
  // Each process gets its own environment, which is why this does not shell out
  // to `turbo run dev`. Two reasons: the API and the web app both read `PORT`,
  // so one shared environment puts them on the same one; and turbo never ran
  // the worker at all, because `worker:dev` is not a task in its graph. The
  // worker is where event delivery and background jobs live, so without it the
  // outbox fills and nothing handles a job — the app looks like it works right
  // up until you check whether anything happened.
  const managed: Managed[] = [];

  for (const proc of dev.processes) {
    const cwd = proc.cwd ? path.join(project.root, proc.cwd) : project.root;
    // A process whose script this project does not have is skipped, not failed:
    // the same manifest serves a build with a worker and one without.
    if (proc.requires && !(await hasScript(cwd, proc.requires))) continue;
    if (!(await exists(cwd))) continue;

    const env: Record<string, string> = { ...plan.env };
    if (proc.port === 'api') env['PORT'] = String(apiPort);
    if (proc.port === 'web') {
      env['PORT'] = String(webPort);
      // The LAN address, not localhost. This value is baked into the browser
      // bundle, so `localhost` there means the PHONE's own localhost — the page
      // loads and every request fails, which looks like a broken API rather
      // than a wrong base URL.
      env['NEXT_PUBLIC_API_URL'] = `http://${host}:${apiPort}`;
    }

    managed.push({ label: proc.label, cwd, run: proc.run, env });
  }

  if (managed.length === 0) {
    p.outro('Nothing to run — this template declares no dev processes.');
    return;
  }

  const webProc = dev.processes.find((proc) => proc.port === 'web');
  const webUrl = webProc ? `http://${host}:${webPort}` : undefined;
  const showQr = Boolean(webUrl) && onLan && host !== 'localhost';

  const supervisor = supervise(managed);

  let quit: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    quit = resolve;
  });

  const keys: Hotkey[] = [
    { key: 'r', describe: 'restart all', run: () => supervisor.restart() },
    ...(webProc
      ? [{ key: 'f', describe: 'restart the front end', run: () => supervisor.restart(webProc.label) }]
      : []),
    { key: 'u', describe: 'show urls', run: () => console.log(`\n${urls.join('\n')}\n`) },
    ...(showQr
      ? [{ key: 's', describe: 'show the qr code', run: () => printQr(webUrl!, webProc!.label) }]
      : []),
    { key: 'c', describe: 'clear', run: () => console.clear() },
    { key: 'h', describe: 'help', run: () => console.log(`\n  ${hotkeyHelp(keys)}\n`) },
    { key: 'q', describe: 'stop', run: () => quit() },
  ];

  const release = onHotkeys(keys, quit);
  console.log(`\n  ${hotkeyHelp(keys)}\n`);

  // The QR comes AFTER the server answers, not with the startup banner. A code
  // printed while Next is still compiling gets scanned during those seconds and
  // shows a connection error, and the conclusion is that the feature is broken
  // rather than early.
  if (showQr) void announceOnLan(webUrl!, webProc!.label);

  // Whichever comes first: a process dying on its own, or the user quitting.
  // Sitting in a web-only foreground after the API has died, pretending things
  // are fine, is worse than stopping.
  await Promise.race([finished, supervisor.whenAnyExits]);

  release();
  await supervisor.stop();
  p.outro(`Stopped. ${pc.dim('Containers are still up — `si stop` takes them down.')}`);
}

/**
 * The reason, not the transcript.
 *
 * `docker compose up` narrates every container it touches, so dumping stderr
 * verbatim buried the one line that mattered under thirty lines of "Container
 * x Started". The error is the last thing it says; a port collision gets named
 * outright, because that one has an answer.
 */
function composeFailure(stderr: string): string {
  const lines = stderr.trim().split('\n').filter((l) => l.trim());
  const error = [...lines].reverse().find((l) => /error|failed|cannot|denied/i.test(l));

  const port = /Bind for [\d.]+:(\d+) failed: port is already allocated/.exec(stderr);
  if (port) {
    return (
      `port ${port[1]} is already taken by something outside this project.\n\n` +
      'si moves the ports it knows about, but a container left running from another\n' +
      'stack holds this one. Find it with:\n' +
      `  docker ps --filter publish=${port[1]}\n` +
      'then stop it, or stop this project with `si stop` and start it again.'
    );
  }
  return error ?? lines.at(-1) ?? 'docker compose exited non-zero with no output';
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

/**
 * Wait for the dev server to answer, then print a QR code for it.
 *
 * Scanning beats typing `http://192.168.1.40:3100` into a phone keyboard, and
 * typing it wrong is the most common reason "it does not work on my phone".
 *
 * Fails quietly: this sits on top of a URL that is already printed, so a
 * machine without QR support, or a server slower than the wait, must not turn a
 * working stack into an error.
 */
async function announceOnLan(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await answers(url)) {
      await printQr(url, label);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/** The QR itself. Also bound to a hotkey, so it can be asked for again. */
async function printQr(url: string, label: string): Promise<void> {
  try {
    const qr = (await import('qrcode-terminal')).default;
    qr.generate(url, { small: true }, (code: string) => {
      console.log(`\n${code}`);
      console.log(`  ${pc.cyan(url)}  ${pc.dim(`— the ${label}, on your phone`)}`);
      console.log(
        `  ${pc.dim('Same Wi-Fi as this machine. If it will not load, check the firewall.')}\n`,
      );
    });
  } catch {
    // No QR is fine; the URL is in the summary above.
  }
}

/** Does anything answer here yet? Any HTTP reply counts — even a 404. */
async function answers(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
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

/**
 * What is reachable, and where.
 *
 * Read from the compose file and the declared processes, never a fixed list.
 * Printing "the API" at a Flutter project, or a MinIO console for a project
 * scaffolded with `--storage none`, sends people to a dead tab — and a summary
 * that is wrong once stops being read.
 */
function runningUrls(
  dev: TemplateDev,
  compose: string,
  ports: Record<string, string>,
  apiPort: number,
  webPort: number,
  host: string,
): string[] {
  const at = (key: string, fallback: number) => Number(ports[key] ?? fallback);
  const urls: string[] = [];

  // The app's own two on the LAN address, so the line can be typed into a
  // phone. Everything below is a developer tool that stays on this machine.
  for (const proc of dev.processes) {
    if (proc.port === 'api') urls.push(`${pc.cyan(`http://${host}:${apiPort}`)}   ${proc.label}`);
    if (proc.port === 'web') urls.push(`${pc.cyan(`http://${host}:${webPort}`)}   ${proc.label}`);
  }

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
