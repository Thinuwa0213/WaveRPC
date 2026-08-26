# WaveRPC Beta Release Manual Verification Checklist

Follow this checklist to manually verify the release build on a clean machine/environment (or simulated environment) to guarantee stable behavior before publication.

---

## 1. Installation & Environment Verification

- [ ] **Installer launch:** Double-click `WaveRPC-Setup-0.3.0-beta.0.exe`. The NSIS installer should launch without requesting Administrator elevation.
- [ ] **Installation path:** Verify WaveRPC is installed in your local user directory (e.g. `AppData\Local\Programs\WaveRPC`).
- [ ] **Desktop shortcut:** Check that a "WaveRPC" shortcut is created on the Desktop and Start Menu.
- [ ] **Startup check:** Verify that launching WaveRPC does not trigger any environment errors or search for a `.env` file (Client ID must default to `1542063156338229258`).
- [ ] **App Launch:** Run the application. The main window should show, and the WaveRPC system tray icon should appear in the taskbar tray.
- [ ] **Single Instance Lock:** Double-click the desktop shortcut again while WaveRPC is running. Verify that it focuses the existing main window instead of launching a second instance or throwing a port error.

---

## 2. Browser Extension Verification

- [ ] **Extension Loading:** Load the unpacked `WaveRPC-Extension-0.3.0-beta.0.zip` (extracted) into Chrome/Brave. Verify that there are zero warnings or permissions errors in `chrome://extensions/`.
- [ ] **Auto-connect:** Start WaveRPC Desktop, then load the extension. Check the Desktop logs/status to verify the extension automatically connects to the localhost bridge.

---

## 3. Discord RPC Gating & State Machines

With the extension active and SoundCloud open:

- [ ] **Discord Open:** Start SoundCloud playback. Verify that Discord Rich Presence updates within 2 seconds.
- [ ] **No Early activity:** Close Discord and restart WaveRPC. Play music. Verify that WaveRPC does not attempt to send `SET_ACTIVITY` requests before Discord is open and the RPC client is fully handshaked (`READY` state).
- [ ] **Discord Reconnect:** Close Discord while music is playing, then reopen it. Verify that WaveRPC automatically reconnects to Discord and restores your presence.

---

## 4. SoundCloud Playback State Machine

- [ ] **Normal Progression:** Start playing a track. Verify that the Discord Rich Presence timer ticks forward synchronously with SoundCloud (no timer jitter or drift).
- [ ] **Forward Seek:** Click ahead in the track. Verify that Discord re-anchors the timer to the new elapsed position immediately.
- [ ] **Backward Seek:** Click backward in the track. Verify that Discord re-anchors the timer to the earlier elapsed position immediately.
- [ ] **Spotify-like Pause:** Pause the track. Verify that your Discord Rich Presence is cleared immediately (no longer displaying in your Discord profile status), but WaveRPC Desktop still retains the track information locally.
- [ ] **Resume Re-anchor:** Resume playback. Verify that your Discord Rich Presence is restored immediately from the exact paused time.
- [ ] **Track Change:** Skip to the next track. Verify that the previous track's timing and metadata are completely cleared, and the new track starts with fresh timing authority.

---

## 5. Port Conflict Handling

- [ ] **Simulated Port Conflict:** Use a separate utility (like Netcat or Python server) to bind to `127.0.0.1:6124` before launching WaveRPC. Launch WaveRPC.
- [ ] **Error Box:** Verify that WaveRPC displays a native error dialog box with the following message:
      _Title: WaveRPC Launch Error_
      _Message: WaveRPC couldn't start its local bridge because port 6124 is already in use. Close the other application using this port and start WaveRPC again._
- [ ] **Clean Exit:** Verify that after clicking OK, WaveRPC exits cleanly with zero orphaned background processes or resource leaks.

---

## 6. Packaged Shutdown Behavior

- [ ] **Graceful Shutdown:** Quit WaveRPC via the system tray context menu or the main window quit action during active playback.
- [ ] **Cleanup validation:** Verify that:
  - The Discord activity is cleared.
  - The WebSocket port `6124` is released immediately.
  - All WaveRPC processes are fully terminated.
- [ ] **Immediate Relaunch:** Relaunch WaveRPC immediately. Verify that it starts up successfully without any port binding issues.

---

## 7. Uninstall Cleanup

- [ ] **Uninstall:** Open Windows Settings → Apps → Installed Apps, locate WaveRPC, and click Uninstall.
- [ ] **Clean-up:** Verify that shortcut entries and registry keys under HKCU are deleted, but settings in local AppData are preserved for future updates.
