import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDocument, parse } from 'yaml';
import { loadRegistry, forFlavor, byCategory, withRequires, TEMPLATES_DIR, REGISTRY_DIR } from './registry.ts';
import { mergeComposeDocuments } from './compose.ts';
import { parseTool, CATEGORIES, FEATURE_CATEGORIES } from './schema.ts';

test('every registry entry loads and validates', async () => {
  const tools = await loadRegistry();
  assert.ok(tools.length >= 25, `expected a seeded registry, got ${tools.length}`);
  for (const t of tools) {
    assert.ok(t.summary.length > 10, `${t.id}: summary too thin`);
    assert.match(t.repo, /^https:\/\//, `${t.id}: repo must be a URL`);
    assert.ok(t.license.length > 0, `${t.id}: license required`);
    const all = [...CATEGORIES, ...FEATURE_CATEGORIES] as readonly string[];
    assert.ok(all.includes(t.category), `${t.id}: unknown category ${t.category}`);
  }
});

test('every shipped template compiles as Handlebars and parses as YAML', async () => {
  // Rendering with the REAL engine, not a string replace. `${VAR:-{{brand}}}`
  // ends in `}}}`, which Handlebars reads as a raw-output block and rejects —
  // a faked substitution passes and the actual install fails.
  const Handlebars = (await import('handlebars')).default;
  for (const tool of await loadRegistry()) {
    const templates = [
      ...(tool.compose ? [tool.compose] : []),
      ...tool.files.map((f) => f.src),
    ];
    for (const name of templates) {
      const file = path.join(TEMPLATES_DIR, tool.id, name);
      const source = await readFile(file, 'utf8');
      let rendered: string;
      try {
        rendered = Handlebars.compile(source, { noEscape: true })({ brand: 'demo', tool });
      } catch (err) {
        assert.fail(`${tool.id}/${name}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      }
      if (name.endsWith('.yml') || name.endsWith('.yaml')) {
        const doc = parse(rendered) as { services?: unknown };
        assert.ok(doc.services, `${tool.id}/${name}: fragment declares no services`);
      }
      assert.ok(!rendered.includes('{{'), `${tool.id}/${name}: an unresolved placeholder survived`);
    }
  }
});

test('a tool declaring files actually ships those templates', async () => {
  for (const tool of await loadRegistry()) {
    for (const f of tool.files) {
      await readFile(path.join(TEMPLATES_DIR, tool.id, f.src), 'utf8');
    }
  }
});

test('registrations reference anchors the SiSAAS template declares', async () => {
  const manifest = JSON.parse(
    await readFile(
      path.join(REGISTRY_DIR, '..', '..', '..', 'templates', 'sisaas', '.si', 'template.json'),
      'utf8',
    ),
  ) as { anchors: Record<string, unknown> };
  for (const tool of await loadRegistry()) {
    for (const reg of tool.register) {
      assert.ok(
        manifest.anchors[reg.anchor],
        `${tool.id} registers at unknown anchor "${reg.anchor}"`,
      );
    }
  }
});

test('flavor filtering: empty list means every flavor', async () => {
  const tools = await loadRegistry();
  const sisaas = forFlavor(tools, 'sisaas');
  const sical = forFlavor(tools, 'sical');
  assert.ok(sisaas.some((t) => t.id === 'livekit'));
  assert.ok(!sical.some((t) => t.id === 'livekit'), 'a no-network flavor is not offered an SFU');
  assert.ok(sical.some((t) => t.id === 'pglite'));
});

test('categories group without losing anything', async () => {
  const tools = await loadRegistry();
  const grouped = byCategory(tools);
  const total = [...grouped.values()].reduce((n, list) => n + list.length, 0);
  assert.equal(total, tools.length);
});

test('registry ids are unique and match their filenames', async () => {
  const files = (await readdir(REGISTRY_DIR)).filter((f) => f.endsWith('.yaml'));
  const tools = await loadRegistry();
  assert.equal(files.length, tools.length);
  assert.equal(new Set(tools.map((t) => t.id)).size, tools.length);
});

test('parseTool rejects malformed entries loudly', () => {
  assert.throws(() => parseTool({ id: 'x' }, 'x.yaml'), /missing/);
  assert.throws(
    () => parseTool({ id: 'X', name: 'X', category: 'search', summary: 's', repo: 'r', license: 'l' }, 'x.yaml'),
    /kebab-case/,
  );
  assert.throws(
    () => parseTool({ id: 'x', name: 'X', category: 'nope', summary: 's', repo: 'r', license: 'l' }, 'x.yaml'),
    /unknown category/,
  );
});

test('compose merge adds services and volumes without touching what exists', () => {
  const target = parseDocument(`# keep me
name: demo-dev
services:
  postgres:
    image: postgres:17-alpine
volumes:
  postgres-data:
`);
  const fragment = parseDocument(`services:
  livekit:
    image: livekit/livekit-server:v1.9.1
volumes:
  livekit-data:
`);
  const result = mergeComposeDocuments(target, fragment);
  assert.deepEqual(result.added, ['livekit', 'volumes.livekit-data']);
  const out = String(target);
  assert.match(out, /# keep me/, 'comments survive the merge');
  assert.match(out, /postgres:17-alpine/);
  assert.match(out, /livekit\/livekit-server/);
});

test('compose merge is idempotent and never overwrites an edited service', () => {
  const target = parseDocument(`services:
  livekit:
    image: livekit/livekit-server:CUSTOM
`);
  const fragment = parseDocument(`services:
  livekit:
    image: livekit/livekit-server:v1.9.1
`);
  const result = mergeComposeDocuments(target, fragment);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.alreadyPresent, ['services.livekit']);
  assert.match(String(target), /CUSTOM/, 'a local edit is preserved');
});

test('compose merge creates the services key when the target has none', () => {
  const target = parseDocument('name: demo-dev\n');
  const fragment = parseDocument('services:\n  redis:\n    image: redis:7-alpine\n');
  const result = mergeComposeDocuments(target, fragment);
  assert.deepEqual(result.added, ['redis']);
  assert.match(String(target), /redis:7-alpine/);
});

test('money-handling templates never route an amount through a float', async () => {
  // Money crosses these boundaries as a decimal string or as integer minor units.
  // `parseFloat`/`Number(decimalString)`/`toFixed` reintroduce IEEE-754 error,
  // which is the entire class of bug the ledger and `money` columns exist to stop.
  const banned = /parseFloat|\.toFixed\(|Number\(\s*(decimal|amount|price)/;
  // Scan code only — a comment saying "never uses parseFloat" is not a violation.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const tool of await loadRegistry()) {
    if (!['blnk', 'medusa'].includes(tool.id)) continue;
    for (const f of tool.files) {
      const src = stripComments(await readFile(path.join(TEMPLATES_DIR, tool.id, f.src), 'utf8'));
      const hit = banned.exec(src);
      assert.equal(hit?.[0], undefined, `${tool.id}/${f.src}: float arithmetic on money`);
    }
  }
});

test('every tool that ships code registers it somewhere', async () => {
  // A generated module nobody imports is dead code that typechecks — it looks
  // installed and does nothing.
  for (const tool of await loadRegistry()) {
    const shipsModule = tool.files.some((f) => f.dest.endsWith('.module.ts'));
    if (!shipsModule) continue;
    assert.ok(tool.register.length > 0, `${tool.id} ships a module but registers nothing`);
  }
});

test('a feature that declares a migration actually ships it', async () => {
  // A feature whose table never gets created fails at the first request, in
  // production, with a confusing error.
  for (const tool of await loadRegistry()) {
    for (const migration of tool.migrations ?? []) {
      const source = await readFile(path.join(TEMPLATES_DIR, tool.id, migration.src), 'utf8');
      assert.match(source, /CREATE TABLE/i, `${tool.id}/${migration.src} creates no table`);
      assert.match(migration.name, /^[a-z][a-z0-9_]*$/, `${tool.id}: bad migration name`);
    }
  }
});

test('features declare their prerequisites', async () => {
  const tools = await loadRegistry();
  const ids = new Set(tools.map((t) => t.id));
  for (const tool of tools) {
    for (const required of tool.requires ?? []) {
      // A dangling prerequisite means `si add` fails after writing half a feature.
      assert.ok(ids.has(required), `${tool.id} requires unknown entry "${required}"`);
    }
  }
});

test('features and tools are distinguishable', async () => {
  const tools = await loadRegistry();
  const features = tools.filter((t) => t.kind === 'feature');
  assert.ok(features.length > 0, 'the registry ships at least one feature');
  for (const feature of features) {
    // A feature is application code; a compose service belongs to a tool.
    assert.equal(feature.compose, undefined, `${feature.id}: a feature should not run a container`);
    assert.ok(feature.files.length > 0, `${feature.id}: a feature must ship code`);
  }
});

test('withRequires pulls dependencies in, dependencies first', async () => {
  const all = await loadRegistry();
  const joonapay = all.find((t) => t.id === 'payments-joonapay')!;
  const ordered = withRequires([joonapay], all).map((t) => t.id);
  // The port must exist before the adapter that imports it.
  assert.deepEqual(ordered, ['payments-core', 'payments-joonapay']);
});

test('withRequires does not duplicate an entry already asked for', async () => {
  const all = await loadRegistry();
  const picked = ['payments-core', 'payments-kpay', 'payments-joonapay'].map(
    (id) => all.find((t) => t.id === id)!,
  );
  const ordered = withRequires(picked, all).map((t) => t.id);
  assert.deepEqual(ordered, ['payments-core', 'payments-kpay', 'payments-joonapay']);
});

test('withRequires refuses a cycle rather than recursing forever', () => {
  const a = { id: 'a', requires: ['b'] } as never as Parameters<typeof withRequires>[0][number];
  const b = { id: 'b', requires: ['a'] } as never as Parameters<typeof withRequires>[0][number];
  assert.throws(() => withRequires([a], [a, b]), /circular requires/);
});

test('a shared-package dest uses the root: prefix, not a path inside the server app', async () => {
  const all = await loadRegistry();
  for (const tool of all) {
    for (const file of tool.files) {
      // `packages/...` under the server app is a stray file nobody imports.
      assert.ok(
        !file.dest.startsWith('packages/'),
        `${tool.id} writes ${file.dest} inside the server app — prefix it with root:`,
      );
    }
  }
});

test('installing an entry twice does not write its migration twice', async (t) => {
  // `requires` re-installs entries routinely — payments-kpay arrives once from
  // the --payments choice and again as a dependency of subscriptions. A second
  // migration file means the second `db:migrate` fails on a type that exists.
  const { installTool } = await import('./install.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'si-mig-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'apps/server/drizzle'), { recursive: true });

  const all = await loadRegistry();
  const tool = all.find((x) => x.id === 'payments-kpay')!;
  const options = {
    root,
    manifest: { id: 'sisaas', label: 'SiSAAS', targets: {}, anchors: {} } as never,
    brand: 'acme',
    skipInstall: true,
  };

  const first = await installTool(tool, options);
  const second = await installTool(tool, options);
  // `.sql` only — the directory now also holds meta/_journal.json.
  const files = (await readdir(path.join(root, 'apps/server/drizzle'))).filter((f) =>
    f.endsWith('.sql'),
  );

  assert.equal(first.migrations.length, 1);
  assert.equal(second.migrations.length, 0);
  assert.deepEqual(files, ['0000_kpay_payments.sql']);
});

test('no tool hardcodes the shared Postgres cluster in its connection string', async () => {
  // A tool given a dedicated cluster creates its database in one cluster and
  // connects to another, where it does not exist. Nothing errors at generation
  // time; it fails at first connection, in the cluster, at deploy.
  const all = await loadRegistry();
  for (const tool of all) {
    for (const [key, value] of Object.entries(tool.deploy?.env ?? {})) {
      assert.ok(
        !/\{\{brand\}\}-pg/.test(String(value)),
        `${tool.id}.${key} hardcodes the shared cluster — use {{db.host}}`,
      );
    }
  }
});

test('no tool claims a host port the base template already publishes', async () => {
  // The dev stack is one compose file. A collision here is not a warning: the
  // second `docker compose up` fails outright, and it fails for whoever added
  // the tool, not for whoever wrote it. Fragments must be compared against the
  // BASE template too — comparing them only against each other misses MinIO's
  // console, Postgres, Redis and Mailpit entirely.
  const base = await readFile(
    path.join(TEMPLATES_DIR, '../../../templates/sisaas/infra/docker-compose.yml'),
    'utf8',
  );
  const render = (t: string) => t.replaceAll('{{brand}}', 'acme');
  const claimed = new Map<string, string>();

  const collect = (yamlText: string, owner: string) => {
    const doc = parse(render(yamlText)) as { services?: Record<string, { ports?: unknown[] }> };
    for (const [svc, def] of Object.entries(doc.services ?? {})) {
      for (const p of def.ports ?? []) {
        const host = String(p).split(':')[0]!.replace(/['"]/g, '').trim();
        if (!/^\d+$/.test(host)) continue;
        const prior = claimed.get(host);
        assert.ok(!prior, `port ${host}: ${owner}/${svc} collides with ${prior}`);
        claimed.set(host, `${owner}/${svc}`);
      }
    }
  };

  collect(base, 'base');
  for (const tool of await loadRegistry()) {
    if (!tool.compose) continue;
    const frag = path.join(TEMPLATES_DIR, tool.id, tool.compose);
    collect(await readFile(frag, 'utf8'), tool.id);
  }
});

test('every tool with an HTTP API is reachable through ToolEndpoints', async () => {
  // 29 tools declare a `*_URL`. If the key is neither `<ID>_URL` nor mapped to
  // that tool's id in the override map, `ToolEndpoints.base(id)` looks up an env
  // var nobody sets and throws at the first call — long after the tool was
  // added, in whatever feature happened to need it first.
  const source = await readFile(
    path.join(TEMPLATES_DIR, 'integrations/tool-endpoints.ts.hbs'),
    'utf8',
  );
  // id -> urlEnv, as actually keyed. Matching the env name alone would pass with
  // the entry filed under the wrong tool.
  const mapped = new Map<string, string>();
  for (const m of source.matchAll(/^\s+'?([a-z0-9-]+)'?:\s*\{\s*urlEnv:\s*'([A-Z0-9_]+)'/gm)) {
    mapped.set(m[1]!, m[2]!);
  }
  assert.ok(mapped.size > 5, 'the override map did not parse');

  const missing: string[] = [];
  for (const tool of await loadRegistry()) {
    // Features are our own code with their own clients — KPay's base URL is read
    // by KpayClient, not by ToolEndpoints. This is about IMPORTED tools.
    if (tool.kind === 'feature') continue;
    const urlKey = tool.env.find((e) => /_(URL|ENDPOINT|HOST)$/.test(e.key))?.key;
    if (!urlKey) continue;
    const conventional = `${tool.id.toUpperCase().replaceAll('-', '_')}_URL`;
    if (urlKey === conventional) continue;
    if (mapped.get(tool.id) !== urlKey) missing.push(`${tool.id} -> ${urlKey}`);
  }
  assert.deepEqual(missing, [], `map these in OVERRIDES: ${missing.join(', ')}`);
});

test('every compose fragment merges into the base template and survives serialisation', async () => {
  // Parsing a fragment on its own is not enough. ERPNext used a YAML anchor,
  // which parsed perfectly alone and then threw "Unresolved alias" on merge —
  // an `x-` anchor does not travel with the services that reference it. That
  // aborted `si add` halfway, after earlier tools had already written files.
  const { mergeComposeDocuments } = await import('./compose.ts');
  const { parseDocument } = await import('yaml');
  const basePath = path.join(TEMPLATES_DIR, '../../../templates/sisaas/infra/docker-compose.yml');
  const baseText = await readFile(basePath, 'utf8');

  for (const tool of await loadRegistry()) {
    if (!tool.compose) continue;
    const fragment = await readFile(path.join(TEMPLATES_DIR, tool.id, tool.compose), 'utf8');
    const target = parseDocument(baseText.replaceAll('{{brand}}', 'acme'));
    const doc = parseDocument(fragment.replaceAll('{{brand}}', 'acme'));
    assert.deepEqual(doc.errors, [], `${tool.id}: ${doc.errors.map((e) => e.message).join('; ')}`);

    const merged = mergeComposeDocuments(target, doc);
    const declared = Object.keys((doc.toJS() as { services?: object }).services ?? {});
    assert.ok(declared.length > 0, `${tool.id} declares a compose file with no services`);

    // Stringifying is where an unresolvable alias actually throws.
    let out = '';
    assert.doesNotThrow(() => {
      out = String(target);
    }, `${tool.id} cannot be serialised after merging`);

    for (const svc of declared) {
      assert.ok(
        merged.added.includes(svc) || merged.alreadyPresent.includes(`services.${svc}`),
        `${tool.id}: service "${svc}" was neither merged nor reported as present`,
      );
      assert.ok(out.includes(svc), `${tool.id}: "${svc}" vanished from the merged file`);
    }
  }
});

test('no default silently installs a tool the user never picked', async () => {
  // `si new` with nothing selected wired in k6, because the loadtest choice
  // defaulted to it. A tool nobody asked for is a container they will not run
  // and an env var they will not set — and it teaches them the picker is a lie.
  const manifests = await readdir(path.join(TEMPLATES_DIR, '../../../templates'));
  const offenders: string[] = [];
  for (const flavor of manifests) {
    const file = path.join(TEMPLATES_DIR, '../../../templates', flavor, '.si/template.json');
    const raw = await readFile(file, 'utf8').catch(() => '');
    if (!raw) continue;
    const manifest = JSON.parse(raw) as {
      choices?: { key: string; default: string; options: { value: string; tools?: string[] }[] }[];
    };
    for (const choice of manifest.choices ?? []) {
      const chosen = choice.options.find((o) => o.value === choice.default);
      if (chosen?.tools?.length) {
        offenders.push(`${flavor}/${choice.key} -> ${chosen.tools.join(', ')}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `these defaults install tools unasked: ${offenders.join('; ')}`);
});

test('a migration written by si add is journalled, or it never runs', async () => {
  // `drizzle-kit migrate` reads meta/_journal.json, not the directory. A
  // migration that is written but not journalled is silently skipped — and
  // drizzle-kit exits 1 printing NOTHING, so it reads as a broken database
  // rather than a missing line. This is how `pnpm db:migrate` was broken in
  // every scaffolded project while every check still passed.
  const { installTool } = await import('./install.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'si-journal-'));
  await mkdir(path.join(root, 'apps/server/drizzle/meta'), { recursive: true });
  await writeFile(
    path.join(root, 'apps/server/drizzle/meta/_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries: [] }),
  );

  const all = await loadRegistry();
  const withMigrations = all.filter((t) => (t.migrations ?? []).length > 0).slice(0, 3);
  assert.ok(withMigrations.length > 0, 'no entry ships a migration — the test proves nothing');

  const options = {
    root,
    manifest: { id: 'sisaas', label: 'SiSAAS', targets: {}, anchors: {} } as never,
    brand: 'acme',
    skipInstall: true,
  };
  for (const tool of withMigrations) await installTool(tool, options);

  const files = (await readdir(path.join(root, 'apps/server/drizzle')))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();
  const journal = JSON.parse(
    await readFile(path.join(root, 'apps/server/drizzle/meta/_journal.json'), 'utf8'),
  ) as { entries: { idx: number; tag: string }[] };

  assert.deepEqual(journal.entries.map((e) => e.tag).sort(), files, 'journal and files disagree');
  assert.deepEqual(
    journal.entries.map((e) => e.idx),
    journal.entries.map((_, i) => i),
    'idx must be contiguous and in file order',
  );
  await rm(root, { recursive: true, force: true });
});

test('the compliance report is evidence, never the dataset grading itself', async () => {
  // The failure mode this guards: a requirement declared `code` whose probe
  // finds nothing must come back MISSING. A matrix that reports the dataset's
  // own optimism produces a green sheet for a tender that would fail — worse
  // than shipping no tool at all.
  const { evaluate, loadFramework } = await import('./compliance.ts');
  const framework = await loadFramework('public-sector');
  const empty = await mkdtemp(path.join(tmpdir(), 'si-compliance-'));

  const findings = await evaluate(framework, empty, []);
  const codeReqs = framework.sections
    .flatMap((s) => s.requirements)
    .filter((r) => r.kind === 'code' && r.check && !r.check.repo);
  assert.ok(codeReqs.length > 10, 'the dataset should probe more than a handful of things');

  for (const req of codeReqs) {
    const found = findings.find((f) => f.requirement.id === req.id)!;
    assert.equal(
      found.status,
      'missing',
      `${req.id} claims satisfied against an EMPTY directory — the probe is not probing`,
    );
  }

  // Organisational items must never be reported as satisfied by anything.
  for (const f of findings.filter((x) => x.requirement.kind === 'manual')) {
    assert.equal(f.status, 'manual', `${f.requirement.id} must stay organisational`);
  }
  await rm(empty, { recursive: true, force: true });
});

test('no compliance dataset names a customer organisation', async () => {
  // The requirements are the standard, not one client's tender. A dataset tied
  // to an organisation's name is one nobody else reads.
  const dir = path.join(TEMPLATES_DIR, '../compliance');
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.yaml'))) {
    const text = (await readFile(path.join(dir, file), 'utf8')).toLowerCase();
    for (const name of ['feicom', 'minfi', 'sonara']) {
      assert.ok(!text.includes(name), `${file} names an organisation: ${name}`);
    }
  }
});

test('every tool template renders for both tenancies, with no tenant left in a single-tenant build', async () => {
  // Tool templates are Handlebars, not marker-pruned, so a tenancy-dependent one
  // branches on `{{#if multiTenant}}`. Two ways that goes wrong, both of which
  // shipped before this test existed:
  //
  //   - a parse error, from `{{/if}}}` — Handlebars reads the three closing
  //     braces as a triple-stache and the whole file fails to render;
  //   - a branch that renders but still says "tenant", in a project that has
  //     none. That compiles. It just describes a thing the app does not have.
  const Handlebars = (await import('handlebars')).default;
  const { readdir, readFile } = await import('node:fs/promises');
  const root = new URL('../templates/', import.meta.url);

  // Two things that say "tenant" and are not ours:
  //   - `TenantTx`, the transaction type, which is named the same in both builds;
  //   - Bigcapital's own multi-tenancy, which is a property of that product and
  //     has nothing to do with whether OUR app has tenants.
  const ALLOWED = /TenantTx|TENANT_DB_NAME_PERFIX|DATABASE PER TENANT/;
  // SiMICE only; a single-tenant web app never sees it.
  const SKIP_DIRS = new Set(['cloud-sync']);

  let checked = 0;
  for (const dir of await readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || SKIP_DIRS.has(dir.name)) continue;
    for (const file of await readdir(new URL(`${dir.name}/`, root))) {
      const source = await readFile(new URL(`${dir.name}/${file}`, root), 'utf8');
      for (const multiTenant of [true, false]) {
        let rendered: string;
        try {
          rendered = Handlebars.compile(source, { noEscape: true })({ brand: 'x', multiTenant });
        } catch (err) {
          assert.fail(
            `${dir.name}/${file} does not render with multiTenant=${multiTenant}: ` +
              `${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
          );
        }
        checked++;
        if (multiTenant) continue;
        const leaked = rendered
          .split('\n')
          .filter((l) => /tenant/i.test(l) && !ALLOWED.test(l));
        assert.equal(
          leaked.length,
          0,
          `${dir.name}/${file} still mentions a tenant in a single-tenant build:\n` +
            leaked.slice(0, 3).map((l) => `    ${l.trim()}`).join('\n'),
        );
      }
    }
  }
  assert.ok(checked > 100, `only rendered ${checked} templates — the walk is broken`);
});
