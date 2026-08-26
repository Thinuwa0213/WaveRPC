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

// src/websocket/client.test.ts
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

// src/websocket/client.ts
var log = new Logger("ExtensionWS");
var ExtensionWSClient = class {
  socket = null;
  state = "DISCONNECTED";
  url;
  autoReconnect;
  maxReconnectIntervalMs;
  reconnectTimer = null;
  reconnectAttempts = 0;
  heartbeatIntervalMs = 2e4;
  heartbeatTimer = null;
  constructor(options) {
    this.url = options?.url ?? "ws://127.0.0.1:6124";
    this.autoReconnect = options?.autoReconnect ?? true;
    this.maxReconnectIntervalMs = options?.maxReconnectIntervalMs ?? 3e4;
  }
  get connectionState() {
    return this.state;
  }
  connect() {
    if (this.state === "CONNECTED" || this.state === "CONNECTING") return;
    this.state = "CONNECTING";
    log.info(`Connecting to ${this.url}...`);
    try {
      this.socket = new WebSocket(this.url);
      this.socket.onopen = () => {
        log.info("Connected to Desktop Bridge.");
        this.state = "CONNECTED";
        this.startHeartbeat();
        if (this.reconnectAttempts > 0) {
          log.info(
            `Reconnected successfully after ${this.reconnectAttempts} attempt(s). Backoff reset.`
          );
        }
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };
      this.socket.onclose = () => {
        log.info("Disconnected from Desktop Bridge.");
        this.handleDisconnect();
      };
      this.socket.onerror = (error) => {
        log.warn("Socket error:", error);
      };
    } catch (error) {
      log.error("Failed to create WebSocket connection:", error);
      this.handleDisconnect();
    }
  }
  disconnect() {
    this.autoReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.state = "DISCONNECTED";
    this.reconnectAttempts = 0;
  }
  sendTrackUpdate(payload) {
    return this.send({
      type: "TRACK_UPDATE",
      payload
    });
  }
  sendPlaybackUpdate(payload) {
    return this.send({
      type: "PLAYBACK_UPDATE",
      payload
    });
  }
  sendTrackClear() {
    return this.send({
      type: "TRACK_CLEAR"
    });
  }
  send(message) {
    if (this.state !== "CONNECTED" || !this.socket) {
      log.warn("Send failed: client is not connected.");
      return false;
    }
    try {
      const json = JSON.stringify(message);
      this.socket.send(json);
      return true;
    } catch (error) {
      log.error("Failed to send message:", error);
      return false;
    }
  }
  handleDisconnect() {
    this.socket = null;
    this.state = "DISCONNECTED";
    this.stopHeartbeat();
    if (this.autoReconnect) {
      this.scheduleReconnect();
    }
  }
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, this.heartbeatIntervalMs);
  }
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  sendPing() {
    if (this.state === "CONNECTED" && this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: "PING" });
    }
  }
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      1e3 * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectIntervalMs
    );
    log.info(`Reconnect attempt #${this.reconnectAttempts} scheduled in ${delay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
};

// src/websocket/client.test.ts
var MockWebSocket = class _MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  url;
  onopen = null;
  onclose = null;
  onerror = null;
  sentMessages = [];
  closed = false;
  readyState = _MockWebSocket.CONNECTING;
  constructor(url) {
    this.url = url;
    _MockWebSocket.instances.push(this);
  }
  send(data) {
    this.sentMessages.push(data);
  }
  close() {
    this.readyState = _MockWebSocket.CLOSED;
    this.closed = true;
    if (this.onclose) {
      this.onclose();
    }
  }
  triggerOpen() {
    this.readyState = _MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen();
    }
  }
  triggerClose() {
    this.readyState = _MockWebSocket.CLOSED;
    this.closed = true;
    if (this.onclose) {
      this.onclose();
    }
  }
  triggerError(err = new Error("Socket error")) {
    this.readyState = _MockWebSocket.CLOSED;
    if (this.onerror) {
      this.onerror(err);
    }
  }
};
(0, import_node_test.describe)("ExtensionWSClient Resilience & Reconnect Tests", () => {
  let originalWebSocket;
  (0, import_node_test.beforeEach)(() => {
    MockWebSocket.instances = [];
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket;
    import_node_test.mock.timers.enable();
  });
  (0, import_node_test.afterEach)(() => {
    import_node_test.mock.timers.reset();
    globalThis.WebSocket = originalWebSocket;
  });
  (0, import_node_test.it)("1. Extension Backoff Sequence: should follow exponential backoff sequence (1s, 2s, 4s, 8s, 16s, 30s, 30s)", () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();
    import_node_assert.default.strictEqual(MockWebSocket.instances.length, 1);
    import_node_assert.default.strictEqual(client.connectionState, "CONNECTING");
    const expectedDelays = [1e3, 2e3, 4e3, 8e3, 16e3, 3e4, 3e4];
    for (let i = 0; i < expectedDelays.length; i++) {
      const delay = expectedDelays[i];
      const currentSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      currentSocket.triggerClose();
      import_node_assert.default.strictEqual(client.connectionState, "DISCONNECTED");
      if (delay > 1) {
        import_node_test.mock.timers.tick(delay - 1);
        import_node_assert.default.strictEqual(
          MockWebSocket.instances.length,
          i + 1,
          `At delay - 1ms (${delay - 1}ms), no new WebSocket instance should be created for attempt ${i + 1}`
        );
      }
      import_node_test.mock.timers.tick(1);
      import_node_assert.default.strictEqual(
        MockWebSocket.instances.length,
        i + 2,
        `At exact delay (${delay}ms), new WebSocket instance should be created for attempt ${i + 2}`
      );
      import_node_assert.default.strictEqual(client.connectionState, "CONNECTING");
    }
    client.disconnect();
  });
  (0, import_node_test.it)("2. Extension Backoff Reset: should reset attempt counter upon successful connection", () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();
    for (let i = 0; i < 3; i++) {
      const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      socket.triggerClose();
      const delay = 1e3 * Math.pow(2, i);
      import_node_test.mock.timers.tick(delay);
    }
    import_node_assert.default.strictEqual(MockWebSocket.instances.length, 4);
    const activeSocket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    activeSocket.triggerOpen();
    import_node_assert.default.strictEqual(client.connectionState, "CONNECTED");
    activeSocket.triggerClose();
    import_node_assert.default.strictEqual(client.connectionState, "DISCONNECTED");
    import_node_test.mock.timers.tick(999);
    import_node_assert.default.strictEqual(
      MockWebSocket.instances.length,
      4,
      "Should not reconnect before 1000ms after reset"
    );
    import_node_test.mock.timers.tick(1);
    import_node_assert.default.strictEqual(
      MockWebSocket.instances.length,
      5,
      "Should reconnect at 1000ms after backoff reset"
    );
    client.disconnect();
  });
  (0, import_node_test.it)("3. Duplicate Reconnect Timer Prevention: should schedule only one reconnect timer when error and close occur", () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.triggerError(new Error("Network error"));
    socket.triggerClose();
    socket.triggerClose();
    import_node_test.mock.timers.tick(1e3);
    import_node_assert.default.strictEqual(
      MockWebSocket.instances.length,
      2,
      "Only one reconnect attempt should be scheduled"
    );
    client.disconnect();
  });
  (0, import_node_test.it)("4. Manual Extension Disconnect: should cancel pending timer, disable autoReconnect, and close socket cleanly", () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.triggerClose();
    client.disconnect();
    import_node_assert.default.strictEqual(client.connectionState, "DISCONNECTED");
    import_node_test.mock.timers.tick(1e4);
    import_node_assert.default.strictEqual(
      MockWebSocket.instances.length,
      1,
      "No reconnect should occur after manual disconnect"
    );
    socket.triggerClose();
    import_node_test.mock.timers.tick(1e4);
    import_node_assert.default.strictEqual(MockWebSocket.instances.length, 1);
  });
  (0, import_node_test.it)("5. Heartbeat Starts on Open: should begin heartbeat only after onopen triggers", () => {
    const client = new ExtensionWSClient();
    client.connect();
    const socket = MockWebSocket.instances[0];
    import_node_test.mock.timers.tick(2e4);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 0);
    socket.triggerOpen();
    import_node_test.mock.timers.tick(19999);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 0);
    import_node_test.mock.timers.tick(1);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 1);
    import_node_assert.default.deepStrictEqual(JSON.parse(socket.sentMessages[0]), { type: "PING" });
    import_node_test.mock.timers.tick(2e4);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 2);
    import_node_assert.default.deepStrictEqual(JSON.parse(socket.sentMessages[1]), { type: "PING" });
    client.disconnect();
  });
  (0, import_node_test.it)("6. Heartbeat Lifecycle - Stops on Close and Error: should stop sending pings after close or error", () => {
    const client = new ExtensionWSClient();
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    import_node_test.mock.timers.tick(2e4);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 1);
    socket.triggerClose();
    import_node_test.mock.timers.tick(4e4);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 1);
    client.disconnect();
  });
  (0, import_node_test.it)("7. Heartbeat Lifecycle - Manual Disconnect Stops: manual disconnect cancels the heartbeat", () => {
    const client = new ExtensionWSClient();
    client.connect();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    import_node_test.mock.timers.tick(2e4);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 1);
    client.disconnect();
    import_node_test.mock.timers.tick(4e4);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 1);
  });
  (0, import_node_test.it)("8. Heartbeat Lifecycle - Reconnect Starts Fresh: successful reconnect starts a fresh single heartbeat", () => {
    const client = new ExtensionWSClient({ autoReconnect: true });
    client.connect();
    let socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    import_node_test.mock.timers.tick(2e4);
    import_node_assert.default.strictEqual(socket.sentMessages.length, 1);
    socket.triggerClose();
    import_node_test.mock.timers.tick(1e3);
    import_node_assert.default.strictEqual(MockWebSocket.instances.length, 2);
    const newSocket = MockWebSocket.instances[1];
    newSocket.triggerOpen();
    import_node_test.mock.timers.tick(2e4);
    import_node_assert.default.strictEqual(newSocket.sentMessages.length, 1);
    import_node_assert.default.deepStrictEqual(JSON.parse(newSocket.sentMessages[0]), { type: "PING" });
    import_node_test.mock.timers.tick(2e4);
    import_node_assert.default.strictEqual(newSocket.sentMessages.length, 2);
    client.disconnect();
  });
});
//# sourceMappingURL=client.test.js.map
