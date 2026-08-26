# WaveRPC Beta Release Notes (v0.3.0-beta.0)

WaveRPC is a universal music Rich Presence platform that connects browser players (like SoundCloud) to Discord Rich Presence, entirely local-first.

## Requirements & Support

- **Operating System:** Windows (10/11, x64 architecture).
- **Discord:** Discord Desktop App must be open and running locally. (Note: Rich Presence is not supported on Discord Web).
- **Browser:** Google Chrome, Brave, or any Chromium-based browser.
- **Provider Scope:** This release supports SoundCloud.

## Key Features

- **Local-first Security:** The Desktop app binds strictly to localhost (`127.0.0.1:6124`). No cloud synchronization, no external telemetry, and no tracking.
- **Spotify-like Pause Behavior:** Pausing SoundCloud clears your Discord Rich Presence automatically while retaining your local queue/track state.
- **Timing Authority state machine:** Handles seeks, page transitions, and temporary disconnects without timing jitter or fake `00:00` resets.
- **Port Conflict Alerts**: Native error boxes notify you if port 6124 is occupied by another process.

## Installation & Setup

### 1. Install WaveRPC Desktop

1. Run `WaveRPC-Setup-0.3.0-beta.0.exe`.
2. Follow the NSIS setup wizard (requires no administrator elevation, installs per-user).
3. Once installed, WaveRPC will launch and sit in your system tray.

### 2. Install WaveRPC Extension

1. Extract the `WaveRPC-Extension-0.3.0-beta.0.zip` file to a folder.
2. Open Chrome or Brave and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the folder where you extracted the ZIP (the folder that directly contains `manifest.json`).

### 3. Usage

1. Make sure Discord Desktop is running.
2. Open WaveRPC Desktop.
3. Open SoundCloud in your browser and play any track. Your Discord Rich Presence should update automatically within a couple of seconds!

## Known Limitations

- **Localhost Bound:** The Desktop bridge strictly listens on port `6124`. If another server or process occupies this port, WaveRPC will alert and shut down cleanly.

## Uninstalling WaveRPC

- **Desktop App:** Open Windows **Settings** → **Apps** → **Installed Apps**, find **WaveRPC**, and click **Uninstall**. User settings are retained under AppData for upgrades unless explicitly cleared.
- **Browser Extension:** Navigate to `chrome://extensions/` and click **Remove** under the WaveRPC extension card.
