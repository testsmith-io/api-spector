// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { v4 as uuidv4 } from 'uuid';
import type { ApiRequest, Collection, KeyValuePair, RequestBody } from '../../shared/types';
import { contentTypeForSoap } from '../../shared/soap';
import { parseWsdl } from '../ipc/soap-handler';

// Turn a WSDL document into a collection of SOAP requests, one per operation,
// each pre-filled with the operation's endpoint, Content-Type / SOAPAction
// headers, and a ready-to-send envelope (the same template the SOAP editor
// produces when you pick an operation). The caller routes the result through the
// import picker, so the user can keep all operations or only a selection.
export function importWsdlCollection(wsdlText: string, name?: string): Collection {
  const parsed = parseWsdl(wsdlText);
  const requests: Record<string, ApiRequest> = {};
  const requestIds: string[] = [];

  // A WSDL can expose the same operation in both a 1.1 and a 1.2 binding, which
  // would otherwise import as two identical names. Suffix the version (and a
  // counter if even that collides) so each request is distinguishable.
  const nameCounts = new Map<string, number>();
  for (const op of parsed.operations) nameCounts.set(op.name, (nameCounts.get(op.name) ?? 0) + 1);
  const usedNames = new Set<string>();
  const displayName = (opName: string, soapVersion: '1.1' | '1.2'): string => {
    const base = (nameCounts.get(opName) ?? 0) > 1 ? `${opName} (${soapVersion})` : opName;
    let unique = base;
    for (let i = 2; usedNames.has(unique); i++) unique = `${base} ${i}`;
    usedNames.add(unique);
    return unique;
  };

  for (const op of parsed.operations) {
    const headers: KeyValuePair[] = [
      { key: 'Content-Type', value: contentTypeForSoap(op.soapVersion), enabled: true },
    ];
    // SOAPAction is a SOAP 1.1 HTTP header; 1.2 folds it into the Content-Type.
    if (op.soapVersion === '1.1' && op.soapAction) {
      headers.push({ key: 'SOAPAction', value: op.soapAction, enabled: true });
    }

    const body: RequestBody = {
      mode: 'soap',
      soap: {
        wsdlUrl:       '',
        operationName: op.name,
        soapVersion:   op.soapVersion,
        binding:       op.binding,
        soapAction:    op.soapAction ?? '',
        envelope:      op.inputTemplate,
      },
    };

    const req: ApiRequest = {
      id: uuidv4(),
      name: displayName(op.name, op.soapVersion),
      method: 'POST',
      url: op.endpoint ?? '',
      protocol: 'soap',
      headers,
      params: [],
      auth: { type: 'none' },
      body,
      description: op.soapAction ? `SOAPAction: ${op.soapAction}` : '',
    };
    requests[req.id] = req;
    requestIds.push(req.id);
  }

  return {
    version: '1.0',
    id: uuidv4(),
    name: name || parsed.targetNamespace || 'Imported WSDL',
    description: '',
    rootFolder: { id: uuidv4(), name: 'root', description: '', folders: [], requestIds },
    requests,
  };
}
