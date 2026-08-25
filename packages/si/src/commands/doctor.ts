import pc from 'picocolors';
import { FLAVORS } from '../flavors.ts';
import { TOOLS, PACKAGE_MANAGERS, probe, toolsFor } from '../toolchain.ts';

export async function doctor(): Promise<void> {
  console.log();
  console.log(pc.bold('si doctor') + pc.dim(' — toolchain check'));
  console.log();

  const results = await Promise.all(
    TOOLS.map(async (tool) => ({ tool, probe: await probe(tool.bin, tool.args, tool.min) })),
  );

  let blocking = 0;
  for (const { tool, probe: p } of results) {
    const universal = tool.requiredFor.length === 0;
    const scope = universal ? pc.dim('all flavors') : pc.dim(tool.requiredFor.join(', '));
    let mark: string;
    let detail: string;
    if (!p.found) {
      mark = universal ? pc.red('x') : pc.yellow('o');
      detail = pc.dim(`not found — ${tool.hint}`);
      if (universal) blocking++;
    } else if (p.tooOld) {
      mark = pc.red('x');
      detail = pc.red(`${p.version} — need >= ${tool.min}`);
      if (universal) blocking++;
    } else {
      mark = pc.green('v');
      detail = p.version ?? 'installed';
    }
    console.log(`  ${mark} ${tool.label.padEnd(14)} ${detail.padEnd(34)} ${scope}`);
  }

  const managers = await Promise.all(
    PACKAGE_MANAGERS.map(async (pm) => ({ pm, probe: await probe(pm, ['--version']) })),
  );
  const available = managers.filter((m) => m.probe.found);
  if (available.length === 0) {
    console.log(`  ${pc.red('x')} ${'Package mgr'.padEnd(14)} ${pc.dim('none of pnpm/npm/yarn/bun found')}`);
    blocking++;
  } else {
    const list = available.map((m) => `${m.pm} ${m.probe.version ?? ''}`.trim()).join(', ');
    console.log(`  ${pc.green('v')} ${'Package mgr'.padEnd(14)} ${list.padEnd(34)} ${pc.dim('all flavors')}`);
  }

  console.log();
  if (blocking > 0) {
    console.log(pc.red(`${blocking} blocking issue(s) — fix these before scaffolding anything.`));
    console.log();
    process.exitCode = 1;
    return;
  }

  const missing = new Set(results.filter((r) => !r.probe.found || r.probe.tooOld).map((r) => r.tool.id));

  // Scaffolding needs the build tools. The operate tools are reported separately
  // because not having kubectl yet is not a reason to be unable to start.
  const ready = FLAVORS.filter((f) => toolsFor(f.id, 'build').every((t) => !missing.has(t)));
  const blocked = FLAVORS.filter((f) => !ready.includes(f));

  console.log(pc.green(`Ready to scaffold: ${ready.map((f) => f.id).join(', ') || '(none)'}`));
  for (const f of blocked) {
    console.log(pc.red(`  ${f.id} cannot be built without ${toolsFor(f.id, 'build').filter((t) => missing.has(t)).join(', ')}`));
  }

  const laterGaps = FLAVORS.map((f) => ({
    flavor: f.id,
    tools: toolsFor(f.id, 'operate').filter((t) => missing.has(t)),
  })).filter((g) => g.tools.length > 0);

  if (laterGaps.length > 0) {
    console.log();
    console.log(pc.dim('Needed to run or deploy, not to scaffold:'));
    for (const gap of laterGaps) {
      console.log(pc.dim(`  ${gap.flavor} will need ${gap.tools.join(', ')}`));
    }
  }
  console.log();
}
