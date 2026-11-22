// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// The provider-agnostic request builders: endpoint resolution, per-provider auth
// headers, request body shape, and response parsing for both the OpenAI and
// Anthropic families.
import { describe, it, expect } from 'vitest';
import { AI_PROVIDERS } from '../shared/types/ai';
import { aiBody, aiEndpoint, aiHeaders, parseAiResponse } from '../shared/ai-request';

describe('aiEndpoint', () => {
  it('appends /chat/completions for OpenAI-shaped providers', () => {
    expect(aiEndpoint(AI_PROVIDERS.openai)).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('appends /messages for Anthropic', () => {
    expect(aiEndpoint(AI_PROVIDERS.anthropic)).toBe('https://api.anthropic.com/v1/messages');
  });

  it('honours a base-URL override and trims a trailing slash', () => {
    expect(aiEndpoint(AI_PROVIDERS.ollama, 'http://localhost:11434/v1/')).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('uses the base URL as the full endpoint when the provider does not append a path (Azure)', () => {
    const url = 'https://res.openai.azure.com/openai/deployments/d/chat/completions?api-version=2024-10-21';
    expect(aiEndpoint(AI_PROVIDERS.azure, url)).toBe(url);
  });

  it('throws when an editable provider has no base URL', () => {
    expect(() => aiEndpoint(AI_PROVIDERS.custom, '')).toThrow(/base url/i);
  });
});

describe('aiHeaders', () => {
  it('uses a bearer token for OpenAI', () => {
    expect(aiHeaders(AI_PROVIDERS.openai, 'sk-1')).toMatchObject({ authorization: 'Bearer sk-1' });
  });

  it('uses x-api-key plus a version header for Anthropic', () => {
    const h = aiHeaders(AI_PROVIDERS.anthropic, 'key');
    expect(h['x-api-key']).toBe('key');
    expect(h['anthropic-version']).toBe('2023-06-01');
    expect(h.authorization).toBeUndefined();
  });

  it('uses the api-key header for Azure', () => {
    const h = aiHeaders(AI_PROVIDERS.azure, 'azkey');
    expect(h['api-key']).toBe('azkey');
    expect(h.authorization).toBeUndefined();
  });

  it('sends no auth header for a keyless local provider', () => {
    const h = aiHeaders(AI_PROVIDERS.ollama, null);
    expect(h.authorization).toBeUndefined();
    expect(h['api-key']).toBeUndefined();
    expect(h['content-type']).toBe('application/json');
  });
});

describe('aiBody', () => {
  const parts = { model: 'm', system: 'sys', user: 'usr' };

  it('puts the system message in messages[] for the OpenAI shape', () => {
    const body = aiBody('openai', parts) as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe('m');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'usr' });
  });

  it('keeps system separate and sets max_tokens for the Anthropic shape', () => {
    const body = aiBody('anthropic', parts) as { system: string; max_tokens: number; messages: { role: string }[] };
    expect(body.system).toBe('sys');
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages).toEqual([{ role: 'user', content: 'usr' }]);
  });
});

describe('parseAiResponse', () => {
  it('reads choices[0].message.content for the OpenAI shape', () => {
    expect(parseAiResponse('openai', { choices: [{ message: { content: '  hi  ' } }] })).toBe('hi');
  });

  it('reads content[0].text for the Anthropic shape', () => {
    expect(parseAiResponse('anthropic', { content: [{ text: ' doc ' }] })).toBe('doc');
  });

  it('returns null on an empty or malformed response', () => {
    expect(parseAiResponse('openai', {})).toBeNull();
    expect(parseAiResponse('anthropic', { content: [] })).toBeNull();
  });
});
