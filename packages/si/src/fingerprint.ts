import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * A hash per file, so an upgrade can tell "the template changed this" from
 * "the user changed this".
 *
 * Without it there is no safe upgrade: a file that differs from the new
 * template might be one you edited or one we improved, and overwriting the
 * first to deliver the second is how a scaffold eats someone's afternoon.
 */
export type Fingerprint = Record<string, string>;

/** Never fingerprinted: generated, installed, or none of our business. */
const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage', '.env']);

/**
 * Walk a project.
 *
 * Symlinked DIRECTORIES are followed. `dirent.isDirectory()` is false for a
 * symlink, so trusting it skipped whole subtrees silently — and a subtree the
 * walk cannot see looks to `si upgrade` like files the project does not have,
 * which is a licence to write them. That is how an upgrade overwrote somebody's
 * `page.tsx`.
 *
 * `seen` guards the loop that following symlinks invites.
 */
export async function fingerprint(
  root: string,
  dir = root,
  seen = new Set<string>(),
): Promise<Fingerprint> {
  const out: Fingerprint = {};

  let here: string;
  try {
    here = await realpath(dir);
  } catch {
    return out;
  }
  if (seen.has(here)) return out; // a link pointing back up its own tree
  seen.add(here);

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);

    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      // What it POINTS AT decides, not the link itself.
      try {
        const target = await stat(abs);
        isDir = target.isDirectory();
        isFile = target.isFile();
      } catch {
        continue; // dangling link
      }
    }

    if (isDir) {
      Object.assign(out, await fingerprint(root, abs, seen));
    } else if (isFile) {
      try {
        out[path.relative(root, abs)] = hash(await readFile(abs));
      } catch {
        // Unreadable is not "absent". Recorded with a sentinel so an upgrade
        // treats it as present-and-unknown rather than as missing, which would
        // let it be written over.
        out[path.relative(root, abs)] = UNREADABLE;
      }
    }
  }
  return out;
}

/** A file that exists but could not be read. Never equal to any real hash. */
export const UNREADABLE = 'unreadable';

export function hash(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex').slice(0, 16);
}
