#!/usr/bin/env node
/**
 * Fails the build if the app can reach anything outside its own origin.
 *
 * "No network" is a promise to the customer — an air-gapped install, a clinic
 * with no connection, a regulator who requires that data never leaves. A promise
 * nothing checks is a promise that quietly stops being true the first time
 * someone adds a dependency.
 */
import { readFile } from 'node:fs/promises';
import { verifyOffline } from './offline-rules.mjs';

const dist = process.argv[2] ?? 'dist';

let allowPrefixes = [];
try {
  const config = JSON.parse(await readFile('offline.allowlist.json', 'utf8'));
  allowPrefixes = config.urlPrefixes ?? [];
} catch {
  // No allowlist is a valid, stricter state.
}

const { files, violations, missingCsp } = await verifyOffline(dist, allowPrefixes);

if (violations.length === 0 && missingCsp.length === 0) {
  console.log(`offline verified — ${files} built files, nothing reaches another origin`);
  process.exit(0);
}

console.error('\nThis build can reach the network. SiCAL apps must not.\n');
for (const { file, finding } of violations) console.error(`  ${file}: ${finding}`);
for (const { directive, why } of missingCsp) {
  console.error(`  index.html: CSP is missing "${directive}" — ${why}`);
}
console.error(
  '\nA URL that is only ever a string (an XML namespace, a docs link) belongs in\n' +
    'offline.allowlist.json, with a reason. A real endpoint does not: replace the\n' +
    'dependency, bundle its data, or accept that this is not a SiCAL app.\n',
);
process.exit(1);
