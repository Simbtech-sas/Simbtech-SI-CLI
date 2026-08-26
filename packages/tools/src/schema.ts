/**
 * A registry entry is data, not code. Adding a tool is adding a YAML file — no
 * TypeScript changes anywhere.
 */
export const CATEGORIES = [
  'realtime',
  'finance',
  'auth',
  'search',
  'storage',
  'queue',
  'observability',
  'admin',
  'ai',
  'email',
  'geo',
  'docs',
  'scheduling',
  'flags',
  'erp',
  'iot',
  'local-first',
  'licensing',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * What kind of thing this entry is.
 *
 * `tool`    — an external service you run (LiveKit, Meilisearch). Adds a client,
 *             a compose service and env; owns no tables.
 * `feature` — application code you would otherwise write again on every project
 *             (forgot password, invitations, webhooks). Adds modules, routes AND
 *             a migration, because a feature that needs a table is not optional
 *             about needing it.
 */
export type EntryKind = 'tool' | 'feature';

/** Categories a feature can belong to, alongside the tool ones. */
export const FEATURE_CATEGORIES = [
  'auth',
  'notifications',
  'tenancy',
  'integration',
  'compliance',
  'sync',
] as const;

export interface ToolFile {
  /** Handlebars template under `templates/<tool id>/`. */
  src: string;
  /** Destination relative to the target's server app (or `web:` prefixed for the web app). */
  dest: string;
}

export interface ToolRegistration {
  /** Manifest anchor name, resolved through the template's `.si/template.json`. */
  anchor: string;
  /** Code inserted above the anchor. */
  snippet: string;
  /** Import line added to the same file. */
  import?: string;
}

/**
 * How to run this tool as a first-class service in the cluster.
 *
 * Only tools that are a deployable server carry this. A client library (maplibre,
 * yjs, pglite) has nothing to deploy, and `si service add --from <it>` refuses
 * rather than generating a Deployment for a package.
 */
export interface ToolDeploy {
  image: string;
  /** Port the container listens on. */
  port: number;
  /** Provision a database for it in the shared Postgres cluster. */
  needsDatabase?: boolean;
  /** Env passed to the container. `{{db.*}}` is filled from the generated secret. */
  env?: Record<string, string>;
  /** Expose it outside the cluster. Internal-only by default. */
  ingress?: boolean;
  /** Persistent volume size, e.g. `10Gi`. Omit for a stateless service. */
  storage?: string;
}

export interface Tool {
  id: string;
  /** Defaults to `tool` so existing entries need no change. */
  kind?: EntryKind;
  name: string;
  category: Category;
  /** One line: what problem this removes. */
  summary: string;
  repo: string;
  license: string;
  /** Flavors this is offered for. Empty means all of them. */
  flavors: string[];
  deps: { server?: string[]; web?: string[]; dev?: string[] };
  /** Env keys appended to `.env.example`, with an optional dev default. */
  env: Array<{ key: string; value?: string; comment?: string }>;
  /** Docker-compose services merged into the dev stack, as a YAML fragment file. */
  compose?: string;
  files: ToolFile[];
  register: ToolRegistration[];
  /** Free-text shown after install — credentials to create, dashboards to open. */
  notes: string[];
  /** Present when the tool can be deployed as a cluster service. */
  deploy?: ToolDeploy;
  /**
   * SQL migrations this feature adds, in order. Numbered by the installer
   * against what the target already has, so two features added on different days
   * cannot collide.
   */
  migrations?: Array<{ src: string; name: string }>;
  /** Other entries that must be present first. */
  requires?: string[];
}

const REQUIRED = ['id', 'name', 'category', 'summary', 'repo', 'license'] as const;

/**
 * Validate an entry at load. This is our own data, but a typo that silently
 * drops a dependency produces a project that fails to build for a reason nobody
 * can trace back to a YAML file.
 */
export function parseTool(raw: unknown, source: string): Tool {
  if (typeof raw !== 'object' || raw === null) throw new Error(`${source}: not a mapping`);
  const t = raw as Partial<Tool> & Record<string, unknown>;

  const missing = REQUIRED.filter((k) => t[k] === undefined);
  if (missing.length > 0) throw new Error(`${source}: missing ${missing.join(', ')}`);

  const allCategories = [...CATEGORIES, ...FEATURE_CATEGORIES] as readonly string[];
  if (!allCategories.includes(t.category as string)) {
    throw new Error(`${source}: unknown category "${String(t.category)}"`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(t.id as string)) {
    throw new Error(`${source}: id "${String(t.id)}" must be lowercase kebab-case`);
  }

  return {
    id: t.id as string,
    name: t.name as string,
    category: t.category as Category,
    summary: t.summary as string,
    repo: t.repo as string,
    license: t.license as string,
    flavors: t.flavors ?? [],
    deps: t.deps ?? {},
    env: t.env ?? [],
    compose: t.compose,
    files: t.files ?? [],
    register: t.register ?? [],
    notes: t.notes ?? [],
    deploy: t.deploy,
    kind: t.kind ?? 'tool',
    migrations: t.migrations ?? [],
    requires: t.requires ?? [],
  };
}
