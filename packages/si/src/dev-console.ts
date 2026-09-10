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
  /**
   * Hold this one back until something answers here.
   *
   * The web app waits for the API. Started together, the API's boot — Nest logs
   * a line per route — scrolls past everything the web app said, including the
   * QR code, which is the one thing you wanted to look at.
   *
   * It is a wait, not a dependency: if nothing ever answers, the process starts
   * anyway once the deadline passes. A front end that will not start because
   * the API is down is worse than one that starts and shows the error.
   */
  waitFor?: { url: string; seconds: number };
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

  // Sequential, so a process that waits actually delays the ones after it.
  void (async () => {
    for (const [index, proc] of processes.entries()) {
      if (proc.waitFor) {
        const up = await answersWithin(proc.waitFor.url, proc.waitFor.seconds);
        // Starting anyway is right — a front end that shows the error beats one
        // that refuses to boot. Doing it SILENTLY is not: the console would
        // carry on to a QR code and look like a healthy start while the thing
        // it waited for is dead.
        if (!up) {
          out(
            `${pc.yellow('!')} ${pc.dim(
              `${proc.waitFor.url} never answered — starting ${proc.label} anyway, but expect it to fail`,
            )}\n`,
          );
        }
      }
      if (stopping) return;
      start(proc, index);
    }
  })();

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
        // On a full restart the ordering matters again; restarting one process
        // on its own does not wait, because whatever it waited for is already up.
        void (async () => {
          for (const proc of targets) {
            if (!label && proc.waitFor) await answersWithin(proc.waitFor.url, proc.waitFor.seconds);
            if (stopping) return;
            start(proc, processes.indexOf(proc));
          }
        })();
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

/**
 * Poll until something replies, or the deadline passes.
 *
 * Any HTTP answer counts, including a 404 — the question is whether the process
 * is listening, not whether that particular path exists.
 */
async function answersWithin(url: string, seconds: number): Promise<boolean> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
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
