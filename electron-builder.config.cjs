// electron-builder configuration.
//
// The base build config still lives in package.json ("build"). This file just
// spreads it and layers on Windows code signing (Azure Trusted Signing) — but
// ONLY when the CI signing secrets are present. With no secrets set, the config
// is byte-for-byte the current unsigned build, so local dev and any release
// made before signing is provisioned keep working unchanged.
//
// Used by the release workflow via `electron-builder --config electron-builder.config.cjs`.
const pkg = require('./package.json');

/** @type {import('electron-builder').Configuration} */
const config = { ...pkg.build };

// Azure Trusted Signing kicks in only when a service-principal client id and a
// signing account are both provided (i.e. the GitHub secrets are configured).
if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CODE_SIGNING_ACCOUNT) {
  config.win = {
    ...config.win,
    // All four fields are REQUIRED by electron-builder's WindowsAzureSigningConfiguration.
    // publisherName lives INSIDE azureSignOptions (not at win level) and must match
    // the certificate subject CN.
    azureSignOptions: {
      endpoint: process.env.AZURE_CODE_SIGNING_ENDPOINT,
      codeSigningAccountName: process.env.AZURE_CODE_SIGNING_ACCOUNT,
      certificateProfileName: process.env.AZURE_CODE_SIGNING_PROFILE,
      publisherName: process.env.AZURE_CODE_SIGNING_PUBLISHER,
    },
  };
}

module.exports = config;
