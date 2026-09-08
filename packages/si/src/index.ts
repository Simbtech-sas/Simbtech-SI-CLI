#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import pc from 'picocolors';
import { FLAVORS } from './flavors.ts';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

import { register } from './registry.ts';
import { commands } from './commands-registry.ts';

const program = new Command();

program
  .name('si')
  .description(
    `${pc.bold('SIMBTECH project scaffolder')}\n\n` +
      FLAVORS.map((f) => `  ${pc.cyan(f.id.padEnd(18))} ${f.summary}`).join('\n'),
  )
  .version(version, '-v, --version')
  .showHelpAfterError();

for (const def of commands) register(program, def);

// Deliberately no update check on startup: it makes every invocation depend on
// the network and stalls CI.
try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(pc.red('error: ') + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 1;
}
