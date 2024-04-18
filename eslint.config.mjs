import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'
import { fileURLToPath, URL } from 'node:url'

export default [
  {
    ignores: [
      '**/.DS_Store',
      'node_modules/**',
      'dist/**',
      '**/.env',
      '.vite/**',
      'out/**',
      '**/*.zip',
      '**/*.qcow2',
      '**/*.disk',
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
    rules: {
      'import/extensions': [
        2,
        'always',
        { ignorePackages: true }
      ]
    }
  }
]
