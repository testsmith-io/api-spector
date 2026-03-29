// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain } from 'electron';
import type { ContractRunPayload, ContractReport } from '../../shared/types';
import { runConsumerContracts }   from '../contract/consumer-verifier';
import { runProviderVerification } from '../contract/provider-verifier';
import { runBidirectional }       from '../contract/bidirectional';
import { inferSchemaFromJson }    from '../contract/schema-inferrer';

export function registerContractHandlers(ipc: IpcMain): void {
  ipc.handle('contract:run', async (_e, payload: ContractRunPayload): Promise<ContractReport> => {
    const { mode, requests, envVars, collectionVars = {}, specUrl, specPath, requestBaseUrl } = payload;
    switch (mode) {
      case 'consumer':
        return runConsumerContracts(requests, envVars, collectionVars);
      case 'provider':
        return runProviderVerification(requests, envVars, specUrl, specPath, requestBaseUrl);
      case 'bidirectional':
        return runBidirectional(requests, envVars, collectionVars, specUrl, specPath, requestBaseUrl);
    }
  });

  ipc.handle('contract:inferSchema', (_e, jsonBody: string): string | null => {
    const schema = inferSchemaFromJson(jsonBody);
    return schema ? JSON.stringify(schema, null, 2) : null;
  });
}
