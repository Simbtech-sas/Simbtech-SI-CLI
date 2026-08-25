import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { brandTokens, isValidBrand, templateTokens } from './brand.ts';
import { substituteTokens } from './substitute.ts';
import { detectPackageManager } from './pm.ts';
import { insertAtAnchor } from './anchor.ts';
import { assertEmptyDir, copyDir } from './fsx.ts';

async function scratch(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'si-core-'));
}

test('brand validation rejects what a pg role or npm scope cannot be', () => {
  assert.ok(isValidBrand('acme'));
  assert.ok(isValidBrand('shop2'));
  assert.ok(!isValidBrand('A'), 'single char');
  assert.ok(!isValidBrand('2fast'), 'leading digit');
  assert.ok(!isValidBrand('Acme'), 'uppercase');
  assert.ok(!isValidBrand('my-app'), 'hyphen breaks pg roles');
  assert.ok(!isValidBrand('a'.repeat(32)), 'too long');
  assert.throws(() => brandTokens('my-app'), /invalid brand/);
});

test('three case variants, and capital is first-letter-only', () => {
  assert.deepEqual(brandTokens('acme'), { lower: 'acme', capital: 'Acme', upper: 'ACME' });
});

test('substitution rewrites derived identifiers from the single token', async () => {
  const dir = await scratch();
  try {
    await writeFile(
      path.join(dir, 'sample.ts'),
      [
        'import { x } from "@simbkit/server";',
        'const role = "simbkit_app";',
        'const domain = "simbkit.local";',
        'const title = "Simbkit Dashboard";',
      ].join('\n'),
    );
    const result = await substituteTokens(dir, brandTokens('acme'));
    assert.equal(result.filesChanged, 1);
    const out = await readFile(path.join(dir, 'sample.ts'), 'utf8');
    assert.match(out, /@acme\/server/);
    assert.match(out, /acme_app/);
    assert.match(out, /acme\.local/);
    assert.match(out, /Acme Dashboard/);
    assert.ok(!out.includes('simbkit'), 'no token survives');
    assert.ok(!out.includes('Simbkit'), 'no capitalised token survives');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('substitution renames paths and skips .git and binaries', async () => {
  const dir = await scratch();
  try {
    await mkdir(path.join(dir, 'com', 'simbkit'), { recursive: true });
    await writeFile(path.join(dir, 'com', 'simbkit', 'simbkit.kt'), 'package com.simbkit');
    await mkdir(path.join(dir, '.git'), { recursive: true });
    await writeFile(path.join(dir, '.git', 'config'), 'url = simbkit');
    await writeFile(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x0d, 0x73]));

    const result = await substituteTokens(dir, brandTokens('acme'));

    assert.equal(result.pathsRenamed, 2, 'directory and file both renamed');
    const kt = await readFile(path.join(dir, 'com', 'acme', 'acme.kt'), 'utf8');
    assert.equal(kt, 'package com.acme');
    assert.equal(await readFile(path.join(dir, '.git', 'config'), 'utf8'), 'url = simbkit');
    assert.deepEqual([...(await readFile(path.join(dir, 'logo.png')))], [0x89, 0x50, 0x00, 0x0d, 0x73]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('substitution is idempotent', async () => {
  const dir = await scratch();
  try {
    await writeFile(path.join(dir, 'a.txt'), 'simbkit and Simbkit');
    await substituteTokens(dir, brandTokens('acme'));
    const second = await substituteTokens(dir, brandTokens('acme'));
    assert.equal(second.filesChanged, 0);
    assert.equal(await readFile(path.join(dir, 'a.txt'), 'utf8'), 'acme and Acme');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('template brand itself is a valid brand', () => {
  assert.deepEqual(templateTokens, { lower: 'simbkit', capital: 'Simbkit', upper: 'SIMBKIT' });
});

test('SCREAMING_SNAKE env prefixes are rebranded too', async () => {
  // A two-case rule leaves `SIMBKIT_MODE` pointing at the template brand, which
  // then fails at runtime instead of at scaffold time.
  const dir = await scratch();
  try {
    await writeFile(
      path.join(dir, 'env.rs'),
      'option_env!("SIMBKIT_LICENCE_PUBLIC_KEY") // simbkit, Simbkit',
    );
    await substituteTokens(dir, brandTokens('acme'));
    const out = await readFile(path.join(dir, 'env.rs'), 'utf8');
    assert.equal(out, 'option_env!("ACME_LICENCE_PUBLIC_KEY") // acme, Acme');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('packageManager field outranks a lockfile', async () => {
  const dir = await scratch();
  try {
    await writeFile(path.join(dir, 'package-lock.json'), '{}');
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.1.0' }));
    assert.equal(detectPackageManager(dir), 'yarn');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('lockfile is used when no packageManager field, walking up from a subdir', async () => {
  const dir = await scratch();
  try {
    await writeFile(path.join(dir, 'pnpm-lock.yaml'), '');
    const nested = path.join(dir, 'apps', 'server');
    await mkdir(nested, { recursive: true });
    assert.equal(detectPackageManager(nested), 'pnpm');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('anchor insertion matches indentation, is idempotent, and reports a missing anchor', async () => {
  const dir = await scratch();
  const file = path.join(dir, 'app.module.ts');
  try {
    await writeFile(file, ['@Module({', '  imports: [', '    // si:modules', '  ],', '})'].join('\n'));

    const first = await insertAtAnchor(file, '// si:modules', 'LivekitModule,');
    assert.equal(first.inserted, true);
    const out = await readFile(file, 'utf8');
    assert.match(out, /\n {4}LivekitModule,\n {4}\/\/ si:modules/);

    const again = await insertAtAnchor(file, '// si:modules', 'LivekitModule,');
    assert.deepEqual(again, { inserted: false, reason: 'already-present' });

    const missing = await insertAtAnchor(file, '// si:nowhere', 'X,');
    assert.deepEqual(missing, { inserted: false, reason: 'anchor-not-found' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('assertEmptyDir tolerates .git and a missing dir, refuses real content', async () => {
  const dir = await scratch();
  try {
    await assertEmptyDir(dir);
    await assertEmptyDir(path.join(dir, 'does-not-exist'));
    await mkdir(path.join(dir, '.git'));
    await assertEmptyDir(dir);
    await writeFile(path.join(dir, 'README.md'), '');
    await assert.rejects(() => assertEmptyDir(dir), /not empty/);
    assert.ok((await readdir(dir)).length > 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('copyDir leaves build output and installed dependencies behind', async () => {
  const from = await scratch();
  const to = path.join(await scratch(), 'out');
  try {
    await mkdir(path.join(from, 'src'), { recursive: true });
    await writeFile(path.join(from, 'src', 'app.ts'), 'export const x = 1;');
    await writeFile(path.join(from, '.gitignore'), 'node_modules/');
    for (const junk of ['node_modules', 'dist', '.turbo', 'target', '.next']) {
      await mkdir(path.join(from, junk), { recursive: true });
      await writeFile(path.join(from, junk, 'huge.bin'), 'x'.repeat(1000));
    }
    // Nested too — a monorepo has one per package.
    await mkdir(path.join(from, 'packages', 'a', 'node_modules'), { recursive: true });
    await writeFile(path.join(from, 'packages', 'a', 'node_modules', 'dep.js'), '');

    await copyDir(from, to);

    assert.equal(await readFile(path.join(to, 'src', 'app.ts'), 'utf8'), 'export const x = 1;');
    assert.ok((await readdir(to)).includes('.gitignore'), 'dotfiles are template content');
    const copied = await readdir(to);
    for (const junk of ['node_modules', 'dist', '.turbo', 'target', '.next']) {
      assert.ok(!copied.includes(junk), `${junk} must not be copied`);
    }
    assert.deepEqual(await readdir(path.join(to, 'packages', 'a')), [], 'nested node_modules skipped');
  } finally {
    await rm(from, { recursive: true, force: true });
    await rm(to, { recursive: true, force: true });
  }
});

test('profile pruning keeps only the lines a profile claims', async () => {
  const { pruneProfileLines } = await import('./applyProfile.ts');
  const source = [
    "import { AuthModule } from './auth';",
    "import { IamModule } from './iam'; // si:profile platform,identity",
    'imports: [',
    '  AuthModule,',
    '  IamModule, // si:profile platform,identity',
    '  TenancyModule, // si:profile platform,service',
    ']',
  ].join('\n');

  const service = pruneProfileLines(source, 'service');
  assert.ok(!service.includes('IamModule'), 'a service must not import identity');
  assert.ok(service.includes('TenancyModule'));
  assert.ok(!service.includes('si:profile'), 'the marker is stripped from output');

  const identity = pruneProfileLines(source, 'identity');
  assert.ok(identity.includes('IamModule'));
  assert.ok(!identity.includes('TenancyModule'), 'identity does not project its own events');

  const platform = pruneProfileLines(source, 'platform');
  assert.ok(platform.includes('IamModule') && platform.includes('TenancyModule'));

  // The unmarked line survives every profile.
  for (const out of [service, identity, platform]) assert.ok(out.includes('AuthModule'));
});

test('a profile that names a path the template no longer has is reported', async () => {
  const { applyProfile } = await import('./applyProfile.ts');
  const dir = await scratch();
  try {
    await mkdir(path.join(dir, 'keep'), { recursive: true });
    await writeFile(path.join(dir, 'keep', 'a.ts'), 'export const a = 1;');
    const result = await applyProfile(
      dir,
      { label: 'X', description: '', remove: ['keep', 'gone/forever'] },
      'x',
    );
    assert.deepEqual(result.removed, ['keep']);
    // Silently ignoring this is how a service ships the identity tables it was
    // supposed to drop.
    assert.deepEqual(result.missing, ['gone/forever']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveProfile rejects an unknown name instead of silently defaulting', async () => {
  const { resolveProfile } = await import('./manifest.ts');
  const manifest = {
    id: 'sisaas',
    profiles: { service: { label: 'S', description: '', remove: [] } },
    defaultProfile: 'service',
  } as never;
  assert.equal(resolveProfile(manifest, 'service')?.name, 'service');
  assert.equal(resolveProfile(manifest)?.name, 'service', 'falls back to the default');
  assert.throws(() => resolveProfile(manifest, 'nope'), /unknown profile/);
});

test('block markers prune a whole YAML section, not just a line', async () => {
  const { pruneProfileLines } = await import('./applyProfile.ts');
  const compose = [
    'services:',
    '  postgres:',
    '    image: postgres:17',
    '  # si:profile-begin identity,service',
    '  redpanda:',
    '    image: redpandadata/redpanda',
    '  debezium:',
    '    image: quay.io/debezium/server',
    '  # si:profile-end',
    'volumes:',
    '  postgres-data:',
  ].join('\n');

  const mono = pruneProfileLines(compose, 'mono');
  assert.ok(!mono.includes('redpanda'), 'a single deployable runs no broker');
  assert.ok(!mono.includes('debezium'));
  // The section AFTER the block must survive — an unbalanced marker would eat
  // the rest of the file, and the compose would still parse while missing keys.
  assert.ok(mono.includes('volumes:'));
  assert.ok(mono.includes('postgres-data:'));
  assert.ok(!mono.includes('si:profile'));

  const service = pruneProfileLines(compose, 'service');
  assert.ok(service.includes('redpanda') && service.includes('debezium'));
  assert.ok(service.includes('volumes:'));
});

test('a file using only the new marker name is still pruned', async () => {
  // The fast-path check and the regex must agree on which spellings exist, or a
  // file using only one of them is skipped whole and ships every variant.
  const { pruneProfileLines } = await import('./applyProfile.ts');
  const source = ["keep; // si:when a", "drop; // si:when b"].join('\n');
  assert.equal(pruneProfileLines(source, new Set(['a'])), 'keep;');
});

test('replace happens before remove, so a variant is not deleted first', async () => {
  const { applyProfile } = await import('./applyProfile.ts');
  const dir = await scratch();
  try {
    await mkdir(path.join(dir, 'variants'), { recursive: true });
    await writeFile(path.join(dir, 'guard.ts'), 'export const which = "default";');
    await writeFile(path.join(dir, 'variants', 'guard.oidc.ts'), 'export const which = "oidc";');

    const result = await applyProfile(
      dir,
      {
        label: 'oidc',
        description: '',
        // The same option swaps the variant in AND removes where it came from.
        replace: { 'guard.ts': 'variants/guard.oidc.ts' },
        remove: ['variants'],
      },
      'oidc',
    );

    assert.deepEqual(result.replaced, ['guard.ts']);
    assert.deepEqual(result.missing, [], 'the variant must still exist when the swap runs');
    assert.match(await readFile(path.join(dir, 'guard.ts'), 'utf8'), /oidc/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('markers are honoured in any text file, not a list of known extensions', async () => {
  // An extension allowlist silently ignored markers in Cargo.toml, and the
  // template shipped both database drivers.
  const { applyProfile } = await import('./applyProfile.ts');
  const dir = await scratch();
  try {
    await writeFile(
      path.join(dir, 'Cargo.toml'),
      ['plugin = { features = ["sqlite"] } # si:when db-sqlite',
       'plugin = { features = ["postgres"] } # si:when db-postgres'].join('\n'),
    );
    await writeFile(path.join(dir, 'main.rs'), 'let a = 1; // si:when db-sqlite\nlet b = 2; // si:when db-postgres');
    await writeFile(path.join(dir, 'app.dart'), 'const a = 1; // si:when db-sqlite');
    await writeFile(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x0d]));

    await applyProfile(dir, { label: 'pg', description: '', remove: [] }, 'db-postgres', ['db-postgres']);

    const toml = await readFile(path.join(dir, 'Cargo.toml'), 'utf8');
    assert.ok(toml.includes('postgres'), 'the chosen driver survives');
    assert.ok(!toml.includes('sqlite'), 'the other driver is pruned');
    assert.ok((await readFile(path.join(dir, 'main.rs'), 'utf8')).trim() === 'let b = 2;');
    assert.equal((await readFile(path.join(dir, 'app.dart'), 'utf8')).trim(), '');
    // Binary files are left alone rather than corrupted.
    assert.deepEqual([...(await readFile(path.join(dir, 'logo.png')))], [0x89, 0x50, 0x00, 0x0d]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
