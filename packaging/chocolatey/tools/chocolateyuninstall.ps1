$ErrorActionPreference = 'Stop'

# Run the NSIS uninstaller silently. Looks it up from the standard uninstall
# registry key so this keeps working regardless of the per-user install path.
$keys = Get-UninstallRegistryKey -SoftwareName 'API Spector*'
foreach ($key in $keys) {
  if ($key.UninstallString) {
    $exe = $key.UninstallString -replace '"', ''
    Start-Process -FilePath $exe -ArgumentList '/S' -Wait
  }
}
