# WaveRPC Code Signing & Authenticode Integration Guide

This guide describes how code signing is configured for WaveRPC desktop binaries and browser extension distribution.

---

## 1. Overview & Security Posture

- **Unsigned by Default (Local & RC)**: WaveRPC builds locally and for Release Candidates in an unsigned state without requiring code signing certificates or secrets.
- **Zero Committed Secrets**: No certificates, private keys, or passwords are stored in the repository.
- **Windows SmartScreen**: When launching unsigned open-source binaries, Windows SmartScreen will display an _"Unknown Publisher"_ warning. Users can click _"More info"_ → _"Run anyway"_.

---

## 2. Windows Authenticode Signing via Environment Variables

The `electron-builder` packaging tool is pre-configured to automatically detect and apply code signing when the standard environment variables are provided:

### Required Environment Variables

| Variable               | Description                                                                  | Example                         |
| :--------------------- | :--------------------------------------------------------------------------- | :------------------------------ |
| `CSC_LINK`             | Path to your `.pfx` / `.p12` Authenticode certificate file, or base64 string | `C:\certs\waverpc-codesign.pfx` |
| `CSC_KEY_PASSWORD`     | The decryption password for the certificate file                             | `your_secret_password`          |
| `WIN_CSC_LINK`         | (Alternative) Windows-specific certificate link                              | `C:\certs\waverpc-codesign.pfx` |
| `WIN_CSC_KEY_PASSWORD` | (Alternative) Windows-specific certificate password                          | `your_secret_password`          |

### Signing on Local / CI Environment

To create a signed release build, simply set the environment variables prior to running the packaging script:

```bash
# Windows PowerShell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "YourSecretPassword"

# Run Release Packaging
pnpm run package:release
```

If these environment variables are absent, `electron-builder` silently skips code signing and produces clean, unsigned executables.

---

## 3. Chrome Web Store Signing & Publishing

Chrome Web Store distribution requires uploading the generated ZIP archive:

1. Locate the packaged extension:
   `release/extension/WaveRPC-Extension-1.0.0.zip`
2. Log in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
3. Upload the ZIP file under the WaveRPC extension listing.
4. Google automatically signs and publishes the extension with its Web Store signature upon review approval.

---

## 4. SHA-256 Checksum Verification

To verify that an installer or extension package has not been tampered with:

```bash
# Windows PowerShell
Get-FileHash release/desktop/WaveRPC-Setup-1.0.0.exe -Algorithm SHA256

# Compare with release/SHA256SUMS.txt
```
