const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const TEST_FILES = ['src/**/__tests__/**', 'src/**/testing/**', 'src/**/*.test.{ts,tsx}'];
const AI_PACKAGES = [
  { name: '@react-native-ai/apple', message: 'Use LocalAIService from @/ai instead.' },
  { name: 'ai', message: 'Use LocalAIService from @/ai instead.' },
];
const TESTING_HELPERS = [{ group: ['**/testing/*', '@/*/testing/*'], message: 'testing/ helpers are for tests only.' }];

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'ios/*', 'design/*', 'node_modules/*'] },
  // ESLint keeps only the last matching `no-restricted-imports` entry for a file, so the two bans are
  // written as disjoint file sets instead of two overlapping blocks.
  {
    // App code: no provider or AI SDK outside the adapter (docs/LOCAL_AI.md), and no test helpers.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ai/callstack/**', ...TEST_FILES],
    rules: { 'no-restricted-imports': ['error', { paths: AI_PACKAGES, patterns: TESTING_HELPERS }] },
  },
  {
    // The adapter may import the provider; it still must not ship test helpers.
    files: ['src/ai/callstack/**/*.{ts,tsx}'],
    ignores: TEST_FILES,
    rules: { 'no-restricted-imports': ['error', { patterns: TESTING_HELPERS }] },
  },
  {
    // Tests outside the adapter fake LocalAIService; they never load the provider.
    files: TEST_FILES,
    ignores: ['src/ai/callstack/**'],
    rules: { 'no-restricted-imports': ['error', { paths: AI_PACKAGES }] },
  },
]);
