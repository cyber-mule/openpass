import js from '@eslint/js';
import vuePlugin from 'eslint-plugin-vue';
import typescriptEslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default typescriptEslint.config(
  js.configs.recommended,
  ...typescriptEslint.configs.recommended,
  ...vuePlugin.configs['flat/recommended'],
  prettierConfig,
  {
    files: ['**/*.{vue,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        parser: typescriptEslint.parser
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },
  {
    ignores: ['.output/**', '.wxt/**', 'dist/**', 'node_modules/**']
  }
);
