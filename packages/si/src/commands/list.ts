import pc from 'picocolors';
import { byCategory, forFlavor, loadRegistry, CATEGORIES } from '@simbtech/si-tools';
import { findProject } from '../project.ts';

export interface ListOptions {
  category?: string;
  flavor?: string;
  all?: boolean;
}

export async function listTools(what: string | undefined, options: ListOptions): Promise<void> {
  if (what !== undefined && !['tools', 'features', 'all'].includes(what)) {
    throw new Error(`don't know how to list "${what}" — try tools, features or all`);
  }

  let tools = await loadRegistry();
  // Features are application code you would otherwise write again; tools are
  // external services you run. Different decisions, listed separately.
  if (what === 'features') tools = tools.filter((t) => t.kind === 'feature');
  else if (what !== 'all') tools = tools.filter((t) => t.kind !== 'feature');
  let scope = 'all flavors';

  // Inside a project, show what applies here. Outside one, show everything.
  if (!options.all) {
    const flavor = options.flavor ?? (await findProject().then((p) => p.manifest.id).catch(() => undefined));
    if (flavor) {
      tools = forFlavor(tools, flavor);
      scope = flavor;
    }
  }

  if (options.category) {
    if (!(CATEGORIES as readonly string[]).includes(options.category)) {
      throw new Error(
        `unknown category "${options.category}". One of: ${CATEGORIES.join(', ')}`,
      );
    }
    tools = tools.filter((t) => t.category === options.category);
  }

  console.log();
  const label = what === 'features' ? 'features' : what === 'all' ? 'entries' : 'tools';
  console.log(`${pc.bold(`${tools.length} ${label}`)} ${pc.dim(`(${scope})`)}`);

  for (const [category, list] of [...byCategory(tools)].sort(([a], [b]) => a.localeCompare(b))) {
    console.log();
    console.log(`  ${pc.cyan(category)}`);
    for (const t of list.sort((a, b) => a.id.localeCompare(b.id))) {
      console.log(`    ${t.id.padEnd(18)} ${t.summary}`);
      console.log(`    ${' '.repeat(18)} ${pc.dim(t.license)}`);
    }
  }
  console.log();
  console.log(pc.dim('  si add <id>...   to wire one in'));
  console.log();
}
