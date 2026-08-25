import { readdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BrandTokens } from './brand.ts';
import { templateTokens } from './brand.ts';
import { SKIP_DIRS } from './skip.ts';

/** Files whose bytes we never rewrite. Detected by content, not extension. */
function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

export interface SubstituteResult {
  /** Files whose contents changed. */
  filesChanged: number;
  /** Paths renamed because a file or directory name contained the token. */
  pathsRenamed: number;
}

/**
 * Rewrite the template brand to the project brand, in file contents and in paths.
 *
 * Content substitution is two literal, case-sensitive replacements — no templating
 * engine. Path substitution matters for templates that encode the brand in
 * directory names (Flutter's `android/app/src/main/kotlin/com/simbkit/...`, Rust
 * crate dirs); it is a no-op for templates that don't.
 */
export async function substituteTokens(
  dir: string,
  to: BrandTokens,
  from: BrandTokens = templateTokens,
): Promise<SubstituteResult> {
  const result: SubstituteResult = { filesChanged: 0, pathsRenamed: 0 };
  await walk(dir, from, to, result);
  return result;
}

function swap(text: string, from: BrandTokens, to: BrandTokens): string {
  // Order is irrelevant: no case variant is a substring of another.
  return text
    .split(from.lower)
    .join(to.lower)
    .split(from.capital)
    .join(to.capital)
    .split(from.upper)
    .join(to.upper);
}

async function walk(
  dir: string,
  from: BrandTokens,
  to: BrandTokens,
  result: SubstituteResult,
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walk(full, from, to, result);
    } else if (entry.isFile()) {
      const buf = await readFile(full);
      if (isBinary(buf)) continue;
      const original = buf.toString('utf8');
      const next = swap(original, from, to);
      if (next !== original) {
        await writeFile(full, next, 'utf8');
        result.filesChanged++;
      }
    }
  }

  // Rename after descending, so children are handled under their old path first.
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const renamed = swap(entry.name, from, to);
    if (renamed === entry.name) continue;
    const target = path.join(dir, renamed);
    if (await exists(target)) {
      throw new Error(`cannot rename ${path.join(dir, entry.name)} -> ${target}: target exists`);
    }
    await rename(path.join(dir, entry.name), target);
    result.pathsRenamed++;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
