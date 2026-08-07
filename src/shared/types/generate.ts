// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── Code generation ─────────────────────────────────────────────────────────

import type { Collection, Environment } from './collection';

export type GenerateTarget =
  | 'robot_framework'
  | 'playwright_ts'
  | 'playwright_js'
  | 'supertest_ts'
  | 'supertest_js'
  | 'rest_assured'
  | 'karate'
  | 'http_file'
  | 'curl'

export interface GenerateOptions {
  collection: Collection
  environment: Environment | null
  target: GenerateTarget
  outputDir?: string
}

export interface GeneratedFile {
  path: string
  content: string
}
