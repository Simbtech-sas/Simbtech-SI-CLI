#!/usr/bin/env node
/**
 * The control plane, as a CLI.
 *
 * A web UI is the obvious next step and every operation below is already a pure
 * function over `state.json` — but the CLI is what makes the operations testable
 * and scriptable, and a form that calls an untested function is worse than no
 * form. Add the HTTP layer on top of these, not beside them.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { addNode, disruptionWarning, renderInventory, DEFAULT_SETTINGS, type ClusterNode, type ClusterSettings } from './cluster/inventory.ts';
import { generateService, generateToolService, generateLoadBalancing, type LoadBalancing } from './services/generate.ts';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STATE = path.join(REPO, 'cluster', 'state.json');

interface State {
  settings: ClusterSettings;
  nodes: ClusterNode[];
}

async function loadState(): Promise<State> {
  try {
    return JSON.parse(await readFile(STATE, 'utf8')) as State;
  } catch {
    return { settings: DEFAULT_SETTINGS, nodes: [] };
  }
}

async function saveState(state: State): Promise<void> {
  await mkdir(path.dirname(STATE), { recursive: true });
  await writeFile(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await writeFile(path.join(REPO, 'cluster', 'inventory.env'), renderInventory(state.nodes, state.settings), 'utf8');
}

/**
 * Read a tool's deployment facts from the si registry.
 *
 * Resolved from the installed @simbtech/si-tools package so the platform repo
 * carries no copy of the registry — one source of truth for what a tool is.
 */
async function loadToolDeploy(id: string): Promise<{
  image: string;
  port: number;
  needsDatabase?: boolean;
  env?: Record<string, string>;
  ingress?: boolean;
  storage?: string;
}> {
  interface RegistryTool {
    id: string;
    name: string;
    deploy?: {
      image: string;
      port: number;
      needsDatabase?: boolean;
      env?: Record<string, string>;
      ingress?: boolean;
      storage?: string;
    };
  }

  // Resolved at runtime, not statically: the platform repo depends on the
  // registry package but should still typecheck and run `node add` without it.
  const specifier = '@simbtech/si-tools';
  let tools: RegistryTool[];
  try {
    const mod = (await import(specifier)) as { loadRegistry: () => Promise<RegistryTool[]> };
    tools = await mod.loadRegistry();
  } catch {
    throw new Error(
      'the tool registry is not installed — run `npm --prefix apps/control-plane install @simbtech/si-tools`, ' +
        'or use --from nestjs to scaffold a service you write yourself',
    );
  }
  const tool = tools.find((t) => t.id === id);
  if (!tool) {
    throw new Error(
      `unknown tool "${id}". Run \`si list tools\` to see what is available, ` +
        'or use --from nestjs to scaffold a service you write yourself.',
    );
  }
  if (!tool.deploy) {
    throw new Error(
      `"${id}" is a client library, not a deployable server — there is nothing to run as a service. ` +
        `Use \`si add ${id}\` inside a service instead.`,
    );
  }
  return tool.deploy;
}

function arg(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** Refuses an unknown value rather than silently defaulting to shared. */
function parseDatabase(value: string | undefined): 'shared' | 'dedicated' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'shared' && value !== 'dedicated') {
    throw new Error(`--database must be shared or dedicated, got "${value}"`);
  }
  return value;
}

async function main(): Promise<void> {
  const [, , group, action, ...rest] = process.argv;

  if (group === 'node' && action === 'add') {
    const ip = arg(rest, '--ip');
    if (!ip) throw new Error('usage: node add --ip <address> [--role worker|control-plane] [--name n]');

    const state = await loadState();
    const warning = disruptionWarning(state.nodes);
    if (warning) console.warn(`\n  ! ${warning}\n`);

    const node = addNode(state.nodes, {
      ip,
      role: arg(rest, '--role') as ClusterNode['role'] | undefined,
      name: arg(rest, '--name'),
    }, state.settings);

    state.nodes.push(node);
    await saveState(state);

    console.log(`added ${node.name}  ${node.ip}  mesh ${node.wireguardIp}  (${node.role})`);
    console.log('\nnext:');
    console.log('  ./cluster/bootstrap-network.sh   # rebuilds the mesh across all nodes');
    console.log('  ./cluster/bootstrap-k3s.sh       # joins the new node only');
    return;
  }

  if (group === 'node' && action === 'list') {
    const { nodes } = await loadState();
    if (nodes.length === 0) return console.log('no nodes yet — `node add --ip <address>`');
    for (const n of nodes) {
      console.log(`  ${n.name.padEnd(18)} ${n.ip.padEnd(16)} ${n.wireguardIp.padEnd(12)} ${n.role}`);
    }
    return;
  }

  if (group === 'service' && action === 'add') {
    const name = rest[0];
    if (!name) {
      throw new Error(
        'usage: service add <name> [--from nestjs|<tool-id>] [--aggregates <a,b>] [--database shared|dedicated] [--repo <url>]\n' +
          '                          [--balancing round-robin|sticky|canary] [--canary-weight N]',
      );
    }

    const { settings } = await loadState();
    const from = arg(rest, '--from') ?? 'nestjs';

    let files;
    if (from === 'nestjs') {
      const spec = {
        name,
        brand: settings.brand,
        // Comma-separated: a service usually publishes more than one
        // aggregate, and each needs its own Kafka topic declared. Copy the list
        // from `allTopics()` in the service's @<brand>/events package.
        aggregates: arg(rest, '--aggregates')?.split(',').map((a) => a.trim()).filter(Boolean),
        // shared: a database of its own inside the platform cluster.
        // dedicated: a Postgres cluster of its own — its own CPU, disk, version
        // and WAL, at the cost of two more pods and another thing to upgrade.
        database: parseDatabase(arg(rest, '--database')),
        repoUrl: arg(rest, '--repo'),
        loadBalancing: arg(rest, '--balancing') as LoadBalancing | undefined,
        canaryWeight: Number(arg(rest, '--canary-weight') ?? 10),
      };
      files = [...generateService(spec), ...generateLoadBalancing(spec, `${name}-api`)];
    } else {
      // A tool from the registry, deployed as a service. The registry is the
      // source of the image, port and whether it needs a database — this file
      // should never hardcode a tool.
      const tool = await loadToolDeploy(from);
      const spec = {
        name,
        brand: settings.brand,
        rootDomain: arg(rest, '--domain'),
        loadBalancing: arg(rest, '--balancing') as LoadBalancing | undefined,
        canaryWeight: Number(arg(rest, '--canary-weight') ?? 10),
        tool: { id: from, ...tool },
      };
      files = [...generateToolService(spec), ...generateLoadBalancing(spec)];
    }

    for (const file of files) {
      const abs = path.join(REPO, file.path);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, file.contents, 'utf8');
      console.log(`  + ${file.path}`);
    }

    if (from === 'nestjs') {
      console.log('\nnext:');
      console.log(`  si new ../${name}-api -f sisaas -b ${settings.brand} -p service`);
      console.log('  then push that repo, and commit this one — Argo picks it up.');
    } else {
      console.log(`\n${from} will be deployed as "${name}". Commit and push.`);
    }
    return;
  }

  console.error('usage:\n  node add --ip <address>\n  node list\n  service add <name>');
  process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

// si:modules
