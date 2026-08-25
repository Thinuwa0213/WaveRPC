# Contributing to WaveRPC

Thank you for your interest in contributing to WaveRPC! We welcome contributions from the community to help connect every music service with Discord Rich Presence.

## Code of Conduct

Please be respectful, collaborative, and helpful in all interactions within issues, pull requests, and discussions.

## Getting Started

### Prerequisites

- **Node.js**: >= 20.x
- **pnpm**: >= 9.x

### Setup Project

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/WaveRPC.git
   cd WaveRPC
   ```

2. Install workspace dependencies:

   ```bash
   pnpm install
   ```

3. Verify build & type checking:
   ```bash
   pnpm run typecheck
   pnpm run build
   ```

## Adding a New Provider

WaveRPC follows a modular provider pattern (`packages/providers`). To add a new music service provider (e.g., Spotify, YouTube Music, Apple Music):

1. Create a new directory under `packages/providers/src/<provider-name>/`:
   ```
   packages/providers/src/<provider-name>/
   ├── index.ts
   ├── detector.ts
   └── types.ts
   ```
2. Extend `BaseProvider` and implement the required contract:
   - `isSupported(context?: unknown): Promise<boolean> | boolean`
   - `getCurrentTrack(): Promise<Track | undefined> | Track | undefined`
   - `getPlaybackState(): Promise<PlaybackState> | PlaybackState`
3. Register the new provider in `ProviderRegistry` or `ProviderService`.
4. Export the provider from `packages/providers/src/index.ts`.

## Monorepo Layout

- `apps/desktop`: Electron desktop application service architecture.
- `apps/extension`: Chrome Manifest V3 extension background worker & content scripts.
- `packages/shared`: Core models (`Track`, `PlaybackState`, `DiscordPresenceData`) and typed event system (`TypedEventEmitter`).
- `packages/providers`: Base provider interface (`BaseProvider`), provider registry (`ProviderRegistry`), and provider implementations.
- `packages/config`: Centralized TypeScript, ESLint, and Prettier configuration.

## Development Workflow

- Run type check: `pnpm run typecheck`
- Run linting: `pnpm run lint`
- Format code: `pnpm run format`
- Build workspace: `pnpm run build`

## Pull Request Guidelines

1. Create a feature branch (`git checkout -b feature/my-new-provider`).
2. Write clean, modular TypeScript code with strict mode compliance.
3. Ensure `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build` pass without warnings/errors.
4. Submit your PR against the `main` branch.
