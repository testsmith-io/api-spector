# Chocolatey package — API Spector (Windows)

Publishes the signed Windows installer to the [Chocolatey Community Repository](https://community.chocolatey.org/)
so users can `choco install api-spector`.

The package **downloads** the `.exe` from GitHub Releases at install time (it does
not bundle it), so publishing a version is just: set the version, inject the
installer's SHA-256, pack, and push.

## Per-release steps

Run from this folder with the release version, e.g. `1.2.3`:

```powershell
$version = '1.2.3'
$exe = "API-Spector-Setup-$version.exe"
$url = "https://github.com/testsmith-io/api-spector/releases/download/$version/$exe"

# 1. Download the released installer and compute its SHA-256.
Invoke-WebRequest $url -OutFile $exe
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()

# 2. Inject the checksum into the install script.
(Get-Content tools\chocolateyinstall.ps1) -replace '__CHECKSUM64__', $sha |
  Set-Content tools\chocolateyinstall.ps1

# 3. Pack and push (needs your API key from community.chocolatey.org).
choco pack --version $version
choco apikey --source https://push.chocolatey.org/ --api-key $env:CHOCO_API_KEY
choco push api-spector.$version.nupkg --source https://push.chocolatey.org/
```

Then restore the placeholder so the working copy stays templated:

```powershell
git checkout tools\chocolateyinstall.ps1
```

## Notes

- First-time submissions go through **Chocolatey moderation** (automated + human);
  later versions of an approved package auto-approve faster.
- The installer must be **code-signed** (it already is, via Azure Trusted Signing
  in the release workflow) — moderation checks this.
- This can be wired into CI: a job on `release: published` that performs steps
  1–3 using a `CHOCO_API_KEY` secret. Kept manual here so credentials stay with you.
