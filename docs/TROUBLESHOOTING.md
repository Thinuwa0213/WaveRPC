# WaveRPC Troubleshooting Guide

This guide resolves common issues and error scenarios when running WaveRPC.

---

## 1. Port 6124 Already in Use (`EADDRINUSE`)

### Symptoms

When starting WaveRPC, an error dialog box appears:

> **WaveRPC Launch Error**
> WaveRPC couldn't start its local bridge because port 6124 is already in use. Close the other application using this port and start WaveRPC again.

### Resolution

WaveRPC's local bridge communicates strictly on `127.0.0.1:6124`. If another instance or server is occupying this port:

1. Open Task Manager and terminate any zombie `WaveRPC.exe` or `electron.exe` processes.
2. Alternatively, in PowerShell find and stop the process occupying port 6124:
   ```powershell
   Get-Process -Id (Get-NetTCPConnection -LocalPort 6124).OwningProcess | Stop-Process -Force
   ```
3. Restart WaveRPC.

---

## 2. Browser Extension Shows "Waiting" / "Disconnected"

### Symptoms

The WaveRPC Desktop status card displays `Waiting` under Browser Extension.

### Resolution

1. Verify WaveRPC Desktop is running and sitting in the system tray.
2. In Chrome / Brave, open `chrome://extensions/` and click the reload icon on the WaveRPC card.
3. Refresh your SoundCloud tab.
4. Verify you loaded `apps/extension/dist` or the extracted `WaveRPC-Extension-*.zip` (the folder directly containing `manifest.json`).

---

## 3. Discord Rich Presence Not Showing on Profile

### Symptoms

Music is playing on SoundCloud and the Desktop app shows active track details, but nothing appears on your Discord profile.

### Resolution

1. **Discord Desktop Required**: Discord Web in a browser cannot host Rich Presence. Ensure the official Discord Desktop application is running locally.
2. **Discord Activity Privacy Settings**:
   - Open Discord Settings → **Activity Privacy**.
   - Ensure **"Display current activity as a status message"** is toggled **ON**.
3. **Restart Discord**: If Discord RPC socket pipes were temporarily stalled, close and reopen Discord Desktop. WaveRPC will reconnect automatically within seconds.

---

## 4. Manual Upgrade / Update Procedure

WaveRPC (`v1.0.0`) utilizes manual installer updates:

1. Download the latest `WaveRPC-Setup-<version>.exe` from GitHub Releases.
2. Run the installer. It will automatically overwrite previous application binaries while preserving your local user settings under `%LOCALAPPDATA%\WaveRPC\settings.json`.
3. In Chrome, load the updated extension ZIP into `chrome://extensions/`.
