# Changelog

All notable changes to the WaveRPC project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
