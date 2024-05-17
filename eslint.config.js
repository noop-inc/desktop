import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'
import { fileURLToPath, URL } from 'node:url'
import stylisticJs from '@stylistic/eslint-plugin-js'

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
      '@stylistic/js': stylisticJs
    },
    rules: {
      'import/extensions': ['error', 'always', { ignorePackages: true }],
      '@stylistic/js/array-bracket-newline': ['error', 'consistent'],
      '@stylistic/js/arrow-parens': ['error', 'as-needed'],
      '@stylistic/js/no-mixed-operators': 'error',
      '@stylistic/js/wrap-regex': 'error'
    }
  }
]
