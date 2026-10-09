const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'ios/*', 'design/*', 'node_modules/*'] },
  {
    // Only the adapter may talk to the Callstack provider or the AI SDK (docs/LOCAL_AI.md).
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ai/callstack/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@react-native-ai/apple', message: 'Use LocalAIService from @/ai instead.' },
            { name: 'ai', message: 'Use LocalAIService from @/ai instead.' },
          ],
        },
      ],
    },
  },
]);
