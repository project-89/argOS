/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  modulePathIgnorePatterns: [
    '<rootDir>/stress-test-output/',
    '<rootDir>/saves/',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true, // Skip type checking for faster tests
      },
    ],
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
  ],
  testTimeout: 60000,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
