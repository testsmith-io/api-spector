// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { IpcMain } from 'electron';
import { handleIpc } from './handle';
import { IPC } from '../../shared/ipc-channels';
import { getSecret } from './secret-handler';
import { buildDispatcher } from '../request-exec';
import { AI_PROVIDERS, aiTokenRef, type AiProvider, type GenerateDocsInput } from '../../shared/types';
import { aiBody, aiEndpoint, aiHeaders, parseAiResponse } from '../../shared/ai-request';

function systemPrompt(level: GenerateDocsInput['level']): string {
  return [
    'You write clear, concise API documentation in GitHub-flavored Markdown.',
    `You are documenting an API ${level}.`,
    'Return ONLY markdown — no preamble, no code fences around the whole answer.',
    'Use short paragraphs and headings. Describe purpose, key parameters, request/response shape,',
    'auth if relevant, and any gotchas. Do not invent endpoints or fields that are not in the context.',
    'Keep it practical for a developer who will call this API.',
  ].join(' ');
}

export function registerAiHandlers(ipc: IpcMain): void {
  handleIpc(ipc, IPC.ai.generateDocs, async (_e, input: GenerateDocsInput): Promise<string> => {
    const provider: AiProvider = input.provider ?? 'openai';
    const meta = AI_PROVIDERS[provider] ?? AI_PROVIDERS.openai;

    const key = meta.needsKey ? await getSecret(aiTokenRef(meta.id)) : null;
    if (meta.needsKey && !key) {
      throw new Error(`No API key configured for ${meta.label}. Add one in Settings - AI.`);
    }
    const model = input.model?.trim() || meta.defaultModel;
    if (!model) throw new Error(`Set a model for ${meta.label} in Settings - AI.`);

    const userParts = [`Name: ${input.name}`, '', input.context];
    if (input.existing?.trim()) {
      userParts.push('', 'Existing documentation to refine and expand (keep what is still accurate):', input.existing.trim());
    }

    const url = aiEndpoint(meta, input.baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: aiHeaders(meta, key),
        body: JSON.stringify(aiBody(meta.apiShape, { model, system: systemPrompt(input.level), user: userParts.join('\n') })),
        signal: controller.signal,
        // @ts-expect-error undici accepts a dispatcher for proxy/TLS support
        dispatcher: await buildDispatcher(),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json() as { error?: { message?: string } | string };
          const msg = typeof body?.error === 'string' ? body.error : body?.error?.message;
          if (msg) detail = msg;
        } catch { /* non-JSON error body */ }
        if (res.status === 401 || res.status === 403) {
          detail = `${meta.label} rejected the request (${res.status}). Check the key in Settings - AI.`;
        }
        throw new Error(`Doc generation failed: ${detail}`);
      }
      const content = parseAiResponse(meta.apiShape, await res.json());
      if (!content) throw new Error('The model returned an empty response.');
      return content;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw new Error('Doc generation timed out after 60s.');
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  });
}
