// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

import React, { useState } from 'react';
import type { ApiRequest, AuthConfig } from '../../../../shared/types';
import { AuthEditor, type AuthEditorPatch } from '../common/AuthEditor';

const { electron } = window;

// Request-level auth. The full set of types (incl. OAuth 2.0) lives in the
// shared AuthEditor, so requests, folders and collections all offer the same
// options. This wrapper only adds the keychain-backed secret inputs.
export function AuthTab({ request, onChange }: { readonly request: ApiRequest; readonly onChange: (p: Partial<ApiRequest>) => void }) {
  const auth = request.auth;
  const [secretValue, setSecretValue] = useState('');
  const [saved, setSaved] = useState(false);

  function setAuth(patch: AuthEditorPatch) {
    onChange({ auth: { ...auth, ...patch } as AuthConfig });
  }

  async function saveSecret(ref: string) {
    if (!secretValue || !ref) return;
    await electron.setSecret(ref, secretValue);
    setSaved(true);
    setSecretValue('');
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <AuthEditor
      auth={auth}
      onChange={setAuth}
      secrets={{ secretValue, setSecretValue, saved, saveSecret }}
      className="text-xs"
    />
  );
}
