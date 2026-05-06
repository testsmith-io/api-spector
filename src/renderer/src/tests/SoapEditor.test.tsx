// Copyright (c) 2024-2026 Testsmith.io. All rights reserved.
// Licensed for private, internal, non-commercial use only.
// See LICENSE for full terms.

// Canary component test — exercises the SoapEditor empty-state and
// fallback-when-saved-data render paths.
//
// Run with: npx vitest --config vitest.renderer.config.ts
// Requires: @testing-library/react, @testing-library/jest-dom, jsdom

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SoapEditor } from '../components/RequestBuilder/SoapEditor';
import type { ApiRequest } from '../../../shared/types';

function makeRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1',
    name: 'Test',
    method: 'POST',
    url: '',
    headers: [],
    params: [],
    auth: { type: 'none' },
    body: { mode: 'soap', soap: { wsdlUrl: '', envelope: '' } },
    protocol: 'soap',
    ...overrides,
  };
}

describe('SoapEditor', () => {
  it('shows the empty state when no WSDL data is present', () => {
    render(<SoapEditor request={makeRequest()} onChange={vi.fn()} />);
    expect(screen.getByText(/Paste a WSDL URL above/i)).toBeInTheDocument();
  });

  it('shows the saved-envelope fallback when a request already has SOAP data', () => {
    const req = makeRequest({
      body: {
        mode: 'soap',
        soap: {
          wsdlUrl: 'https://example.com/svc?WSDL',
          operationName: 'GetUser',
          soapAction: 'urn:GetUser',
          envelope: '<soap:Envelope/>',
        },
      },
    });
    render(<SoapEditor request={req} onChange={vi.fn()} />);
    // Fallback shows the operation name
    expect(screen.getByText('GetUser')).toBeInTheDocument();
    // Empty-state hint must NOT be shown
    expect(screen.queryByText(/Paste a WSDL URL above/i)).not.toBeInTheDocument();
  });
});
