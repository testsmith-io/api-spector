// Copyright (c) 2024-2026 Testsmith.io
// SPDX-License-Identifier: MIT

// External secret managers. Importing this module registers the built-in
// providers; add a new backend by implementing SecretProvider and registering it
// here (one line), with no changes to the run/interpolation pipeline.
//
//   import { registerSecretProvider } from './registry'
//   import { awsSecretsProvider } from './providers/aws'
//   registerSecretProvider(awsSecretsProvider)   // enables `aws:...` references

import { registerSecretProvider } from './registry';
import { vaultProvider, openBaoProvider } from './providers/vault';
import { awsSecretsProvider } from './providers/aws';
import { azureKeyVaultProvider } from './providers/azure';
import { onePasswordProvider } from './providers/onepassword';
import { gcpSecretManagerProvider } from './providers/gcp';

registerSecretProvider(vaultProvider);          // vault:secret/data/app#token
registerSecretProvider(openBaoProvider);        // bao:secret/data/app#token (OpenBao)
registerSecretProvider(awsSecretsProvider);     // aws:my/secret#key
registerSecretProvider(azureKeyVaultProvider);  // azure:my-kv/db-password
registerSecretProvider(onePasswordProvider);    // op://vault/item/field
registerSecretProvider(gcpSecretManagerProvider); // gcp:my-project/secret#key

export {
  hasSecretScheme,
  resolveExternalSecret,
  registerSecretProvider,
  registeredSchemes,
} from './registry';
export { setSecretsConfig, getSecretsConfig } from './config';
export type { SecretProvider, SecretResolveContext } from './types';
