# WaveRPC Privacy Policy & Security Architecture Specification

WaveRPC is engineered around a strict **privacy-first, local-only architecture**. The core design principle guarantees that your listening data, browsing history, and credentials remain 100% on your device and are never sent to external servers or telemetry collectors.

---

## 1. Local-First Processing Pipeline

All track metadata collection, WebSocket communication, and Discord Rich Presence updating occur entirely on your local machine:

```
+─────────────────────────────+
|  Browser Music Service Tab  | (e.g. SoundCloud player session)
+──────────────┬──────────────+
               │ Local Content Script Observer
               ▼
+─────────────────────────────+
|  WaveRPC Extension Worker   |
+──────────────┬──────────────+
               │ Localhost Loopback WebSocket (ws://127.0.0.1:6124)
               ▼
+─────────────────────────────+
|    WaveRPC Desktop App      | (Runs PrivacySanitizer & Event Engine)
+──────────────┬──────────────+
               │ Local IPC Socket (\pipe\discord-ipc-0)
               ▼
+─────────────────────────────+
|       Discord Client        | (Renders Rich Presence on Discord Profile)
+─────────────────────────────+
```

### Guarantees

- **No Remote Telemetry**: WaveRPC operates with zero analytics, tracking scripts, or external telemetry backends.
- **Loopback Only**: Extension-to-Desktop communication is strictly bound to `127.0.0.1`.

---

## 2. Data Minimization Standard

WaveRPC collects only the absolute minimum metadata required to display rich music presence on Discord.

### ✅ Allowed Metadata Fields

| Field       | Type                | Description                       |
| :---------- | :------------------ | :-------------------------------- |
| `title`     | `string`            | Track title                       |
| `artist`    | `string`            | Artist / Producer name            |
| `url`       | `string`            | Public permalink URL to the track |
| `artwork`   | `string` (optional) | Album or track cover image URL    |
| `duration`  | `number` (optional) | Track duration in milliseconds    |
| `isPlaying` | `boolean`           | Current playback state            |

### ❌ Strictly Prohibited & Excluded Data

WaveRPC **NEVER** accesses, processes, or transmits:

- User passwords or authentication tokens (`OAuth`, session cookies, API secrets).
- Browsing history, active tabs outside supported music domains, or bookmarks.
- Personal files, local storage data, or private messages.
- Account names, email addresses, or payment information.

---

## 3. Automated Data Sanitization (`PrivacySanitizer`)

All incoming metadata payloads pass through the `PrivacySanitizer` module before being processed:

- **Query Parameter Scrubbing**: Automatically removes sensitive parameters (`access_token`, `token`, `auth`, `bearer`, `session_id`, `client_secret`, `key`, `api_key`) from URLs.
- **Control Character Filtering**: Strips hidden control characters and caps string lengths (max 128 characters) to prevent memory or buffer overflow vectors.

---

## 4. Extension Permission Audit

The WaveRPC Chrome Extension complies with Manifest V3 strict least-privilege access rules:

| Permission         |   Status   | Justification                                                                                 |
| :----------------- | :--------: | :-------------------------------------------------------------------------------------------- |
| `activeTab`        |  Granted   | Allows interactions with the currently focused music tab when invoked.                        |
| `host_permissions` | Restricted | Scope is strictly locked to supported music provider domains (e.g. `*://*.soundcloud.com/*`). |
| `cookies`          | ⛔ Denied  | Never requested.                                                                              |
| `history`          | ⛔ Denied  | Never requested.                                                                              |
| `tabs`             | ⛔ Denied  | Never requested.                                                                              |
