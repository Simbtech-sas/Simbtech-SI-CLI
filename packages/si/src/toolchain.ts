import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseVersion, atLeast } from './version.ts';
import type { FlavorId } from './flavors.ts';

const run = promisify(execFile);

export interface Tool {
  id: string;
  label: string;
  bin: string;
  args: string[];
  min?: string;
  /**
   * Flavors that need this tool. An empty list means every flavor does.
   */
  requiredFor: readonly FlavorId[];
  /**
   * When the tool is needed.
   *
   * `build` — you cannot compile the scaffolded project without it, so `si new`
   * refuses rather than handing over a directory that will not build.
   * `operate` — needed to run or deploy, not to scaffold. Warn and continue:
   * refusing would mean you cannot lay down an infra repo on a laptop that
   * happens not to have kubectl yet.
   */
  phase: 'build' | 'operate';
  hint: string;
}

export const TOOLS: readonly Tool[] = [
  { id: 'node', label: 'Node.js', bin: 'node', args: ['-v'], min: '20.0.0', requiredFor: [], phase: 'build', hint: 'https://nodejs.org — or use nvm' },
  { id: 'git', label: 'Git', bin: 'git', args: ['--version'], requiredFor: [], phase: 'build', hint: 'apt install git' },
  { id: 'cargo', label: 'Rust (cargo)', bin: 'cargo', args: ['--version'], requiredFor: ['simice'], phase: 'build', hint: 'https://rustup.rs' },
  { id: 'flutter', label: 'Flutter', bin: 'flutter', args: ['--version'], requiredFor: ['sibile-flutter'], phase: 'build', hint: 'https://docs.flutter.dev/get-started/install' },
  { id: 'docker', label: 'Docker', bin: 'docker', args: ['--version'], requiredFor: ['sisaas', 'platform'], phase: 'operate', hint: 'https://docs.docker.com/engine/install' },
  { id: 'kubectl', label: 'kubectl', bin: 'kubectl', args: ['version', '--client'], requiredFor: ['platform'], phase: 'operate', hint: 'https://kubernetes.io/docs/tasks/tools' },
];

export const PACKAGE_MANAGERS = ['pnpm', 'npm', 'yarn', 'bun'] as const;

export interface Probe {
  found: boolean;
  version?: string;
  tooOld?: boolean;
}

export async function probe(bin: string, args: string[], min?: string): Promise<Probe> {
  try {
    const { stdout, stderr } = await run(bin, args, { timeout: 15_000 });
    const version = parseVersion(stdout || stderr);
    return { found: true, version, tooOld: min && version ? !atLeast(version, min) : false };
  } catch {
    return { found: false };
  }
}

/** Tool ids a flavor needs, derived from the tool table so the two cannot drift. */
export function toolsFor(flavor: FlavorId, phase?: Tool['phase']): string[] {
  return TOOLS.filter(
    (t) => t.requiredFor.includes(flavor) && (phase === undefined || t.phase === phase),
  ).map((t) => t.id);
}
