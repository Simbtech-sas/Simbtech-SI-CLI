import path from 'node:path';
import { downloadTemplate } from 'giget';
import { copyDir } from './fsx.ts';

/**
 * Templates are real runnable projects living under `templates/` in the CLI's own
 * repo, fetched over the network at scaffold time. `SI_TEMPLATE_DIR` points at a
 * local checkout instead — that is what development and CI use, so there is one
 * code path and no bundled copy to drift.
 */
export const DEFAULT_TEMPLATE_REPO = 'SIMBTECH-SAS/boilerplates';

export interface FetchTemplateOptions {
  /** Git ref (tag/branch/sha). Defaults to the CLI's pinned template ref. */
  ref?: string;
  /** Override the source repo. Defaults to `SI_TEMPLATE_REPO` or the SIMBTECH repo. */
  repo?: string;
}

export function templateSource(flavor: string, opts: FetchTemplateOptions = {}): string {
  const repo = opts.repo ?? process.env['SI_TEMPLATE_REPO'] ?? DEFAULT_TEMPLATE_REPO;
  const ref = opts.ref ?? process.env['SI_TEMPLATE_REF'] ?? 'main';
  return `github:${repo}/templates/${flavor}#${ref}`;
}

/** Materialise `templates/<flavor>` into `dest`. Returns a description of the source used. */
export async function fetchTemplate(
  flavor: string,
  dest: string,
  opts: FetchTemplateOptions = {},
): Promise<string> {
  const local = process.env['SI_TEMPLATE_DIR'];
  if (local) {
    const from = path.resolve(local, flavor);
    await copyDir(from, dest);
    return from;
  }
  const source = templateSource(flavor, opts);
  await downloadTemplate(source, { dir: dest, force: true });
  return source;
}
