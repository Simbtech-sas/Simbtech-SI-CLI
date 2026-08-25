import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrandTokens } from './brand.ts';

/**
 * `.si/template.json` — what a template declares about itself so the CLI does not
 * need per-flavor code. Adding a template is a data change.
 */
/**
 * A composition of the template. One template, several shapes — so a service and
 * the identity service share every line of infrastructure code and can only
 * disagree about what is present, never about how it works.
 */
export interface TemplateProfile {
  label: string;
  description: string;
  /** Paths, relative to the project root, deleted after scaffolding. */
  remove: string[];
  /** Files swapped for a variant: `{ "src/a.ts": "src/a.service.ts" }`. */
  replace?: Record<string, string>;
}

/**
 * One decision offered at scaffold time — auth, storage, workflows, uploads.
 *
 * Each option contributes features (which drive marker pruning), tools (installed
 * from the registry) and removals. That is the whole mechanism: a choice is data,
 * so adding "use Ory instead" is an entry in a JSON file, not a code change.
 *
 * Every group must offer a way out. A scaffolder that forces its opinions on
 * someone who wanted to write their own is a scaffolder they stop using.
 */
export interface TemplateChoiceOption {
  value: string;
  label: string;
  description?: string;
  /** Marker features this option activates. */
  features?: string[];
  /** Registry tool ids to wire in. */
  tools?: string[];
  /** Paths to delete when this option is chosen. */
  remove?: string[];
  /** Files swapped for a variant: `{ "src/a.ts": "src/variants/a.oidc.ts" }`. */
  replace?: Record<string, string>;
  /** Shown after scaffolding — credentials to create, a realm to import. */
  notes?: string[];
}

export interface TemplateChoice {
  /** CLI flag and prompt key, e.g. `auth` -> `--auth keycloak`. */
  key: string;
  question: string;
  default: string;
  options: TemplateChoiceOption[];
}

export interface TemplateManifest {
  id: string;
  label: string;
  summary: string;
  brandToken: BrandTokens;
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
  /** Tool-registry categories offered for this flavor. */
  toolCategories: string[];
  /** Named insertion points, so `si add` never hardcodes a file path. */
  anchors: Record<string, { file: string; marker: string }>;
  /** Well-known paths within the template (server app, compose file, env file…). */
  targets: Record<string, string>;
  /** Commands printed after scaffolding. `{{brand}}` is substituted. */
  nextSteps: string[];
  /** Available compositions. Absent means the template has only one shape. */
  profiles?: Record<string, TemplateProfile>;
  defaultProfile?: string;
  /** Infrastructure decisions offered at scaffold time. */
  choices?: TemplateChoice[];
}

export const MANIFEST_PATH = '.si/template.json';

export async function readManifest(templateDir: string): Promise<TemplateManifest> {
  const file = path.join(templateDir, MANIFEST_PATH);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new Error(`template at "${templateDir}" has no ${MANIFEST_PATH}`);
  }
  const parsed: unknown = JSON.parse(raw);
  return assertManifest(parsed, file);
}

function assertManifest(value: unknown, file: string): TemplateManifest {
  const m = value as Partial<TemplateManifest>;
  const missing = (['id', 'label', 'summary', 'brandToken', 'anchors', 'targets'] as const).filter(
    (k) => m[k] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`${file}: missing required field(s): ${missing.join(', ')}`);
  }
  return {
    ...m,
    toolCategories: m.toolCategories ?? [],
    nextSteps: m.nextSteps ?? [],
  } as TemplateManifest;
}

/** Render `nextSteps` for a concrete brand. */
export function nextSteps(manifest: TemplateManifest, brand: string): string[] {
  return manifest.nextSteps.map((s) => s.split('{{brand}}').join(brand));
}

/** Resolve a profile name against a manifest, with a clear error when it is wrong. */
export function resolveProfile(
  manifest: TemplateManifest,
  requested?: string,
): { name: string; profile: TemplateProfile } | undefined {
  if (!manifest.profiles) {
    if (requested) {
      throw new Error(`the ${manifest.id} template has no profiles; drop --profile`);
    }
    return undefined;
  }
  const name = requested ?? manifest.defaultProfile;
  if (!name) return undefined;

  const profile = manifest.profiles[name];
  if (!profile) {
    throw new Error(
      `unknown profile "${name}" for ${manifest.id}. ` +
        `Available: ${Object.keys(manifest.profiles).join(', ')}`,
    );
  }
  return { name, profile };
}

export interface ResolvedChoice {
  key: string;
  option: TemplateChoiceOption;
}

/**
 * Resolve every choice group against what the caller asked for.
 *
 * `blank` selects the option that opts out of everything, so someone who wants
 * to build their own infrastructure gets a clean project rather than a fight.
 */
export function resolveChoices(
  manifest: TemplateManifest,
  selected: Record<string, string | undefined>,
  options: { blank?: boolean } = {},
): ResolvedChoice[] {
  const resolved: ResolvedChoice[] = [];

  for (const choice of manifest.choices ?? []) {
    const requested = selected[choice.key] ?? (options.blank ? 'none' : undefined) ?? choice.default;
    const option = choice.options.find((o) => o.value === requested);
    if (!option) {
      throw new Error(
        `unknown --${choice.key} "${requested}". One of: ` +
          choice.options.map((o) => o.value).join(', '),
      );
    }
    resolved.push({ key: choice.key, option });
  }
  return resolved;
}

/** Everything the resolved choices contribute, flattened. */
export function choiceEffects(choices: readonly ResolvedChoice[]): {
  features: string[];
  tools: string[];
  remove: string[];
  replace: Record<string, string>;
  notes: string[];
} {
  return {
    features: choices.flatMap((c) => c.option.features ?? []),
    tools: choices.flatMap((c) => c.option.tools ?? []),
    remove: choices.flatMap((c) => c.option.remove ?? []),
    replace: Object.assign({}, ...choices.map((c) => c.option.replace ?? {})) as Record<string, string>,
    notes: choices.flatMap((c) => c.option.notes ?? []),
  };
}
