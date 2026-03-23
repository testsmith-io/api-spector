import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  // ─── Ignore build outputs ────────────────────────────────────────────────────
  {
    ignores: ['out/**', 'dist/**', 'dist-electron/**', 'node_modules/**', 'src/tests/**'],
  },

  // ─── JavaScript baseline ─────────────────────────────────────────────────────
  js.configs.recommended,

  // ─── TypeScript — all source files ───────────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // Warn on `any` — often unavoidable when bridging Electron IPC / third-party
      '@typescript-eslint/no-explicit-any': 'warn',

      // Unused vars are errors; prefix with _ to explicitly opt out
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Enforce `import type` for type-only imports (keeps bundles clean)
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      }],

      // Require semicolons
      'semi': ['error', 'always'],

      // Prefer const over let when variable is never reassigned
      'prefer-const': 'error',

      // Warn on console.log in renderer / shared code
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Allow empty catch blocks when they are intentional (e.g. best-effort cleanup)
      '@typescript-eslint/no-empty-function': 'off',

      // Non-null assertions are common in Electron/React patterns
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ─── React — renderer + shared ───────────────────────────────────────────────
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // JSX transform (React 17+) — no need to import React in every file
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // TypeScript handles prop types
      'react/prop-types': 'off',

      // Keys in lists are required
      'react/jsx-key': 'error',

      // Array index as key is fragile with dynamic lists
      'react/no-array-index-key': 'off',

      // Self-close components with no children
      'react/self-closing-comp': ['warn', { component: true, html: false }],

      // Rules of Hooks — prevents ordering violations (we had one of these!)
      'react-hooks/rules-of-hooks': 'error',

      // Missing dependencies in useEffect/useCallback/useMemo
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ─── Main process / preload / CLI — Node.js context ─────────────────────────
  // console.log is legitimate here (structured logging, startup messages)
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/cli/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
