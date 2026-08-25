import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { readManifest, type TemplateManifest } from '@simbtech/si-core';

export interface Project {
  root: string;
  manifest: TemplateManifest;
  /** npm scope of the project, e.g. `acme` for `@acme/server`. */
  brand: string;
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
 * Find the project root by walking up for `.si/template.json`. That file is what
 * tells the CLI where this template keeps its server app, compose file and
 * anchors — without it there is nothing to add a tool to.
 */
export async function findProject(from: string = process.cwd()): Promise<Project> {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (await exists(path.join(dir, '.si', 'template.json'))) {
      const manifest = await readManifest(dir);
      return { root: dir, manifest, brand: await readBrand(dir) };
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        'not inside a si project (no .si/template.json found walking up). ' +
          'Run this from a project created by `si new`.',
      );
    }
  }
}

async function readBrand(root: string): Promise<string> {
  try {
    const pkg: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const name = (pkg as { name?: string }).name ?? '';
    // Root package.json of a scaffolded project is named after the brand.
    return name.replace(/^@/, '').split('/')[0] ?? 'app';
  } catch {
    return 'app';
  }
}
