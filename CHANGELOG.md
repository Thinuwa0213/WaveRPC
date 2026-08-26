# Changelog

All notable changes to the WaveRPC project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v1.0.0 (General Availability) - 2026-08-27

This is the first stable production General Availability (GA) release of WaveRPC, establishing a production-ready, local-first bridge between music playback and Discord Rich Presence.

### Key Capabilities & Highlights

- **SoundCloud Presence Integration**: Real-time extraction and synchronization of track title, artist, artwork, duration, elapsed playback position, and interactive "Listen on SoundCloud" action button on Discord.
- **Timing Authority & Precision**: Drift-compensated logical anchor synchronization with seamless forward/backward seek recovery, tab navigation handling, and zero timestamp jitter.
- **Spotify-like Pause Behavior**: Pausing playback clears Discord Rich Presence immediately (`{ activity: null }`) while keeping local track information intact in the desktop client.
- **Multi-Tab Audio Coordination**: Deterministic audio session tracking with automated authority handover between concurrent playing tabs and zero metadata/timing leakage upon tab closure.
- **Local-Only WebSocket Bridge**: High-performance local bridge strictly bound to `127.0.0.1:6124` with origin verification, defensive payload size limits (100KB), and strict schema type validation.
- **Discord IPC Pipe Auto-Discovery**: Cross-platform scanning (`\\.\pipe\discord-ipc-0` through `9` on Windows) with automatic exponential backoff reconnection.
- **Single-Instance Lock & Port Conflict Handling**: Electron single-instance enforcement and friendly native error dialogs on `EADDRINUSE` port conflicts.
- **Privacy & Data Minimization**: Zero telemetry, zero external network requests, and automated `PrivacySanitizer` query parameter stripping.
- **Un-Elevated User Installer**: NSIS Windows installer targeting `%LOCALAPPDATA%\Programs\WaveRPC` without administrator elevation required.

## v0.9.0-rc.1 (Release Candidate 1) - 2026-08-27

This is the Release Candidate for WaveRPC, preparing the platform for v1.0.0 production deployment:

### Added & Hardened

- **Automated Release Engineering**: New unified packaging pipeline (`scripts/package-release.js`) generating verified NSIS installers, production Manifest V3 extension archives (excluding sourcemaps and TypeScript sources), and automated SHA-256 checksums (`SHA256SUMS.txt`).
- **Release Verification Test Suite**: Added deterministic integration tests (`packages/shared/src/integration/release-verification.test.ts`) validating workspace version consistency, Manifest V3 version formats, canonical port 6124 configuration, and privacy parameter stripping.
- **Multi-Tab Deterministic Handover Coverage**: Added regression tests in `SoundCloudTabStateManager` verifying seamless authority handover between concurrent playing tabs and ensuring zero metadata or timing leakage upon active tab termination.
- **Documentation & Port Standardization**: Standardized all architecture, privacy, and user setup documentation strictly to `ws://127.0.0.1:6124`. Added Release Candidate verification runbooks and code signing guides.

## v0.3.0-beta.0 (Beta Release) - 2026-08-26

This is the Beta release of WaveRPC, introducing security hardening, error handling robustness, and code health improvements:

### Added & Hardened

- **Port Conflict Native Error Handling**: Custom native error dialog boxes when port 6124 is in use (`EADDRINUSE`) rather than silently exiting on launch.
- **Strict Payload Schema Validation**: Centralized type safety checks on incoming WebSocket bridge messages to prevent parser/sanitization crashes.
- **Tray Status Event Unsubscription**: Fixed listener memory leak by cleaning up the status-changed handler during tray destruction.
- **Dynamic Version Assertions**: Updated the test suite to load the package.json version dynamically, removing hardcoded expectations.

## v0.3.0-alpha.0 (Alpha Release) - 2026-08-26

This is the first usable alpha release of WaveRPC, establishing a local-only, privacy-first bridge between music playback and Discord Rich Presence.

### Major Capabilities Included

- **SoundCloud Playback Detection**: Real-time extraction of track title, artist, duration, current timestamp, artwork URL, and play/pause state from SoundCloud web player.
- **Discord Rich Presence**: Integration via Discord IPC pipe with real-time status updates, elapsed/remaining time timestamps, provider icons, and action buttons.
- **Local Extension ↔ Desktop WebSocket Bridge**: High-performance local WebSocket connection between Chrome Extension (Manifest V3) and Desktop background process.
- **Discord IPC Pipe Scanning**: Cross-platform scanning (`\\.\pipe\discord-ipc-0` through `9` on Windows) for reliable client detection.
- **Automatic Reconnect & Exponential Backoff**: Resilient reconnect strategy with configurable backoff and capped delays for WebSocket and IPC transports.
- **TRACK_CLEAR Support**: Proper state reset and presence clearing when media stops or playback tab is closed.
- **Presence Deduplication**: Intelligent hashing and state comparison to prevent redundant IPC dispatches to Discord.
- **PrivacySanitizer**: Redaction and sanitization of user data, query params, and tokens before sending presence updates.
- **Local-Only Architecture**: Zero cloud dependencies or telemetry; 100% local IPC and WebSocket transport for privacy-first operations.
- **Structured Local Logging**: Consistent contextual logging across desktop runtime and shared modules.
- **Automated Test Suite**: Automated unit and integration test coverage for privacy sanitization, presence payload creation, reconnect handlers, and transport protocols.
- **Real Windows End-to-End Validation**: Verified operating status on Windows with active Discord Desktop and SoundCloud web playback.
