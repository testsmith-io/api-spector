// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Optional AI documentation generation. The API key is NEVER stored in the
// workspace/collection files — it lives only in the OS keychain (safeStorage),
// referenced by AI_OPENAI_TOKEN_REF. Model choice lives in renderer localStorage,
// per-machine, so nothing AI-related is committed to version control.

/** Keychain ref the OpenAI API key is stored under. */
export const AI_OPENAI_TOKEN_REF = 'ai:openai:token';

export interface GenerateDocsInput {
  /** Which tree level the docs are for — steers the prompt. */
  level: 'request' | 'folder' | 'collection'
  /** The item's name, shown to the model. */
  name: string
  /** A readable, pre-assembled summary of the item (method/URL/params/headers,
   *  child requests, captured examples). Built in the renderer so no internal
   *  shape leaks into the prompt. */
  context: string
  /** Existing markdown docs, so the model refines rather than discards them. */
  existing?: string
  /** OpenAI model id, e.g. "gpt-4o-mini". */
  model: string
}
