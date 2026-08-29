import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pc from 'picocolors';
import {
  evaluate,
  fixesFor,
  listFrameworks,
  loadFramework,
  summarise,
  type Finding,
  type Status,
} from '@simbtech/si-tools';
import { findProject } from '../project.ts';

export interface ComplianceOptions {
  framework?: string;
  /** Write docs/compliance/<framework>.md instead of only printing. */
  write?: boolean;
  /** Exit non-zero if anything is missing. For CI, once you have a baseline. */
  strict?: boolean;
  /** Install every registry entry that closes a missing requirement. */
  fix?: boolean;
}

const MARK: Record<Status, string> = {
  satisfied: pc.green('✓'),
  partial: pc.yellow('~'),
  missing: pc.red('✗'),
  manual: pc.dim('○'),
  elsewhere: pc.cyan('→'),
};

const LEGEND = [
  `${pc.green('✓')} satisfied  evidence found in this project`,
  `${pc.yellow('~')} partial    the mechanism is here; a policy or decision is not`,
  `${pc.red('✗')} missing    declared checkable, and nothing was found`,
  `${pc.dim('○')} manual     organisational — no CLI can satisfy it`,
  `${pc.cyan('→')} elsewhere  the evidence lives in the ops repo`,
];

/**
 * Report a project against a compliance framework.
 *
 * Every line is backed by a path that was actually found, or says nothing was.
 * The `manual` count is printed as prominently as the satisfied one on purpose:
 * a tender is lost on the organisational half, and a tool that quietly drops it
 * produces a green sheet for a bid that would fail.
 */
export async function compliance(options: ComplianceOptions): Promise<void> {
  const available = await listFrameworks();
  const id = options.framework ?? available[0];
  if (!id || !available.includes(id)) {
    throw new Error(`unknown framework "${id}". Available: ${available.join(', ')}`);
  }

  const project = await findProject();
  const framework = await loadFramework(id);
  const installed = await installedTools(project.root);
  const findings = await evaluate(framework, project.root, installed);
  const counts = summarise(findings);

  console.log();
  console.log(pc.bold(framework.name));
  console.log(pc.dim(framework.summary));
  if (framework.jurisdiction) console.log(pc.dim(`Jurisdiction: ${framework.jurisdiction}`));
  console.log();

  let section = '';
  for (const f of findings) {
    if (f.section !== section) {
      section = f.section;
      console.log(pc.bold(`\n  ${section}`));
    }
    const line = `    ${MARK[f.status]} ${f.requirement.id.padEnd(7)} ${f.requirement.title}`;
    console.log(line);
    if (f.status !== 'satisfied') console.log(pc.dim(`        ${f.evidence}`));
  }

  console.log();
  console.log(LEGEND.map((l) => `  ${l}`).join('\n'));
  console.log();
  console.log(
    `  ${pc.green(`${counts.satisfied} satisfied`)}   ` +
      `${pc.yellow(`${counts.partial} partial`)}   ` +
      `${pc.red(`${counts.missing} missing`)}   ` +
      `${pc.dim(`${counts.manual} organisational`)}   ` +
      `${pc.cyan(`${counts.elsewhere} in the ops repo`)}`,
  );
  console.log(
    pc.dim(
      `\n  ${counts.manual} of ${findings.length} cannot be satisfied by code. Plans, tests,\n` +
        '  contracts and sign-off are the other half of this, and no command produces them.',
    ),
  );

  // ── the part that is not a report ─────────────────────────────────────────
  const fixes = fixesFor(findings);
  if (fixes.length > 0) {
    const total = fixes.reduce((n, f) => n + f.requirements.length, 0);
    console.log(
      `\n  ${pc.bold(`${total} of the missing requirements can be installed`)} ` +
        pc.dim(`(${fixes.length} feature${fixes.length === 1 ? '' : 's'})`),
    );
    for (const fix of fixes) {
      console.log(`    ${pc.cyan(fix.tool.padEnd(16))} ${pc.dim(fix.requirements.join(', '))}`);
    }
    if (!options.fix) {
      console.log(pc.dim(`\n  si compliance --fix    ${pc.reset('installs all of them')}`));
    }
  }

  if (options.fix) {
    if (fixes.length === 0) {
      console.log(pc.dim('\n  Nothing left that a command can install.'));
    } else {
      const { addTools } = await import('./add.ts');
      console.log();
      await addTools(
        fixes.map((f) => f.tool),
        { path: project.root },
      );
      console.log(
        pc.dim(
          '\n  Run `si compliance` again to see the new state, and `pnpm db:migrate`\n' +
            '  for the tables these added.',
        ),
      );
    }
  }

  if (options.write) {
    const out = path.join(project.root, 'docs', 'compliance', `${id}.md`);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, renderMatrix(framework.name, framework.summary, findings, counts), 'utf8');
    console.log(pc.dim(`\n  written to docs/compliance/${id}.md`));
  }

  if (options.strict && counts.missing > 0) {
    throw new Error(`${counts.missing} requirement(s) missing`);
  }
}

async function installedTools(root: string): Promise<string[]> {
  try {
    const record = JSON.parse(
      await readFile(path.join(root, '.si', 'project.json'), 'utf8'),
    ) as { tools?: string[] };
    return record.tools ?? [];
  } catch {
    return [];
  }
}

function renderMatrix(
  name: string,
  summary: string,
  findings: Finding[],
  counts: Record<Status, number>,
): string {
  const label: Record<Status, string> = {
    satisfied: 'Satisfied',
    partial: 'Partial',
    missing: 'Missing',
    manual: 'Organisational',
    elsewhere: 'Ops repo',
  };
  const rows = findings
    .map(
      (f) =>
        `| ${f.requirement.id} | ${f.requirement.title} | ${label[f.status]} | ${f.evidence.replace(/\|/g, '\\|')} |`,
    )
    .join('\n');

  return `# ${name}

${summary}

Generated by \`si compliance --write\`. **Every row is evidence or the absence of
it** — a path this tool found in the project, or a statement that it found
nothing. Nothing here is a claim.

${counts.manual} of ${findings.length} requirements cannot be satisfied by code.
Continuity plans, penetration tests, entitlement recertification, hosting
location and contractual clauses are the other half, and they are the half a
tender is usually lost on.

| Satisfied | Partial | Missing | Organisational | Ops repo |
|---|---|---|---|---|
| ${counts.satisfied} | ${counts.partial} | ${counts.missing} | ${counts.manual} | ${counts.elsewhere} |

| # | Requirement | Status | Evidence |
|---|---|---|---|
${rows}
`;
}
