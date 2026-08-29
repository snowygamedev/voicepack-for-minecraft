import js from '@eslint/js'
import ts from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * The smoke drivers are Node scripts that also contain code sent into the
 * renderer via `page.evaluate`, so they legitimately reference both sets of
 * globals in one file.
 */
const driverGlobals = {
  process: 'readonly',
  console: 'readonly',
  window: 'readonly',
  document: 'readonly',
  Buffer: 'readonly'
}

export default ts.config(
  { ignores: ['out/**', 'release/**', 'node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: driverGlobals }
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  }
)
