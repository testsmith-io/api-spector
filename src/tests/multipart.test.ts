// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildMultipartBody } from '../main/request-exec';
import { importPostman } from '../main/importers/postman';
import { importInsomnia } from '../main/importers/insomnia';
import { importHar } from '../main/importers/har';
import { importOpenApi } from '../main/importers/openapi';
import { parseBruFile } from '../main/importers/bruno';
import { generateCurl } from '../main/generators/curl';
import { generateHttpFile } from '../main/generators/http-file';
import { generateSupertestJs } from '../main/generators/supertest-js';
import type { ApiRequest, Collection, Folder, MultipartPart } from '../shared/types';

// ─── Executor: multipart/form-data body assembly ──────────────────────────────

describe('buildMultipartBody (executor)', () => {
  let dir = '';
  let filePath = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spector-mp-'));
    filePath = join(dir, 'hello.txt');
    await writeFile(filePath, 'FILE-CONTENTS');
  });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

  it('assembles text + file parts with a boundary and reads the file from disk', async () => {
    const parts: MultipartPart[] = [
      { key: 'name', enabled: true, type: 'text', value: 'Ada' },
      { key: 'avatar', enabled: true, type: 'file', filePath, contentType: 'text/plain' },
    ];
    const r = await buildMultipartBody(parts, {});
    const boundary = r.contentType.split('boundary=')[1];
    expect(r.contentType.startsWith('multipart/form-data; boundary=')).toBe(true);
    const text = r.body.toString('utf8');
    expect(text).toContain(`--${boundary}\r\n`);
    expect(text).toContain('Content-Disposition: form-data; name="name"\r\n\r\nAda\r\n');
    expect(text).toContain('Content-Disposition: form-data; name="avatar"; filename="hello.txt"');
    expect(text).toContain('Content-Type: text/plain');
    expect(text).toContain('FILE-CONTENTS');
    expect(text.endsWith(`--${boundary}--\r\n`)).toBe(true);
    // Preview is a readable summary with no raw bytes.
    expect(r.preview).toContain('name: Ada');
    expect(r.preview).toContain('avatar: <file');
    expect(r.preview).not.toContain('FILE-CONTENTS');
  });

  it('interpolates {{vars}} in keys, values and file paths; auto-detects content type', async () => {
    const png = join(dir, 'pic.png');
    await writeFile(png, 'PNGDATA');
    const parts: MultipartPart[] = [
      { key: 'who', enabled: true, type: 'text', value: 'hi {{user}}' },
      { key: 'file', enabled: true, type: 'file', filePath: '{{dir}}/pic.png' },
    ];
    const r = await buildMultipartBody(parts, { user: 'Grace', dir });
    const text = r.body.toString('utf8');
    expect(text).toContain('\r\n\r\nhi Grace\r\n');
    expect(text).toContain('filename="pic.png"');
    expect(text).toContain('Content-Type: image/png'); // from .png extension
  });

  it('skips disabled / unnamed parts and throws a clear error on a missing file', async () => {
    const r = await buildMultipartBody([
      { key: 'keep', enabled: true, type: 'text', value: 'y' },
      { key: 'drop', enabled: false, type: 'text', value: 'n' },
      { key: '', enabled: true, type: 'text', value: 'noname' },
    ], {});
    expect(r.body.toString('utf8')).toContain('name="keep"');
    expect(r.body.toString('utf8')).not.toContain('name="drop"');
    expect(r.body.toString('utf8')).not.toContain('noname');

    await expect(buildMultipartBody(
      [{ key: 'f', enabled: true, type: 'file', filePath: join(dir, 'nope.bin') }], {},
    )).rejects.toThrow(/Multipart file not found/);
  });
});

// ─── Importers ────────────────────────────────────────────────────────────────

describe('multipart import — Postman form-data', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('maps a formdata body to multipart with text and file parts', async () => {
    dir = await mkdtemp(join(tmpdir(), 'spector-pm-'));
    const file = join(dir, 'pm.json');
    await writeFile(file, JSON.stringify({
      info: { name: 'C' },
      item: [{
        name: 'Upload',
        request: {
          method: 'POST', url: 'https://x.test/u',
          body: {
            mode: 'formdata',
            formdata: [
              { key: 'title', value: 'hi', type: 'text' },
              { key: 'file', src: '/home/ada/a.png', type: 'file', contentType: 'image/png' },
            ],
          },
        },
      }],
    }));
    const col = await importPostman(file);
    const req = Object.values(col.requests)[0];
    expect(req.body.mode).toBe('multipart');
    expect(req.body.multipart).toEqual([
      { key: 'title', enabled: true, type: 'text', value: 'hi' },
      { key: 'file', enabled: true, type: 'file', filePath: '/home/ada/a.png', contentType: 'image/png' },
    ]);
  });
});

describe('multipart import — Insomnia multipart/form-data', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('maps a multipart/form-data body with a file param', async () => {
    dir = await mkdtemp(join(tmpdir(), 'spector-ins-'));
    const file = join(dir, 'ins.json');
    await writeFile(file, JSON.stringify({
      resources: [
        { _type: 'workspace', _id: 'wrk' },
        {
          _type: 'request', _id: 'req', name: 'Up', method: 'POST', url: 'https://x.test/u',
          body: {
            mimeType: 'multipart/form-data',
            params: [
              { name: 'caption', value: 'c' },
              { name: 'photo', type: 'file', fileName: '/home/ada/p.jpg' },
            ],
          },
        },
      ],
    }));
    const col = await importInsomnia(file);
    const req = Object.values(col.requests)[0];
    expect(req.body.mode).toBe('multipart');
    expect(req.body.multipart).toEqual([
      { key: 'caption', enabled: true, type: 'text', value: 'c' },
      { key: 'photo', enabled: true, type: 'file', filePath: '/home/ada/p.jpg' },
    ]);
  });
});

describe('multipart import — HAR multipart/form-data', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('maps recorded multipart params, treating a fileName as a file part', async () => {
    dir = await mkdtemp(join(tmpdir(), 'spector-har-'));
    const file = join(dir, 'log.har');
    await writeFile(file, JSON.stringify({
      log: { entries: [{
        _resourceType: 'fetch',
        request: {
          method: 'POST', url: 'https://x.test/u', headers: [],
          postData: {
            mimeType: 'multipart/form-data',
            params: [
              { name: 'field', value: 'v' },
              { name: 'upload', fileName: 'report.pdf', contentType: 'application/pdf' },
            ],
          },
        },
        response: { content: { mimeType: 'application/json' } },
      }] },
    }));
    const col = await importHar(file);
    const req = Object.values(col.requests)[0];
    expect(req.body.mode).toBe('multipart');
    expect(req.body.multipart).toEqual([
      { key: 'field', enabled: true, type: 'text', value: 'v' },
      { key: 'upload', enabled: true, type: 'file', filePath: 'report.pdf', contentType: 'application/pdf' },
    ]);
  });
});

describe('multipart import — OpenAPI 3 & Swagger 2.0', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('maps an OpenAPI 3 multipart/form-data requestBody (binary → file part)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'spector-oas-'));
    const file = join(dir, 'oas3.json');
    await writeFile(file, JSON.stringify({
      openapi: '3.0.0',
      servers: [{ url: 'https://x.test' }],
      paths: {
        '/upload': {
          post: {
            operationId: 'upload',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    required: ['file'],
                    properties: {
                      file: { type: 'string', format: 'binary' },
                      note: { type: 'string', example: 'hello' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }));
    const col = await importOpenApi(file);
    const req = Object.values(col.requests)[0];
    expect(req.body.mode).toBe('multipart');
    const byKey = Object.fromEntries((req.body.multipart ?? []).map(p => [p.key, p]));
    expect(byKey.file.type).toBe('file');
    expect(byKey.file.enabled).toBe(true); // required
    expect(byKey.note.type).toBe('text');
    expect(byKey.note.value).toBe('hello');
  });

  it('maps a Swagger 2.0 formData file param to a multipart body', async () => {
    const file = join(dir, 'swg2.json');
    await writeFile(file, JSON.stringify({
      swagger: '2.0', host: 'x.test', basePath: '/', schemes: ['https'],
      paths: {
        '/upload': {
          post: {
            operationId: 'up',
            consumes: ['multipart/form-data'],
            parameters: [
              { name: 'avatar', in: 'formData', type: 'file', required: true },
              { name: 'alt', in: 'formData', type: 'string' },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }));
    const col = await importOpenApi(file);
    const req = Object.values(col.requests)[0];
    expect(req.body.mode).toBe('multipart');
    const avatar = (req.body.multipart ?? []).find(p => p.key === 'avatar')!;
    expect(avatar.type).toBe('file');
    expect((req.body.multipart ?? []).find(p => p.key === 'alt')!.type).toBe('text');
  });
});

describe('multipart import — Bruno multipart-form', () => {
  it('maps @file(path) to a file part and a plain value to a text part', () => {
    const bru = [
      'meta {',
      '  name: Upload',
      '  type: http',
      '}',
      'post {',
      '  url: https://x.test/u',
      '  body: multipartForm',
      '}',
      'body:multipart-form {',
      '  title: hi there',
      '  document: @file(/home/ada/d.pdf)',
      '}',
    ].join('\n');
    const req = parseBruFile(bru, 'upload.bru');
    expect(req.body.mode).toBe('multipart');
    expect(req.body.multipart).toEqual([
      { key: 'title', enabled: true, type: 'text', value: 'hi there' },
      { key: 'document', enabled: true, type: 'file', filePath: '/home/ada/d.pdf' },
    ]);
  });
});

// ─── Code generation ──────────────────────────────────────────────────────────

function multipartRequest(): ApiRequest {
  return {
    id: 'r1', name: 'Upload', method: 'POST', url: 'https://x.test/u',
    headers: [], params: [], auth: { type: 'none' },
    body: {
      mode: 'multipart',
      multipart: [
        { key: 'title', enabled: true, type: 'text', value: 'hi' },
        { key: 'file', enabled: true, type: 'file', filePath: '/tmp/a.png', contentType: 'image/png' },
      ],
    },
  };
}

function singleRequestCollection(req: ApiRequest): Collection {
  const rootFolder: Folder = { id: 'root', name: 'root', description: '', folders: [], requestIds: [req.id] };
  return { version: '1.0', id: 'c1', name: 'Uploads', rootFolder, requests: { [req.id]: req } };
}

describe('multipart code generation', () => {
  const col = singleRequestCollection(multipartRequest());

  it('curl emits -F flags (text and @file with ;type) and no explicit Content-Type', () => {
    const out = generateCurl(col, null)[0].content;
    expect(out).toContain('-F "title=hi"');
    expect(out).toContain('-F "file=@/tmp/a.png;type=image/png"');
    expect(out).not.toContain('--data');
    expect(out).not.toMatch(/Content-Type: multipart/); // curl sets it with the boundary
  });

  it('supertest emits .field() and .attach() chains', () => {
    const out = generateSupertestJs(col, null).find(f => f.path.endsWith('.test.js'))!.content;
    expect(out).toContain(".field('title'");
    expect(out).toContain(".attach('file'");
    expect(out).toContain('/tmp/a.png');
  });

  it('.http emits an explicit boundary with a < file include', () => {
    const out = generateHttpFile(col, null)[0].content;
    expect(out).toContain('Content-Type: multipart/form-data; boundary=');
    expect(out).toContain('Content-Disposition: form-data; name="title"');
    expect(out).toContain('Content-Disposition: form-data; name="file"; filename="a.png"');
    expect(out).toContain('< /tmp/a.png');
  });
});
