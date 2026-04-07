import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import json from '@eslint/json'
import markdown from '@eslint/markdown'
import yml from 'eslint-plugin-yml'
import html from '@html-eslint/eslint-plugin'
import neostandard from 'neostandard'
import importX from 'eslint-plugin-import-x'
import { includeIgnoreFile } from '@eslint/compat'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig([
  includeIgnoreFile(fileURLToPath(new URL('./.gitignore', import.meta.url))),
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    plugins: { js },
    extends: ['js/recommended']
  },
  ...neostandard({
    noJsx: true,
    semi: false,
    ts: false,
    env: ['node', 'es2026']
  })
    .filter(config =>
      ![
        'neostandard/modernization-since-standard-17',
        'neostandard/style/modernization-since-standard-17'
      ].includes(config.name)
    )
    .map(config => {
      const files = {
        'neostandard/globals': ['**/*.js', '**/*.cjs', '**/*.mjs'],
        'neostandard/base': ['**/*.js', '**/*.cjs', '**/*.mjs'],
        'neostandard/style': ['**/*.js', '**/*.cjs', '**/*.mjs']
      }[config.name]
      if (config.name === 'neostandard/style') {
        config.rules['@stylistic/function-call-spacing'] = config.rules['@stylistic/func-call-spacing']
        delete config.rules['@stylistic/func-call-spacing']
        config.rules['@stylistic/object-property-newline'][1] = { allowAllPropertiesOnSameLine: true }
        config.rules['@stylistic/quotes'][2].allowTemplateLiterals = 'never'
        config.rules['@stylistic/indent'][2].offsetTernaryExpressions = { CallExpression: false }
      }
      return { ...config, files }
    }),
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    plugins: {
      'import-x': importX,
      html
    },
    extends: ['html/recommended'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'import-x/export': 'error',
      'import-x/first': 'error',
      'import-x/no-absolute-path': ['error', { esmodule: true, commonjs: true, amd: false }],
      'import-x/no-duplicates': 'error',
      'import-x/no-named-default': 'error',
      'import-x/no-webpack-loader-syntax': 'error',
      'import-x/extensions': ['error', 'always', { ignorePackages: true }],
      '@stylistic/array-bracket-newline': ['error', 'consistent'],
      '@stylistic/arrow-parens': ['error', 'as-needed'],
      '@stylistic/no-mixed-operators': 'error',
      '@stylistic/wrap-regex': 'error',
      'html/use-baseline': ['error', { available: 2026 }],
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
  ...[
    ...markdown.configs.recommended,
    ...markdown.configs.processor
  ]
    .map(config =>
      ({ ...config, files: (config.files || ['**/*.md']).flatMap(file => [file, file.replace('.md', '.markdown')]) })
    ),
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
      'html/use-baseline': ['error', { available: 2026 }],
      'html/indent': ['error', 2],
      'html/require-closing-tags': ['error', { selfClosing: 'always' }],
      'html/no-extra-spacing-attrs': ['error', { enforceBeforeSelfClose: true }]
    }
  }
])
