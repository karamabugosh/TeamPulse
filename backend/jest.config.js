// Jest configuration for the NestJS + TypeScript backend.
// Existing src/**/*.spec.ts files are ad-hoc ts-node scripts (Node assert), not Jest.
// Jest only discovers:
//   - colocated Nest unit tests named *.unit.spec.ts
//   - suites under test/ matching *.spec.ts
// Application tsconfig.json is unchanged; Jest compiles via tsconfig.spec.json.
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',

  // Discover only Jest-style unit tests (see comments above).
  testMatch: [
    '<rootDir>/src/**/*.unit.spec.ts',
    '<rootDir>/test/**/*.spec.ts',
  ],

  // Allow a green baseline before any Jest tests exist.
  passWithNoTests: true,

  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },

  // Nest DI uses reflect-metadata; load it once before suites.
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],

  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/**/*.spec.ts',
    '!src/**/*.unit.spec.ts',
    '!src/main.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],

  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Clear mocks between tests — NestJS / Jest best practice.
  clearMocks: true,
};
