import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import json from '@eslint/json'
import markdown from '@eslint/markdown'
import yml from 'eslint-plugin-yml'
import html from '@html-eslint/eslint-plugin'
import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'

export default defineConfig([
  {
    ignores: [
      ...resolveIgnoresFromGitignore()
    ]
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.ts'],
    plugins: { js },
    extends: ['js/recommended']
  },
  ...neostandard({
    noJsx: true,
    semi: false,
    ts: true,
    env: ['node', 'es2026']
  })
    .filter(config => !config.name.includes('modernization'))
    .map(config => ({ ...config, files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.ts'] })),
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.ts'],
    plugins: { html },
    extends: ['html/recommended'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'import-x/extensions': ['error', 'always', { ignorePackages: true }],
      '@stylistic/array-bracket-newline': ['error', 'consistent'],
      '@stylistic/arrow-parens': ['error', 'as-needed'],
      '@stylistic/no-mixed-operators': 'error',
      '@stylistic/wrap-regex': 'error',
      'html/use-baseline': ['error', { available: 2025 }],
      'html/indent': ['error', 2],
      'html/require-closing-tags': ['error', { selfClosing: 'always' }],
      'html/no-extra-spacing-attrs': ['error', { enforceBeforeSelfClose: true }]
    }
  },
  {
    files: ['**/*.json'],
    ignores: ['**/jsconfig.json', '**/launch.json'],
    plugins: { json },
    language: 'json/json',
    extends: ['json/recommended']
  },
  {
    files: ['**/package-lock.json'],
    rules: {
      'json/no-empty-keys': 'off'
    }
  },
  {
    files: ['**/jsconfig.json', '**/launch.json', '**/*.jsonc'],
    plugins: { json },
    language: 'json/jsonc',
    extends: ['json/recommended']
  },
  {
    files: ['**/*.md', '**/*.markdown'],
    plugins: { markdown },
    extends: ['markdown/recommended']
  },
  {
    files: ['**/*.yml', '**/*.yaml'],
    plugins: { yml },
    extends: ['yml/standard'],
    rules: {
      'yml/quotes': ['error', { prefer: 'single' }]
    }
  },
  {
    files: ['**/*.htm', '**/*.html'],
    plugins: { html },
    language: 'html/html',
    extends: ['html/recommended'],
    rules: {
      'html/use-baseline': ['error', { available: 2025 }],
      'html/indent': ['error', 2],
      'html/require-closing-tags': ['error', { selfClosing: 'always' }],
      'html/no-extra-spacing-attrs': ['error', { enforceBeforeSelfClose: true }]
    }
  }
])
