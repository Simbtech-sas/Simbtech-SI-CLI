import path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { findProject } from '../project.ts';
import { newProject } from './new.ts';

export interface ApiOptions {
  auth?: string;
  tool?: string[];
  skipInstall?: boolean;
  yes?: boolean;
  /** Where services live. Defaults to `services/`. */
  dir?: string;
}

interface ProjectRecord {
  brand?: string;
  layout?: string;
  data?: string;
  choices?: Record<string, string>;
}

/**
 * Add another API to an existing project.
 *
 * This is `si new` pointed at a subdirectory, with every answer it can reuse
 * taken from the parent rather than asked again. Two services that disagree
 * about auth or data topology is not a choice anybody made — it is a question
 * that got asked twice.
 */
export async function addApi(name: string, options: ApiOptions): Promise<void> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `"${name}" is not a valid service name — lowercase letters, digits and hyphens. ` +
        'It becomes a directory, an npm scope entry and a Kubernetes object name.',
    );
  }

  const project = await findProject();
  const record = await readRecord(project.root);

  const servicesDir = options.dir ?? 'services';
  const target = path.join(project.root, servicesDir, name);

  // A feature service cannot use the built-in identity — that would give it its
  // own user store and its own token issuer, a second answer to "who is this
  // user". Inherit the parent's choice when it is a real one.
  const inherited = record.choices?.['auth'];
  const auth =
    options.auth ?? (inherited && inherited !== 'builtin' ? inherited : undefined);

  if (!auth && !options.yes) {
    p.log.warn(
      `the parent project uses ${pc.bold(inherited ?? 'the built-in identity')}, which a service ` +
        'cannot share. Pick an issuer for this service.',
    );
  }

  await newProject(target, {
    flavor: 'sisaas',
    brand: project.brand,
    profile: 'service',
    // Recorded once at the root and reused, so services cannot drift apart on
    // the one decision that has to match.
    data: record.data,
    auth,
    tool: options.tool,
    skipInstall: options.skipInstall,
    yes: options.yes,
    label: `si api ${name}`,
  });

  p.log.info(
    `${pc.bold(name)} lives in ${pc.dim(path.join(servicesDir, name))}. ` +
      `It publishes on its own topics — add them to the platform with ` +
      `${pc.cyan(`si service add ${name} --aggregates <a,b>`)} in your ops repo.`,
  );
}

async function readRecord(root: string): Promise<ProjectRecord> {
  try {
    return JSON.parse(
      await readFile(path.join(root, '.si', 'project.json'), 'utf8'),
    ) as ProjectRecord;
  } catch {
    // A project scaffolded before project.json existed. Not an error — just
    // nothing to inherit, so every answer is asked.
    return {};
  }
}
