// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Pure helpers that turn a provider + key + prompt into an HTTP call, and read
// the model's text back out. Kept provider-agnostic and side-effect free so the
// main-process handler stays thin and this stays unit-testable.

import type { AiApiShape, AiProviderMeta } from './types/ai';

/** Final endpoint for a provider, honouring a user base-URL override. Throws a
 *  user-facing message when an editable provider has no base URL. */
export function aiEndpoint(meta: AiProviderMeta, baseUrl?: string): string {
  const base = (baseUrl?.trim() || meta.defaultBaseUrl).replace(/\/+$/, '');
  if (!base) throw new Error(`Set a base URL for ${meta.label} in Settings - AI.`);
  if (!meta.appendPath) return base;
  return base + (meta.apiShape === 'anthropic' ? '/messages' : '/chat/completions');
}

/** Request headers for a provider. The key is omitted when the provider needs
 *  none (local Ollama); Anthropic always gets its version header. */
export function aiHeaders(meta: AiProviderMeta, key: string | null): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  switch (meta.authStyle) {
    case 'bearer':        if (key) h.authorization = `Bearer ${key}`; break;
    case 'azure-api-key': if (key) h['api-key'] = key; break;
    case 'x-api-key':
      if (key) h['x-api-key'] = key;
      h['anthropic-version'] = '2023-06-01';
      break;
    case 'none': break;
  }
  return h;
}

export interface AiPromptParts {
  model: string;
  system: string;
  user: string;
}

/** Request body in the provider's shape. Anthropic takes `system` separately and
 *  requires `max_tokens`; OpenAI-style takes a system message in `messages`. */
export function aiBody(apiShape: AiApiShape, { model, system, user }: AiPromptParts): unknown {
  if (apiShape === 'anthropic') {
    return {
      model,
      max_tokens: 1500,
      temperature: 0.3,
      system,
      messages: [{ role: 'user', content: user }],
    };
  }
  return {
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

/** Pull the generated text out of a provider's JSON response, or null if empty. */
export function parseAiResponse(apiShape: AiApiShape, data: unknown): string | null {
  if (apiShape === 'anthropic') {
    const d = data as { content?: { text?: string }[] };
    return d?.content?.[0]?.text?.trim() || null;
  }
  const d = data as { choices?: { message?: { content?: string } }[] };
  return d?.choices?.[0]?.message?.content?.trim() || null;
}
