import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
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

export async function fingerprint(root: string, dir = root): Promise<Fingerprint> {
  const out: Fingerprint = {};
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(out, await fingerprint(root, abs));
    } else if (entry.isFile()) {
      out[path.relative(root, abs)] = hash(await readFile(abs));
    }
  }
  return out;
}

export function hash(contents: Buffer | string): string {
  return createHash('sha256').update(contents).digest('hex').slice(0, 16);
}
