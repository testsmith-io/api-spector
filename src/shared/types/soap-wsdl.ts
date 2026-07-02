// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// ─── WSDL metadata (SOAP) ─────────────────────────────────────────────────────
//
// Shared between the main-process WSDL parser (src/main/ipc/soap-handler.ts)
// and the renderer's SOAP editor (RequestBuilder/SoapEditor.tsx), which
// receives these shapes over IPC.

export interface WsdlParam {
  name: string
  typeHint: string
  children?: WsdlParam[]
}

export interface WsdlOperation {
  name: string
  /** Binding this operation is exposed by — useful when WSDL has both 1.1 and 1.2. */
  binding?: string
  soapAction?: string
  soapVersion: '1.1' | '1.2'
  /** Resolved endpoint from the matching <soap:address> / <soap12:address>. */
  endpoint?: string
  /** Ready-to-send envelope with parameter elements pre-stubbed. */
  inputTemplate: string
  /** Input message parameters resolved from the schema (empty if WSDL omits a schema). */
  params?: WsdlParam[]
}

export interface WsdlEndpoint {
  binding: string
  address: string
  soapVersion: '1.1' | '1.2'
}

export interface WsdlResult {
  targetNamespace: string
  endpoints: WsdlEndpoint[]
  operations: WsdlOperation[]
}
