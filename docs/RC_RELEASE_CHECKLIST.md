# WaveRPC Release Candidate (v0.9.0-rc.1) Manual Acceptance Runbook

This checklist outlines the comprehensive clean-machine verification procedure required before promoting **`v0.9.0-rc.1`** to **`v1.0.0`**.

---

## 1. Clean Environment & Installation

- [ ] **Un-elevated Installer Launch**: Double-click `WaveRPC-Setup-0.9.0-rc.1.exe`. Verify the installer launches without requesting UAC Administrator elevation.
- [ ] **Target Directory**: Verify installation directory defaults to `%LOCALAPPDATA%\Programs\WaveRPC`.
- [ ] **Shortcuts**: Verify shortcuts are created on the Desktop and Start Menu with the WaveRPC icon.
- [ ] **Single Instance Lock**: Attempt launching a second instance while WaveRPC is already open. Verify that the second instance terminates immediately and focuses the existing window.
- [ ] **Packaged Environment**: Launch the app without any `.env` file present. Verify it runs cleanly and connects to Discord using default client ID `1542063156338229258`.

---

## 2. Chrome / Brave Extension Loading

- [ ] **Unpacked Load**: Extract `WaveRPC-Extension-0.9.0-rc.1.zip` and load unpacked into `chrome://extensions/`.
- [ ] **Zero Warnings**: Verify there are zero manifest warnings, errors, or permission flags.
- [ ] **Auto-Connect**: Verify that when WaveRPC Desktop is running, the extension connects immediately to `ws://127.0.0.1:6124` and the Desktop UI shows "Extension Connected".

---

## 3. Playback & Rich Presence Verification

- [ ] **Normal Playback**: Play a track on SoundCloud. Verify that within 2 seconds Discord Rich Presence displays:
  - Track Title (e.g., _Monstercat Release_)
  - Artist Name (e.g., _Vicetone_)
  - Elapsed and Total Duration Timestamps (e.g., _01:15 elapsed (03:45 total)_)
  - Album Artwork Image
  - "Listen on SoundCloud" button linking to track URL
- [ ] **Forward Scrub / Seek**: Click forward on the SoundCloud seek bar. Verify Discord re-anchors immediately to the new timestamp without timer drift or reset to 0:00.
- [ ] **Backward Scrub / Seek**: Click backward on the SoundCloud seek bar. Verify Discord re-anchors to the earlier timestamp.
- [ ] **Spotify-like Pause**: Pause playback on SoundCloud. Verify Discord Rich Presence is cleared immediately (`{ activity: null }`), while WaveRPC Desktop UI displays the paused track state.
- [ ] **Resume**: Resume playback. Verify Discord Rich Presence restores immediately with the correct elapsed timestamp.
- [ ] **Track Skip / Next**: Skip to the next track. Verify the old track's metadata is replaced and new timing starts cleanly.

---

## 4. Multi-Tab SoundCloud Behavior

- [ ] **Two SoundCloud Tabs**: Open SoundCloud in Tab 1 (playing) and Tab 2 (paused).
- [ ] **Authority Transfer**: Press Play in Tab 2. Verify Tab 2 immediately becomes the authoritative presence source on Discord.
- [ ] **Tab Closure Fallback**: Close Tab 2. Verify Tab 1 (paused) becomes the active source, and presence clears gracefully without stale data leaking.

---

## 5. Port Conflict & Lifecycle Hygiene

- [ ] **Port 6124 Conflict**: Bind a test server to `127.0.0.1:6124` and launch WaveRPC. Verify WaveRPC displays a native error dialog:
      _Title: WaveRPC Launch Error_
      _Message: WaveRPC couldn't start its local bridge because port 6124 is already in use. Close the other application using this port and start WaveRPC again._
- [ ] **Clean Exit**: Click OK on the error box. Verify WaveRPC exits completely with zero orphaned background processes.
- [ ] **Discord Reconnection**: Close the Discord Desktop app while playing music. Re-open Discord. Verify WaveRPC automatically reconnects and restores presence within seconds.
- [ ] **Graceful Shutdown**: Right-click the WaveRPC tray icon and select **Quit WaveRPC**. Verify:
  - Discord activity is cleared.
  - Port 6124 is released.
  - Process exits completely.

---

## 6. Uninstall Verification

- [ ] **Uninstall via Windows Settings**: Open Windows _Settings_ → _Apps_ → _Installed Apps_, find WaveRPC, and click _Uninstall_.
- [ ] **Cleanup**: Verify shortcuts and installation binaries are completely removed from `%LOCALAPPDATA%\Programs\WaveRPC`.
