# WaveRPC 🎵

> Universal music Rich Presence platform connecting your favorite music streaming services with Discord Rich Presence.

[![CI](https://github.com/waverpc/waverpc/actions/workflows/ci.yml/badge.svg)](https://github.com/waverpc/waverpc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io)
[![Release](https://img.shields.io/badge/release-v1.0.0-blue.svg)](CHANGELOG.md)

---

## 📌 Status & Overview

**Current Release Status**: `v1.0.0` (General Availability / Stable)

WaveRPC bridges music services directly to Discord Rich Presence via a clean, high-performance monorepo architecture.

### 🔒 Local-Only & Privacy-First Architecture

WaveRPC operates entirely **locally** on your device:

- **No Remote Servers**: 100% of network traffic remains strictly between your local browser extension and local desktop background service via a local WebSocket bridge (`ws://127.0.0.1:6124`).
- **Direct Discord IPC**: Updates are sent directly to the local Discord Desktop client using native local IPC pipes (`\\.\pipe\discord-ipc-*`).
- **Privacy Sanitization**: All track metadata undergoes local sanitization (`PrivacySanitizer`) to strip authentication tokens and tracking query parameters prior to broadcast.

---

## 🗺️ Supported Providers & Roadmap

| Provider                      |    Status    |     App Support     |
| :---------------------------- | :----------: | :-----------------: |
| 🟠 **SoundCloud**             | ✅ Supported | Extension & Desktop |
| 🟢 **Spotify**                |  📅 Planned  | Extension & Desktop |
| 🔴 **YouTube Music**          |  📅 Planned  | Extension & Desktop |
| 💖 **Apple Music**            |  📅 Planned  | Extension & Desktop |
| 🌐 **Browser Media Sessions** |  📅 Planned  |      Extension      |

---

## 📋 System Requirements

To run WaveRPC, you need:

1. **Discord Desktop Application** running locally on your computer.
2. **WaveRPC Browser Extension** installed in Chrome or Chromium-based browsers.
3. **WaveRPC Desktop Service** running locally.
4. **Discord Application Client ID** (`DISCORD_CLIENT_ID`) for custom developer configurations (defaults to official WaveRPC application ID).

---

## 🛠️ Technology Stack

- **Runtime**: Node.js >= 20.x
- **Language**: TypeScript (Strict Mode)
- **Monorepo Manager**: pnpm Workspaces
- **Desktop Application**: Electron / Node background process
- **Browser Extension**: Manifest V3
- **Presence Protocol**: Discord RPC (Native local IPC pipe)

---

## 🚀 Basic Setup Flow

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v20.x or later)
- [pnpm](https://pnpm.io/) (v9.x or later)
- [Discord Desktop Client](https://discord.com/) (running on local machine)

### 2. Environment Setup

Copy `.env.example` to `.env` (or export the variable in your shell) if you wish to override the default Discord Application Client ID:

```bash
cp .env.example .env
```

```env
DISCORD_CLIENT_ID=your_public_discord_client_id
```

### 3. Build Workspace

```bash
# Clone the repository
git clone https://github.com/waverpc/waverpc.git
cd WaveRPC

# Install dependencies
pnpm install

# Typecheck workspace packages
pnpm run typecheck

# Build all packages and applications
pnpm run build

# Run unit & integration tests
pnpm test
```

### 4. Run Desktop Service & Extension

1. **Start Desktop App**:
   ```bash
   pnpm --filter @waverpc/desktop start
   ```
2. **Load Extension in Chrome**:
   - Open `chrome://extensions` in Chrome.
   - Enable **Developer mode** (toggle in upper right corner).
   - Click **Load unpacked** and select the `apps/extension/dist` folder (after `pnpm build`) or extract the release extension ZIP.
3. **Listen on SoundCloud**:
   - Play any track on [SoundCloud](https://soundcloud.com).
   - WaveRPC will automatically detect playback and reflect rich presence on your Discord profile!

---

## 🏗️ Project Layout

```
WaveRPC/
├── apps/
│   ├── desktop/          # Desktop background application and Discord IPC service
│   └── extension/        # Manifest V3 Chrome Extension background & SoundCloud content script
├── packages/
│   ├── shared/           # Track schemas, presence types, PrivacySanitizer, event system
│   ├── providers/        # BaseProvider interface, ProviderRegistry, SoundCloud provider
│   └── config/           # Shared TypeScript, ESLint, and Prettier configurations
├── docs/                 # Architecture, privacy & release documentation
└── .github/              # GitHub Actions CI & Release workflows
```

---

## 🤝 Contributing

We welcome community contributions! Please check out [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines on adding new providers, setting up your development environment, and submitting pull requests.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
