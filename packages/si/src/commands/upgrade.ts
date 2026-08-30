import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  applyProfile,
  brandTokens,
  choiceEffects,
  fetchTemplate,
  readManifest,
  resolveChoices,
  resolveProfile,
  substituteTokens,
  type ResolvedChoice,
} from '@simbtech/si-core';
import { findProject } from '../project.ts';
import { findFlavor, flavorTemplate } from '../flavors.ts';
import { fingerprint, type Fingerprint } from '../fingerprint.ts';
import { CLI_VERSION } from '../version.ts';

export interface UpgradeOptions {
  /** Template ref to upgrade to. Defaults to the CLI's own. */
  ref?: string;
  /** Report what would change and change nothing. */
  dryRun?: boolean;
  /** Take the new version of a file you edited, discarding your change. */
  force?: boolean;
}

interface ProjectRecord {
  flavor: string;
  brand: string;
  layout?: string;
  choices?: Record<string, string>;
  siVersion?: string;
  files?: Fingerprint;
}

type Verdict = 'added' | 'updated' | 'unchanged' | 'yours' | 'conflict';

interface Change {
  file: string;
  verdict: Verdict;
}

/**
 * Bring an existing project onto a newer template.
 *
 * The hard part is not fetching the new files, it is knowing which ones you are
 * allowed to write. A scaffold stops being ours the moment someone edits it, so
 * this never overwrites a file that differs from what we originally wrote. It
 * classifies instead:
 *
 *   added     — new in the template, you do not have it. Written.
 *   updated   — the template changed it, you never touched it. Written.
 *   yours     — you changed it, the template did not. Left alone.
 *   conflict  — you changed it AND the template changed it. Written beside it
 *               as `<file>.si-new` for you to merge. Never applied.
 *
 * That classification needs the hashes recorded at scaffold time. A project
 * made before those existed gets the honest fallback: everything that differs
 * is treated as a conflict, because we genuinely cannot tell.
 */
export async function upgrade(options: UpgradeOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' si upgrade ')));

  const project = await findProject();
  const record = JSON.parse(
    await readFile(path.join(project.root, '.si', 'project.json'), 'utf8'),
  ) as ProjectRecord;

  const flavor = findFlavor(record.flavor);
  if (!flavor) throw new Error(`this project records an unknown flavor "${record.flavor}"`);

  const from = record.siVersion ?? 'an unrecorded version';
  p.log.info(`${flavor.label} · ${from} → ${CLI_VERSION}`);

  const baseline = record.files;
  if (!baseline) {
    p.log.warn(
      'This project predates upgrade tracking, so there are no original hashes to\n' +
        'compare against. Every file that differs is reported as a conflict — that is\n' +
        'not pessimism, it is that we genuinely cannot tell your edit from ours.',
    );
  }

  // ── build what a fresh scaffold would look like today ─────────────────────
  const work = await mkdtemp(path.join(tmpdir(), 'si-upgrade-'));
  try {
    const spin = p.spinner();
    spin.start('Fetching the current template');
    const dest = path.join(work, 'next');
    await fetchTemplate(flavorTemplate(flavor), dest, { ref: options.ref });
    const manifest = await readManifest(dest);
    spin.stop('Template fetched');

    // Replay the SAME composition this project was built with. Anything else
    // would hand back a different project wearing the same name.
    const resolved = resolveProfile(manifest, record.layout);
    const choices: ResolvedChoice[] = resolveChoices(manifest, record.choices ?? {});
    const effects = choiceEffects(choices);
    const features = [...(resolved ? [resolved.name] : []), ...effects.features];
    await applyProfile(
      dest,
      {
        label: 'upgrade',
        description: '',
        remove: [...(resolved?.profile.remove ?? []), ...effects.remove],
        replace: { ...(resolved?.profile.replace ?? {}), ...effects.replace },
      },
      features[0] ?? 'default',
      features,
    );
    await substituteTokens(dest, brandTokens(record.brand), manifest.brandToken);

    // ── classify ────────────────────────────────────────────────────────────
    const incoming = await fingerprint(dest);
    const current = await fingerprint(project.root);
    const changes: Change[] = [];

    for (const [file, nextHash] of Object.entries(incoming)) {
      // `.si/project.json` is this project's own record, not template content.
      if (file === path.join('.si', 'project.json')) continue;

      const mine = current[file];
      const original = baseline?.[file];

      if (mine === undefined) {
        changes.push({ file, verdict: 'added' });
      } else if (mine === nextHash) {
        changes.push({ file, verdict: 'unchanged' });
      } else if (original !== undefined && mine === original) {
        // Untouched since scaffold, and the template moved. Safe.
        changes.push({ file, verdict: 'updated' });
      } else if (original !== undefined && nextHash === original) {
        // You changed it; the template did not. Yours.
        changes.push({ file, verdict: 'yours' });
      } else {
        changes.push({ file, verdict: 'conflict' });
      }
    }

    const by = (v: Verdict) => changes.filter((c) => c.verdict === v);
    const added = by('added');
    const updated = by('updated');
    const conflicts = by('conflict');
    const yours = by('yours');

    if (added.length + updated.length + conflicts.length === 0) {
      p.outro('Already up to date.');
      return;
    }

    p.note(
      [
        `${pc.green(String(added.length).padStart(4))}  new files`,
        `${pc.green(String(updated.length).padStart(4))}  updated, and you had not touched them`,
        `${pc.yellow(String(conflicts.length).padStart(4))}  changed by both — written as .si-new`,
        `${pc.dim(String(yours.length).padStart(4))}  yours, left alone`,
      ].join('\n'),
      'What this will do',
    );

    if (conflicts.length > 0) {
      p.log.warn(
        `Both changed:\n  ${conflicts.slice(0, 20).map((c) => c.file).join('\n  ')}` +
          (conflicts.length > 20 ? `\n  … and ${conflicts.length - 20} more` : ''),
      );
    }

    if (options.dryRun) {
      p.outro('Dry run — nothing written.');
      return;
    }

    // ── apply ───────────────────────────────────────────────────────────────
    spin.start('Writing');
    for (const change of [...added, ...updated]) {
      await copyInto(dest, project.root, change.file);
    }
    for (const change of conflicts) {
      if (options.force) {
        await copyInto(dest, project.root, change.file);
      } else {
        // Beside the file, never over it. A merge is a judgement call and this
        // command does not have the context to make it.
        await copyInto(dest, project.root, change.file, `${change.file}.si-new`);
      }
    }
    spin.stop(`Wrote ${added.length + updated.length + conflicts.length} file(s)`);

    // The new baseline is "the template content this project is now at" — NOT a
    // fresh fingerprint of the working tree.
    //
    // Fingerprinting the tree was the first thing I wrote and it is wrong in a
    // way that loses work: an unresolved conflict is still YOUR edit sitting on
    // disk, so recording it as the baseline makes the next upgrade see a
    // pristine file and overwrite you without asking. A file keeps its old
    // baseline until we actually apply the template's version of it.
    const nextBaseline: Fingerprint = { ...(baseline ?? {}) };
    for (const change of [...added, ...updated]) {
      nextBaseline[change.file] = incoming[change.file]!;
    }
    if (options.force) {
      for (const change of conflicts) nextBaseline[change.file] = incoming[change.file]!;
    }
    // Files the template no longer has stop being tracked; keeping them would
    // make a deletion upstream look like a conflict forever.
    for (const file of Object.keys(nextBaseline)) {
      if (!(file in incoming)) delete nextBaseline[file];
    }

    const rewritten: ProjectRecord = {
      ...record,
      siVersion: CLI_VERSION,
      files: nextBaseline,
    };
    await writeFile(
      path.join(project.root, '.si', 'project.json'),
      `${JSON.stringify(rewritten, null, 2)}\n`,
      'utf8',
    );

    p.note(
      [
        'pnpm install          # the template may have moved a dependency',
        'pnpm build            # nest build, not just typecheck',
        ...(conflicts.length > 0
          ? [`git diff             # then merge each .si-new and delete it`]
          : []),
      ].join('\n'),
      'Next',
    );
    p.outro(
      conflicts.length > 0
        ? `Upgraded, with ${conflicts.length} file(s) to merge by hand.`
        : 'Upgraded.',
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function copyInto(from: string, to: string, file: string, as = file): Promise<void> {
  const target = path.join(to, as);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(path.join(from, file)));
}
