$ErrorActionPreference = 'Stop'

# electron-builder registers a standard Uninstall entry; find it and run the
# NSIS uninstaller silently (/S).
[array]$key = Get-UninstallRegistryKey -SoftwareName 'API Spector*'

if ($key.Count -eq 1) {
  $key | ForEach-Object {
    Uninstall-ChocolateyPackage -PackageName 'api-spector' -FileType 'exe' -SilentArgs '/S' -File "$($_.UninstallString)"
  }
} elseif ($key.Count -eq 0) {
  Write-Warning 'API Spector is not installed (no uninstall entry found).'
} else {
  Write-Warning "$($key.Count) matching uninstall entries found; skipping to avoid removing the wrong one."
  $key | ForEach-Object { Write-Warning "- $($_.DisplayName)" }
}
