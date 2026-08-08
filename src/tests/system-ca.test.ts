// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { trustSystemCertificateStore } from '../main/request-exec';

describe('trustSystemCertificateStore', () => {
  it('adds Windows system roots to the process trust store', () => {
    const setDefaultCACertificates = vi.fn();
    const getCACertificates = vi.fn((type: 'default' | 'system') => {
      if (type === 'default') return ['bundled-root'];
      return ['bundled-root', 'local-proxy-root'];
    });

    const applied = trustSystemCertificateStore({
      platform: 'win32',
      tlsApi: { getCACertificates, setDefaultCACertificates },
      force: true,
    });

    expect(applied).toBe(true);
    expect(getCACertificates).toHaveBeenCalledWith('default');
    expect(getCACertificates).toHaveBeenCalledWith('system');
    expect(setDefaultCACertificates).toHaveBeenCalledWith(['bundled-root', 'local-proxy-root']);
  });

  it('does not change trust roots on non-Windows platforms', () => {
    const setDefaultCACertificates = vi.fn();
    const getCACertificates = vi.fn(() => ['root']);

    const applied = trustSystemCertificateStore({
      platform: 'linux',
      tlsApi: { getCACertificates, setDefaultCACertificates },
      force: true,
    });

    expect(applied).toBe(false);
    expect(getCACertificates).not.toHaveBeenCalled();
    expect(setDefaultCACertificates).not.toHaveBeenCalled();
  });

  it('leaves the trust store alone when the system store adds no roots', () => {
    const setDefaultCACertificates = vi.fn();
    const getCACertificates = vi.fn(() => ['bundled-root']);

    const applied = trustSystemCertificateStore({
      platform: 'win32',
      tlsApi: { getCACertificates, setDefaultCACertificates },
      force: true,
    });

    expect(applied).toBe(false);
    expect(setDefaultCACertificates).not.toHaveBeenCalled();
  });

  it('retries when TLS certificate-store APIs become available later', async () => {
    vi.resetModules();
    const { trustSystemCertificateStore: freshTrustSystemCertificateStore } = await import('../main/request-exec');

    expect(freshTrustSystemCertificateStore({
      platform: 'win32',
      tlsApi: {},
    })).toBe(false);

    const setDefaultCACertificates = vi.fn();
    const getCACertificates = vi.fn((type: 'default' | 'system') => {
      if (type === 'default') return ['bundled-root'];
      return ['bundled-root', 'local-proxy-root'];
    });

    expect(freshTrustSystemCertificateStore({
      platform: 'win32',
      tlsApi: { getCACertificates, setDefaultCACertificates },
    })).toBe(true);
    expect(setDefaultCACertificates).toHaveBeenCalledWith(['bundled-root', 'local-proxy-root']);
  });

  it('retries after a certificate-store read error', async () => {
    vi.resetModules();
    const { trustSystemCertificateStore: freshTrustSystemCertificateStore } = await import('../main/request-exec');

    expect(freshTrustSystemCertificateStore({
      platform: 'win32',
      tlsApi: {
        getCACertificates: vi.fn(() => { throw new Error('temporary store error'); }),
        setDefaultCACertificates: vi.fn(),
      },
    })).toBe(false);

    const setDefaultCACertificates = vi.fn();
    const getCACertificates = vi.fn((type: 'default' | 'system') => {
      if (type === 'default') return ['bundled-root'];
      return ['bundled-root', 'local-proxy-root'];
    });

    expect(freshTrustSystemCertificateStore({
      platform: 'win32',
      tlsApi: { getCACertificates, setDefaultCACertificates },
    })).toBe(true);
    expect(setDefaultCACertificates).toHaveBeenCalledWith(['bundled-root', 'local-proxy-root']);
  });
});
