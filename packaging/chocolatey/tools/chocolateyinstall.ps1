$ErrorActionPreference = 'Stop'

# Download the signed installer for this exact version from GitHub Releases and
# verify its checksum. The version comes from the package itself, so only the
# checksum needs updating per release (set __CHECKSUM64__ at pack time — see
# README.md; a release CI step can compute and inject it).
$version = $env:ChocolateyPackageVersion
$url64   = "https://github.com/testsmith-io/api-spector/releases/download/$version/API-Spector-Setup-$version.exe"

$packageArgs = @{
  packageName    = 'api-spector'
  fileType       = 'exe'
  url64bit       = $url64
  softwareName   = 'API Spector*'
  checksum64     = '__CHECKSUM64__'
  checksumType64 = 'sha256'
  # NSIS silent install. The build installs per-user (no admin rights needed).
  silentArgs     = '/S'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
