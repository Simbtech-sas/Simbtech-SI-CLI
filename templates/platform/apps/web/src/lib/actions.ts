'use server';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import {
  addNode,
  disruptionWarning,
  generateLoadBalancing,
  generateService,
  loadState,
  saveState,
  REPO,
  type ClusterNode,
  type GeneratedFile,
  type LoadBalancing,
  type NodeRole,
} from '@simbkit/control-plane';

/**
 * The UI's whole server side.
 *
 * Every function here is a thin wrapper over the control plane's own — the same
 * ones `apps/control-plane/src/main.ts` calls. Nothing about placing a node or
 * generating a service is decided in this file, because two implementations of
 * "add a node" is how the datastore and the mesh drift apart.
 *
 * These run on the server only. They touch the repo's own files, so the app has
 * to be running where the repo is — which is the point: this is an operator
 * tool, not something to expose on the internet.
 */

export interface ClusterView {
  nodes: ClusterNode[];
  brand: string;
  wireguardCidr: string;
  /** Set when adding a node will restart the mesh on the existing ones. */
  warning: string | null;
}

export async function getCluster(): Promise<ClusterView> {
  const state = await loadState();
  return {
    nodes: state.nodes,
    brand: state.settings.brand,
    wireguardCidr: state.settings.wireguardCidr,
    warning: disruptionWarning(state.nodes),
  };
}

export type ActionResult =
  | { ok: true; message: string; detail?: string[] }
  | { ok: false; error: string };

export async function addNodeAction(input: {
  ip: string;
  role?: NodeRole;
  name?: string;
}): Promise<ActionResult> {
  try {
    const state = await loadState();
    // `addNode` validates the address, refuses a second control plane and
    // allocates the mesh IP. Let it throw — its messages are the good ones.
    const node = addNode(state.nodes, input, state.settings);
    state.nodes.push(node);
    await saveState(state);
    revalidatePath('/nodes');
    return {
      ok: true,
      message: `Added ${node.name} — ${node.ip}, mesh ${node.wireguardIp} (${node.role})`,
      // The UI cannot SSH anywhere, and pretending otherwise would be worse
      // than saying what to run. These are the two scripts that do the work.
      detail: [
        './cluster/bootstrap-network.sh   # rebuilds the mesh across all nodes',
        './cluster/bootstrap-k3s.sh       # joins the new node only',
      ],
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function addServiceAction(input: {
  name: string;
  aggregates?: string;
  database?: 'shared' | 'dedicated';
  repoUrl?: string;
  loadBalancing?: LoadBalancing;
  replicas?: number;
  canaryWeight?: number;
}): Promise<ActionResult> {
  try {
    const { settings } = await loadState();
    const spec = {
      name: input.name,
      brand: settings.brand,
      aggregates: input.aggregates?.split(',').map((a) => a.trim()).filter(Boolean),
      database: input.database,
      repoUrl: input.repoUrl || undefined,
      loadBalancing: input.loadBalancing,
      replicas: input.replicas,
      canaryWeight: input.canaryWeight,
    };
    const files: GeneratedFile[] = [
      ...generateService(spec),
      ...generateLoadBalancing(spec, `${input.name}-api`),
    ];
    await Promise.all(
      files.map(async (file) => {
        const abs = path.join(REPO, file.path);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, file.contents, 'utf8');
      }),
    );
    revalidatePath('/services');
    return {
      ok: true,
      message: `Generated ${files.length} file(s) for ${input.name}`,
      detail: files.map((f) => f.path),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
