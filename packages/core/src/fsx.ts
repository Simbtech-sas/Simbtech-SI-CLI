import { readdir, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { SKIP_DIRS } from './skip.ts';

/**
 * Refuse to scaffold into a directory that already holds work. A lone `.git` is
 * fine — `git init && si new .` is a normal way to start.
 */
export async function assertEmptyDir(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  const blocking = entries.filter((e) => e !== '.git');
  if (blocking.length > 0) {
    throw new Error(
      `target "${dir}" is not empty (${blocking.slice(0, 3).join(', ')}` +
        `${blocking.length > 3 ? `, +${blocking.length - 3} more` : ''})`,
    );
  }
}

/**
 * Copy a template directory, leaving behind build output and installed
 * dependencies. Without the filter a local template that has been built and
 * installed copies its whole `node_modules` — hundreds of megabytes of files the
 * scaffolded project is about to install for itself anyway.
 */
export async function copyDir(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  await cp(from, to, {
    recursive: true,
    dereference: false,
    filter: (src) => !SKIP_DIRS.has(path.basename(src)),
  });
}
