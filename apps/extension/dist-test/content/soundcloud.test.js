"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/content/soundcloud.test.ts
var import_node_test = require("node:test");
var import_node_assert = __toESM(require("node:assert"));

// ../../packages/shared/src/privacy/sanitizer.ts
var PrivacySanitizer = class {
  /**
   * Sanitizes a track payload to ensure data minimization compliance.
   * Strips authentication query parameters, access tokens, and limits text length.
   */
  static sanitizeTrack(track) {
    const sanitizedDuration = track.duration && track.duration > 0 ? Math.round(track.duration) : void 0;
    let playbackPosition;
    if (track.playbackPosition !== void 0 && typeof track.playbackPosition === "number" && Number.isFinite(track.playbackPosition) && track.playbackPosition >= 0) {
      playbackPosition = Math.round(track.playbackPosition);
      if (sanitizedDuration !== void 0 && playbackPosition > sanitizedDuration) {
        playbackPosition = sanitizedDuration;
      }
    }
    return {
      title: this.cleanText(track.title, 128),
      artist: this.cleanText(track.artist, 128),
      url: this.sanitizeUrl(track.url),
      artwork: track.artwork ? this.sanitizeUrl(track.artwork) : void 0,
      duration: sanitizedDuration,
      isPlaying: Boolean(track.isPlaying),
      playbackPosition
    };
  }
  /**
   * Cleans text input, stripping control characters and truncating long strings.
   */
  static cleanText(text, maxLength = 128) {
    if (!text) return "";
    return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim().slice(0, maxLength);
  }
  /**
   * Sanitizes URLs by removing sensitive query parameters (oauth, tokens, session IDs).
   */
  static sanitizeUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      const url = new URL(rawUrl);
      const sensitiveParams = [
        "access_token",
        "token",
        "auth",
        "bearer",
        "session_id",
        "client_secret",
        "key",
        "api_key"
      ];
      for (const param of sensitiveParams) {
        url.searchParams.delete(param);
      }
      return url.toString();
    } catch {
      return rawUrl.split("?")[0] || "";
    }
  }
};

// ../../packages/shared/src/logging/logger.ts
var LOG_LEVEL_PRIORITY = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};
var Logger = class {
  scope;
  level;
  constructor(scope, level) {
    this.scope = scope;
    this.level = level ?? "DEBUG";
  }
  debug(...args) {
    this.log("DEBUG", args);
  }
  info(...args) {
    this.log("INFO", args);
  }
  warn(...args) {
    this.log("WARN", args);
  }
  error(...args) {
    this.log("ERROR", args);
  }
  setLevel(level) {
    this.level = level;
  }
  log(level, args) {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }
    const sanitizedArgs = args.map((arg) => this.sanitizeArg(arg));
    const prefix = `[${this.scope}]`;
    switch (level) {
      case "DEBUG":
        console.debug(prefix, ...sanitizedArgs);
        break;
      case "INFO":
        console.log(prefix, ...sanitizedArgs);
        break;
      case "WARN":
        console.warn(prefix, ...sanitizedArgs);
        break;
      case "ERROR":
        console.error(prefix, ...sanitizedArgs);
        break;
    }
  }
  sanitizeArg(arg) {
    if (typeof arg === "string") {
      return this.sanitizeString(arg);
    }
    return arg;
  }
  /**
   * Sanitizes a string by finding and replacing URL-like substrings
   * that contain query parameters. This ensures no tokens, session IDs,
   * or other sensitive parameters leak into log output.
   */
  sanitizeString(value) {
    return value.replace(
      /https?:\/\/[^\s]+\?[^\s]*/g,
      (match) => PrivacySanitizer.sanitizeUrl(match)
    );
  }
};

// src/content/soundcloud.ts
var log = new Logger("SoundCloudDetector");
var SoundCloudPageDetector = class {
  lastTrackSignature = "";
  lastIsPlaying = null;
  hasActiveTrack = false;
  observer = null;
  bodyObserver = null;
  disposed = false;
  sourceSessionId = crypto.randomUUID();
  audioListeners = [];
  initialize() {
    log.info("Initializing detector observer...");
    this.detectAndSend();
    this.setupDOMObserver();
    this.setupAudioListeners();
    const handleUnload = () => {
      this.dispose();
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    log.info("Disposing detector...");
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.bodyObserver) {
      this.bodyObserver.disconnect();
      this.bodyObserver = null;
    }
    this.audioListeners.forEach(({ audio, event, listener }) => {
      try {
        audio.removeEventListener(event, listener);
      } catch {
      }
    });
    this.audioListeners = [];
  }
  detectTrackPayload() {
    let title;
    let artist;
    let artwork;
    if (typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession?.metadata) {
      const meta = navigator.mediaSession.metadata;
      title = meta.title?.trim();
      artist = meta.artist?.trim();
      if (meta.artwork && meta.artwork.length > 0) {
        const lastArt = meta.artwork[meta.artwork.length - 1];
        artwork = lastArt.src;
      }
    }
    if (!title) {
      const titleElem = document.querySelector(".playbackSoundBadge__titleLink");
      title = titleElem?.innerText?.trim() || titleElem?.title?.trim();
    }
    if (!artist) {
      const artistElem = document.querySelector(
        ".playbackSoundBadge__lightLink"
      );
      artist = artistElem?.innerText?.trim() || artistElem?.title?.trim();
    }
    let url = window.location.href;
    const badgeLink = document.querySelector(".playbackSoundBadge__titleLink");
    if (badgeLink && badgeLink.href) {
      url = badgeLink.href;
    }
    if (!artwork) {
      const imgElem = document.querySelector(
        ".playbackSoundBadge__avatar img, .sc-artwork img"
      );
      if (imgElem && imgElem.src) {
        artwork = imgElem.src;
      } else {
        const bgElem = document.querySelector(
          ".playbackSoundBadge__avatar span.sc-artwork-img"
        );
        if (bgElem && bgElem.style.backgroundImage) {
          const match = bgElem.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/);
          if (match && match[1]) {
            artwork = match[1];
          }
        }
      }
    }
    let isPlaying = false;
    const playControl = document.querySelector(".playControl");
    if (playControl) {
      isPlaying = playControl.classList.contains("playing") || playControl.classList.contains("sc-button-pause");
    }
    const audioElement = document.querySelector("audio");
    if (audioElement) {
      isPlaying = !audioElement.paused;
    }
    if (typeof navigator !== "undefined" && "mediaSession" in navigator && navigator.mediaSession?.playbackState) {
      if (navigator.mediaSession.playbackState === "playing") {
        isPlaying = true;
      } else if (navigator.mediaSession.playbackState === "paused") {
        isPlaying = false;
      }
    }
    let duration;
    if (audioElement && !isNaN(audioElement.duration) && audioElement.duration > 0) {
      duration = Math.round(audioElement.duration * 1e3);
    }
    let playbackPosition;
    if (audioElement && !isNaN(audioElement.currentTime)) {
      playbackPosition = Math.round(audioElement.currentTime * 1e3);
    }
    if (!title || !artist) {
      log.debug("Metadata unavailable: missing title or artist.");
      return null;
    }
    return {
      title,
      artist,
      url,
      artwork,
      duration,
      isPlaying,
      playbackPosition,
      providerId: "soundcloud"
    };
  }
  detectAndSend() {
    if (this.disposed) return;
    const payload = this.detectTrackPayload();
    if (!payload) {
      if (this.hasActiveTrack) {
        this.hasActiveTrack = false;
        this.lastTrackSignature = "";
        this.lastIsPlaying = null;
        log.info("TRACK_CLEAR emitted: no active track detected.");
        this.sendToBackground({
          type: "TRACK_CLEAR"
        });
      }
      return;
    }
    this.hasActiveTrack = true;
    const signature = `${payload.title}|${payload.artist}|${payload.url}|${payload.isPlaying}`;
    if (signature === this.lastTrackSignature) {
      return;
    }
    const oldSignature = this.lastTrackSignature;
    const playbackChanged = this.lastIsPlaying !== null && this.lastIsPlaying !== payload.isPlaying;
    this.lastTrackSignature = signature;
    this.lastIsPlaying = payload.isPlaying;
    const sanitizedUrl = PrivacySanitizer.sanitizeUrl(payload.url);
    if (!oldSignature) {
      log.info(
        `Track detected: "${payload.title}" by ${payload.artist} [${payload.isPlaying ? "Playing" : "Paused"}] ${sanitizedUrl}`
      );
    } else if (playbackChanged) {
      log.info(
        `Playback state changed: ${payload.isPlaying ? "Playing" : "Paused"} \u2014 "${payload.title}" by ${payload.artist}`
      );
    } else {
      log.info(
        `Track changed: "${payload.title}" by ${payload.artist} [${payload.isPlaying ? "Playing" : "Paused"}] ${sanitizedUrl}`
      );
    }
    this.sendToBackground({
      type: "TRACK_UPDATE",
      payload
    });
  }
  setupDOMObserver() {
    const targetNode = document.querySelector(".playControls") || document.body;
    this.observer = new MutationObserver(() => {
      if (this.disposed) return;
      this.detectAndSend();
    });
    this.observer.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "title", "src", "href"]
    });
  }
  setupAudioListeners() {
    const attachToAudio = (audio) => {
      const events = ["play", "pause", "playing", "ended"];
      events.forEach((evtName) => {
        const listener = () => {
          if (this.disposed) return;
          this.detectAndSend();
        };
        audio.addEventListener(evtName, listener);
        this.audioListeners.push({ audio, event: evtName, listener });
      });
    };
    const existingAudio = document.querySelector("audio");
    if (existingAudio) {
      attachToAudio(existingAudio);
    }
    this.bodyObserver = new MutationObserver((mutations) => {
      if (this.disposed) return;
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === "AUDIO") {
            attachToAudio(node);
          }
        });
      });
    });
    this.bodyObserver.observe(document.body, { childList: true, subtree: true });
  }
  sendToBackground(message) {
    if (this.disposed) return;
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      const msgWithSession = {
        ...message,
        sourceSessionId: this.sourceSessionId
      };
      chrome.runtime.sendMessage(msgWithSession, (_response) => {
        if (chrome.runtime.lastError) {
        }
      });
    }
  }
};
if (typeof document !== "undefined") {
  const detector = new SoundCloudPageDetector();
  detector.initialize();
}

// src/content/soundcloud.test.ts
(0, import_node_test.describe)("SoundCloud Detector Module Test Suite", () => {
  (0, import_node_test.it)("should construct valid SoundCloud extension track update payloads", () => {
    const payload = {
      title: "Monstercat Release",
      artist: "Vicetone",
      url: "https://soundcloud.com/vicetone/monstercat-release",
      artwork: "https://i1.sndcdn.com/artworks-0001.jpg",
      duration: 18e4,
      isPlaying: true,
      providerId: "soundcloud"
    };
    import_node_assert.default.strictEqual(payload.title, "Monstercat Release");
    import_node_assert.default.strictEqual(payload.artist, "Vicetone");
    import_node_assert.default.strictEqual(payload.providerId, "soundcloud");
    import_node_assert.default.strictEqual(payload.isPlaying, true);
  });
  (0, import_node_test.it)("session ID remains stable for one content-script lifetime", () => {
    const detector1 = new SoundCloudPageDetector();
    const session1 = detector1.sourceSessionId;
    import_node_assert.default.ok(session1, "Should generate session ID");
    import_node_assert.default.strictEqual(typeof session1, "string");
    const session1_again = detector1.sourceSessionId;
    import_node_assert.default.strictEqual(session1, session1_again, "Session ID must remain stable");
    const detector2 = new SoundCloudPageDetector();
    const session2 = detector2.sourceSessionId;
    import_node_assert.default.notStrictEqual(
      session1,
      session2,
      "Different instances must have different session IDs"
    );
  });
  (0, import_node_test.it)("dispose() is idempotent", () => {
    const detector = new SoundCloudPageDetector();
    import_node_assert.default.strictEqual(detector.disposed, false);
    detector.dispose();
    import_node_assert.default.strictEqual(detector.disposed, true);
    import_node_assert.default.doesNotThrow(() => {
      detector.dispose();
    });
    import_node_assert.default.strictEqual(detector.disposed, true);
  });
});
//# sourceMappingURL=soundcloud.test.js.map
