import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'
import { fileURLToPath, URL } from 'node:url'
import stylistic from '@stylistic/eslint-plugin'

export default [
  {
    ignores: [
      '**/.DS_Store',
      'node_modules/**',
      'dist/**',
      '**/.env',
      '.vite/**',
      'out/**',
      'stats*.html',
      '**/*.zip',
      '**/*.qcow2',
      '**/*.disk',
      '**/*.tar.gz',
      '**/*.htm',
      '**/*.html',
      '**/*.json',
      '**/*.md',
      '**/*.markdown',
      '**/*.yml',
      '**/*.yaml',
      '**/*.scss',
      '**/*.css'
    ]
  },
  js.configs.recommended,
  ...new FlatCompat({
    baseDirectory: fileURLToPath(new URL('.', import.meta.url))
  }).extends('eslint-config-standard'),
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    plugins: {
      '@stylistic': stylistic
    },
    rules: {
      'import/extensions': ['error', 'always', { ignorePackages: true }],
      '@stylistic/array-bracket-newline': ['error', 'consistent'],
      '@stylistic/arrow-parens': ['error', 'as-needed'],
      '@stylistic/no-mixed-operators': 'error',
      '@stylistic/wrap-regex': 'error'
    }
  }
]
