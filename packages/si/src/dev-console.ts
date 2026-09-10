import { spawn, type ChildProcess } from 'node:child_process';
import pc from 'picocolors';

/**
 * One dev process, and how to tell its output apart from the others'.
 *
 * Before this, everything inherited the terminal: Nest's routes, Next's
 * compiles and the worker's logs arrived interleaved and unlabelled, and the
 * first question about any line was which process wrote it.
 */
export interface Managed {
  label: string;
  cwd: string;
  run: string[];
  env: Record<string, string>;
}

/** Enough colours to keep three or four processes apart, reused beyond that. */
const COLOURS = [pc.cyan, pc.magenta, pc.yellow, pc.blue, pc.green] as const;

export interface Supervisor {
  /** Stop everything. Safe to call twice. */
  stop(): Promise<void>;
  /** Restart one process by label, or all of them. */
  restart(label?: string): void;
  /** Resolves when a process exits on its own. */
  whenAnyExits: Promise<string>;
  labels: string[];
}

/**
 * Run the dev processes, label their output, and let them be restarted.
 *
 * Output is piped rather than inherited so each line can be prefixed. The cost
 * is that a child no longer sees a TTY, which turns off its own progress
 * spinners — worth it, because a spinner from one of three processes is noise
 * anyway, and knowing which process is talking is not. FORCE_COLOR keeps the
 * colours that piping would otherwise strip.
 */
export function supervise(
  processes: Managed[],
  // Injectable so a test can read what was written without monkey-patching
  // process.stdout — doing that swallowed the test reporter's own output and
  // three unrelated tests vanished from the run.
  out: (line: string) => void = (line) => void process.stdout.write(line),
): Supervisor {
  const children = new Map<string, ChildProcess>();
  const width = Math.max(...processes.map((proc) => proc.label.length));
  let stopping = false;
  let announceExit: (label: string) => void = () => {};
  const whenAnyExits = new Promise<string>((resolve) => {
    announceExit = resolve;
  });

  function start(proc: Managed, index: number): void {
    const paint = COLOURS[index % COLOURS.length]!;
    const tag = paint(proc.label.padEnd(width));
    const [cmd, ...args] = proc.run;

    const child = spawn(cmd!, args, {
      cwd: proc.cwd,
      env: { ...process.env, ...proc.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // A chunk is not a line. Without this, a log split across two reads gets a
    // prefix in the middle of itself, which is worse than no prefix at all.
    const prefixed = (stream: NodeJS.ReadableStream | null): void => {
      let rest = '';
      stream?.on('data', (chunk: Buffer) => {
        const lines = (rest + chunk.toString()).split('\n');
        rest = lines.pop() ?? '';
        for (const line of lines) {
          // A blank line stays blank; a prefixed empty line is noise in output
          // that already has plenty.
          out(line.trim() ? `${tag} ${pc.dim('|')} ${line}\n` : '\n');
        }
      });
    };
    prefixed(child.stdout);
    prefixed(child.stderr);

    child.on('exit', (code) => {
      children.delete(proc.label);
      if (stopping) return;
      out(`${tag} ${pc.dim('|')} ${pc.dim(`exited (${code ?? 0})`)}\n`);
      announceExit(proc.label);
    });

    children.set(proc.label, child);
  }

  processes.forEach(start);

  return {
    whenAnyExits,
    labels: processes.map((proc) => proc.label),
    restart(label) {
      const targets = label ? processes.filter((proc) => proc.label === label) : processes;
      for (const proc of targets) {
        children.get(proc.label)?.kill('SIGTERM');
        children.delete(proc.label);
      }
      // A moment for the port to come free. Restarting straight into "address
      // already in use" is the failure this avoids, and it reads like a crash.
      setTimeout(() => {
        for (const proc of targets) start(proc, processes.indexOf(proc));
      }, 400);
    },
    async stop() {
      stopping = true;
      for (const child of children.values()) child.kill('SIGTERM');
      // A beat to close sockets and flush, then insist.
      await new Promise((resolve) => setTimeout(resolve, 600));
      for (const child of children.values()) child.kill('SIGKILL');
      children.clear();
    },
  };
}

export interface Hotkey {
  key: string;
  describe: string;
  run: () => void | Promise<void>;
}

/** The one-line reminder, printed at startup and on `h`. */
export function hotkeyHelp(keys: Hotkey[]): string {
  return keys.map((k) => `${pc.bold(k.key)} ${pc.dim(k.describe)}`).join(pc.dim('  ·  '));
}

const CTRL_C = '\u0003';
const CTRL_D = '\u0004';

/**
 * Listen for single keypresses, the way a dev server does.
 *
 * Raw mode only when there is a TTY. Under CI, or with output piped to a file,
 * stdin is not a terminal and setRawMode throws — a dev server that cannot run
 * under `si start dev > log.txt` would be a poor trade for a shortcut.
 *
 * Returns a function that puts the terminal back.
 */
export function onHotkeys(keys: Hotkey[], onQuit: () => void): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};

  const table = new Map(keys.map((k) => [k.key, k]));
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  const handler = (data: string): void => {
    // Raw mode means the terminal no longer turns Ctrl-C into SIGINT, so
    // quitting has to be handled here or the process cannot be stopped at all.
    if (data === CTRL_C || data === CTRL_D) {
      onQuit();
      return;
    }
    void table.get(data.toLowerCase())?.run();
  };

  stdin.on('data', handler);
  return () => {
    stdin.off('data', handler);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };
}
