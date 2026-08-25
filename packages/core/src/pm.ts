import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);

export const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

/**
 * Resolve the package manager for a project, in descending order of authority:
 * the `packageManager` field, then a lockfile, then the agent that launched us,
 * then pnpm. Walks up to the repo root so a package inside a monorepo resolves
 * to the workspace's manager.
 */
export function detectPackageManager(cwd: string): PackageManager {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const field = readPackageManagerField(pkgPath);
      if (field) return field;
    }
    for (const [lockfile, pm] of LOCKFILES) {
      if (existsSync(path.join(dir, lockfile))) return pm;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
  }
  return fromUserAgent() ?? 'pnpm';
}

function readPackageManagerField(pkgPath: string): PackageManager | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const field = (raw as { packageManager?: unknown }).packageManager;
    if (typeof field !== 'string') return undefined;
    const name = field.split('@')[0];
    return name && isPackageManager(name) ? name : undefined;
  } catch {
    return undefined;
  }
}

function fromUserAgent(): PackageManager | undefined {
  const name = process.env['npm_config_user_agent']?.split('/')[0];
  return name && isPackageManager(name) ? name : undefined;
}

function addArgs(pm: PackageManager, deps: string[], dev: boolean): string[] {
  switch (pm) {
    case 'npm':
      return ['install', dev ? '--save-dev' : '--save', ...deps];
    case 'yarn':
      return ['add', ...(dev ? ['--dev'] : []), ...deps];
    case 'bun':
      return ['add', ...(dev ? ['--dev'] : []), ...deps];
    case 'pnpm':
      return ['add', ...(dev ? ['--save-dev'] : []), ...deps];
  }
}

export interface AddDependenciesOptions {
  dev?: boolean;
  packageManager?: PackageManager;
  /** Workspace package to install into, for pnpm/yarn monorepos. */
  filter?: string;
}

/**
 * Install dependencies into a project. Uses execFile with an argument array —
 * never a shell string — so a dependency name from a registry file cannot inject
 * a command.
 */
export async function addDependencies(
  cwd: string,
  deps: string[],
  opts: AddDependenciesOptions = {},
): Promise<void> {
  if (deps.length === 0) return;
  const pm = opts.packageManager ?? detectPackageManager(cwd);
  const args = addArgs(pm, deps, opts.dev ?? false);
  if (opts.filter && (pm === 'pnpm' || pm === 'yarn')) args.unshift('--filter', opts.filter);
  await run(pm, args, { cwd });
}

export async function installAll(cwd: string, pm?: PackageManager): Promise<void> {
  await run(pm ?? detectPackageManager(cwd), ['install'], { cwd });
}
