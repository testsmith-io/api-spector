$ErrorActionPreference = 'Stop'

$version    = '0.6.9'
$url64       = "https://github.com/testsmith-io/api-spector/releases/download/v$version/API-Spector-Setup-$version.exe"

$packageArgs = @{
  packageName    = 'api-spector'
  fileType       = 'exe'
  url64bit       = $url64
  # sha256 of the signed installer for this version. Get it from the release,
  # or with:  Get-FileHash API-Spector-Setup-<version>.exe -Algorithm SHA256
  checksum64     = 'REPLACE_WITH_SHA256_OF_THE_EXE'
  checksumType64 = 'sha256'
  # electron-builder NSIS one-click installer: /S = silent.
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
