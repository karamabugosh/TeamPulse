/**
 * Jest config for QuestionsModule integration tests only.
 * Not used by `npm test` / GitHub Actions CI v1.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/integration/**/*.integration.spec.ts'],
  setupFiles: ['<rootDir>/integration/set-test-database-url.js'],
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  collectCoverageFrom: [
    'src/questions/**/*.ts',
    '!src/questions/**/*.spec.ts',
    '!src/questions/**/*.unit.spec.ts',
  ],
  coverageDirectory: '<rootDir>/coverage/integration',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  clearMocks: true,
};
