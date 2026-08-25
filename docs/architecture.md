# WaveRPC Architecture Specification

## 1. System Overview

WaveRPC is an open-source, multi-platform Discord Rich Presence gateway for web and desktop music streaming services. It decouples music provider detection from client presence dispatchers through a unified, modular monorepo architecture.

```
                        ┌─────────────────────────┐
                        │      WaveRPC Apps       │
                        │  (Desktop / Extension)  │
                        └────────────┬────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │   @waverpc/providers    │
                        │   (Provider Registry)   │
                        └────────────┬────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │    @waverpc/shared      │
                        │ (Events & Track Schema) │
                        └─────────────────────────┘
```

---

## 2. Monorepo Package Topology

WaveRPC is built as a pnpm monorepo consisting of:

- **`packages/config`**: Centralized configuration management (TypeScript base config, ESLint flat config, Prettier rules).
- **`packages/shared`**: Core domain types (`Track`, `PlaybackState`, `DiscordPresenceData`) and the shared typed event system (`TypedEventEmitter`).
- **`packages/providers`**: Provider abstraction (`BaseProvider`), provider registry (`ProviderRegistry`), and provider detector modules (e.g., SoundCloud provider stub).
- **`apps/desktop`**: Scalable Electron desktop client modularized into `DiscordService`, `ProviderService`, and `IPCService`.
- **`apps/extension`**: Chrome Extension Manifest V3 background service worker and content scripts for web browser sessions.

---

## 3. Provider Architecture System

Every supported music platform implements the `BaseProvider` abstract class:

```typescript
export abstract class BaseProvider {
  public abstract readonly metadata: ProviderMetadata;

  public abstract isSupported(context?: unknown): Promise<boolean> | boolean;
  public abstract getCurrentTrack(): Promise<Track | undefined> | Track | undefined;
  public abstract getPlaybackState(): Promise<PlaybackState> | PlaybackState;
}
```

### Provider Registry

The `ProviderRegistry` manages provider lifecycles and active selection:

```
ProviderRegistry
 ├── Registers providers (SoundCloud, Spotify, YouTube Music, Apple Music...)
 ├── Finds active/supported provider for current tab/window context
 └── Queries active track metadata & playback state asynchronously
```

---

## 4. End-to-End Data Flow

```
+────────────────────────+
|   Music Service DOM    | (e.g., SoundCloud player session)
+───────────┬────────────+
            │ DOM / MediaSession Observer
            ▼
+────────────────────────+
|   Provider Detector    | (SoundCloudDetector extracts metadata)
+───────────┬────────────+
            │ Formats to unified Track schema
            ▼
+────────────────────────+
|    BaseProvider        | (getCurrentTrack() -> Track)
+───────────┬────────────+
            │ Emits 'track:changed' / 'presence:updated'
            ▼
+────────────────────────+
|    TypedEventEmitter   | (Shared Event System)
+───────────┬────────────+
            │ Dispatches presence update payload
            ▼
+────────────────────────+
|     DiscordService     | (IPC / Discord RPC Client)
+───────────┬────────────+
            │ Discord RPC IPC Socket
            ▼
+────────────────────────+
|    Discord Client      | (Renders Rich Presence on Discord Profile)
+────────────────────────+
```

---

## 5. Discord Integration Plan

1. **Client ID Authorization**: Discord Application credentials registered for WaveRPC.
2. **Activity Payload Mapping**:
   - `details`: Track Title
   - `state`: `by <Artist Name>`
   - `largeImageKey`: Album artwork URL or provider icon key
   - `largeImageText`: Track / Album title
   - `smallImageKey`: Provider brand icon (e.g. `soundcloud_icon`)
   - `smallImageText`: Provider Name
   - `timestamps`: `startTimestamp` & `endTimestamp` computed from elapsed duration
3. **IPC Connection Management**: `DiscordService` automatically handles connection retries, reconnection backoff, and graceful socket cleanup on application shutdown.
