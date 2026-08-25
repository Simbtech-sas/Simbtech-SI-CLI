import { rm, rename, access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TemplateProfile } from './manifest.ts';
import { SKIP_DIRS } from './skip.ts';

export interface ProfileResult {
  removed: string[];
  replaced: string[];
  /** Files whose profile-marked lines were pruned. */
  pruned: string[];
  /** Declared paths that were not there — a stale profile, worth surfacing. */
  missing: string[];
}

/**
 * `// si:when a,b` on a line means "keep this line only when feature a or b is
 * active". `si:profile` is the same thing under an older name — a profile is
 * just one more feature — and both are matched so existing templates keep working.
 *
 * Markers rather than variant files: an `app.module.keycloak.ts` beside an
 * `app.module.builtin.ts` is N copies of one file that drift independently, and
 * no CI run ever builds more than one of them. A marker keeps the single file CI
 * already compiles and makes the difference greppable.
 */
const PROFILE_MARKER = /(?:\/\/|#|--)\s*si:(?:when|profile)\s+([a-z0-9,\s._-]+)$/;

/**
 * A block form, for YAML and anything else where the unit is not a line.
 *
 *   # si:profile-begin identity,service
 *   ...several lines...
 *   # si:profile-end
 *
 * Marking every line of a compose service individually works but leaves the
 * template unreadable, and an unreadable template is one nobody edits correctly.
 */
const BLOCK_BEGIN = /(?:\/\/|#|--)\s*si:(?:when|profile)-begin\s+([a-z0-9,\s._-]+)$/;
const BLOCK_END = /(?:\/\/|#|--)\s*si:(?:when|profile)-end\s*$/;

/** A marker is satisfied when ANY of its features is active. */
function allows(list: string, active: ReadonlySet<string>): boolean {
  return list
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .some((feature) => active.has(feature));
}

export function pruneProfileLines(source: string, features: string | ReadonlySet<string>): string {
  const active = typeof features === 'string' ? new Set([features]) : features;
  const kept: string[] = [];
  let skippingBlock: boolean | undefined;

  for (const line of source.split('\n')) {
    const trimmed = line.trimEnd();

    const begin = BLOCK_BEGIN.exec(trimmed);
    if (begin) {
      skippingBlock = !allows(begin[1]!, active);
      continue;
    }
    if (BLOCK_END.test(trimmed)) {
      skippingBlock = undefined;
      continue;
    }
    if (skippingBlock) continue;

    const match = PROFILE_MARKER.exec(trimmed);
    if (!match) {
      kept.push(line);
      continue;
    }
    if (!allows(match[1]!, active)) continue;
    // Keep the line, drop the marker — the shipped file should not carry
    // instructions for a decision that has already been made.
    kept.push(line.replace(PROFILE_MARKER, '').trimEnd());
  }
  return kept.join('\n');
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trim a scaffolded project down to one profile.
 *
 * Removal rather than assembly: the template stays a single runnable project
 * that CI builds and tests as a whole, and a profile is a subtraction from
 * something known to work. Assembling from fragments means no profile is ever
 * exercised end to end until someone scaffolds it.
 *
 * A declared path that does not exist is reported, not ignored — it means the
 * profile has drifted from the template, and silently doing nothing is how a
 * `service` build ends up shipping the identity tables.
 */
export async function applyProfile(
  dir: string,
  profile: TemplateProfile,
  profileName: string,
  extraFeatures: readonly string[] = [],
): Promise<ProfileResult> {
  const active = new Set([profileName, ...extraFeatures]);
  const result: ProfileResult = { removed: [], replaced: [], pruned: [], missing: [] };

  // Swap variants in FIRST. A choice commonly removes the directory the variant
  // came from, and doing that before the rename deletes its own source.
  for (const [target, source] of Object.entries(profile.replace ?? {})) {
    const from = path.join(dir, source);
    const to = path.join(dir, target);
    if (!(await exists(from))) {
      result.missing.push(source);
      continue;
    }
    await rename(from, to);
    result.replaced.push(target);
  }

  for (const target of profile.remove) {
    const abs = path.join(dir, target);
    if (!(await exists(abs))) {
      result.missing.push(target);
      continue;
    }
    await rm(abs, { recursive: true, force: true });
    result.removed.push(target);
  }

  await pruneTree(dir, dir, active, result);

  return result;
}

/**
 * Every text file is scanned, detected by content rather than by extension.
 *
 * An allowlist of extensions is a bug waiting for the next language: `.toml`,
 * `.rs` and `.dart` were all missing from one, so markers in a Cargo manifest
 * were silently ignored and the template shipped both variants.
 */
function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

async function pruneTree(
  root: string,
  dir: string,
  active: ReadonlySet<string>,
  result: ProfileResult,
): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await pruneTree(root, path.join(dir, entry.name), active, result);
      continue;
    }
    const abs = path.join(dir, entry.name);
    const raw = await readFile(abs);
    if (isBinary(raw)) continue;
    const source = raw.toString('utf8');
    // Both marker spellings, or a file using only the new one is skipped whole.
    if (!source.includes('si:when') && !source.includes('si:profile')) continue;

    const next = pruneProfileLines(source, active);
    if (next !== source) {
      await writeFile(abs, next, 'utf8');
      result.pruned.push(path.relative(root, abs));
    }
  }
}
