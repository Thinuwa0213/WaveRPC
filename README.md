# WaveRPC 🎵

> Universal music Rich Presence platform connecting your favorite music streaming services with Discord Rich Presence.

[![CI](https://github.com/waverpc/waverpc/actions/workflows/ci.yml/badge.svg)](https://github.com/waverpc/waverpc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io)

---

## 📌 Project Overview

**WaveRPC** bridges music services directly to Discord Rich Presence via a clean, high-performance monorepo architecture. Whether listening via an Electron desktop app or through a web browser using the Chrome Extension, WaveRPC detects active playback and updates your Discord status with rich track details, artwork, and playback progress.

---

## 🗺️ Roadmap & Supported Providers

| Provider                      |            Status            |     App Support     |
| :---------------------------- | :--------------------------: | :-----------------: |
| 🟠 **SoundCloud**             | 🚧 Target Provider (Phase 1) | Extension & Desktop |
| 🟢 **Spotify**                |          📅 Planned          | Extension & Desktop |
| 🔴 **YouTube Music**          |          📅 Planned          | Extension & Desktop |
| 💖 **Apple Music**            |          📅 Planned          | Extension & Desktop |
| 🌐 **Browser Media Sessions** |          📅 Planned          |      Extension      |

---

## 🛠️ Technology Stack

- **Runtime**: Node.js >= 20.x
- **Language**: TypeScript (Strict Mode)
- **Monorepo Manager**: pnpm Workspaces
- **Desktop Application**: Electron
- **Browser Extension**: Manifest V3
- **Presence Protocol**: Discord RPC

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20.x or later)
- [pnpm](https://pnpm.io/) (v9.x or later)

### Setup & Build

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

# Run linting
pnpm run lint
```

---

## 🏗️ Project Layout

```
WaveRPC/
├── apps/
│   ├── desktop/          # Electron desktop application service structure
│   └── extension/        # Manifest V3 Chrome Extension service worker & content scripts
├── packages/
│   ├── shared/           # Track schemas, presence types, and shared event system
│   ├── providers/        # BaseProvider interface, ProviderRegistry, and providers
│   └── config/           # Shared TypeScript, ESLint, and Prettier configurations
├── docs/                 # Architecture & design documentation
└── .github/              # GitHub Actions CI & Release workflows
```

---

## 🤝 Contributing

We welcome community contributions! Please check out [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines on adding new providers, setting up your development environment, and submitting pull requests.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
