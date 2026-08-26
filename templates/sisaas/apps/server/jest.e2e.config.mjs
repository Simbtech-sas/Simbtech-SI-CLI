/**
 * Integration tests. These need the docker stack up and a migrated database:
 *
 *   pnpm infra:up && pnpm db:migrate && pnpm test:e2e
 *
 * Separate from the unit config on purpose — mixing them means the fast suite
 * inherits the slow one's setup, and nobody runs either.
 */
export default {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', {}] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  // A single worker: these share one database, and parallel suites would race on it.
  maxWorkers: 1,
  testTimeout: 30_000,
};
