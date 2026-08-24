// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadDesignContractRequests } from '../cli/cli-common';
import type { Workspace, ConsumerContract } from '../shared/types';

const designContract: ConsumerContract = {
  id: 'c1',
  consumer: 'product-listing',
  provider: 'toolshop-api',
  interactions: [
    {
      id: 'i1',
      description: 'get all brands',
      request: { method: 'GET', path: '/brands', headers: [] },
      response: { status: 200, headers: [], body: JSON.stringify([{ id: '1', name: 'x', slug: 'y' }]) },
      looseMatch: true,
    },
  ],
};

// Same first interaction as the design contract (to prove de-dup) plus a second.
const pactFile = {
  consumer: { name: 'product-listing' },
  provider: { name: 'toolshop-api' },
  interactions: [
    { description: 'get all brands', request: { method: 'GET', path: '/brands' }, response: { status: 200 } },
    { description: 'get one brand', request: { method: 'GET', path: '/brands/1' }, response: { status: 200 } },
  ],
  metadata: { pactSpecification: { version: '3.0.0' } },
};

const ws = (designContracts?: ConsumerContract[]): Workspace =>
  ({ version: '1.0', collections: [], environments: [], designContracts }) as unknown as Workspace;

describe('loadDesignContractRequests', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spector-design-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns nothing when there are no design contracts and no pacts/ dir', async () => {
    const reqs = await loadDesignContractRequests(ws(), dir);
    expect(reqs).toEqual([]);
  });

  it('turns an inline design contract into a contract-bearing request', async () => {
    const reqs = await loadDesignContractRequests(ws([designContract]), dir);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe('GET');
    expect(reqs[0].url).toBe('{{baseUrl}}/brands');
    expect(reqs[0].contract?.statusCode).toBe(200);
  });

  it('reads pacts/*.json from the workspace directory', async () => {
    await mkdir(join(dir, 'pacts'));
    await writeFile(join(dir, 'pacts', 'a.pact.json'), JSON.stringify(pactFile), 'utf8');

    const reqs = await loadDesignContractRequests(ws(), dir);
    expect(reqs.map(r => r.name).sort()).toEqual(['get all brands', 'get one brand']);
    expect(reqs.every(r => r.contract?.statusCode === 200)).toBe(true);
  });

  it('de-duplicates the same interaction across the manifest and a pact file', async () => {
    await mkdir(join(dir, 'pacts'));
    await writeFile(join(dir, 'pacts', 'a.pact.json'), JSON.stringify(pactFile), 'utf8');

    const reqs = await loadDesignContractRequests(ws([designContract]), dir);
    // 'get all brands' comes from both sources but appears once; 'get one brand' only from the pact.
    expect(reqs).toHaveLength(2);
    expect(reqs.filter(r => r.name === 'get all brands')).toHaveLength(1);
  });

  it('skips an unreadable pact file rather than throwing', async () => {
    await mkdir(join(dir, 'pacts'));
    await writeFile(join(dir, 'pacts', 'broken.json'), '{ not json', 'utf8');
    await writeFile(join(dir, 'pacts', 'ok.pact.json'), JSON.stringify(pactFile), 'utf8');

    const reqs = await loadDesignContractRequests(ws(), dir);
    expect(reqs).toHaveLength(2);
  });
});
