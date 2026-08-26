import path from 'node:path';
import { readFile, readdir, access } from 'node:fs/promises';
import { parse } from 'yaml';

export const COMPLIANCE_DIR = new URL('../compliance/', import.meta.url).pathname;

/**
 * How a requirement is established.
 *
 * The distinction is the whole point of the dataset. A tool that reports
 * `manual` items as satisfied produces a green sheet for a tender the
 * organisation would fail — which is worse than having no tool.
 */
export type RequirementKind = 'code' | 'partial' | 'manual' | 'absent';

export interface RequirementCheck {
  /** A path that must exist, relative to the project root. */
  file?: string;
  /** A pattern that must appear in `in`. */
  pattern?: string;
  in?: string;
  /** The file named by `file` must also contain this. */
  contains?: string;
  /** Satisfied if any of these tools is installed. */
  anyTool?: string[];
  orFile?: string;
  /** The evidence lives in the ops repo, not this one. */
  repo?: string;
  note?: string;
}

export interface Requirement {
  id: string;
  title: string;
  kind: RequirementKind;
  check?: RequirementCheck;
  /** A registry entry that would satisfy or advance this. */
  suggests?: string;
  /**
   * The registry entry that DOES satisfy this. `si compliance --fix` installs
   * every one of these that is still missing — the difference between a report
   * and a tool.
   */
  provides?: string;
  note?: string;
}

export interface Framework {
  id: string;
  name: string;
  summary: string;
  jurisdiction?: string;
  references?: string[];
  sections: { id: string; title: string; requirements: Requirement[] }[];
}

export type Status =
  /** The probe found the evidence. */
  | 'satisfied'
  /** The mechanism is here; a policy or a decision is not. */
  | 'partial'
  /** Declared in the dataset, and the probe found nothing. */
  | 'missing'
  /** Organisational. No CLI can satisfy it. */
  | 'manual'
  /** The evidence lives in the ops repo, which is not this project. */
  | 'elsewhere';

export interface Finding {
  section: string;
  requirement: Requirement;
  status: Status;
  /** What was actually found, or why nothing was. Never an assertion. */
  evidence: string;
}

export async function loadFramework(id: string): Promise<Framework> {
  const file = path.join(COMPLIANCE_DIR, `${id}.yaml`);
  return parse(await readFile(file, 'utf8')) as Framework;
}

export async function listFrameworks(): Promise<string[]> {
  return (await readdir(COMPLIANCE_DIR))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.yaml$/, ''));
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Recursive grep, bounded. A compliance report must not take a minute. */
async function grepIn(root: string, rel: string, pattern: RegExp): Promise<string | null> {
  const target = path.join(root, rel);
  if (!(await exists(target))) return null;

  const stack = [target];
  let scanned = 0;
  while (stack.length > 0 && scanned < 4000) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      // A file, not a directory.
      const text = await readFile(current, 'utf8').catch(() => '');
      scanned++;
      if (pattern.test(text)) return path.relative(root, current);
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.git')) {
        continue;
      }
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else {
        scanned++;
        const text = await readFile(child, 'utf8').catch(() => '');
        if (pattern.test(text)) return path.relative(root, child);
      }
    }
  }
  return null;
}

/**
 * Evaluate a framework against a real project.
 *
 * Every status is backed by a path this function actually found. Nothing is
 * inferred from the dataset's own optimism: a requirement declared `code` whose
 * probe finds nothing comes back `missing`, and says so.
 */
export async function evaluate(
  framework: Framework,
  root: string,
  installedTools: string[] = [],
): Promise<Finding[]> {
  const findings: Finding[] = [];

  for (const section of framework.sections) {
    for (const req of section.requirements) {
      const base = { section: `${section.id} ${section.title}`, requirement: req };

      // A requirement whose feature is installed is satisfied, whatever the
      // dataset's own `kind` says. Without this the report keeps offering to
      // install something it already installed.
      if (req.provides && installedTools.includes(req.provides)) {
        findings.push({ ...base, status: 'satisfied', evidence: `tool: ${req.provides}` });
        continue;
      }

      if (req.kind === 'manual') {
        findings.push({ ...base, status: 'manual', evidence: req.note ?? 'organisational' });
        continue;
      }
      if (!req.check) {
        findings.push({
          ...base,
          status: req.kind === 'absent' ? 'missing' : 'partial',
          evidence: req.note ?? (req.suggests ? `try \`si add ${req.suggests}\`` : 'not probed'),
        });
        continue;
      }

      const check = req.check;
      if (check.repo) {
        findings.push({
          ...base,
          status: 'elsewhere',
          evidence: `${check.repo} repo: ${check.file ?? check.pattern ?? ''}`.trim(),
        });
        continue;
      }

      let found: string | null = null;

      if (check.anyTool) {
        const hit = check.anyTool.find((t) => installedTools.includes(t));
        if (hit) found = `tool: ${hit}`;
        else if (check.orFile && (await exists(path.join(root, check.orFile)))) found = check.orFile;
      }

      if (!found && check.file) {
        if (await exists(path.join(root, check.file))) {
          if (check.contains) {
            const text = await readFile(path.join(root, check.file), 'utf8').catch(() => '');
            found = text.includes(check.contains) ? check.file : null;
          } else {
            found = check.file;
          }
        }
      }

      if (!found && check.pattern && check.in) {
        found = await grepIn(root, check.in, new RegExp(check.pattern));
      }

      if (found) {
        findings.push({
          ...base,
          status: req.kind === 'partial' ? 'partial' : 'satisfied',
          evidence: found,
        });
      } else {
        // The dataset said `code` and the probe found nothing. Report what is
        // true, not what was expected — a matrix that grades itself is not one.
        findings.push({
          ...base,
          status: 'missing',
          evidence: req.suggests ? `not found — try \`si add ${req.suggests}\`` : 'not found',
        });
      }
    }
  }
  return findings;
}

/**
 * The registry entries that would close the missing requirements.
 *
 * Deduplicated and ordered, because one feature usually answers several — MFA,
 * the password policy and device management are one install.
 */
export function fixesFor(findings: Finding[]): { tool: string; requirements: string[] }[] {
  const byTool = new Map<string, string[]>();
  for (const f of findings) {
    if (f.status !== 'missing') continue;
    const tool = f.requirement.provides;
    if (!tool) continue;
    byTool.set(tool, [...(byTool.get(tool) ?? []), f.requirement.id]);
  }
  return [...byTool.entries()].map(([tool, requirements]) => ({ tool, requirements }));
}

export function summarise(findings: Finding[]): Record<Status, number> {
  const counts: Record<Status, number> = {
    satisfied: 0,
    partial: 0,
    missing: 0,
    manual: 0,
    elsewhere: 0,
  };
  for (const f of findings) counts[f.status]++;
  return counts;
}
