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

// src/background/soundcloud-tab-state.test.ts
var import_node_test = require("node:test");
var import_node_assert = __toESM(require("node:assert"));

// src/background/soundcloud-tab-state.ts
var SoundCloudTabStateManager = class {
  constructor(callbacks) {
    this.callbacks = callbacks;
  }
  soundCloudTabs = /* @__PURE__ */ new Map();
  activePlaybackTabId = null;
  invalidatedSessionIds = /* @__PURE__ */ new Set();
  desktopHasTrack = false;
  getActivePlaybackTabId() {
    return this.activePlaybackTabId;
  }
  getTabs() {
    const tabs = /* @__PURE__ */ new Map();
    for (const [id, state] of this.soundCloudTabs.entries()) {
      tabs.set(id, state.payload);
    }
    return tabs;
  }
  forwardTrackUpdate(payload) {
    this.desktopHasTrack = true;
    this.callbacks.onTrackUpdate(payload);
  }
  forwardTrackClear() {
    if (this.desktopHasTrack) {
      this.desktopHasTrack = false;
      this.callbacks.onTrackClear();
    }
  }
  /**
   * Called when a tab sends a TRACK_UPDATE.
   */
  handleTrackUpdate(tabId, sourceSessionId, payload, tabUrl) {
    if (typeof tabId !== "number") return;
    if (tabUrl && !tabUrl.includes("soundcloud.com")) return;
    if (this.invalidatedSessionIds.has(sourceSessionId)) return;
    const existing = this.soundCloudTabs.get(tabId);
    if (existing && existing.sourceSessionId !== sourceSessionId) {
      this.invalidateSession(existing.sourceSessionId);
    }
    this.soundCloudTabs.set(tabId, { sourceSessionId, payload });
    if (payload.isPlaying) {
      this.activePlaybackTabId = tabId;
    } else if (this.activePlaybackTabId === null || this.activePlaybackTabId === tabId) {
      this.activePlaybackTabId = tabId;
    } else {
      const activeTab = this.soundCloudTabs.get(this.activePlaybackTabId);
      if (!activeTab || !activeTab.payload.isPlaying) {
        this.activePlaybackTabId = tabId;
      }
    }
    if (this.activePlaybackTabId === tabId) {
      this.forwardTrackUpdate(payload);
    }
  }
  /**
   * Called when a tab sends a TRACK_CLEAR.
   */
  handleTrackClear(tabId, sourceSessionId) {
    if (this.invalidatedSessionIds.has(sourceSessionId)) {
      return;
    }
    const existing = this.soundCloudTabs.get(tabId);
    if (!existing || existing.sourceSessionId !== sourceSessionId) {
      return;
    }
    this.invalidateSession(sourceSessionId);
    this.soundCloudTabs.delete(tabId);
    if (this.activePlaybackTabId === tabId) {
      this.resolveActivePlaybackReplacement();
    }
  }
  /**
   * Called when a tab is removed, loading, or navigated away.
   */
  handleTabRemoved(tabId) {
    const existing = this.soundCloudTabs.get(tabId);
    if (existing) {
      this.invalidateSession(existing.sourceSessionId);
      this.soundCloudTabs.delete(tabId);
    }
    if (this.activePlaybackTabId === tabId) {
      this.resolveActivePlaybackReplacement();
    }
  }
  resolveActivePlaybackReplacement() {
    let replacementTabId = null;
    let replacementPayload = null;
    for (const [id, state] of this.soundCloudTabs.entries()) {
      if (state.payload.isPlaying) {
        replacementTabId = id;
        replacementPayload = state.payload;
        break;
      }
    }
    if (!replacementTabId) {
      for (const [id, state] of this.soundCloudTabs.entries()) {
        replacementTabId = id;
        replacementPayload = state.payload;
        break;
      }
    }
    if (replacementTabId && replacementPayload) {
      this.activePlaybackTabId = replacementTabId;
      this.forwardTrackUpdate(replacementPayload);
    } else {
      this.activePlaybackTabId = null;
      this.forwardTrackClear();
    }
  }
  invalidateSession(sessionId) {
    if (!sessionId) return;
    this.invalidatedSessionIds.add(sessionId);
    if (this.invalidatedSessionIds.size > 256) {
      const oldestKey = this.invalidatedSessionIds.values().next().value;
      if (oldestKey !== void 0) {
        this.invalidatedSessionIds.delete(oldestKey);
      }
    }
  }
};

// src/background/soundcloud-tab-state.test.ts
(0, import_node_test.describe)("SoundCloudTabStateManager Tests", () => {
  let stateManager;
  let trackUpdates;
  let trackClears;
  (0, import_node_test.beforeEach)(() => {
    trackUpdates = [];
    trackClears = 0;
    stateManager = new SoundCloudTabStateManager({
      onTrackUpdate: (payload) => {
        trackUpdates.push(payload);
      },
      onTrackClear: () => {
        trackClears++;
      }
    });
  });
  (0, import_node_test.it)("1. TRACK_UPDATE associates active track with sender tab (playing update claims ownership)", () => {
    const payload = {
      title: "Track A",
      artist: "Artist A",
      url: "https://soundcloud.com/track-a",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(1, "session-1", payload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    import_node_assert.default.strictEqual(trackUpdates.length, 1);
    import_node_assert.default.deepStrictEqual(trackUpdates[0], payload);
  });
  (0, import_node_test.it)("2. Paused update does not steal ownership from playing tab", () => {
    const playingPayload = {
      title: "Playing Track",
      artist: "Artist P",
      url: "https://soundcloud.com/track-p",
      isPlaying: true
    };
    const pausedPayload = {
      title: "Paused Track",
      artist: "Artist Paused",
      url: "https://soundcloud.com/track-paused",
      isPlaying: false
    };
    stateManager.handleTrackUpdate(
      1,
      "session-1",
      playingPayload,
      "https://soundcloud.com/track-p"
    );
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    stateManager.handleTrackUpdate(
      2,
      "session-2",
      pausedPayload,
      "https://soundcloud.com/track-paused"
    );
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    import_node_assert.default.strictEqual(trackUpdates.length, 1);
    import_node_assert.default.deepStrictEqual(trackUpdates[0], playingPayload);
  });
  (0, import_node_test.it)("3. Non-active tab clear/close does not clear active presence", () => {
    const playingPayload = {
      title: "Playing Track",
      artist: "Artist P",
      url: "https://soundcloud.com/track-p",
      isPlaying: true
    };
    const pausedPayload = {
      title: "Paused Track",
      artist: "Artist Paused",
      url: "https://soundcloud.com/track-paused",
      isPlaying: false
    };
    stateManager.handleTrackUpdate(
      1,
      "session-1",
      playingPayload,
      "https://soundcloud.com/track-p"
    );
    stateManager.handleTrackUpdate(
      2,
      "session-2",
      pausedPayload,
      "https://soundcloud.com/track-paused"
    );
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    trackUpdates = [];
    stateManager.handleTrackClear(2, "session-2");
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    import_node_assert.default.strictEqual(trackUpdates.length, 0);
    import_node_assert.default.strictEqual(trackClears, 0);
  });
  (0, import_node_test.it)("4. Active tab close/clear selects playing replacement if available", () => {
    const playingPayload1 = {
      title: "Playing Track 1",
      artist: "Artist 1",
      url: "https://soundcloud.com/track-1",
      isPlaying: true
    };
    const playingPayload2 = {
      title: "Playing Track 2",
      artist: "Artist 2",
      url: "https://soundcloud.com/track-2",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(
      1,
      "session-1",
      playingPayload1,
      "https://soundcloud.com/track-1"
    );
    stateManager.handleTrackUpdate(
      2,
      "session-2",
      playingPayload2,
      "https://soundcloud.com/track-2"
    );
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 2);
    trackUpdates = [];
    stateManager.handleTabRemoved(2);
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    import_node_assert.default.strictEqual(trackUpdates.length, 1);
    import_node_assert.default.deepStrictEqual(trackUpdates[0], playingPayload1);
    import_node_assert.default.strictEqual(trackClears, 0);
  });
  (0, import_node_test.it)("5. Active tab close/clear selects paused replacement if no playing replacement exists", () => {
    const pausedPayload = {
      title: "Paused Track",
      artist: "Artist Paused",
      url: "https://soundcloud.com/track-paused",
      isPlaying: false
    };
    const playingPayload = {
      title: "Playing Track",
      artist: "Artist P",
      url: "https://soundcloud.com/track-p",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(
      1,
      "session-1",
      pausedPayload,
      "https://soundcloud.com/track-paused"
    );
    stateManager.handleTrackUpdate(
      2,
      "session-2",
      playingPayload,
      "https://soundcloud.com/track-p"
    );
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 2);
    trackUpdates = [];
    stateManager.handleTabRemoved(2);
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    import_node_assert.default.strictEqual(trackUpdates.length, 1);
    import_node_assert.default.deepStrictEqual(trackUpdates[0], pausedPayload);
    import_node_assert.default.strictEqual(trackClears, 0);
  });
  (0, import_node_test.it)("6. Active tab close with no replacement emits TRACK_CLEAR once", () => {
    const playingPayload = {
      title: "Playing Track",
      artist: "Artist P",
      url: "https://soundcloud.com/track-p",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(
      1,
      "session-1",
      playingPayload,
      "https://soundcloud.com/track-p"
    );
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    trackUpdates = [];
    stateManager.handleTabRemoved(1);
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), null);
    import_node_assert.default.strictEqual(trackClears, 1);
    import_node_assert.default.strictEqual(trackUpdates.length, 0);
  });
  (0, import_node_test.it)("7. Navigation away behaves like removal", () => {
    const playingPayload = {
      title: "Playing Track",
      artist: "Artist P",
      url: "https://soundcloud.com/track-p",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(
      1,
      "session-1",
      playingPayload,
      "https://soundcloud.com/track-p"
    );
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    stateManager.handleTabRemoved(1);
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), null);
    import_node_assert.default.strictEqual(trackClears, 1);
  });
  (0, import_node_test.it)("8. Duplicate tab removal does not emit duplicate TRACK_CLEAR", () => {
    const playingPayload = {
      title: "Playing Track",
      artist: "Artist P",
      url: "https://soundcloud.com/track-p",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(
      1,
      "session-1",
      playingPayload,
      "https://soundcloud.com/track-p"
    );
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    trackClears = 0;
    stateManager.handleTabRemoved(1);
    import_node_assert.default.strictEqual(trackClears, 1);
    stateManager.handleTabRemoved(1);
    import_node_assert.default.strictEqual(trackClears, 1, "Should not emit duplicate TRACK_CLEAR");
  });
  (0, import_node_test.it)("9. Multiple SoundCloud tabs are isolated", () => {
    const payload1 = {
      title: "Track 1",
      artist: "Artist 1",
      url: "https://soundcloud.com/track-1",
      isPlaying: false
    };
    const payload2 = {
      title: "Track 2",
      artist: "Artist 2",
      url: "https://soundcloud.com/track-2",
      isPlaying: false
    };
    stateManager.handleTrackUpdate(1, "session-1", payload1, "https://soundcloud.com/track-1");
    stateManager.handleTrackUpdate(2, "session-2", payload2, "https://soundcloud.com/track-2");
    const tabs = stateManager.getTabs();
    import_node_assert.default.strictEqual(tabs.size, 2);
    import_node_assert.default.deepStrictEqual(tabs.get(1), payload1);
    import_node_assert.default.deepStrictEqual(tabs.get(2), payload2);
  });
  (0, import_node_test.it)("10. No history is persisted", () => {
    const playingPayload = {
      title: "Playing Track",
      artist: "Artist P",
      url: "https://soundcloud.com/track-p",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(
      1,
      "session-1",
      playingPayload,
      "https://soundcloud.com/track-p"
    );
    stateManager.handleTabRemoved(1);
    const tabs = stateManager.getTabs();
    import_node_assert.default.strictEqual(tabs.size, 0);
  });
  (0, import_node_test.it)("11. delayed old-session update after tab close is rejected", () => {
    const payload = {
      title: "Track A",
      artist: "Artist A",
      url: "https://soundcloud.com/track-a",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(1, "session-1", payload, "https://soundcloud.com/track-a");
    stateManager.handleTabRemoved(1);
    trackUpdates = [];
    stateManager.handleTrackUpdate(1, "session-1", payload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(trackUpdates.length, 0, "Should reject late update from tombstoned session");
  });
  (0, import_node_test.it)("12. delayed old-session update after navigation is rejected", () => {
    const payload = {
      title: "Track A",
      artist: "Artist A",
      url: "https://soundcloud.com/track-a",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(1, "session-1", payload, "https://soundcloud.com/track-a");
    stateManager.handleTrackClear(1, "session-1");
    trackUpdates = [];
    stateManager.handleTrackUpdate(1, "session-1", payload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(
      trackUpdates.length,
      0,
      "Should reject late update from navigated-away session"
    );
  });
  (0, import_node_test.it)("13. S1 -> S2 same-tab replacement and S1 late update is rejected", () => {
    const payload1 = {
      title: "Track 1",
      artist: "Artist 1",
      url: "https://soundcloud.com/track-1",
      isPlaying: true
    };
    const payload2 = {
      title: "Track 2",
      artist: "Artist 2",
      url: "https://soundcloud.com/track-2",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(1, "session-1", payload1, "https://soundcloud.com/track-1");
    import_node_assert.default.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    stateManager.handleTrackUpdate(1, "session-2", payload2, "https://soundcloud.com/track-2");
    import_node_assert.default.strictEqual(trackUpdates.length, 2);
    import_node_assert.default.deepStrictEqual(trackUpdates[1], payload2);
    trackUpdates = [];
    stateManager.handleTrackUpdate(1, "session-1", payload1, "https://soundcloud.com/track-1");
    import_node_assert.default.strictEqual(trackUpdates.length, 0, "Should reject stale S1 message after S2 took over");
  });
  (0, import_node_test.it)("14. pause does not invalidate session and resume works", () => {
    const playPayload = {
      title: "Track A",
      artist: "Artist A",
      url: "https://soundcloud.com/track-a",
      isPlaying: true
    };
    const pausePayload = {
      title: "Track A",
      artist: "Artist A",
      url: "https://soundcloud.com/track-a",
      isPlaying: false
    };
    stateManager.handleTrackUpdate(1, "session-1", playPayload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(trackUpdates.length, 1);
    stateManager.handleTrackUpdate(1, "session-1", pausePayload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(trackUpdates.length, 2);
    import_node_assert.default.strictEqual(trackUpdates[1].isPlaying, false);
    stateManager.handleTrackUpdate(1, "session-1", playPayload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(trackUpdates.length, 3);
    import_node_assert.default.strictEqual(trackUpdates[2].isPlaying, true);
  });
  (0, import_node_test.it)("15. duplicate teardown produces one effective clear", () => {
    const payload = {
      title: "Track A",
      artist: "Artist A",
      url: "https://soundcloud.com/track-a",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(1, "session-1", payload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(trackClears, 0);
    stateManager.handleTrackClear(1, "session-1");
    import_node_assert.default.strictEqual(trackClears, 1);
    stateManager.handleTabRemoved(1);
    import_node_assert.default.strictEqual(trackClears, 1, "Should not emit second clear");
    stateManager.handleTabRemoved(1);
    import_node_assert.default.strictEqual(trackClears, 1, "Should not emit third clear");
  });
  (0, import_node_test.it)("16. tombstone collection remains bounded", () => {
    const payload = {
      title: "Track",
      artist: "Artist",
      url: "https://soundcloud.com/track",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(999, "active-session", payload, "https://soundcloud.com/track");
    for (let i = 0; i < 300; i++) {
      stateManager.handleTrackUpdate(1, `session-${i}`, payload, "https://soundcloud.com/track");
      stateManager.handleTrackClear(1, `session-${i}`);
    }
    trackUpdates = [];
    stateManager.handleTrackUpdate(1, "session-0", payload, "https://soundcloud.com/track");
    import_node_assert.default.strictEqual(
      trackUpdates.length,
      1,
      "session-0 should be allowed again because tombstone fell off bound"
    );
  });
  (0, import_node_test.it)("17. final effective clear cannot be followed by stale provider reactivation", () => {
    const payload = {
      title: "Track A",
      artist: "Artist A",
      url: "https://soundcloud.com/track-a",
      isPlaying: true
    };
    stateManager.handleTrackUpdate(1, "session-1", payload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(trackClears, 0);
    stateManager.handleTabRemoved(1);
    import_node_assert.default.strictEqual(trackClears, 1);
    trackUpdates = [];
    stateManager.handleTrackUpdate(1, "session-1", payload, "https://soundcloud.com/track-a");
    import_node_assert.default.strictEqual(
      trackUpdates.length,
      0,
      "No track updates should be sent from stale session"
    );
  });
});
//# sourceMappingURL=soundcloud-tab-state.test.js.map
