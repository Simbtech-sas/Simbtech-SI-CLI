import path from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  applyProfile,
  choiceEffects,
  resolveChoices,
  type ResolvedChoice,
  assertEmptyDir,
  brandTokens,
  fetchTemplate,
  isValidBrand,
  nextSteps,
  readManifest,
  resolveProfile,
  substituteTokens,
  installAll,
} from '@simbtech/si-core';
import { FLAVORS, findFlavor, flavorChoices, flavorTemplate, registryFlavor, type FlavorId } from '../flavors.ts';
import { addTools, type PendingDeps } from './add.ts';
import { forFlavor, loadRegistry } from '@simbtech/si-tools';
import { TOOLS, probe, toolsFor } from '../toolchain.ts';

export interface NewOptions {
  flavor?: string;
  brand?: string;
  profile?: string;
  /** Infrastructure decisions, keyed as the manifest declares them. */
  auth?: string;
  storage?: string;
  uploads?: string;
  workflows?: string;
  observability?: string;
  loadtest?: string;
  database?: string;
  mode?: string;
  payments?: string;
  /** `--tool a b c`. Given, the picker is skipped entirely. */
  tool?: string[];
  /** shared | per-service. Multi-service layouts only. */
  data?: string;
  /** Scaffold a flavor that is not finished. */
  force?: boolean;
  /** Overrides the banner, so `si api` does not announce itself as `si new`. */
  label?: string;
  /** Opt out of every choice — scaffold the skeleton and nothing else. */
  blank?: boolean;
  /** Skip installing the tools the choices pull in. */
  skipInstall?: boolean;
  ref?: string;
  /** Skip prompts; fail instead of asking. For CI and the integration tests. */
  yes?: boolean;
}

function cancelled(value: unknown): never | void {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.');
    process.exit(130);
  }
}

/** Default the brand from the directory name when it happens to be a legal one. */
function brandFromName(name: string): string | undefined {
  const guess = path.basename(path.resolve(name)).toLowerCase().replace(/[^a-z0-9]/g, '');
  return isValidBrand(guess) ? guess : undefined;
}

export async function newProject(name: string | undefined, options: NewOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(` ${options.label ?? 'si new'} `)));

  // ── target directory ────────────────────────────────────────────────────────
  let target = name;
  if (!target) {
    if (options.yes) throw new Error('a project directory is required with --yes');
    const answer = await p.text({
      message: 'Where should the project go?',
      placeholder: './my-app',
      validate: (v) => (v.trim().length === 0 ? 'required' : undefined),
    });
    cancelled(answer);
    target = answer as string;
  }
  const dir = path.resolve(target);
  await assertEmptyDir(dir);

  // ── flavor ──────────────────────────────────────────────────────────────────
  let flavorId = options.flavor;
  if (!flavorId) {
    if (options.yes) throw new Error('--flavor is required with --yes');
    const answer = await p.select({
      message: 'What are you building?',
      options: FLAVORS.map((f) => ({ value: f.id, label: f.label, hint: f.summary })),
    });
    cancelled(answer);
    flavorId = answer as string;
  }
  const flavor = findFlavor(flavorId);
  if (!flavor) {
    throw new Error(
      `unknown flavor "${flavorId}". Available: ${FLAVORS.map((f) => f.id).join(', ')}`,
    );
  }

  // Check the toolchain BEFORE writing anything — a half-scaffolded directory the
  // user cannot build is worse than a clear refusal.
  await assertToolchain(flavor.id);

  // ── brand ───────────────────────────────────────────────────────────────────
  let brand = options.brand;
  if (!brand) {
    const suggested = brandFromName(target);
    // Derived from the directory name rather than asked. It is the npm scope,
    // the Postgres roles and the dev domain, so it matters — but "my-app" ->
    // "myapp" is right almost every time, and a question whose answer is
    // already on screen is a question worth deleting. `--brand` overrides.
    if (options.yes || suggested) {
      if (!suggested) throw new Error('--brand is required with --yes');
      brand = suggested;
    } else {
      const answer = await p.text({
        message: 'Brand slug — npm scope, Postgres roles, database name, dev domain',
        placeholder: suggested ?? 'acme',
        defaultValue: suggested ?? '',
        validate: (v) =>
          isValidBrand(v.trim())
            ? undefined
            : 'lowercase, starts with a letter, 2-31 chars, letters and digits only',
      });
      cancelled(answer);
      brand = (answer as string).trim();
    }
  }
  const tokens = brandTokens(brand);

  // ── scaffold ────────────────────────────────────────────────────────────────
  const spinner = p.spinner();
  spinner.start(`Fetching the ${flavor.label} template`);
  let source: string;
  try {
    // A flavor may share another's template — SiAPP is SiSAAS composed differently.
    source = await fetchTemplate(flavorTemplate(flavor), dir, { ref: options.ref });
  } catch (err) {
    spinner.stop(pc.red('Template fetch failed'));
    // Leave nothing half-written behind.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  spinner.stop(`Template fetched from ${pc.dim(source)}`);

  // Everything past the fetch runs against a directory that now exists on
  // disk. A validation error here — an incompatible profile, an unusable
  // choice — must not leave a half-written project behind for the next
  // command to operate on as if it were finished.
  try {
    const manifest = await readManifest(dir);

    // ── profile ─────────────────────────────────────────────────────────────────
    let profileName = options.profile;
    if (!profileName && manifest.profiles && !options.yes) {
      const answer = await p.select({
        message: 'Single deployable or microservice?',
        initialValue: manifest.defaultProfile,
        options: Object.entries(manifest.profiles).map(([value, prof]) => ({
          value,
          label: prof.label,
          hint: prof.description,
        })),
      });
      cancelled(answer);
      profileName = answer as string;
    }
    const resolved = resolveProfile(manifest, profileName);

    // ── where the data lives ────────────────────────────────────────────────
    //
    // Only asked for a multi-service layout. With one app there is one database
    // and nothing to decide, and a question with one sensible answer is noise.
    //
    // It changes nothing in THIS repo — a service reads DATABASE_URL either way.
    // It is recorded so `si api` and the platform generator honour it later,
    // which is the whole reason to ask now rather than at every service.
    let dataTopology = options.data;
    if (!dataTopology && resolved?.name && resolved.name !== 'mono') {
      if (options.yes || options.blank) {
        dataTopology = 'shared';
      } else {
        const answer = await p.select({
          message: 'Where do the services keep their data?',
          initialValue: 'shared',
          options: [
            {
              value: 'shared',
              label: 'One Postgres cluster, a database each',
              hint: 'isolated by database and role; one thing to back up and upgrade',
            },
            {
              value: 'per-service',
              label: 'A Postgres cluster per service',
              hint: 'its own CPU, disk and WAL — costs two more pods per service',
            },
          ],
        });
        cancelled(answer);
        dataTopology = answer as string;
      }
    }

    // ── infrastructure choices ──────────────────────────────────────────────────
    const selected: Record<string, string | undefined> = {
      // Fixed by the flavor — SiAPP IS `tenancy: single`, so it is never asked.
      ...flavorChoices(flavor),
      auth: options.auth,
      storage: options.storage,
      uploads: options.uploads,
      workflows: options.workflows,
      observability: options.observability,
      loadtest: options.loadtest,
      database: options.database,
      mode: options.mode,
      payments: options.payments,
    };

    // ── the rest, as ONE question ───────────────────────────────────────────
    //
    // These used to be seven separate prompts. Every one has a defensible
    // default, and asking somebody to choose an observability stack before they
    // have written a line is not a decision — it is an obstacle. So the defaults
    // are shown together and changed on request; each is still a flag.
    if (!options.blank && !options.yes) {
      const pending = (manifest.choices ?? []).filter((c) => !selected[c.key]);
      if (pending.length > 0) {
        const labelFor = (c: (typeof pending)[number]) =>
          c.options.find((o) => o.value === c.default)?.label ?? c.default;
        p.note(
          pending.map((c) => `${pc.dim(c.key.padEnd(14))} ${labelFor(c)}`).join('\n'),
          'Defaults',
        );
        const customise = await p.confirm({
          message: 'Change any of these?',
          initialValue: false,
        });
        cancelled(customise);

        if (customise === true) {
          // Pick WHICH ones to revisit, rather than walking all seven again.
          const toAsk = await p.multiselect({
            message: 'Which?',
            required: false,
            options: pending.map((c) => ({ value: c.key, label: c.key, hint: c.question })),
          });
          cancelled(toAsk);
          for (const key of toAsk as string[]) {
            const choice = pending.find((c) => c.key === key)!;
            const answer = await p.select({
              message: choice.question,
              initialValue: choice.default,
              options: choice.options.map((o) => ({
                value: o.value,
                label: o.label,
                hint: o.description,
              })),
            });
            cancelled(answer);
            selected[choice.key] = answer as string;
          }
        }
      }
    }

    const choices: ResolvedChoice[] = resolveChoices(manifest, selected, { blank: options.blank });
    assertCoherent(resolved?.name, choices);
    const effects = choiceEffects(choices);

    // ONE pass: the profile's removals and the choices' are applied together, with
    // the full feature set active. Two passes let a profile delete a file a choice
    // was about to swap in, and a template with no profiles never got pruned at all.
    const composition = {
      label: resolved?.profile.label ?? 'composition',
      description: '',
      remove: [...(resolved?.profile.remove ?? []), ...effects.remove],
      replace: { ...(resolved?.profile.replace ?? {}), ...effects.replace },
    };
    const features = [...(resolved ? [resolved.name] : []), ...effects.features];

    const applied = await applyProfile(dir, composition, features[0] ?? 'default', features);
    if (applied.missing.length > 0) {
      // A composition that no longer matches the template is how a service ends up
      // shipping the identity tables it was supposed to drop.
      p.log.warn(`names paths this template does not have: ${applied.missing.join(', ')}`);
    }
    if (applied.removed.length > 0 || applied.pruned.length > 0 || applied.replaced.length > 0) {
      p.log.info(
        `${composition.label} — removed ${applied.removed.length}, ` +
          `replaced ${applied.replaced.length}, pruned ${applied.pruned.length} file(s)`,
      );
    }

    spinner.start(`Rebranding to ${tokens.lower}`);
    const result = await substituteTokens(dir, tokens, manifest.brandToken);
    spinner.stop(
      `Rebranded ${result.filesChanged} file(s)` +
        (result.pathsRenamed > 0 ? `, renamed ${result.pathsRenamed} path(s)` : ''),
    );

    if (choices.length > 0) {
      p.log.info(
        choices.map((c) => `${c.key}: ${pc.cyan(c.option.label)}`).join('   '),
      );
    }

    // Tools the choices pull in are installed here, so the project is complete on
    // first `pnpm install` rather than after a second command nobody remembers.
    //
    // `--skip-install` means "do not run the package manager", not "drop the
    // features I just chose". Wiring happens either way; `addTools` is told to
    // skip the install step, and the final `pnpm install` picks up the deps.
    // ── tools ───────────────────────────────────────────────────────────────
    //
    // Grouped by category, because forty in one flat list is a wall, not a
    // choice. Nothing is preselected: a tool you did not ask for is a container
    // you will not run and an env var you will not set.
    const picked: string[] = [...(options.tool ?? [])];
    if (!options.blank && !options.yes && (options.tool ?? []).length === 0) {
      const available = forFlavor(await loadRegistry(), registryFlavor(flavor.id))
        .filter((t) => t.kind !== 'feature')
        // Do not offer what would be refused two lines later.
        .filter((t) => !(features.includes('single-tenant') && t.id in TENANT_COUPLED_TOOLS));
      if (available.length === 0) {
        // Say it. A picker that simply does not appear reads as a bug, and it
        // WAS one: SiAPP offered nothing for a while because the registry is
        // keyed by template and nothing named `siapp`.
        p.log.info(
          `No open-source tools are wired for ${flavor.label} yet — the registry is npm packages, ` +
            'and this flavor does not use them.',
        );
      } else {
        const groups: Record<string, { value: string; label: string; hint: string }[]> = {};
        for (const tool of available) {
          (groups[tool.category] ??= []).push({
            value: tool.id,
            label: tool.name,
            hint: tool.summary,
          });
        }
        const chosen = await p.groupMultiselect({
          message: `Open-source tools ${pc.dim('(space to pick, enter to skip)')}`,
          required: false,
          selectableGroups: false,
          options: Object.fromEntries(
            Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)),
          ),
        });
        cancelled(chosen);
        picked.push(...(chosen as string[]));
      }
    }

    // The choices' own tools first: a choice that wires KPay must not be
    // reordered behind a tool the user happened to pick.
    const tools = [...new Set([...effects.tools, ...picked])];
    assertTenancySupported(features, tools);
    let pending: PendingDeps | undefined;
    if (tools.length > 0) {
      spinner.start(`Wiring in ${tools.join(', ')}`);
      try {
        // NOT `skipInstall: true` unconditionally. A tool's npm dependencies are
        // recorded by the install step, so skipping it wires in code that imports
        // packages package.json never learned about — and the user's own
        // `pnpm install` afterwards cannot install what was never recorded.
        //
        // When the user asked for --skip-install we honour it and report the exact
        // `pnpm add` lines instead, rather than inventing a version range.
        pending = await addTools(tools, {
          path: dir,
          skipInstall: options.skipInstall,
          quiet: true,
        });
        spinner.stop(`Wired in ${tools.join(', ')}`);
      } catch (err) {
        spinner.stop(pc.yellow(`Could not wire in ${tools.join(', ')}`));
        p.log.warn(
          `${err instanceof Error ? err.message : String(err)}\n` +
            `Add them later with: si add ${tools.join(' ')}`,
        );
      }
    }

    // ── record what was decided ─────────────────────────────────────────────
    //
    // `si api` and the platform generator both need to know the layout and the
    // data topology, and asking again per service is how two services end up on
    // different answers to the same question.
    await writeFile(
      path.join(dir, '.si', 'project.json'),
      `${JSON.stringify(
        {
          flavor: flavor.id,
          brand,
          layout: resolved?.name ?? 'mono',
          data: dataTopology ?? 'shared',
          choices: Object.fromEntries(
            Object.entries(selected).filter(([, v]) => v !== undefined),
          ),
          tools,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    // ── dependencies ────────────────────────────────────────────────────────
    //
    // Explicit, not a side effect of wiring a tool. It used to happen only
    // because SOME tool was always selected; the moment nothing was, `si new`
    // handed back a project with no node_modules and a build that failed on 251
    // missing jest globals. Scaffolding a project is the reason to install.
    if (!options.skipInstall) {
      spinner.start('Installing dependencies');
      try {
        await installAll(dir);
        spinner.stop('Dependencies installed');
      } catch (err) {
        spinner.stop(pc.yellow('Install failed'));
        p.log.warn(`${err instanceof Error ? err.message : String(err)}\nRun it yourself: pnpm install`);
      }
    }

    // Skipping the install left these unrecorded, so `pnpm install` will not
    // find them. Say exactly what to run — the code that needs them is already
    // written into the project.
    if (pending) {
      const lines = [
        pending.server.length > 0
          ? `pnpm --filter @${tokens.lower}/server add ${pending.server.join(' ')}`
          : '',
        pending.dev.length > 0
          ? `pnpm --filter @${tokens.lower}/server add -D ${pending.dev.join(' ')}`
          : '',
        pending.web.length > 0
          ? `pnpm --filter @${tokens.lower}/web add ${pending.web.join(' ')}`
          : '',
      ].filter(Boolean);
      if (lines.length > 0) {
        p.log.warn(
          `--skip-install means these were wired in but not recorded in package.json:\n` +
            lines.map((l) => `  ${l}`).join('\n'),
        );
      }
    }

    for (const note of effects.notes) p.log.warn(note);

    p.note(
      nextSteps(manifest, tokens.lower)
        .map((s) => pc.cyan(s))
        .join('\n'),
      `Next, in ${path.relative(process.cwd(), dir) || '.'}`,
    );
    p.outro(`${flavor.label} ready.`);
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Tool templates that are still written against a tenant, and so cannot be
 * composed into a single-tenant project.
 *
 * Each reads `runInTenantContext`, or a tenant id off the principal, or declares
 * a `tenant_id` column with a foreign key to a `tenants` table that a SiAPP build
 * does not have. Wiring one in produces a tree that does not compile — and the
 * choices route around the registry's own `flavors` filter, so nothing else
 * catches it.
 *
 * Refusing is the honest answer until they are marked up the way the main
 * template now is. Each of these is genuinely wanted in a normal web app, so this
 * list is a to-do, not a design statement — see docs/FOLLOW-UPS.md.
 */
export const TENANT_COUPLED_TOOLS: Record<string, string> = {
  'payments-kpay': 'the payments tables are tenant-scoped with an RLS policy',
  'payments-joonapay': 'the payments tables are tenant-scoped with an RLS policy',
  'payments-reconcile': 'the reconcile workflow keys on a tenant id',
  subscriptions: 'subscriptions are one-per-tenant, with tenant-scoped invoices',
  temporal: 'the activities open a tenant context and the example workflow onboards a tenant',
};

/** Fail before writing, not after: a broken tree is worse than a refusal. */
function assertTenancySupported(features: string[], tools: string[]): void {
  if (!features.includes('single-tenant')) return;
  const blocked = tools.filter((t) => t in TENANT_COUPLED_TOOLS);
  if (blocked.length === 0) return;
  throw new Error(
    `these do not support a single-tenant build yet:\n` +
      blocked.map((t) => `  - ${t}: ${TENANT_COUPLED_TOOLS[t]}`).join('\n') +
      `\n\nScaffolding them here produces a project that does not compile, so si stops\n` +
      `instead. Either drop them, or use \`si new -f sisaas\` where they work today.`,
  );
}

/**
 * Refuse when a tool needed to BUILD the project is missing; warn when a tool
 * needed only to run or deploy it is. Handing over a directory that cannot
 * compile is worse than useless, but refusing to lay down an infra repo because
 * kubectl is not installed yet is just in the way.
 */
async function assertToolchain(flavor: FlavorId): Promise<void> {
  const missing: Array<{ tool: (typeof TOOLS)[number]; phase: 'build' | 'operate' }> = [];

  for (const id of toolsFor(flavor)) {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) continue;
    const found = await probe(tool.bin, tool.args, tool.min);
    if (!found.found || found.tooOld) missing.push({ tool, phase: tool.phase });
  }

  const blocking = missing.filter((m) => m.phase === 'build');
  if (blocking.length > 0) {
    throw new Error(
      `${flavor} cannot be built without:\n` +
        blocking.map((m) => `  - ${m.tool.label} (${m.tool.hint})`).join('\n') +
        `\nRun \`si doctor\` for the full picture.`,
    );
  }

  for (const { tool } of missing.filter((m) => m.phase === 'operate')) {
    p.log.warn(`${tool.label} is not installed — you will need it to run this. ${tool.hint}`);
  }
}

/**
 * Reject combinations that cannot mean anything, rather than scaffolding a
 * project that fails to compile and leaving the reason to be guessed.
 */
function assertCoherent(profile: string | undefined, choices: readonly ResolvedChoice[]): void {
  const auth = choices.find((c) => c.key === 'auth')?.option.value;

  if (profile === 'service' && auth === 'builtin') {
    throw new Error(
      'a feature service cannot use the built-in identity: that would give it its own ' +
        'user store and its own token issuer, which is a second answer to "who is this user".\n' +
        'Use --auth keycloak, --auth zitadel, or --auth none, and let one identity service issue tokens.',
    );
  }
  if (profile === 'identity' && auth !== 'builtin') {
    throw new Error(
      `an identity service exists to issue tokens, so --auth ${String(auth)} leaves it with nothing to do.\n` +
        'Use --auth builtin, or scaffold a feature service with --profile service.',
    );
  }

  const database = choices.find((c) => c.key === 'database')?.option.value;
  const mode = choices.find((c) => c.key === 'mode')?.option.value;
  if (mode === 'lan-server' && database === 'sqlite') {
    throw new Error(
      'lan-server mode shares one dataset between machines, and SQLite over a network share ' +
        'corrupts — its locking assumes a local filesystem.\nUse --database postgres.',
    );
  }

  const uploads = choices.find((c) => c.key === 'uploads')?.option.value;
  const storage = choices.find((c) => c.key === 'storage')?.option.value;
  if (storage === 'none' && uploads && uploads !== 'none') {
    throw new Error(
      `--uploads ${uploads} needs somewhere to put the bytes, but --storage is none.\n` +
        'Choose a storage option, or --uploads none.',
    );
  }
}
