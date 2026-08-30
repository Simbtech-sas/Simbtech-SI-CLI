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

test('si new records the dependencies of the features it wires in', async () => {
  // Wiring in Temporal writes code importing @temporalio/client. If the install
  // step is skipped unconditionally, that package is never added to
  // package.json — and the `pnpm install` the CLI tells the user to run next
  // cannot install what nothing recorded.
  const source = await readFile(new URL('./commands/new.ts', import.meta.url), 'utf8');
  assert.ok(
    source.includes('skipInstall: options.skipInstall'),
    'si new must pass the user’s skip-install choice through, not hardcode true',
  );
  assert.ok(!/addTools\([^)]*skipInstall: true/s.test(source));
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
