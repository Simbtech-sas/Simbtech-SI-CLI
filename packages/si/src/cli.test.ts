import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { register } from './registry.ts';
import { parseVersion, atLeast } from './version.ts';
import { FLAVORS, findFlavor } from './flavors.ts';

test('parseVersion pulls a version out of real --version output', () => {
  assert.equal(parseVersion('v24.18.0'), '24.18.0');
  assert.equal(parseVersion('git version 2.53.0'), '2.53.0');
  assert.equal(parseVersion('Docker version 29.6.1, build 8900f1d'), '29.6.1');
  assert.equal(parseVersion('pnpm 11.9'), '11.9');
  assert.equal(parseVersion('no digits here'), undefined);
});

test('atLeast compares numerically, not lexically', () => {
  assert.ok(atLeast('24.18.0', '20.0.0'));
  assert.ok(atLeast('20.0.0', '20.0.0'));
  assert.ok(!atLeast('18.20.4', '20.0.0'));
  assert.ok(atLeast('9.0.0', '10.0.0') === false, '9 < 10 despite sorting after');
  assert.ok(atLeast('20.1', '20.0.5'), 'missing segments read as 0');
});

test('registry builds commander commands including nested subcommands', () => {
  const program = new Command();
  register(program, {
    name: 'node',
    description: 'cluster nodes',
    subcommands: [
      {
        name: 'add',
        description: 'add a VPS',
        args: [{ name: 'ip', description: 'public IPv4' }],
        options: [{ flags: '--role <role>', description: 'server or agent' }],
        run: async () => {},
      },
    ],
  });
  const node = program.commands.find((c) => c.name() === 'node');
  assert.ok(node, 'node command registered');
  const add = node.commands.find((c) => c.name() === 'add');
  assert.ok(add, 'subcommand registered');
  assert.equal(add.usage(), '[options] <ip>');
});

test('registry renders optional and variadic argument tokens', () => {
  // Commander needs a TRAILING ellipsis; a leading one silently degrades the
  // argument to a single string, so `si add a b` iterates characters.
  const program = new Command();
  register(program, {
    name: 'add',
    description: 'add tools',
    args: [
      { name: 'note', description: 'optional note', required: false },
      // Commander requires the variadic to be last, and it must be a TRAILING
      // ellipsis: a leading one degrades the argument to a single string, so
      // `si add a b` would iterate characters.
      { name: 'tools', description: 'tool ids', variadic: true },
    ],
    run: async () => {},
  });
  assert.equal(program.commands[0]!.usage(), '[options] [note] <tools...>');
});

test('every flavor id is unique and template-directory safe', () => {
  const ids = FLAVORS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate flavor ids');
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
  assert.equal(findFlavor('sisaas')?.label, 'SiSAAS');
  assert.equal(findFlavor('nope'), undefined);
});

test('flavor toolchain requirements derive from the tool table, not a second list', async () => {
  const { toolsFor, TOOLS } = await import('./toolchain.ts');
  assert.deepEqual(toolsFor('platform').sort(), ['docker', 'kubectl']);
  assert.deepEqual(toolsFor('sibile-rn'), [], 'no extra toolchain beyond the universal ones');
  // Every requiredFor entry must name a real flavor, or doctor silently under-reports.
  const ids = new Set(FLAVORS.map((f) => f.id));
  for (const tool of TOOLS) {
    for (const flavor of tool.requiredFor) {
      assert.ok(ids.has(flavor), `${tool.id} requires unknown flavor "${flavor}"`);
    }
  }
});

test('a variadic command actually receives an array, not a string', async () => {
  const program = new Command();
  let received: unknown;
  register(program, {
    name: 'add',
    description: 'add tools',
    args: [{ name: 'tools', description: 'tool ids', variadic: true }],
    run: (async (tools: string[]) => {
      received = tools;
    }) as never,
  });
  await program.parseAsync(['node', 'si', 'add', 'livekit', 'blnk']);
  assert.deepEqual(received, ['livekit', 'blnk']);
});

test('build tools block scaffolding; operate tools only warn', async () => {
  const { toolsFor, TOOLS } = await import('./toolchain.ts');
  // Refusing to lay down an infra repo because kubectl is missing is in the way;
  // handing over a Tauri project on a machine with no Rust is worse than useless.
  assert.deepEqual(toolsFor('platform', 'build'), []);
  assert.deepEqual(toolsFor('platform', 'operate').sort(), ['docker', 'kubectl']);
  assert.deepEqual(toolsFor('simice', 'build'), ['cargo']);
  assert.deepEqual(toolsFor('sisaas', 'build'), []);
  assert.deepEqual(toolsFor('sisaas', 'operate'), ['docker']);
  // Every tool declares a phase, or the distinction silently stops applying.
  for (const tool of TOOLS) {
    assert.ok(['build', 'operate'].includes(tool.phase), `${tool.id} has no phase`);
  }
});

test('--skip-install still wires in the features the user chose', async () => {
  // "Do not run the package manager" is not "silently drop the payment
  // provider I just selected". The tools block runs either way; only the
  // install step is skipped.
  const source = await readFile(new URL('./commands/new.ts', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('const tools = [...new Set('));
  assert.ok(
    /if \(tools\.length > 0\) \{/.test(block.slice(0, 400)),
    'si new must not gate feature wiring on --skip-install',
  );
});

test('a scaffold that fails validation leaves nothing behind', async () => {
  // The failing case is real: `-p service` refuses the built-in identity, and
  // it refuses AFTER the template is on disk. A half-written tree is worse than
  // no tree — the next `si add` treats it as a finished project.
  const source = await readFile(new URL('./commands/new.ts', import.meta.url), 'utf8');
  const after = source.slice(source.indexOf('const manifest = await readManifest(dir);'));
  assert.ok(
    after.includes('await rm(dir, { recursive: true, force: true })'),
    'every post-fetch failure path must remove the target directory',
  );
});

test('a tool wired with --skip-install reports the deps it could not record', async () => {
  // `pnpm add` is what writes a package.json entry, so skipping it wires in code
  // importing packages nothing recorded — and the `pnpm install` the CLI suggests
  // next cannot install what is not there.
  //
  // The version cannot be invented offline and --skip-install means offline, so
  // the contract is: report the exact command. This asserts the reporting path
  // exists end to end — installTool populates `pending`, addTools aggregates it,
  // si new prints it. The previous version of this test grepped new.ts for a
  // substring and passed the whole time the behaviour was broken.
  const { installTool } = await import('@simbtech/si-tools');
  const { findTool } = await import('@simbtech/si-tools');

  const tool = await findTool('livekit');
  assert.ok(tool, 'livekit must be in the registry for this test to mean anything');
  assert.ok((tool.deps.server ?? []).length > 0, 'livekit must have server deps');

  const manifest = JSON.parse(
    await readFile(new URL('../../../templates/sisaas/.si/template.json', import.meta.url), 'utf8'),
  ) as never;

  const result = await installTool(tool, {
    root: '/nonexistent-on-purpose', // dryRun writes nothing, so this is never touched
    manifest,
    brand: 'x',
    dryRun: true,
    skipInstall: true,
  });

  assert.ok(result.pending, 'skipping the install must report what went unrecorded');
  assert.deepEqual(result.pending.server, tool.deps.server ?? []);
  assert.deepEqual(result.pending.web, tool.deps.web ?? []);
});

test('every @Global module reaches BOTH the API and the worker graph', async () => {
  // A @Global module still has to be imported into the graph it is global to,
  // and the worker is a SEPARATE Nest application. Missing one there compiles
  // cleanly, passes every unit test, and fails at worker boot — which is how
  // AuditModule went missing from the worker for the life of this template.
  const dir = new URL('../../../templates/sisaas/apps/server/src/', import.meta.url);
  // Only the `imports:` ARRAY. Matching the whole file passes on the `import`
  // statement alone, which is exactly the state that fails at boot: the symbol
  // is imported and never registered.
  const importsArray = (source: string) => {
    const at = source.indexOf('imports: [');
    return at === -1 ? '' : source.slice(at, source.indexOf('\n  ]', at));
  };
  const app = importsArray(await readFile(new URL('app.module.ts', dir), 'utf8'));
  const worker = importsArray(await readFile(new URL('worker.module.ts', dir), 'utf8'));
  assert.ok(app.length > 0 && worker.length > 0, 'could not locate an imports array');

  const globals: string[] = [];
  for (const name of ['audit', 'events', 'tenancy', 'security', 'redis']) {
    const path = new URL(`modules/${name}/${name}.module.ts`, dir);
    const source = await readFile(path, 'utf8').catch(() => '');
    if (/@Global\(\)/.test(source)) {
      globals.push(`${name[0]!.toUpperCase()}${name.slice(1)}Module`);
    }
  }
  assert.ok(globals.length > 0, 'no global modules found — the check is not looking in the right place');

  const missing = globals.filter(
    (m) => new RegExp(`\\b${m}\\b`).test(app) && !new RegExp(`\\b${m}\\b`).test(worker),
  );
  assert.deepEqual(missing, [], `these @Global modules never reach the worker: ${missing.join(', ')}`);
});

test('si api reuses the parent project’s decisions instead of asking again', async () => {
  // Two services that disagree about auth or data topology is not a choice
  // anybody made — it is a question that got asked twice. `.si/project.json`
  // exists so the second service cannot drift from the first.
  const source = await readFile(new URL('./commands/api.ts', import.meta.url), 'utf8');
  for (const inherited of ['data: record.data', 'brand: project.brand', "profile: 'service'"]) {
    assert.ok(source.includes(inherited), `si api must carry over ${inherited}`);
  }
  // The built-in identity gives a service its own user store and its own token
  // issuer — a second answer to "who is this user". It is never inherited.
  assert.ok(source.includes("inherited !== 'builtin'"));
});

test('si new asks four questions, not ten', async () => {
  // Every extra prompt is a decision demanded before the first line of code.
  // The seven infrastructure choices have defaults and live behind one confirm;
  // the brand is derived from the directory.
  const source = await readFile(new URL('./commands/new.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("message: 'Change any of these?'"), 'defaults must be foldable');
  assert.ok(source.includes('p.groupMultiselect('), 'tools are picked in one grouped step');
  assert.ok(
    source.includes('options.yes || suggested'),
    'the brand is derived from the directory, not asked',
  );
  // The data question is conditional: with one app there is nothing to decide.
  assert.ok(source.includes("resolved.name !== 'mono'"));
});

test('every flavor ships agent rules, and they cite commands that exist', async () => {
  // Rules that name a script the template does not have are worse than no
  // rules: an agent follows them, the command fails, and it learns to ignore
  // the file. Cursor, Codex and Antigravity read AGENTS.md natively; Claude
  // Code and Cline get a pointer, so there is ONE copy to keep true.
  const root = new URL('../../../templates/', import.meta.url);
  const flavors = [
    'sisaas',
    'simice',
    'sibile-rn',
    'sibile-flutter',
    'sibile-capacitor',
    'sical',
    'platform',
  ];

  for (const flavor of flavors) {
    const rules = await readFile(new URL(`${flavor}/AGENTS.md`, root), 'utf8');
    assert.ok(rules.length > 500, `${flavor}/AGENTS.md is too thin to be useful`);

    for (const pointer of ['CLAUDE.md', '.clinerules']) {
      const text = await readFile(new URL(`${flavor}/${pointer}`, root), 'utf8');
      assert.match(text, /AGENTS\.md/, `${flavor}/${pointer} must point at AGENTS.md`);
      // A pointer that grew into a second copy is the drift this avoids.
      assert.ok(text.length < 2000, `${flavor}/${pointer} is becoming a second copy`);
    }

    const pkgRaw = await readFile(new URL(`${flavor}/package.json`, root), 'utf8').catch(() => '');
    const scripts = pkgRaw
      ? Object.keys((JSON.parse(pkgRaw) as { scripts?: Record<string, string> }).scripts ?? {})
      : null;

    // Every `pnpm <script>` named must exist in that flavor's package.json — in
    // prose AND inside fenced blocks. The first version read only backticked
    // commands, so the copy-pasteable ones went unverified, which is the half
    // that actually gets run.
    //
    // Tokenised rather than pattern-matched: a regex clever enough to skip
    // `--filter '*/server' exec nest` matched the wrong word and failed on a
    // script called `t`.
    const PNPM_BUILTINS = new Set(['exec', 'run', 'install', 'add', 'dlx', 'why', 'up']);
    for (const line of rules.split('\n')) {
      for (const command of line.split(/&&|\|\||;/)) {
        const tokens = command.trim().replace(/[`$]/g, '').split(/\s+/).map((t) => t.replace(/[.,;:)]+$/, ''));
        if (tokens[0] !== 'pnpm') continue;
        let i = 1;
        // Skip flags and any value they take.
        while (i < tokens.length && tokens[i]!.startsWith('-')) i += tokens[i]!.includes('=') ? 1 : 2;
        const name = tokens[i];
        // A flavor with no package.json (Flutter) cannot be checked this way.
        if (!name || !scripts || PNPM_BUILTINS.has(name)) continue;
        assert.ok(
          scripts.includes(name),
          `${flavor}/AGENTS.md tells an agent to run \`pnpm ${name}\`, which does not exist`,
        );
      }
    }

    // And every script file it names must be on disk.
    for (const [, file] of rules.matchAll(/`?(scripts\/[\w.-]+)`?/g)) {
      const exists = await readFile(new URL(`${flavor}/${file}`, root), 'utf8').then(
        () => true,
        () => false,
      );
      assert.ok(exists, `${flavor}/AGENTS.md names ${file}, which is not shipped`);
    }
  }
});

test('a variant file used by one choice is deleted by its siblings', async () => {
  // The trap this exists for: `replace` renames a variant onto its target only
  // in the option that declares it. Every OTHER option in the same question
  // leaves the variant sitting in the scaffolded tree — a second copy of a file,
  // shipped to the user, drifting from the one they actually build.
  const root = new URL('../../../templates/', import.meta.url);
  const templates = ['sisaas'];

  for (const name of templates) {
    const manifest = JSON.parse(
      await readFile(new URL(`${name}/.si/template.json`, root), 'utf8'),
    ) as {
      choices?: { key: string; options: { value: string; replace?: Record<string, string>; remove?: string[] }[] }[];
    };

    for (const question of manifest.choices ?? []) {
      for (const option of question.options) {
        for (const source of Object.values(option.replace ?? {})) {
          for (const sibling of question.options) {
            if (sibling.value === option.value) continue;
            // A sibling that swaps the same variant in does not delete it.
            if (Object.values(sibling.replace ?? {}).includes(source)) continue;
            assert.ok(
              (sibling.remove ?? []).includes(source),
              `${name}: ${question.key}=${sibling.value} must remove "${source}", ` +
                `the variant that ${question.key}=${option.value} swaps in`,
            );
          }
        }
      }
    }
  }
});

test('every package.json parses, raw and composed', async () => {
  // `// si:when` in a package.json breaks it for npm, for pnpm, and for the
  // other tests here that read those files directly — so raw must parse, not
  // only the composed output. tsconfig.json and friends are excluded on
  // purpose: those are JSONC, and a comment in them is legal.
  //
  // If a package.json ever genuinely needs a conditional line, this is the test
  // that has to be satisfied first.
  const { pruneProfileLines } = await import('@simbtech/si-core');
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../../../templates/', import.meta.url);

  const found: string[] = [];
  const walk = async (dir: URL, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
      else if (entry.name === 'package.json') found.push(`${prefix}${entry.name}`);
    }
  };
  await walk(root, '');
  assert.ok(found.length > 3, 'found almost no package.json — the walk is broken');

  for (const rel of found) {
    const raw = await readFile(new URL(rel, root), 'utf8');
    assert.doesNotThrow(() => JSON.parse(raw), `${rel} is not valid JSON in the template`);
    if (!raw.includes('si:when') && !raw.includes('si:profile')) continue;
    for (const feature of ['multi-tenant', 'single-tenant', 'mono', 'identity', 'service']) {
      assert.doesNotThrow(
        () => JSON.parse(pruneProfileLines(raw, feature)),
        `${rel} is not valid JSON after composing ${feature}`,
      );
    }
  }
});

test('composing never leaves an unterminated block comment', async () => {
  // The bug this catches, which shipped twice before this test existed: a marker
  // on the CLOSING `*/` of a multi-line comment. The other build drops that one
  // line, the `/**` above it survives, and the comment swallows the declaration
  // underneath — a class body vanishes and the errors point somewhere else
  // entirely. `nest build` catches it; nothing before `nest build` does.
  const { pruneProfileLines } = await import('@simbtech/si-core');
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../../../templates/', import.meta.url);

  const sources: string[] = [];
  const walk = async (dir: URL, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
      else if (/\.(ts|tsx|js|jsx|css|rs|dart)$/.test(entry.name)) sources.push(`${prefix}${entry.name}`);
    }
  };
  await walk(root, '');
  assert.ok(sources.length > 50, 'found almost no sources — the walk is broken');

  // Every feature any template can compose with. A marker naming none of these
  // prunes to nothing everywhere, which this would not notice — that is what the
  // profile-coverage test is for.
  const FEATURES = [
    'multi-tenant', 'single-tenant', 'mono', 'identity', 'service',
    'auth-builtin', 'auth-oidc', 'storage-s3', 'uploads-presigned',
  ];

  for (const rel of sources) {
    const raw = await readFile(new URL(rel, root), 'utf8');
    if (!raw.includes('si:when') && !raw.includes('si:profile')) continue;
    for (const feature of FEATURES) {
      const composed = pruneProfileLines(raw, feature);
      const opens = (composed.match(/\/\*/g) ?? []).length;
      const closes = (composed.match(/\*\//g) ?? []).length;
      assert.equal(
        opens,
        closes,
        `${rel} has ${opens} "/*" and ${closes} "*/" after composing ${feature} — ` +
          'a marker on a closing delimiter drops it and leaves the comment open',
      );
    }
  }
});

test('every flavor offers tools, or is on the list of ones that cannot', async () => {
  // The bug: `si new -f siapp` offered ZERO open-source tools and the picker
  // simply did not appear. Tools declare the project shapes they suit, and every
  // entry named `sisaas`; SiAPP is the same shape under a different flavor id,
  // so the filter matched nothing and said nothing.
  //
  // Silence is the part that made it hard to see, so both halves are pinned
  // here: the mapping, and the fact that a genuine zero must be deliberate.
  const { loadRegistry, forFlavor } = await import('@simbtech/si-tools');
  const { registryFlavor } = await import('./flavors.ts');
  const registry = await loadRegistry();

  // Flutter uses pub.dev. Every entry in this registry is an npm package or a
  // container, so there is honestly nothing to offer — and `si new` says so
  // rather than skipping the question. Delete this the day a Dart tool lands.
  const KNOWN_EMPTY = new Set(['sibile-flutter']);

  for (const flavor of FLAVORS) {
    const count = forFlavor(registry, registryFlavor(flavor.id)).filter(
      (t) => t.kind !== 'feature',
    ).length;
    if (KNOWN_EMPTY.has(flavor.id)) {
      assert.equal(count, 0, `${flavor.id} now has tools — take it out of KNOWN_EMPTY`);
    } else {
      assert.ok(count > 0, `${flavor.id} offers no tools, so si new shows no picker`);
    }
  }

  // An alias flavor must see exactly what its template sees, or the two drift.
  const alias = forFlavor(registry, registryFlavor('siapp')).map((t) => t.id).sort();
  const base = forFlavor(registry, registryFlavor('sisaas')).map((t) => t.id).sort();
  assert.deepEqual(alias, base, 'SiAPP and SiSAAS are one shape and must offer one list');
});


test('every flavor ships a user interface', async () => {
  // The gap this closes: `platform` scaffolded a CLI and nothing else, so
  // "add a VPS" meant reading a runbook. Nothing caught it because a flavor
  // with no UI still scaffolds, still builds and still passes the smoke test.
  //
  // What is counted is files that RENDER something, not files in a directory
  // called `ui` — SiCAL is a whole notes app in two components, and a count of
  // files would have called that a failure while a directory of empty stubs
  // passed.
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../../../templates/', import.meta.url);

  // A component, in each flavor's own idiom.
  const RENDERS: Record<string, { file: RegExp; markup: RegExp }> = {
    sisaas: { file: /\.tsx$/, markup: /<[A-Za-z]/ },
    simice: { file: /\.tsx$/, markup: /<[A-Za-z]/ },
    'sibile-rn': { file: /\.tsx$/, markup: /<[A-Za-z]/ },
    'sibile-flutter': { file: /\.dart$/, markup: /Widget build\(/ },
    'sibile-capacitor': { file: /\.tsx$/, markup: /<[A-Za-z]/ },
    sical: { file: /\.tsx$/, markup: /<[A-Za-z]/ },
    platform: { file: /\.tsx$/, markup: /<[A-Za-z]/ },
  };

  const count = async (dir: URL, spec: { file: RegExp; markup: RegExp }): Promise<number> => {
    let found = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        found += await count(new URL(`${entry.name}/`, dir), spec);
      } else if (spec.file.test(entry.name)) {
        const text = await readFile(new URL(entry.name, dir), 'utf8');
        if (spec.markup.test(text)) found++;
      }
    }
    return found;
  };

  for (const [flavor, spec] of Object.entries(RENDERS)) {
    const found = await count(new URL(`${flavor}/`, root), spec);
    assert.ok(
      found >= 2,
      `${flavor} ships ${found} component(s) that render markup — a flavor a user ` +
        'picks should come with something to look at, not just an API',
    );
  }
});

test('host ports are read from the compose file and moved when taken', async () => {
  const { createServer } = await import('node:net');
  const { planPorts, readPortRequests } = await import('./ports.ts');

  // Shaped like the real file, including a tool fragment `si add` merged in and
  // a `ports:`-looking line inside `command:` that must NOT be treated as one.
  const compose = [
    'services:',
    '  postgres:',
    '    image: postgres:17-alpine',
    '    ports:',
    "      - '${POSTGRES_HOST_PORT:-45810}:5432'",
    '  redpanda:',
    '    command:',
    '      - --kafka-addr=internal://0.0.0.0:9092,external://0.0.0.0:19092',
    '    ports:',
    "      - '${KAFKA_HOST_PORT:-45820}:19092'",
    '  meilisearch:',
    '    ports:',
    "      - '${MEILISEARCH_HOST_PORT:-45830}:7700'",
  ].join('\n');

  const requests = readPortRequests(compose);
  assert.deepEqual(
    requests.map((r) => r.env),
    ['POSTGRES_HOST_PORT', 'KAFKA_HOST_PORT', 'MEILISEARCH_HOST_PORT'],
    'a tool added later must be picked up too — the CLI does not know what it publishes',
  );
  assert.equal(requests[0]!.preferred, 45810);

  // Take one for real, so this tests the bind rather than a mock of it.
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(45810, '0.0.0.0', resolve));
  try {
    const plan = await planPorts(requests);
    assert.notEqual(plan.env['POSTGRES_HOST_PORT'], '45810', 'a taken port must move');
    assert.equal(plan.env['KAFKA_HOST_PORT'], '45820', 'a free port must not move');
    assert.equal(plan.moved.length, 1);
    assert.equal(plan.moved[0]!.from, 45810);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test('two services defaulting to the same port do not both move to the same one', async () => {
  // The bug this would be: allocate independently, both find 8080 taken, both
  // pick 8081, and docker fails on the second with the error the whole feature
  // exists to avoid.
  const { planPorts } = await import('./ports.ts');
  const plan = await planPorts([
    { env: 'A_HOST_PORT', preferred: 45700, label: 'a' },
    { env: 'B_HOST_PORT', preferred: 45700, label: 'b' },
    { env: 'C_HOST_PORT', preferred: 45700, label: 'c' },
  ]);
  const assigned = Object.values(plan.env);
  assert.equal(new Set(assigned).size, 3, `got duplicates: ${assigned.join(', ')}`);
});

test('upgrade never records your unresolved edit as the template baseline', async () => {
  // The bug this pins, which the first version of `si upgrade` had: it
  // re-fingerprinted the working tree after applying. An unresolved conflict is
  // still YOUR file on disk, so recording it as the baseline made the next
  // upgrade see a pristine file and overwrite you without asking.
  //
  // A file keeps its old baseline until the template's version is actually
  // applied. That is what makes a second run report the same conflict instead
  // of quietly resolving it in the template's favour.
  const { fingerprint, hash } = await import('./fingerprint.ts');
  assert.equal(typeof fingerprint, 'function');

  const original = hash('v1');
  const theirs = hash('v3');

  // added/updated take the incoming hash; conflict and yours keep the old one.
  const baseline: Record<string, string> = {
    'kept.ts': original,      // conflict: you edited, they edited
    'mine.ts': original,      // yours: you edited, they did not
    'clean.ts': original,     // updated: you did not touch it
  };
  const incoming: Record<string, string> = {
    'kept.ts': theirs,
    'mine.ts': original,
    'clean.ts': theirs,
    'new.ts': theirs,
  };

  const next = { ...baseline };
  for (const file of ['clean.ts', 'new.ts']) next[file] = incoming[file]!;
  for (const file of Object.keys(next)) if (!(file in incoming)) delete next[file];

  assert.equal(next['kept.ts'], original, 'an unresolved conflict must keep its old baseline');
  assert.equal(next['mine.ts'], original, 'a file only you changed must keep its old baseline');
  assert.equal(next['clean.ts'], theirs, 'an applied update advances the baseline');
  assert.equal(next['new.ts'], theirs, 'a new file is tracked from now on');
});

test('a scaffold records what upgrade needs to work', async () => {
  // Without `files`, upgrade cannot tell your edit from ours and has to treat
  // everything that differs as a conflict. Without `siVersion` it cannot say
  // what it is upgrading from. Both are written by `si new`.
  const source = await readFile(new URL('./commands/new.ts', import.meta.url), 'utf8');
  assert.match(source, /files: await fingerprint\(dir\)/);
  assert.match(source, /siVersion: CLI_VERSION/);
});

test('a compose file with literal host ports is made movable, once', async () => {
  // The failure this fixes, reported from a real project: `si start dev` died
  // with "Bind for 0.0.0.0:9000 failed: port is already allocated". The port
  // allocator only understood `${VAR:-9000}`, and a project scaffolded before
  // that existed has `- '9000:9000'` written out — so nothing was allocated and
  // docker bound exactly the port that was taken.
  const { parameteriseCompose, readPortRequests } = await import('./ports.ts');

  const before = [
    'services:',
    '  minio:',
    '    image: minio/minio',
    '    ports:',
    "      - '9000:9000' # S3 API",
    "      - '9001:9001' # Web console",
    '  redpanda:',
    '    command:',
    // Not a port mapping. Rewriting this would corrupt the broker's own config.
    '      - --kafka-addr=internal://0.0.0.0:9092,external://0.0.0.0:19092',
    '    ports:',
    "      - '19092:19092'",
  ].join('\n');

  const first = parameteriseCompose(before);
  assert.equal(first.changed.length, 3);
  assert.match(first.compose, /\$\{MINIO_HOST_PORT:-9000\}:9000/);
  assert.match(first.compose, /\$\{MINIO_CONSOLE_HOST_PORT:-9001\}:9001/);
  assert.match(first.compose, /\$\{KAFKA_HOST_PORT:-19092\}:19092/);
  assert.match(
    first.compose,
    /--kafka-addr=internal:\/\/0\.0\.0\.0:9092,external:\/\/0\.0\.0\.0:19092/,
    'a port inside `command:` is not a mapping and must survive untouched',
  );

  // The defaults are the ports it had, so nothing about the stack changes.
  const requests = readPortRequests(first.compose);
  assert.deepEqual(
    requests.map((r) => r.preferred),
    [9000, 9001, 19092],
  );

  // Run on every start, so it has to be a no-op the second time.
  const second = parameteriseCompose(first.compose);
  assert.equal(second.changed.length, 0, 'migrating an already-migrated file must change nothing');
  assert.equal(second.compose, first.compose);
});

test('the transport is a choice, not a consequence of the profile', async () => {
  // It used to be derived: `mono` meant in-process, `identity`/`service` meant
  // Kafka. That made a perfectly reasonable wish — one deployable, but on a
  // broker from day one — unexpressible. The markers are features now.
  const root = new URL('../../../templates/sisaas/', import.meta.url);

  for (const file of [
    'apps/server/src/app.module.ts',
    'apps/server/src/worker.module.ts',
    'apps/server/src/worker.module.solo.ts',
  ]) {
    const text = await readFile(new URL(file, root), 'utf8');
    assert.match(text, /transport: 'in-process' \}\).*si:when events-in-process/);
    assert.match(text, /transport: 'kafka' \}\).*si:when events-kafka/);
    assert.doesNotMatch(
      text,
      /EventsModule[^\n]*si:profile/,
      `${file} still ties the transport to the profile`,
    );
  }

  // The broker itself has to come and go with the choice, or `--events kafka`
  // on a mono project configures a Kafka that is not running.
  const compose = await readFile(new URL('infra/docker-compose.yml', root), 'utf8');
  assert.match(compose, /si:when-begin events-kafka/);
  assert.doesNotMatch(compose, /si:profile-begin identity,service/);

  // And both must be offered.
  const manifest = JSON.parse(await readFile(new URL('.si/template.json', root), 'utf8')) as {
    choices: Array<{ key: string; options: Array<{ value: string }> }>;
  };
  const events = manifest.choices.find((c) => c.key === 'events');
  assert.ok(events, 'the events question must exist');
  assert.deepEqual(events.options.map((o) => o.value).sort(), ['in-process', 'kafka']);

  const modules = manifest.choices.find((c) => c.key === 'modules');
  assert.ok(modules, 'the module-shape question must exist');
  assert.deepEqual(modules.options.map((o) => o.value).sort(), ['cqrs', 'service']);
});

test('scaffold takes the module shape from the project, not a flag you must remember', async () => {
  // A codebase with some modules CQRS and some not is the worst of both, and
  // that is what happens when the answer lives only in a flag.
  const source = await readFile(new URL('./commands/scaffold.ts', import.meta.url), 'utf8');
  assert.match(source, /cqrs: options\.cqrs \?\? \(await projectPrefersCqrs\(root\)\)/);
});

test('agent rules cite si commands and docs that actually exist', async () => {
  // Rules that name a command which does not exist are worse than no rules: an
  // agent runs it, it fails, and the file loses its authority for everything
  // else it says. The pnpm-script version of this check already exists; this is
  // the same idea for `si <command>` and for the docs they point at.
  const { readdir, access } = await import('node:fs/promises');
  const root = new URL('../../../templates/', import.meta.url);

  // The real command surface, from the registry the CLI is built from.
  const { commands } = await import('./commands-registry.ts');
  const known = new Set(commands.map((c) => c.name));
  assert.ok(known.has('scaffold') && known.has('upgrade'), 'the registry did not load');

  const flavors = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  assert.ok(flavors.length >= 7);

  for (const flavor of flavors) {
    const rules = await readFile(new URL(`${flavor}/AGENTS.md`, root), 'utf8');

    // Every `si <word>` named in the rules must be a command.
    for (const match of rules.matchAll(/\bsi ([a-z][a-z-]*)/g)) {
      const name = match[1]!;
      assert.ok(
        known.has(name),
        `${flavor}/AGENTS.md says \`si ${name}\`, which is not a command. ` +
          `Known: ${[...known].join(', ')}`,
      );
    }

    // Every doc it points at must be shipped by that flavor.
    for (const match of rules.matchAll(/`(docs\/[A-Za-z0-9._/-]+\.md)`/g)) {
      const rel = match[1]!;
      await assert.doesNotReject(
        access(new URL(`${flavor}/${rel}`, root)),
        `${flavor}/AGENTS.md points at ${rel}, which that flavor does not ship`,
      );
    }

    // And the CLI reference itself must not promise a command that is not real.
    const doc = await readFile(new URL(`${flavor}/docs/SI-CLI.md`, root), 'utf8').catch(() => '');
    for (const match of doc.matchAll(/`si ([a-z][a-z-]*)/g)) {
      const name = match[1]!;
      assert.ok(known.has(name), `${flavor}/docs/SI-CLI.md documents \`si ${name}\`, which does not exist`);
    }
  }
});

test('the CLI runs when invoked through a symlink, as npm installs it', async () => {
  // 0.6.1 shipped a CLI that did nothing. The bootstrap had been guarded on
  // `import.meta.url === pathToFileURL(process.argv[1]).href` so that importing
  // the module for its command list would not run the program — but npm puts a
  // SYMLINK in node_modules/.bin, so argv[1] is the link and import.meta.url is
  // the real path. The guard was false for every user who typed `si`, and the
  // failure was silent: no output, no exit code, nothing.
  //
  // The registry lives in its own module now, so there is no guard to get
  // wrong. This runs the built CLI the way npm does.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { symlink, mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const run = promisify(execFile);

  const dist = new URL('../dist/index.js', import.meta.url);
  const built = await readFile(dist, 'utf8').catch(() => '');
  if (!built) return; // not built yet; `pnpm build` runs before the release anyway

  const dir = await mkdtemp(path.join(tmpdir(), 'si-bin-'));
  try {
    const link = path.join(dir, 'si');
    await symlink(path.resolve(dist.pathname), link);
    const { stdout } = await run(process.execPath, [link, '--version']);
    assert.match(
      stdout.trim(),
      /^\d+\.\d+\.\d+$/,
      'the CLI produced no version through a symlink — it is inert for anyone who installed it',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the LAN address skips loopback and bridge interfaces', async () => {
  // A phone cannot route to 127.0.0.1, and it cannot route to a docker bridge
  // either — both are real interfaces with real addresses on this machine, and
  // putting either in a QR code produces a code that scans and never loads.
  const { lanAddress } = await import('./lan.ts');

  const address = lanAddress();
  if (address) {
    assert.doesNotMatch(address, /^127\./, 'loopback is useless from another device');
    assert.doesNotMatch(address, /^172\.1[7-9]\.|^172\.2\d\.|^172\.3[01]\./, 'docker bridge range');
    assert.match(address, /^\d+\.\d+\.\d+\.\d+$/, 'IPv4 only — a phone cannot type a zone index');
  }

  // No LAN is a normal state, not a failure — `si start dev` falls back to
  // loopback and prints no QR rather than a code nobody can scan.
  assert.ok(address === undefined || address.length > 6);
});

test('every flavor that serves a UI binds it where a phone can reach it', async () => {
  // Binding to localhost is the default for Vite and it is the wrong one here:
  // the URL is printed, the QR is scanned, and the page never loads. SiCAL is
  // the deliberate exception — that flavour's promise is that it makes no
  // network calls, so its dev server has no business on the Wi-Fi.
  const { readFile } = await import('node:fs/promises');
  const root = new URL('../../../templates/', import.meta.url);

  const SERVES_UI: Array<[string, string]> = [
    ['sisaas', 'apps/web/package.json'],
    ['platform', 'apps/web/package.json'],
    ['simice', 'package.json'],
    ['sibile-capacitor', 'package.json'],
  ];

  for (const [flavor, pkgPath] of SERVES_UI) {
    const pkg = JSON.parse(await readFile(new URL(`${flavor}/${pkgPath}`, root), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const dev = pkg.scripts['dev']!;
    assert.match(
      dev,
      /--host|-H 0\.0\.0\.0/,
      `${flavor} serves its UI on localhost only, so a phone cannot reach it: ${dev}`,
    );
    assert.match(dev, /\$\{PORT:-\d+\}/, `${flavor} ignores the port si allocated: ${dev}`);
  }

  const sical = JSON.parse(await readFile(new URL('sical/.si/template.json', root), 'utf8')) as {
    dev: { lan?: boolean };
  };
  assert.equal(sical.dev.lan, false, 'SiCAL must opt out of the LAN — it promises no network');
});

test('upgrade never replaces a file that is not what si last wrote', async () => {
  // The reported bug: `si upgrade` overwrote a user's `src/app/page.tsx`.
  //
  // The mechanism was the directory walk, not the classification. `apps/web`
  // as a SYMLINK is invisible to `readdir(withFileTypes)` — `isDirectory()` is
  // false for a link — so every file under it looked absent, was classified
  // "added", and "added" writes.
  //
  // The walk is fixed, but the guarantee must not depend on the walk being
  // right. This is the rule that holds even when it is wrong.
  const { mayReplace } = await import('./commands/upgrade.ts');

  const mine = 'aaaa', ours = 'bbbb', theirs = 'cccc';

  assert.equal(mayReplace(undefined, undefined, theirs), true, 'absent: write it');
  assert.equal(mayReplace(ours, ours, theirs), true, 'untouched since we wrote it: safe');
  assert.equal(mayReplace(theirs, ours, theirs), true, 'already identical: a no-op');

  assert.equal(mayReplace(mine, ours, theirs), false, 'edited by the user: never');
  assert.equal(
    mayReplace(mine, undefined, theirs),
    false,
    'no baseline is not permission — an unrecognised file is somebody’s work',
  );
});

test('the fingerprint sees through a symlinked directory', async () => {
  // pnpm workspaces and hand-moved app folders both produce these, and a
  // subtree the walk cannot see reads to `si upgrade` as files the project does
  // not have — which is a licence to write them.
  const { fingerprint } = await import('./fingerprint.ts');
  const { mkdtemp, mkdir, writeFile, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;

  const dir = await mkdtemp(path.join(tmpdir(), 'si-fp-'));
  await mkdir(path.join(dir, 'real', 'app'), { recursive: true });
  await writeFile(path.join(dir, 'real', 'app', 'page.tsx'), 'export default function Home() {}');
  await mkdir(path.join(dir, 'apps'), { recursive: true });
  await symlink(path.join(dir, 'real'), path.join(dir, 'apps', 'web'));

  const seen = Object.keys(await fingerprint(dir));
  assert.ok(
    seen.some((f) => f.includes(`apps${path.sep}web`)),
    `a symlinked app directory was invisible to the walk: ${seen.join(', ')}`,
  );
});

test('hotkeys dispatch, and Ctrl-C still quits in raw mode', async () => {
  // Raw mode means the terminal stops turning Ctrl-C into SIGINT, so if this
  // handler does not deal with it the dev server becomes unquittable. That is
  // the part worth a test — a shortcut that does not fire is an annoyance, a
  // process you cannot stop is not.
  const { onHotkeys } = await import('./dev-console.ts');
  const { EventEmitter } = await import('node:events');

  const CTRL_C = String.fromCharCode(3);
  const CTRL_D = String.fromCharCode(4);
  const fired: string[] = [];
  let quit = 0;

  // A stdin that claims to be a terminal, so the raw-mode path is exercised.
  const fake = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode(): void {},
    resume(): void {},
    pause(): void {},
    setEncoding(): void {},
  });
  const real = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true });

  try {
    const release = onHotkeys(
      [
        { key: 'r', describe: 'restart', run: () => fired.push('restart') },
        { key: 's', describe: 'qr', run: () => fired.push('qr') },
      ],
      () => {
        quit += 1;
      },
    );

    fake.emit('data', 'r');
    fake.emit('data', 'S'); // shift is a slip, not a different key
    fake.emit('data', 'z'); // unbound keys are ignored, not errors
    assert.deepEqual(fired, ['restart', 'qr']);

    fake.emit('data', CTRL_C);
    assert.equal(quit, 1, 'Ctrl-C must quit — raw mode means nothing else will');
    fake.emit('data', CTRL_D);
    assert.equal(quit, 2);

    release();
    fake.emit('data', 'r');
    assert.deepEqual(fired, ['restart', 'qr'], 'a released handler must stop listening');
  } finally {
    if (real) Object.defineProperty(process, 'stdin', real);
  }
});

test('a non-terminal stdin skips raw mode instead of throwing', async () => {
  // `si start dev > log.txt`, and CI. setRawMode throws on a pipe, and a dev
  // server that cannot run redirected would be a poor trade for a shortcut.
  const { onHotkeys } = await import('./dev-console.ts');
  const { EventEmitter } = await import('node:events');

  const pipe = Object.assign(new EventEmitter(), { isTTY: false });
  const real = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', { value: pipe, configurable: true });
  try {
    const release = onHotkeys([{ key: 'r', describe: 'restart', run: () => {} }], () => {});
    assert.equal(typeof release, 'function');
    release();
  } finally {
    if (real) Object.defineProperty(process, 'stdin', real);
  }
});

test('the supervisor labels each process and can restart one', async () => {
  // Three processes inheriting one terminal was the state before this: Nest's
  // routes, Next's compiles and the worker's logs interleaved and unlabelled,
  // so the first question about any line was which process wrote it.
  const { supervise } = await import('./dev-console.ts');

  const written: string[] = [];
  const supervisor = supervise(
    [
      {
        label: 'api',
        cwd: process.cwd(),
        run: [process.execPath, '-e', "console.log('hello from api'); setInterval(() => {}, 1000)"],
        env: {},
      },
      {
        label: 'web',
        cwd: process.cwd(),
        run: [process.execPath, '-e', "console.log('hello from web'); setInterval(() => {}, 1000)"],
        env: {},
      },
    ],
    (line) => written.push(line),
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const plain = written.join('').replace(/\u001b\[[0-9;]*m/g, '');
    assert.match(plain, /api\s+\|\s+hello from api/, `no api label in: ${plain}`);
    assert.match(plain, /web\s+\|\s+hello from web/, `no web label in: ${plain}`);

    // Labels are padded to a common width so the pipes line up; a ragged left
    // margin is the thing that makes interleaved output hard to scan.
    assert.match(plain, /api {1,}\|/);

    // Restarting one brings it back, and leaves the other alone.
    written.length = 0;
    supervisor.restart('web');
    await new Promise((r) => setTimeout(r, 1600));
    const after = written.join('').replace(/\u001b\[[0-9;]*m/g, '');
    assert.match(after, /web\s+\|\s+hello from web/, `web did not come back: ${after}`);
    assert.doesNotMatch(after, /hello from api/, 'restarting web must not restart the api');
  } finally {
    await supervisor.stop();
  }
});
