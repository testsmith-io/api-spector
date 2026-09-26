// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import type { IpcMain } from 'electron';
import { handleIpc } from './handle';
import { IPC } from '../../shared/ipc-channels';
import { getSecret } from './secret-handler';
import { buildDispatcher } from '../request-exec';
import { AI_OPENAI_TOKEN_REF, type GenerateDocsInput } from '../../shared/types';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

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
    const token = await getSecret(AI_OPENAI_TOKEN_REF);
    if (!token) {
      throw new Error('No OpenAI API key configured. Add one in Settings → AI.');
    }
    const model = input.model?.trim() || 'gpt-4o-mini';

    const userParts = [
      `Name: ${input.name}`,
      '',
      input.context,
    ];
    if (input.existing?.trim()) {
      userParts.push('', 'Existing documentation to refine and expand (keep what is still accurate):', input.existing.trim());
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt(input.level) },
            { role: 'user', content: userParts.join('\n') },
          ],
        }),
        signal: controller.signal,
        // @ts-expect-error undici accepts a dispatcher for proxy/TLS support
        dispatcher: await buildDispatcher(undefined, undefined),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json() as { error?: { message?: string } };
          if (body?.error?.message) detail = body.error.message;
        } catch { /* non-JSON error body */ }
        if (res.status === 401) detail = 'OpenAI rejected the API key (401). Check the key in Settings → AI.';
        throw new Error(`Doc generation failed: ${detail}`);
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      const content = data.choices?.[0]?.message?.content?.trim();
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
