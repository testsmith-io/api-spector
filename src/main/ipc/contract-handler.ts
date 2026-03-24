// Copyright (C) 2026  Testsmith.io <https://testsmith.io>
//
// This file is part of api Spector.
//
// api Spector is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3.
//
// api Spector is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with api Spector.  If not, see <https://www.gnu.org/licenses/>.

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
