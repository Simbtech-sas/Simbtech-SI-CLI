import path from 'node:path';
import { access, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProject } from '../project.ts';

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
function run(cmd: string, args: string[], cwd: string, quiet = false): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: process.env,
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
  const compose = path.join(project.root, 'infra', 'docker-compose.yml');
  if (!(await exists(compose))) {
    throw new Error(`no infra/docker-compose.yml in ${project.root} — nothing to start`);
  }

  // ── env, before anything reads it ─────────────────────────────────────────
  const serverDir = path.join(project.root, project.manifest.targets['server'] ?? 'apps/server');
  const env = path.join(serverDir, '.env');
  if (!(await exists(env)) && (await exists(`${env}.example`))) {
    await copyFile(`${env}.example`, env);
    p.log.info(`created ${pc.dim('apps/server/.env')} from the example`);
  }

  // ── dependencies ──────────────────────────────────────────────────────────
  const spin = p.spinner();
  spin.start('Starting Postgres, Redis, Kafka, storage, mail and the gateway');
  const up = ['compose', '-f', compose, 'up', '-d'];
  if (options.scale) up.push('--scale', options.scale);
  const started = await run('docker', up, project.root, true);
  if (started.code !== 0) {
    spin.stop(pc.red('docker compose failed'));
    // The reason, verbatim. "Is Docker running?" is a guess, and it is wrong
    // every time the real cause is a port already in use.
    throw new Error(started.stderr.trim() || 'docker compose exited non-zero with no output');
  }
  spin.stop('Dependencies up');

  // ── wait for the database to ANSWER, not merely to exist ──────────────────
  //
  // A container that is "running" is not a Postgres that accepts connections.
  // Migrating too early fails with a connection error that reads like a bug in
  // the app, and that is the single most common way this goes wrong by hand.
  spin.start('Waiting for Postgres');
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    const probe = await run(
      'docker',
      ['compose', '-f', compose, 'exec', '-T', 'postgres', 'pg_isready', '-q'],
      project.root,
      true,
    );
    if (probe.code === 0) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) {
    spin.stop(pc.red('Postgres did not become ready'));
    throw new Error('Postgres never accepted a connection — check `pnpm infra:logs`');
  }
  spin.stop('Postgres ready');

  // ── migrations ────────────────────────────────────────────────────────────
  if (!options.skipMigrate) {
    spin.start('Applying migrations');
    const migrated = await run('pnpm', ['run', 'db:migrate'], project.root, true);
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

  p.note(
    [
      `${pc.cyan('http://localhost:8080')}   the API`,
      `${pc.cyan('http://localhost:3100')}   the web app`,
      `${pc.cyan('http://localhost:8090')}   through the gateway (Traefik)`,
      `${pc.cyan('http://localhost:8091')}   Traefik dashboard — routes and backends`,
      `${pc.cyan('http://localhost:8025')}   Mailpit — every email this app sends`,
      `${pc.cyan('http://localhost:8085')}   Redpanda console — topics and messages`,
      `${pc.cyan('http://localhost:9001')}   MinIO console`,
    ].join('\n'),
    'Running',
  );

  if (options.detach) {
    p.outro(`Dependencies are up. ${pc.dim('pnpm dev')} to start the app.`);
    return;
  }

  // Foreground, so Ctrl-C stops the app the way anyone expects. The stack stays
  // up on purpose: restarting Postgres and Kafka on every code change is the
  // slow loop this command exists to avoid. `si stop` takes them down.
  p.log.info(`Starting the app — ${pc.dim('Ctrl-C stops it; the stack keeps running')}`);
  await run('pnpm', ['run', 'dev'], project.root);
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
