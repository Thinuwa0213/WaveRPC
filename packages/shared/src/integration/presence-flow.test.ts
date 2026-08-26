import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { TypedEventEmitter, Logger } from '../index.js';

// Declaring require as any to avoid any TS compiler warnings
declare const require: any;

const net = require('node:net');

// Mock Socket for Discord RPC
class MockSocket extends EventEmitter {
  public destroyed = false;
  public failNextWrite = false;
  public writtenPackets: Array<{ opcode: number; payload: any }> = [];
  public autoReply = true;

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

        if (this.autoReply && opcode === 1 && payload.nonce) {
          process.nextTick(() => {
            const responsePayload = {
              cmd: payload.cmd,
              evt: null,
              nonce: payload.nonce,
              data: {},
            };
            const responseJson = JSON.stringify(responsePayload);
            const responseData = Buffer.from(responseJson, 'utf-8');
            const responseHeader = Buffer.alloc(8);
            responseHeader.writeInt32LE(1, 0);
            responseHeader.writeInt32LE(responseData.length, 4);
            const responsePacket = Buffer.concat([responseHeader, responseData]);
            this.emit('data', responsePacket);
          });
        }
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
      clientId: '999999999999999999',
    });

    const initialized = await manager.initialize();
    assert.strictEqual(initialized, true, 'PresenceManager should initialize successfully');

    // 1. Verify handshake package was sent
    assert.ok(mockSocket.writtenPackets.length >= 1, 'Should have sent at least one packet');
    const handshakePacket = mockSocket.writtenPackets[0];
    assert.strictEqual(handshakePacket.opcode, 0, 'Opcode 0 is expected for handshake');
    assert.strictEqual(handshakePacket.payload.client_id, '999999999999999999');

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
    assert.strictEqual(activity.state, 'Wave Artist');
    assert.strictEqual(activity.type, 2);

    // Verify sanitized track URL (sensitive query parameters removed)
    assert.ok(activity.buttons && activity.buttons.length === 1);
    const listenButton = activity.buttons[0];
    assert.strictEqual(listenButton.label, 'Listen on SoundCloud');

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
      clientId: '999999999999999999',
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
    assert.strictEqual(pauseActivity.state, 'Wave Artist • Paused');
    assert.strictEqual(
      pauseActivity.timestamps,
      undefined,
      'Paused state should not have timestamps'
    );
    assert.deepStrictEqual(pauseActivity.assets, {
      large_image: 'https://i1.sndcdn.com/artworks-0001.jpg',
      large_text: 'SoundCloud',
    });

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
    assert.strictEqual(playActivity.state, 'Wave Artist');
    assert.ok(
      playActivity.timestamps && typeof playActivity.timestamps.start === 'number',
      'Playing state should have start timestamp'
    );
    assert.strictEqual(playActivity.assets?.small_image, undefined);
    assert.strictEqual(playActivity.assets?.small_text, undefined);

    await manager.shutdown();
  });

  // Phase 2.6D.1 Regression Tests
  it('should suppress duplicate presence updates for identical track state', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
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
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
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
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
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
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
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
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
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
      assert.strictEqual(activity.state, 'No Artwork Artist');
      assert.strictEqual(
        activity.assets,
        undefined,
        'assets should be undefined when artwork is missing or empty'
      );
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

  it('should calculate timestamps using playbackPosition correctly', () => {
    const track = {
      title: 'Position Track',
      artist: 'Position Artist',
      url: 'https://soundcloud.com/artist/position',
      duration: 180000,
      isPlaying: true,
      playbackPosition: 45000,
    };

    const startTime = 1000000;
    const activity = PresenceMapper.mapTrackToActivity(track, 'playing', 'SoundCloud', startTime);
    assert.ok(activity);
    assert.ok(activity.timestamps);
    assert.strictEqual(activity.timestamps.start, startTime - 45000);
    assert.strictEqual(activity.timestamps.end, startTime - 45000 + 180000);
  });

  it('should omit Listen button when track URL is invalid', () => {
    const track = {
      title: 'Invalid URL Track',
      artist: 'Artist',
      url: 'ftp://invalid-url.com',
      isPlaying: true,
    };

    const activity = PresenceMapper.mapTrackToActivity(track, 'playing', 'SoundCloud');
    assert.ok(activity);
    assert.strictEqual(activity.buttons, undefined);
  });

  it('matching SET_ACTIVITY ACK resolves true', async () => {
    const events = new TypedEventEmitter();
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    const track = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/artist/a',
      isPlaying: true,
    };
    const success = await (manager as any).rpcClient.setActivity(track);
    assert.strictEqual(success, true, 'setActivity should resolve true on successful ACK');
    await manager.shutdown();
  });

  it('unrelated DISPATCH frame does not resolve request', async () => {
    const events = new TypedEventEmitter();
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    mockSocket.autoReply = false;

    const track = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/artist/a',
      isPlaying: true,
    };

    const promise = (manager as any).rpcClient.setActivity(track);

    // Write unrelated DISPATCH frame
    const dispatchPayload = {
      cmd: 'DISPATCH',
      evt: 'READY',
      nonce: null,
      data: {},
    };
    const responseJson = JSON.stringify(dispatchPayload);
    const responseData = Buffer.from(responseJson, 'utf-8');
    const responseHeader = Buffer.alloc(8);
    responseHeader.writeInt32LE(1, 0);
    responseHeader.writeInt32LE(responseData.length, 4);
    const responsePacket = Buffer.concat([responseHeader, responseData]);

    mockSocket.emit('data', responsePacket);

    let settled = false;
    promise.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(settled, false, 'unrelated DISPATCH frame should not resolve the promise');

    // Now send the correct ACK to resolve it
    const lastWrite = mockSocket.writtenPackets[mockSocket.writtenPackets.length - 1];
    const nonce = lastWrite.payload.nonce;
    const ackPayload = {
      cmd: 'SET_ACTIVITY',
      evt: null,
      nonce: nonce,
      data: {},
    };
    const ackJson = JSON.stringify(ackPayload);
    const ackData = Buffer.from(ackJson, 'utf-8');
    const ackHeader = Buffer.alloc(8);
    ackHeader.writeInt32LE(1, 0);
    ackHeader.writeInt32LE(ackData.length, 4);
    const ackPacket = Buffer.concat([ackHeader, ackData]);
    mockSocket.emit('data', ackPacket);

    const success = await promise;
    assert.strictEqual(success, true, 'matching SET_ACTIVITY ACK should resolve the promise');

    await manager.shutdown();
  });

  it('Discord error ACK resolves false', async () => {
    const events = new TypedEventEmitter();
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    mockSocket.autoReply = false;

    const track = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/artist/a',
      isPlaying: true,
    };

    const promise = (manager as any).rpcClient.setActivity(track);

    const lastWrite = mockSocket.writtenPackets[mockSocket.writtenPackets.length - 1];
    const nonce = lastWrite.payload.nonce;
    const errorPayload = {
      cmd: 'SET_ACTIVITY',
      evt: 'ERROR',
      nonce: nonce,
      data: {
        code: 4000,
        message: 'Invalid Client ID',
      },
    };
    const errorJson = JSON.stringify(errorPayload);
    const errorData = Buffer.from(errorJson, 'utf-8');
    const errorHeader = Buffer.alloc(8);
    errorHeader.writeInt32LE(1, 0);
    errorHeader.writeInt32LE(errorData.length, 4);
    const errorPacket = Buffer.concat([errorHeader, errorData]);
    mockSocket.emit('data', errorPacket);

    const success = await promise;
    assert.strictEqual(success, false, 'Discord error ACK should resolve false');

    await manager.shutdown();
  });

  it('timeout resolves false', async () => {
    const { mock } = require('node:test');
    mock.timers.enable();
    try {
      const events = new TypedEventEmitter();
      const manager = new PresenceManager(events, { clientId: '999999999999999999' });
      await manager.initialize();

      mockSocket.autoReply = false;

      const track = {
        title: 'Track A',
        artist: 'Artist A',
        url: 'https://soundcloud.com/artist/a',
        isPlaying: true,
      };

      const promise = (manager as any).rpcClient.setActivity(track);

      // Advance timers by 5000ms
      mock.timers.tick(5000);

      const success = await promise;
      assert.strictEqual(success, false, 'command should resolve false on timeout');

      await manager.shutdown();
    } finally {
      mock.timers.reset();
    }
  });

  it('socket disconnect resolves pending requests false', async () => {
    const events = new TypedEventEmitter();
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    mockSocket.autoReply = false;

    const track = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/artist/a',
      isPlaying: true,
    };

    const promise = (manager as any).rpcClient.setActivity(track);

    // Simulate socket disconnect
    mockSocket.destroy();

    const success = await promise;
    assert.strictEqual(success, false, 'disconnect should resolve pending requests false');

    await manager.shutdown();
  });

  it('partial frame parsing', async () => {
    const events = new TypedEventEmitter();
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    mockSocket.autoReply = false;

    const track = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/artist/a',
      isPlaying: true,
    };

    const promise = (manager as any).rpcClient.setActivity(track);
    const lastWrite = mockSocket.writtenPackets[mockSocket.writtenPackets.length - 1];
    const nonce = lastWrite.payload.nonce;

    const responsePayload = {
      cmd: 'SET_ACTIVITY',
      evt: null,
      nonce: nonce,
      data: {},
    };
    const responseJson = JSON.stringify(responsePayload);
    const responseData = Buffer.from(responseJson, 'utf-8');
    const responseHeader = Buffer.alloc(8);
    responseHeader.writeInt32LE(1, 0);
    responseHeader.writeInt32LE(responseData.length, 4);
    const responsePacket = Buffer.concat([responseHeader, responseData]);

    // Send first 4 bytes of header
    mockSocket.emit('data', responsePacket.subarray(0, 4));
    // Send next 8 bytes
    mockSocket.emit('data', responsePacket.subarray(4, 12));
    // Send the remainder
    mockSocket.emit('data', responsePacket.subarray(12));

    const success = await promise;
    assert.strictEqual(
      success,
      true,
      'partial frame parsing should successfully reconstruct the frame'
    );

    await manager.shutdown();
  });

  it('multiple frames in one chunk', async () => {
    const events = new TypedEventEmitter();
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    mockSocket.autoReply = false;

    const track = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/artist/a',
      isPlaying: true,
    };

    const promise = (manager as any).rpcClient.setActivity(track);
    const lastWrite = mockSocket.writtenPackets[mockSocket.writtenPackets.length - 1];
    const nonce = lastWrite.payload.nonce;

    // Create frame 1 (unrelated)
    const unrelatedPayload = {
      cmd: 'DISPATCH',
      evt: 'READY',
      nonce: null,
      data: {},
    };
    const unrelatedJson = JSON.stringify(unrelatedPayload);
    const unrelatedData = Buffer.from(unrelatedJson, 'utf-8');
    const unrelatedHeader = Buffer.alloc(8);
    unrelatedHeader.writeInt32LE(1, 0);
    unrelatedHeader.writeInt32LE(unrelatedData.length, 4);
    const unrelatedPacket = Buffer.concat([unrelatedHeader, unrelatedData]);

    // Create frame 2 (matching ACK)
    const responsePayload = {
      cmd: 'SET_ACTIVITY',
      evt: null,
      nonce: nonce,
      data: {},
    };
    const responseJson = JSON.stringify(responsePayload);
    const responseData = Buffer.from(responseJson, 'utf-8');
    const responseHeader = Buffer.alloc(8);
    responseHeader.writeInt32LE(1, 0);
    responseHeader.writeInt32LE(responseData.length, 4);
    const responsePacket = Buffer.concat([responseHeader, responseData]);

    // Send both concatenated
    mockSocket.emit('data', Buffer.concat([unrelatedPacket, responsePacket]));

    const success = await promise;
    assert.strictEqual(success, true, 'multiple frames in one chunk should be parsed successfully');

    await manager.shutdown();
  });

  it('malformed/excessive payload guard', async () => {
    const events = new TypedEventEmitter();
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    // Create an invalid header with excessive length (20MB)
    const header = Buffer.alloc(8);
    header.writeInt32LE(1, 0);
    header.writeInt32LE(20 * 1024 * 1024, 4);

    mockSocket.emit('data', header);

    // Verify buffer was discarded/cleared and client did not crash
    assert.strictEqual(
      (manager as any).rpcClient.buffer.length,
      0,
      'excessive payload length should clear the buffer'
    );

    await manager.shutdown();
  });

  it('active track -> clear sends exactly one clear', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    mockSocket.writtenPackets = [];

    // Send active track
    handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Track A',
          artist: 'Artist A',
          url: 'https://soundcloud.com/artist/a',
          isPlaying: true,
          providerId: 'soundcloud',
        },
      })
    );
    await new Promise((r) => setTimeout(r, 20));

    mockSocket.writtenPackets = [];

    // Clear track
    handler.handleMessage(JSON.stringify({ type: 'TRACK_CLEAR' }));
    await new Promise((r) => setTimeout(r, 20));

    const clears = mockSocket.writtenPackets.filter(
      (p: any) =>
        p.opcode === 1 && p.payload.cmd === 'SET_ACTIVITY' && p.payload.args.activity === null
    );
    assert.strictEqual(clears.length, 1, 'should send exactly one clear command');

    await manager.shutdown();
  });

  it('repeated clear after successful clear is skipped', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    // Send active track
    handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Track A',
          artist: 'Artist A',
          url: 'https://soundcloud.com/artist/a',
          isPlaying: true,
          providerId: 'soundcloud',
        },
      })
    );
    await new Promise((r) => setTimeout(r, 20));

    // Send first clear
    mockSocket.writtenPackets = [];
    handler.handleMessage(JSON.stringify({ type: 'TRACK_CLEAR' }));
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(
      mockSocket.writtenPackets.filter((p: any) => p.payload.args.activity === null).length,
      1
    );

    // Send second clear
    mockSocket.writtenPackets = [];
    handler.handleMessage(JSON.stringify({ type: 'TRACK_CLEAR' }));
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(
      mockSocket.writtenPackets.filter((p: any) => p.payload.args.activity === null).length,
      0,
      'second clear should be skipped'
    );

    await manager.shutdown();
  });

  it('track A -> clear -> track B race leaves B active', async () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    // Set Track A
    handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Track A',
          artist: 'Artist A',
          url: 'https://soundcloud.com/artist/a',
          isPlaying: true,
          providerId: 'soundcloud',
        },
      })
    );
    await new Promise((r) => setTimeout(r, 20));

    mockSocket.autoReply = false;
    mockSocket.writtenPackets = [];

    // Send clear command
    handler.handleMessage(JSON.stringify({ type: 'TRACK_CLEAR' }));

    // Immediately send Track B update
    handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Track B',
          artist: 'Artist B',
          url: 'https://soundcloud.com/artist/b',
          isPlaying: true,
          providerId: 'soundcloud',
        },
      })
    );

    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(mockSocket.writtenPackets.length, 2);
    const clearNonce = mockSocket.writtenPackets[0].payload.nonce;
    const trackBNonce = mockSocket.writtenPackets[1].payload.nonce;

    // Send ACK for Track B first
    const ackB = { cmd: 'SET_ACTIVITY', evt: null, nonce: trackBNonce, data: {} };
    const ackBJson = JSON.stringify(ackB);
    const ackBData = Buffer.from(ackBJson, 'utf-8');
    const ackBHeader = Buffer.alloc(8);
    ackBHeader.writeInt32LE(1, 0);
    ackBHeader.writeInt32LE(ackBData.length, 4);
    mockSocket.emit('data', Buffer.concat([ackBHeader, ackBData]));

    // Send ACK for CLEAR command
    const ackClear = { cmd: 'SET_ACTIVITY', evt: null, nonce: clearNonce, data: {} };
    const ackClearJson = JSON.stringify(ackClear);
    const ackClearData = Buffer.from(ackClearJson, 'utf-8');
    const ackClearHeader = Buffer.alloc(8);
    ackClearHeader.writeInt32LE(1, 0);
    ackClearHeader.writeInt32LE(ackClearData.length, 4);
    mockSocket.emit('data', Buffer.concat([ackClearHeader, ackClearData]));

    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(
      (manager as any).presenceState,
      'ACTIVE',
      'final presenceState must be ACTIVE'
    );
    assert.strictEqual(
      (manager as any).activeActivity.details,
      'Track B',
      'final activity details must be Track B'
    );

    await manager.shutdown();
  });

  it('reconnect resets confirmed remote state safely', async () => {
    const events = new TypedEventEmitter();
    const manager = new PresenceManager(events, { clientId: '999999999999999999' });
    await manager.initialize();

    // Set presence first via track:changed event
    events.emit('track:changed', {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/artist/a',
      isPlaying: true,
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual((manager as any).presenceState, 'ACTIVE');

    // Simulate disconnect
    mockSocket.emit('close');
    assert.strictEqual(
      (manager as any).presenceState,
      'UNKNOWN',
      'state must reset to UNKNOWN on disconnect'
    );

    await manager.shutdown();
  });

  it('PING has no info-level noise', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const originalInfo = Logger.prototype.info;
    let infoLogged = false;
    Logger.prototype.info = () => {
      infoLogged = true;
    };
    try {
      handler.handleMessage(JSON.stringify({ type: 'PING' }));
      assert.strictEqual(infoLogged, false, 'PING should not produce info-level logs');
    } finally {
      Logger.prototype.info = originalInfo;
    }
  });
});
