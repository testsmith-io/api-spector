// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// Optional AI doc generation. API keys are never stored in workspace/collection
// files; each provider's key lives only in the OS keychain (safeStorage), under
// `ai:<provider>:token` (see aiTokenRef). The provider, model and base URL are
// per-machine config in localStorage.

/** Keychain ref the OpenAI API key is stored under. Kept for back-compat; it is
 *  exactly aiTokenRef('openai'), so existing keys keep working. */
export const AI_OPENAI_TOKEN_REF = 'ai:openai:token';

/** Default model when the user hasn't chosen one (OpenAI provider). */
export const DEFAULT_AI_MODEL = 'gpt-4o-mini';

export type AiProvider = 'openai' | 'anthropic' | 'azure' | 'github-models' | 'ollama' | 'custom';

/** Request/response shape: OpenAI chat-completions, or Anthropic messages. */
export type AiApiShape = 'openai' | 'anthropic';

/** How the key is sent: Authorization bearer, Anthropic x-api-key, Azure
 *  api-key, or no key at all (local Ollama). */
export type AiAuthStyle = 'bearer' | 'x-api-key' | 'azure-api-key' | 'none';

export interface AiProviderMeta {
  id: AiProvider;
  label: string;
  apiShape: AiApiShape;
  authStyle: AiAuthStyle;
  /** Pre-filled base URL; '' means the user must supply one. */
  defaultBaseUrl: string;
  /** Can the user edit the base URL? (false = fixed provider endpoint) */
  baseUrlEditable: boolean;
  /** Append the standard chat path to the base URL, or is the base URL already
   *  the full endpoint (Azure's deployment URL)? */
  appendPath: boolean;
  /** Does the provider need an API key? (Local Ollama does not.) */
  needsKey: boolean;
  /** Suggested model id, pre-filled when the provider is selected. */
  defaultModel: string;
  /** One-line help shown under the inputs. */
  hint: string;
}

/** The keychain ref a provider's API key is stored under. */
export function aiTokenRef(provider: AiProvider): string {
  return `ai:${provider}:token`;
}

// The provider catalogue. OpenAI-compatible providers share one code path; only
// Anthropic needs a different request/response shape.
export const AI_PROVIDERS: Record<AiProvider, AiProviderMeta> = {
  openai: {
    id: 'openai', label: 'OpenAI', apiShape: 'openai', authStyle: 'bearer',
    defaultBaseUrl: 'https://api.openai.com/v1', baseUrlEditable: false, appendPath: true,
    needsKey: true, defaultModel: 'gpt-4o-mini',
    hint: 'Create a key at platform.openai.com.',
  },
  anthropic: {
    id: 'anthropic', label: 'Anthropic (Claude)', apiShape: 'anthropic', authStyle: 'x-api-key',
    defaultBaseUrl: 'https://api.anthropic.com/v1', baseUrlEditable: false, appendPath: true,
    needsKey: true, defaultModel: 'claude-3-5-haiku-latest',
    hint: 'Create a key at console.anthropic.com.',
  },
  azure: {
    id: 'azure', label: 'Azure OpenAI', apiShape: 'openai', authStyle: 'azure-api-key',
    defaultBaseUrl: '', baseUrlEditable: true, appendPath: false,
    needsKey: true, defaultModel: '',
    hint: 'Paste the full endpoint, e.g. https://RES.openai.azure.com/openai/deployments/DEPLOY/chat/completions?api-version=2024-10-21 . The model is your deployment name.',
  },
  'github-models': {
    id: 'github-models', label: 'GitHub Models', apiShape: 'openai', authStyle: 'bearer',
    defaultBaseUrl: 'https://models.github.ai/inference', baseUrlEditable: true, appendPath: true,
    needsKey: true, defaultModel: 'openai/gpt-4o-mini',
    hint: 'Use a GitHub token with the models:read permission.',
  },
  ollama: {
    id: 'ollama', label: 'Ollama (local)', apiShape: 'openai', authStyle: 'none',
    defaultBaseUrl: 'http://localhost:11434/v1', baseUrlEditable: true, appendPath: true,
    needsKey: false, defaultModel: 'llama3.1',
    hint: 'Runs locally, no key needed. Start Ollama and pull a model first.',
  },
  custom: {
    id: 'custom', label: 'OpenAI-compatible (custom)', apiShape: 'openai', authStyle: 'bearer',
    defaultBaseUrl: '', baseUrlEditable: true, appendPath: true,
    needsKey: false, defaultModel: '',
    hint: 'Any server exposing POST {base}/chat/completions (OpenRouter, Groq, vLLM, LM Studio).',
  },
};

export interface GenerateDocsInput {
  /** Which tree level the docs are for; steers the prompt. */
  level: 'request' | 'folder' | 'collection'
  /** The item's name, shown to the model. */
  name: string
  /** A readable, pre-assembled summary of the item (method/URL/params/headers,
   *  child requests, captured examples). Built in the renderer so no internal
   *  shape leaks into the prompt. */
  context: string
  /** Existing markdown docs, so the model refines rather than discards them. */
  existing?: string
  /** Provider to call; defaults to OpenAI when absent (back-compat). */
  provider?: AiProvider
  /** Model id (OpenAI model, Azure deployment name, Ollama model, etc.). */
  model: string
  /** Base URL override for editable providers (Azure/Ollama/custom/GitHub). */
  baseUrl?: string
}
