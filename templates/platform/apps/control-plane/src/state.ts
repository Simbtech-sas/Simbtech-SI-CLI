import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderInventory,
  DEFAULT_SETTINGS,
  type ClusterNode,
  type ClusterSettings,
} from './cluster/inventory.ts';

/**
 * The cluster's state, and the two functions that read and write it.
 *
 * Extracted from the CLI so the web UI drives the SAME code rather than a
 * second implementation. Two writers of `state.json` that disagree about
 * `inventory.env` is how a node ends up in the datastore and not in the mesh.
 */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const STATE_FILE = path.join(REPO, 'cluster', 'state.json');

export interface State {
  settings: ClusterSettings;
  nodes: ClusterNode[];
}

export async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return { settings: DEFAULT_SETTINGS, nodes: [] };
  }
}

/**
 * Writes `state.json` AND regenerates `inventory.env` from it.
 *
 * Never write one without the other: the shell scripts read `inventory.env`,
 * so a state file that has moved ahead of it means the next bootstrap run
 * configures a cluster that no longer matches.
 */
export async function saveState(state: State): Promise<void> {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await writeFile(
    path.join(REPO, 'cluster', 'inventory.env'),
    renderInventory(state.nodes, state.settings),
    'utf8',
  );
}
