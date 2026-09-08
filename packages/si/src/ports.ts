import { createServer } from 'node:net';

/**
 * Host ports, allocated rather than assumed.
 *
 * Two si projects, or one si project and anything else already using 5434,
 * used to collide with `address already in use` from the Docker daemon — a
 * message that names the port but not what to do about it. So every host port
 * in the compose file is `${NAME_HOST_PORT:-default}` and this picks the
 * values.
 */
export interface PortPlan {
  /** Env var name → the port to use. Passed to docker compose. */
  env: Record<string, string>;
  /** What actually got shifted, for reporting. */
  moved: Array<{ label: string; from: number; to: number }>;
}

/** Is anything listening? Binds rather than connects — a connect refused by a
 *  firewall looks free, and a bind is the same operation Docker will attempt. */
export function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    // 0.0.0.0, matching how Docker publishes: a port free on 127.0.0.1 can
    // still be taken on the interface the daemon binds.
    server.listen(port, '0.0.0.0');
  });
}

/**
 * The next free port at or after `from`, skipping anything already claimed in
 * this same run — two services that both default to 8080 must not both move to
 * 8081.
 */
export async function nextFree(from: number, taken: Set<number>): Promise<number> {
  for (let port = from; port < from + 200; port++) {
    if (taken.has(port)) continue;
    if (await isFree(port)) return port;
  }
  throw new Error(`no free port in ${from}..${from + 200}`);
}

export interface PortRequest {
  /** The env var the compose file reads, e.g. `POSTGRES_HOST_PORT`. */
  env: string;
  /** The default the compose file falls back to. */
  preferred: number;
  /** For the summary line. */
  label: string;
}

/** Assign every requested port, moving the ones already in use. */
export async function planPorts(requests: readonly PortRequest[]): Promise<PortPlan> {
  const env: Record<string, string> = {};
  const moved: PortPlan['moved'] = [];
  const taken = new Set<number>();

  for (const request of requests) {
    const port = await nextFree(request.preferred, taken);
    taken.add(port);
    env[request.env] = String(port);
    if (port !== request.preferred) {
      moved.push({ label: request.label, from: request.preferred, to: port });
    }
  }
  return { env, moved };
}

/**
 * The host ports a compose file publishes, read from the file itself.
 *
 * Parsed rather than listed here, so a tool the user added through `si add`
 * gets a port allocated too — its fragment was merged into this same file, and
 * a hardcoded list in the CLI would know nothing about it.
 */
export function readPortRequests(compose: string): PortRequest[] {
  const requests: PortRequest[] = [];
  const seen = new Set<string>();
  let service: string | null = null;
  let inPorts = false;

  for (const line of compose.split('\n')) {
    const svc = /^ {2}([a-z0-9][\w-]*):\s*$/.exec(line);
    if (svc) {
      service = svc[1]!;
      inPorts = false;
      continue;
    }
    if (/^ {4}ports:\s*$/.test(line)) {
      inPorts = true;
      continue;
    }
    if (/^ {4}[a-z_]+:/.test(line)) inPorts = false;
    if (!inPorts || !service) continue;

    // `- '${NAME_HOST_PORT:-1234}:5678'`
    const mapping = /^\s+- ['"]?\$\{([A-Z0-9_]+):-(\d+)\}:/.exec(line);
    if (!mapping) continue;
    const [, env, preferred] = mapping;
    if (seen.has(env!)) continue;
    seen.add(env!);
    requests.push({ env: env!, preferred: Number(preferred), label: service });
  }
  return requests;
}

/**
 * The names the shipped templates use, so a project migrated by the CLI ends up
 * with the same variables a freshly scaffolded one has. Anything not listed
 * falls back to `<SERVICE>_HOST_PORT`, numbered when a service publishes more
 * than one.
 */
const TEMPLATE_NAMES: Record<string, string[]> = {
  minio: ['MINIO_HOST_PORT', 'MINIO_CONSOLE_HOST_PORT'],
  mailpit: ['MAILPIT_SMTP_HOST_PORT', 'MAILPIT_HOST_PORT'],
  traefik: ['GATEWAY_HOST_PORT', 'GATEWAY_DASHBOARD_HOST_PORT'],
  redpanda: ['KAFKA_HOST_PORT', 'KAFKA_ADMIN_HOST_PORT'],
  'redpanda-console': ['KAFKA_CONSOLE_HOST_PORT'],
  postgres: ['POSTGRES_HOST_PORT'],
  redis: ['REDIS_HOST_PORT'],
};

export interface Parameterised {
  compose: string;
  /** `service: 9000` for each literal that became a variable. */
  changed: Array<{ service: string; port: number; env: string }>;
}

/**
 * Turn literal host ports into `${NAME_HOST_PORT:-default}`.
 *
 * Projects scaffolded before this existed have `- '9000:9000'` written out, and
 * a literal is not something the CLI can move — docker binds what the file
 * says. So the file is migrated once, in place, keeping every current port as
 * the default. Nothing about the running stack changes; the ports just become
 * something that CAN be moved when one is taken.
 *
 * Idempotent: a file that is already parameterised comes back unchanged.
 */
export function parameteriseCompose(compose: string): Parameterised {
  const lines = compose.split('\n');
  const changed: Parameterised['changed'] = [];
  const used = new Set<string>();
  let service: string | null = null;
  let inPorts = false;
  let nth = 0;

  for (const [i, line] of lines.entries()) {
    const svc = /^ {2}([a-z0-9][\w-]*):\s*$/.exec(line);
    if (svc) {
      service = svc[1]!;
      inPorts = false;
      nth = 0;
      continue;
    }
    if (/^ {4}ports:\s*$/.test(line)) {
      inPorts = true;
      continue;
    }
    if (/^ {4}[a-z_]+:/.test(line)) inPorts = false;
    if (!inPorts || !service) continue;

    // Only a literal `host:container`. An existing `${...}` is left alone, which
    // is what makes running this twice a no-op.
    const literal = /^(\s+- )['"]?(\d+):(\d+)['"]?(.*)$/.exec(line);
    if (!literal) continue;
    const [, indent, host, container, tail] = literal;

    nth += 1;
    const preferred = TEMPLATE_NAMES[service]?.[nth - 1];
    const generic =
      `${service.replace(/-/g, '_').toUpperCase()}_HOST_PORT` + (nth === 1 ? '' : `_${nth}`);
    let env = preferred ?? generic;
    // Two services publishing the same-named variable would move together.
    while (used.has(env)) env = `${generic}_${used.size}`;
    used.add(env);

    lines[i] = `${indent}'\${${env}:-${host}}:${container}'${tail}`;
    changed.push({ service, port: Number(host), env });
  }

  return { compose: lines.join('\n'), changed };
}
