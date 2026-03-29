// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

import { type IpcMain } from 'electron';
import https from 'https';
import http from 'http';

// ─── WSDL fetch & parse ───────────────────────────────────────────────────────

function fetchUrl(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('WSDL fetch timed out')); });
  });
}

interface WsdlOperation {
  name: string
  soapAction?: string
  inputTemplate: string
}

interface WsdlResult {
  operations: WsdlOperation[]
  targetNamespace: string
}

/**
 * Lightweight WSDL parser.
 * Extracts operation names, SOAPActions, and builds basic input envelope templates
 * using regex/string parsing (avoids a full XML DOM dependency in main process).
 */
export function parseWsdl(wsdlText: string): WsdlResult {
  // Extract targetNamespace from definitions element
  const nsMatch = wsdlText.match(/targetNamespace\s*=\s*["']([^"']+)["']/);
  const targetNamespace = nsMatch ? nsMatch[1] : '';

  // Extract all operation names from <wsdl:operation name="..."> or <operation name="...">
  const operationRegex = /<(?:wsdl:)?operation\s+name\s*=\s*["']([^"']+)["']/g;
  const operationNames = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = operationRegex.exec(wsdlText)) !== null) {
    operationNames.add(m[1]);
  }

  // Extract SOAPActions from <soap:operation soapAction="..."> inside each <wsdl:operation> block
  // Build a map: operationName -> soapAction
  const soapActionMap: Record<string, string> = {};
  // Match binding operation blocks
  const bindingOpRegex = /<(?:wsdl:)?operation\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:wsdl:)?operation>/g;
  while ((m = bindingOpRegex.exec(wsdlText)) !== null) {
    const opName = m[1];
    const block = m[2];
    const saMatch = block.match(/soapAction\s*=\s*["']([^"']*)["']/);
    if (saMatch) soapActionMap[opName] = saMatch[1];
  }

  // Build envelope templates for each operation
  const operations: WsdlOperation[] = [];
  for (const name of operationNames) {
    const soapAction = soapActionMap[name];
    const inputTemplate = buildEnvelopeTemplate(name, targetNamespace);
    operations.push({ name, soapAction, inputTemplate });
  }

  return { operations, targetNamespace };
}

export function buildEnvelopeTemplate(operationName: string, namespace: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope
  xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:tns="${namespace}">
  <soap:Header/>
  <soap:Body>
    <tns:${operationName}>
      <!-- Add parameters here -->
    </tns:${operationName}>
  </soap:Body>
</soap:Envelope>`;
}

// ─── IPC handler ─────────────────────────────────────────────────────────────

export function registerSoapHandlers(ipc: IpcMain): void {
  ipc.handle('wsdl:fetch', async (_event, url: string, extraHeaders: Record<string, string> = {}): Promise<WsdlResult> => {
    const wsdlText = await fetchUrl(url, extraHeaders);
    return parseWsdl(wsdlText);
  });
}
