import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { TypedEventEmitter } from '../index.js';

// Declaring require as any to avoid any TS compiler warnings
declare const require: any;

const net = require('node:net');

// Mock Socket for Discord RPC
class MockSocket extends EventEmitter {
  public destroyed = false;
  public failNextWrite = false;
  public writtenPackets: Array<{ opcode: number; payload: any }> = [];

  public write(data: Buffer): boolean {
    if (this.destroyed) return false;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return false;
    }

    try {
      if (data.length >= 8) {
        const opcode = data.readInt32LE(0);
        const length = data.readInt32LE(4);
        const payloadBuffer = data.subarray(8, 8 + length);
        const payloadStr = payloadBuffer.toString('utf-8');
        const payload = JSON.parse(payloadStr);
        this.writtenPackets.push({ opcode, payload });
      }
    } catch {
      // Ignore parse errors
    }
    return true;
  }

  public destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

describe('Presence Flow Integration Tests', () => {
  let originalCreateConnection: any;
  let mockSocket: MockSocket;
  let ExtensionMessageHandler: any;
  let PresenceManager: any;
  let PresenceMapper: any;

  before(() => {
    originalCreateConnection = net.createConnection;

    // Load the desktop compiled modules at runtime to avoid tsc rootDir errors
    const handlerPath = '../../../../apps/desktop/dist/server/message.handler.js';
    const managerPath = '../../../../apps/desktop/dist/presence/presence.manager.js';
    const mapperPath = '../../../../apps/desktop/dist/presence/presence.mapper.js';

    ExtensionMessageHandler = require(handlerPath).ExtensionMessageHandler;
    PresenceManager = require(managerPath).PresenceManager;
    PresenceMapper = require(mapperPath).PresenceMapper;
  });

  after(() => {
    net.createConnection = originalCreateConnection;
  });

  beforeEach(() => {
    mockSocket = new MockSocket();
    net.createConnection = () => {
      process.nextTick(() => {
        mockSocket.emit('connect');
      });
      return mockSocket as any;
    };
  });

  it('should process TRACK_UPDATE message, sanitize URLs, and update Discord presence metadata', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, {
      clientId: '123456789012345678',
    });

    const initialized = await manager.initialize();
    assert.strictEqual(initialized, true, 'PresenceManager should initialize successfully');

    // 1. Verify handshake package was sent
    assert.ok(mockSocket.writtenPackets.length >= 1, 'Should have sent at least one packet');
    const handshakePacket = mockSocket.writtenPackets[0];
    assert.strictEqual(handshakePacket.opcode, 0, 'Opcode 0 is expected for handshake');
    assert.strictEqual(handshakePacket.payload.client_id, '123456789012345678');

    // Reset packets log to verify next messages specifically
    mockSocket.writtenPackets = [];

    // 2. Simulate TRACK_UPDATE message
    const trackUpdateMessage = {
      type: 'TRACK_UPDATE',
      payload: {
        title: 'Synthwave Dreams',
        artist: 'Wave Artist',
        url: 'https://soundcloud.com/wave-artist/synthwave-dreams?access_token=secret123&client_secret=topsecret&public_id=9876',
        artwork: 'https://i1.sndcdn.com/artworks-0001.jpg',
        duration: 180000,
        isPlaying: true,
        providerId: 'soundcloud',
      },
    };

    const handled = handler.handleMessage(JSON.stringify(trackUpdateMessage));
    assert.strictEqual(handled, true, 'Handler should handle TRACK_UPDATE message');

    // 3. Verify activity payload sent to Discord
    assert.ok(mockSocket.writtenPackets.length >= 1, 'Should have sent setActivity packet');
    const setActivityPacket = mockSocket.writtenPackets.find(
      (p: any) =>
        p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY' && p.payload.args.activity !== null
    );
    assert.ok(setActivityPacket, 'Should have sent a SET_ACTIVITY command');

    const activity = setActivityPacket.payload.args.activity;
    assert.ok(activity, 'Activity object should be present');
    assert.strictEqual(activity.details, 'Synthwave Dreams');
    assert.strictEqual(activity.state, 'by Wave Artist');

    // Verify sanitized track URL (sensitive query parameters removed)
    assert.ok(activity.buttons && activity.buttons.length === 1);
    const listenButton = activity.buttons[0];
    assert.strictEqual(listenButton.label, 'Listen on Soundcloud');

    const parsedUrl = new URL(listenButton.url);
    assert.strictEqual(
      parsedUrl.searchParams.has('access_token'),
      false,
      'Should strip access_token'
    );
    assert.strictEqual(
      parsedUrl.searchParams.has('client_secret'),
      false,
      'Should strip client_secret'
    );
    assert.strictEqual(
      parsedUrl.searchParams.get('public_id'),
      '9876',
      'Should keep public parameters'
    );

    await manager.shutdown();
  });

  it('should handle PLAYBACK_UPDATE and update presence states and timestamps correctly', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, {
      clientId: '123456789012345678',
    });

    await manager.initialize();

    // Send track update first
    const trackUpdateMessage = {
      type: 'TRACK_UPDATE',
      payload: {
        title: 'Synthwave Dreams',
        artist: 'Wave Artist',
        url: 'https://soundcloud.com/wave-artist/synthwave-dreams',
        artwork: 'https://i1.sndcdn.com/artworks-0001.jpg',
        duration: 180000,
        isPlaying: true,
        providerId: 'soundcloud',
      },
    };
    handler.handleMessage(JSON.stringify(trackUpdateMessage));

    // Clear packets list for clean check
    mockSocket.writtenPackets = [];

    // Send PLAYBACK_UPDATE to pause
    const pauseMessage = {
      type: 'PLAYBACK_UPDATE',
      payload: {
        isPlaying: false,
        playbackState: 'paused',
      },
    };

    const handledPause = handler.handleMessage(JSON.stringify(pauseMessage));
    assert.strictEqual(handledPause, true, 'Handler should handle PLAYBACK_UPDATE message');

    // Verify activity sent is paused
    const pausePacket = mockSocket.writtenPackets.find(
      (p: any) => p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY'
    );
    assert.ok(pausePacket, 'Should have sent activity update for pause');
    const pauseActivity = pausePacket.payload.args.activity;
    assert.strictEqual(pauseActivity.state, 'by Wave Artist (Paused)');
    assert.strictEqual(
      pauseActivity.timestamps,
      undefined,
      'Paused state should not have timestamps'
    );
    assert.strictEqual(pauseActivity.assets.small_image, 'pause_icon');
    assert.strictEqual(pauseActivity.assets.small_text, 'Paused');

    // Clear packets list
    mockSocket.writtenPackets = [];

    // Send PLAYBACK_UPDATE to resume playing
    const playMessage = {
      type: 'PLAYBACK_UPDATE',
      payload: {
        isPlaying: true,
        playbackState: 'playing',
      },
    };

    const handledPlay = handler.handleMessage(JSON.stringify(playMessage));
    assert.strictEqual(handledPlay, true, 'Handler should handle PLAYBACK_UPDATE message to play');

    // Verify activity sent has timestamps and playing asset
    const playPacket = mockSocket.writtenPackets.find(
      (p: any) => p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY'
    );
    assert.ok(playPacket, 'Should have sent activity update for play');
    const playActivity = playPacket.payload.args.activity;
    assert.strictEqual(playActivity.state, 'by Wave Artist');
    assert.ok(
      playActivity.timestamps && typeof playActivity.timestamps.start === 'number',
      'Playing state should have start timestamp'
    );
    assert.strictEqual(playActivity.assets.small_image, 'play_icon');
    assert.strictEqual(playActivity.assets.small_text, 'Playing');

    await manager.shutdown();
  });

  // Phase 2.6D.1 Regression Tests
  it('should suppress duplicate presence updates for identical track state', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '123456789012345678' });
    await manager.initialize();

    mockSocket.writtenPackets = [];

    const trackMsg = {
      type: 'TRACK_UPDATE',
      payload: {
        title: 'Monstercat Track',
        artist: 'Vicetone',
        url: 'https://soundcloud.com/vicetone/monstercat-track',
        isPlaying: true,
        providerId: 'soundcloud',
      },
    };

    // First send
    handler.handleMessage(JSON.stringify(trackMsg));
    await new Promise((r) => setTimeout(r, 10));
    const setActivityPackets1 = mockSocket.writtenPackets.filter(
      (p: any) =>
        p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY' && p.payload.args.activity !== null
    );
    assert.strictEqual(setActivityPackets1.length, 1, 'First update should write to Discord RPC');

    mockSocket.writtenPackets = [];

    // Second send (duplicate)
    handler.handleMessage(JSON.stringify(trackMsg));
    await new Promise((r) => setTimeout(r, 10));
    const setActivityPackets2 = mockSocket.writtenPackets.filter(
      (p: any) =>
        p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY' && p.payload.args.activity !== null
    );
    assert.strictEqual(setActivityPackets2.length, 0, 'Duplicate update should be suppressed');

    await manager.shutdown();
  });

  it('should retry presence update if initial setActivity call fails', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '123456789012345678' });
    await manager.initialize();
    await new Promise((r) => setTimeout(r, 20)); // Ensure connection handshake write completes

    mockSocket.writtenPackets = [];
    mockSocket.failNextWrite = true; // Cause first setActivity write to fail

    const trackMsg = {
      type: 'TRACK_UPDATE',
      payload: {
        title: 'Retry Track',
        artist: 'Retry Artist',
        url: 'https://soundcloud.com/artist/retry-track',
        isPlaying: true,
      },
    };

    // First send - write fails
    handler.handleMessage(JSON.stringify(trackMsg));
    await new Promise((r) => setTimeout(r, 20));

    mockSocket.writtenPackets = [];

    // Second send - should retry because signature was not cached
    handler.handleMessage(JSON.stringify(trackMsg));
    await new Promise((r) => setTimeout(r, 20));

    const setActivityPackets = mockSocket.writtenPackets.filter(
      (p: any) =>
        p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY' && p.payload.args.activity !== null
    );
    assert.strictEqual(
      setActivityPackets.length,
      1,
      'Second attempt should succeed and write to Discord'
    );

    await manager.shutdown();
  });

  it('should suppress duplicate TRACK_CLEAR calls when presence is already cleared', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '123456789012345678' });
    await manager.initialize();
    await new Promise((r) => setTimeout(r, 20));

    // Set presence first
    const trackMsg = {
      type: 'TRACK_UPDATE',
      payload: {
        title: 'Active Track',
        artist: 'Active Artist',
        url: 'https://soundcloud.com/artist/active-track',
        isPlaying: true,
      },
    };
    handler.handleMessage(JSON.stringify(trackMsg));
    await new Promise((r) => setTimeout(r, 20));

    mockSocket.writtenPackets = [];

    // Send first TRACK_CLEAR
    handler.handleMessage(JSON.stringify({ type: 'TRACK_CLEAR' }));
    await new Promise((r) => setTimeout(r, 20));

    const clearPackets1 = mockSocket.writtenPackets.filter(
      (p: any) =>
        p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY' && p.payload.args.activity === null
    );
    assert.strictEqual(clearPackets1.length, 1, 'First TRACK_CLEAR should send clearActivity');

    mockSocket.writtenPackets = [];

    // Send second TRACK_CLEAR (duplicate)
    handler.handleMessage(JSON.stringify({ type: 'TRACK_CLEAR' }));
    await new Promise((r) => setTimeout(r, 20));

    const clearPackets2 = mockSocket.writtenPackets.filter(
      (p: any) =>
        p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY' && p.payload.args.activity === null
    );
    assert.strictEqual(clearPackets2.length, 0, 'Duplicate TRACK_CLEAR should be suppressed');

    await manager.shutdown();
  });

  it('should retry clearActivity if initial clear attempt fails', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '123456789012345678' });
    await manager.initialize();
    await new Promise((r) => setTimeout(r, 20));

    // Set presence first
    const trackMsg = {
      type: 'TRACK_UPDATE',
      payload: {
        title: 'Active Track',
        artist: 'Active Artist',
        url: 'https://soundcloud.com/artist/active-track',
        isPlaying: true,
      },
    };
    handler.handleMessage(JSON.stringify(trackMsg));
    await new Promise((r) => setTimeout(r, 20)); // Ensure initial track setActivity completes

    mockSocket.writtenPackets = [];
    mockSocket.failNextWrite = true; // Cause clearActivity write to fail

    // First TRACK_CLEAR - fails
    handler.handleMessage(JSON.stringify({ type: 'TRACK_CLEAR' }));
    await new Promise((r) => setTimeout(r, 20));

    mockSocket.writtenPackets = [];

    // Second TRACK_CLEAR - should retry because clear failed
    handler.handleMessage(JSON.stringify({ type: 'TRACK_CLEAR' }));
    await new Promise((r) => setTimeout(r, 20));

    const clearPackets = mockSocket.writtenPackets.filter(
      (p: any) =>
        p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY' && p.payload.args.activity === null
    );
    assert.strictEqual(clearPackets.length, 1, 'Second TRACK_CLEAR should succeed');

    await manager.shutdown();
  });

  it('should maintain stable startTimestamp across repeated updates for the same track', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '123456789012345678' });
    await manager.initialize();

    const trackMsg = {
      type: 'TRACK_UPDATE',
      payload: {
        title: 'Stable Track',
        artist: 'Stable Artist',
        url: 'https://soundcloud.com/artist/stable-track',
        isPlaying: true,
        providerId: 'soundcloud',
      },
    };

    handler.handleMessage(JSON.stringify(trackMsg));
    await new Promise((r) => setTimeout(r, 10));

    const firstPacket = mockSocket.writtenPackets.find(
      (p: any) => p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY'
    );
    assert.ok(firstPacket, 'firstPacket should be present');
    const firstStartTimestamp = firstPacket.payload.args.activity.timestamps.start;

    // Send update with updated duration (same track title & url)
    const updatedTrackMsg = {
      type: 'TRACK_UPDATE',
      payload: {
        title: 'Stable Track',
        artist: 'Stable Artist',
        url: 'https://soundcloud.com/artist/stable-track',
        duration: 200000,
        isPlaying: true,
        providerId: 'soundcloud',
      },
    };

    mockSocket.writtenPackets = [];
    handler.handleMessage(JSON.stringify(updatedTrackMsg));
    await new Promise((r) => setTimeout(r, 10));

    const secondPacket = mockSocket.writtenPackets.find(
      (p: any) => p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY'
    );
    assert.ok(secondPacket, 'secondPacket should be present');
    const secondStartTimestamp = secondPacket.payload.args.activity.timestamps.start;

    assert.strictEqual(
      firstStartTimestamp,
      secondStartTimestamp,
      'Start timestamp must remain stable for the same playing track'
    );

    await manager.shutdown();
  });

  it('should handle missing artwork without producing fake default_music key', () => {
    for (const artworkValue of [undefined, '']) {
      const track = {
        title: 'No Artwork Track',
        artist: 'No Artwork Artist',
        url: 'https://soundcloud.com/artist/no-artwork',
        artwork: artworkValue,
        isPlaying: true,
      };

      const activity = PresenceMapper.mapTrackToActivity(track, 'playing', 'SoundCloud');
      assert.ok(activity);
      assert.strictEqual(activity.details, 'No Artwork Track');
      assert.strictEqual(activity.state, 'by No Artwork Artist');
      assert.strictEqual(
        activity.assets?.large_image,
        undefined,
        'large_image should be undefined when artwork is missing or empty'
      );
      assert.notStrictEqual(
        activity.assets?.large_image,
        'default_music',
        'should not produce fake default_music image'
      );
      assert.strictEqual(
        activity.assets?.large_text,
        undefined,
        'large_text should be undefined when artwork is missing or empty'
      );
      assert.strictEqual(activity.assets?.small_image, 'play_icon');
    }
  });

  it('should truncate details and state to max 128 characters without throwing', () => {
    const longTitle = 'A'.repeat(200);
    const longArtist = 'B'.repeat(200);
    const track = {
      title: longTitle,
      artist: longArtist,
      url: 'https://soundcloud.com/artist/long-track',
      isPlaying: true,
    };

    const activity = PresenceMapper.mapTrackToActivity(track, 'playing', 'SoundCloud');
    assert.ok(activity);
    assert.ok(
      activity.details.length <= 128,
      `details length ${activity.details.length} should be <= 128`
    );
    assert.ok(
      activity.state.length <= 128,
      `state length ${activity.state.length} should be <= 128`
    );
  });

  it('should omit Listen button when track URL is missing or empty', () => {
    for (const urlValue of [undefined, '']) {
      const trackNoUrl = {
        title: 'Track Without URL',
        artist: 'Artist',
        url: urlValue as any,
        isPlaying: true,
      };

      const activity = PresenceMapper.mapTrackToActivity(trackNoUrl, 'playing', 'SoundCloud');
      assert.ok(activity);
      assert.strictEqual(
        activity.buttons,
        undefined,
        'buttons should be undefined when URL is missing or empty'
      );
      const emptyUrlButton = activity.buttons?.find((b: any) => b.url === '');
      assert.strictEqual(emptyUrlButton, undefined, 'no button with url: "" should exist');
    }
  });
});
