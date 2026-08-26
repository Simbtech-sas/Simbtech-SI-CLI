/**
 * Unit tests. Fast, no database, no HTTP — they run on every save.
 *
 * Anything needing Postgres is an integration test and lives in `test/e2e`
 * (jest.e2e.config.mjs), because a suite that needs docker running is a suite
 * people stop running.
 */
export default {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { allowImportingTsExtensions: false } }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts', '!src/worker.main.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
};
