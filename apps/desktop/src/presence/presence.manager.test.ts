import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { TypedEventEmitter } from '@waverpc/shared';
import { PresenceManager } from './presence.manager.js';
import { PresenceMapper } from './presence.mapper.js';
import { WaveRPCWebSocketServer } from '../server/websocket.server.js';
import { WaveRPCDesktopApp } from '../main/index.js';

async function flushMicrotasks(count = 15): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise((r) => queueMicrotask(() => r(undefined)));
  }
}

describe('PresenceManager & Timing Restoration Tests', () => {
  beforeEach(() => {
    mock.timers.enable({ now: Date.now(), apis: ['Date', 'setTimeout', 'setInterval'] });
  });

  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
  });

  it('1. latest track and playbackPosition wins during handshake, and READY restores it once', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '123' });
    const rpcClient = (pm as any).rpcClient;

    let setActivityCount = 0;
    let lastActivity: any = null;
    mock.method(rpcClient, 'setActivity', async (act: any) => {
      setActivityCount++;
      lastActivity = act;
      return true;
    });

    assert.strictEqual(pm.isConnected(), false);

    events.emit('track:changed', {
      title: 'Track A',
      artist: 'Artist A',
      url: 'urlA',
      isPlaying: true,
      playbackPosition: 1000,
      duration: 10000,
    });
    await flushMicrotasks();

    assert.strictEqual(setActivityCount, 0, 'No activity sent while not connected/ready');

    events.emit('track:changed', {
      title: 'Track B',
      artist: 'Artist B',
      url: 'urlB',
      isPlaying: true,
      playbackPosition: 5000,
      duration: 20000,
    });
    await flushMicrotasks();

    assert.strictEqual(setActivityCount, 0, 'No activity sent while still unready');

    (rpcClient as any).state = 'READY';
    const onStateChangeHandler = (rpcClient as any).onStateChange;
    onStateChangeHandler('READY');
    await flushMicrotasks();

    assert.strictEqual(setActivityCount, 1, 'Restored presence exactly once on READY');
    assert.strictEqual(lastActivity.details, 'Track B', 'Restored the latest track');
    assert.strictEqual(lastActivity.state, 'Artist B');
  });

  it('2. timing stability: track change resets logicalStartTime, normal drift does not spam, seek triggers update', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '123' });
    const rpcClient = (pm as any).rpcClient;

    (rpcClient as any).state = 'READY';

    let setActivityCount = 0;
    let lastActivity: any = null;
    mock.method(rpcClient, 'setActivity', async (act: any) => {
      setActivityCount++;
      lastActivity = act;
      return true;
    });

    events.emit('track:changed', {
      title: 'Track A',
      artist: 'Artist A',
      url: 'urlA',
      isPlaying: true,
      playbackPosition: 5000,
      duration: 60000,
    });
    await flushMicrotasks();

    assert.strictEqual(setActivityCount, 1);
    const initialStart = lastActivity.timestamps.start;

    events.emit('track:changed', {
      title: 'Track A',
      artist: 'Artist A',
      url: 'urlA',
      isPlaying: true,
      playbackPosition: 5500,
      duration: 60000,
    });
    await flushMicrotasks();

    assert.strictEqual(setActivityCount, 1, 'No new activity sent for small drift');

    events.emit('track:changed', {
      title: 'Track A',
      artist: 'Artist A',
      url: 'urlA',
      isPlaying: true,
      playbackPosition: 20000,
      duration: 60000,
    });
    await flushMicrotasks();

    assert.strictEqual(setActivityCount, 2, 'Seek triggers new activity update');
    assert.notStrictEqual(
      lastActivity.timestamps.start,
      initialStart,
      'Seek resets start timestamp'
    );

    events.emit('track:changed', {
      title: 'Track B',
      artist: 'Artist B',
      url: 'urlB',
      isPlaying: true,
      playbackPosition: 5000,
      duration: 20000,
    });
    await flushMicrotasks();

    assert.strictEqual(setActivityCount, 3, 'Track identity change resets and updates');
    assert.strictEqual(lastActivity.details, 'Track B');
  });

  it('4. duplicate REQUEST_STATE triggers are coalesced in WaveRPCDesktopApp, and broadcast filters OPEN sockets only', async () => {
    const wssMock = {
      clients: new Set<any>(),
      isStopping: false,
    };
    const wsServer = new WaveRPCWebSocketServer(new TypedEventEmitter());
    (wsServer as any).wss = wssMock;
    (wsServer as any).clients = wssMock.clients;

    let sentCount = 0;
    const openSocket = {
      readyState: 1, // OPEN
      send: () => {
        sentCount++;
      },
    };
    const closedSocket = {
      readyState: 3, // CLOSED
      send: () => {
        sentCount++;
      },
    };

    wssMock.clients.add(openSocket);
    wssMock.clients.add(closedSocket);

    wsServer.broadcast({ type: 'TEST' });
    assert.strictEqual(sentCount, 1, 'Only OPEN socket should receive broadcast');

    const app = new WaveRPCDesktopApp();
    (app as any).wsServer = {
      start: async () => true,
      stop: async () => {},
      broadcast: mock.fn(),
    };
    (app as any).discordService.connect = async () => true;
    (app as any).discordService.disconnect = async () => {};

    await app.bootstrap();

    const appEvents = app.getEvents();
    appEvents.emit('discord:connected');
    appEvents.emit('discord:connected');

    assert.strictEqual(
      (app as any).wsServer.broadcast.mock.callCount(),
      1,
      'Duplicate request state triggers should be coalesced'
    );
  });

  it('5. shutdown prevents restore', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '123' });
    const rpcClient = (pm as any).rpcClient;

    let setActivityCount = 0;
    mock.method(rpcClient, 'setActivity', async () => {
      setActivityCount++;
      return true;
    });
    mock.method(rpcClient, 'clearActivity', async () => true);

    events.emit('track:changed', {
      title: 'Track A',
      artist: 'Artist A',
      url: 'urlA',
      isPlaying: true,
      playbackPosition: 1000,
    });
    await flushMicrotasks();

    await pm.shutdown();

    const onStateChangeHandler = (rpcClient as any).onStateChange;
    onStateChangeHandler('READY');
    await flushMicrotasks();

    assert.strictEqual(setActivityCount, 0, 'No presence update should occur after shutdown');
  });

  it('6. second conversion boundary regression: ensure timestamps are not divided by 1000 twice', () => {
    const track = {
      title: 'Regression Track',
      artist: 'Artist',
      url: 'https://soundcloud.com/artist/regression',
      playbackPosition: 45000,
      duration: 180000,
      isPlaying: true,
    };
    const startTime = Date.now();
    const activity = PresenceMapper.mapTrackToActivity(track, 'playing', 'SoundCloud', startTime);
    assert.ok(activity);
    assert.ok(activity.timestamps);

    const expectedStartSec = Math.floor((startTime - 45000) / 1000);
    const expectedEndSec = Math.floor((startTime - 45000 + 180000) / 1000);

    assert.strictEqual(
      activity.timestamps.start,
      expectedStartSec,
      'Should be converted to seconds'
    );
    assert.strictEqual(activity.timestamps.end, expectedEndSec, 'Should be converted to seconds');

    assert.ok(
      activity.timestamps.start > 1000000,
      'Start timestamp must be a valid epoch seconds timestamp'
    );
  });

  it('7. duration temporarily unavailable then becomes valid preserves start timestamp', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '123' });
    const rpcClient = (pm as any).rpcClient;
    (rpcClient as any).state = 'READY';

    let lastActivity: any = null;
    mock.method(rpcClient, 'setActivity', async (act: any) => {
      lastActivity = act;
      return true;
    });

    events.emit('track:changed', {
      title: 'Duration Track',
      artist: 'Artist',
      url: 'url',
      isPlaying: true,
      playbackPosition: 1000,
      duration: undefined,
    });
    await flushMicrotasks();

    assert.ok(lastActivity.timestamps);
    assert.ok(lastActivity.timestamps.start);
    assert.strictEqual(lastActivity.timestamps.end, undefined);
    const initialStart = lastActivity.timestamps.start;

    // Provide valid duration now
    events.emit('track:changed', {
      title: 'Duration Track',
      artist: 'Artist',
      url: 'url',
      isPlaying: true,
      playbackPosition: 1050, // very small normal progression
      duration: 20000,
    });
    await flushMicrotasks();

    assert.strictEqual(
      lastActivity.timestamps.start,
      initialStart,
      'Start timestamp must not reset'
    );
    assert.ok(lastActivity.timestamps.end, 'End timestamp must be set');
  });

  it('8. canonical URL identity survives cosmetic title/artist changes', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '123' });
    const rpcClient = (pm as any).rpcClient;
    (rpcClient as any).state = 'READY';

    let lastActivity: any = null;
    mock.method(rpcClient, 'setActivity', async (act: any) => {
      lastActivity = act;
      return true;
    });

    events.emit('track:changed', {
      title: 'Stable Track',
      artist: 'Stable Artist',
      url: 'https://soundcloud.com/artist/stable-track?in=playlist',
      isPlaying: true,
      playbackPosition: 1000,
    });
    await flushMicrotasks();

    const initialStart = lastActivity.timestamps.start;

    events.emit('track:changed', {
      title: '   stable track   ', // cosmetic spaces and casing
      artist: 'STABLE ARTIST',
      url: 'https://soundcloud.com/artist/stable-track', // url search stripped matches canonical url
      isPlaying: true,
      playbackPosition: 1050, // normal progression
    });
    await flushMicrotasks();

    assert.strictEqual(
      lastActivity.timestamps.start,
      initialStart,
      'Start timestamp must survive cosmetic changes'
    );
  });

  it('9. two genuinely different tracks are never merged by normalization', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '123' });
    const rpcClient = (pm as any).rpcClient;
    (rpcClient as any).state = 'READY';

    let lastActivity: any = null;
    mock.method(rpcClient, 'setActivity', async (act: any) => {
      lastActivity = act;
      return true;
    });

    events.emit('track:changed', {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/artist/track-a',
      isPlaying: true,
      playbackPosition: 1000,
    });
    await flushMicrotasks();

    const initialStart = lastActivity.timestamps.start;

    // Advance mock timers to ensure Date.now() differs
    mock.timers.tick(2000);

    events.emit('track:changed', {
      title: 'Track B',
      artist: 'Artist B',
      url: 'https://soundcloud.com/artist/track-b',
      isPlaying: true,
      playbackPosition: 1000,
    });
    await flushMicrotasks();

    assert.notStrictEqual(
      lastActivity.timestamps.start,
      initialStart,
      'Start timestamp must change for different tracks'
    );
  });

  it('10. seek detection: forward and backward seek reset logicalStartTime', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '123' });
    const rpcClient = (pm as any).rpcClient;
    (rpcClient as any).state = 'READY';

    let lastActivity: any = null;
    mock.method(rpcClient, 'setActivity', async (act: any) => {
      lastActivity = act;
      return true;
    });

    events.emit('track:changed', {
      title: 'Seek Track',
      artist: 'Artist',
      url: 'url',
      isPlaying: true,
      playbackPosition: 5000,
    });
    await flushMicrotasks();

    const initialStart = lastActivity.timestamps.start;

    // Simulate forward seek
    events.emit('track:changed', {
      title: 'Seek Track',
      artist: 'Artist',
      url: 'url',
      isPlaying: true,
      playbackPosition: 25000,
    });
    await flushMicrotasks();

    assert.notStrictEqual(
      lastActivity.timestamps.start,
      initialStart,
      'Forward seek must reset logicalStartTime'
    );
    const afterForwardStart = lastActivity.timestamps.start;

    // Simulate backward seek
    events.emit('track:changed', {
      title: 'Seek Track',
      artist: 'Artist',
      url: 'url',
      isPlaying: true,
      playbackPosition: 10000,
    });
    await flushMicrotasks();

    assert.notStrictEqual(
      lastActivity.timestamps.start,
      afterForwardStart,
      'Backward seek must reset logicalStartTime'
    );
  });

  it('11. REQUEST_STATE / Discord reconnect preserves timing', async () => {
    const events = new TypedEventEmitter();
    const pm = new PresenceManager(events, { clientId: '123' });
    const rpcClient = (pm as any).rpcClient;
    (rpcClient as any).state = 'READY';

    let lastActivity: any = null;
    mock.method(rpcClient, 'setActivity', async (act: any) => {
      lastActivity = act;
      return true;
    });

    events.emit('track:changed', {
      title: 'Reconnect Track',
      artist: 'Artist',
      url: 'url',
      isPlaying: true,
      playbackPosition: 5000,
    });
    await flushMicrotasks();

    const initialStart = lastActivity.timestamps.start;

    // Trigger disconnect state transition
    const onStateChangeHandler = (rpcClient as any).onStateChange;
    onStateChangeHandler('DISCONNECTED');
    await flushMicrotasks();

    // Advance time by 2 seconds
    mock.timers.tick(2000);

    // Trigger reconnect
    onStateChangeHandler('READY');
    await flushMicrotasks();

    // Ensure timing is preserved
    assert.strictEqual(
      lastActivity.timestamps.start,
      initialStart,
      'Timing must be preserved across Discord disconnect/reconnect'
    );
  });

  describe('Spotify-Like Pause Behavior & Defensive Baseline Tests', () => {
    it('11. Pause clears Discord activity immediately', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      const rpcClient = (pm as any).rpcClient;
      (rpcClient as any).state = 'READY';

      let lastActivity: any = null;
      let clearCalled = false;
      mock.method(rpcClient, 'setActivity', async (act: any) => {
        lastActivity = act;
        return true;
      });
      mock.method(rpcClient, 'clearActivity', async () => {
        clearCalled = true;
        return true;
      });

      events.emit('track:changed', {
        title: 'Pause Track',
        artist: 'Artist',
        url: 'url',
        isPlaying: true,
        playbackPosition: 10000,
        duration: 300000,
      });
      await flushMicrotasks();
      assert.ok(lastActivity);

      // Transition to paused
      events.emit('track:changed', {
        title: 'Pause Track',
        artist: 'Artist',
        url: 'url',
        isPlaying: false,
        playbackPosition: 15000,
        duration: 300000,
      });
      await flushMicrotasks();

      assert.strictEqual(clearCalled, true, 'clearActivity must be called on pause');
    });

    it('12. Paused track remains in memory and allows seeking without Discord spam', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      const rpcClient = (pm as any).rpcClient;
      (rpcClient as any).state = 'READY';

      let clearCount = 0;
      mock.method(rpcClient, 'setActivity', async () => true);
      mock.method(rpcClient, 'clearActivity', async () => {
        clearCount++;
        return true;
      });

      events.emit('track:changed', {
        title: 'Seek While Paused',
        artist: 'Artist',
        url: 'url',
        isPlaying: true,
        playbackPosition: 10000,
        duration: 300000,
      });
      await flushMicrotasks();

      // Pause
      events.emit('track:changed', {
        title: 'Seek While Paused',
        artist: 'Artist',
        url: 'url',
        isPlaying: false,
        playbackPosition: 15000,
        duration: 300000,
      });
      await flushMicrotasks();
      assert.strictEqual(clearCount, 1);

      // Seek while paused (multiple times)
      events.emit('track:changed', {
        title: 'Seek While Paused',
        artist: 'Artist',
        url: 'url',
        isPlaying: false,
        playbackPosition: 50000,
        duration: 300000,
      });
      await flushMicrotasks();
      assert.strictEqual(clearCount, 1, 'Multiple paused updates must not spam clearActivity');

      const currentTrack = (pm as any).currentTrack;
      assert.strictEqual(
        currentTrack.playbackPosition,
        50000,
        'Internal state must track seek while paused'
      );
    });

    it('13. Resume from pause sends correct new timing and recreates activity', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      const rpcClient = (pm as any).rpcClient;
      (rpcClient as any).state = 'READY';

      let lastActivity: any = null;
      mock.method(rpcClient, 'setActivity', async (act: any) => {
        lastActivity = act;
        return true;
      });
      mock.method(rpcClient, 'clearActivity', async () => true);

      events.emit('track:changed', {
        title: 'Resume Track',
        artist: 'Artist',
        url: 'url',
        isPlaying: true,
        playbackPosition: 10000,
        duration: 300000,
      });
      await flushMicrotasks();

      const initialStart = lastActivity.timestamps.start;

      // Pause and seek
      events.emit('track:changed', {
        title: 'Resume Track',
        artist: 'Artist',
        url: 'url',
        isPlaying: false,
        playbackPosition: 50000, // Seeked to 50s
        duration: 300000,
      });
      await flushMicrotasks();

      // Advance mock timers to simulate pause duration
      mock.timers.tick(10000);

      // Resume
      events.emit('track:changed', {
        title: 'Resume Track',
        artist: 'Artist',
        url: 'url',
        isPlaying: true,
        playbackPosition: 50000,
        duration: 300000,
      });
      await flushMicrotasks();

      assert.notStrictEqual(
        lastActivity.timestamps.start,
        initialStart,
        'Resume from pause must recreate logical timing'
      );

      const expectedNewStart = Math.floor((Date.now() - 50000) / 1000);
      assert.strictEqual(lastActivity.timestamps.start, expectedNewStart);
    });

    it('15. Same position after 8s => STALE_QUANTIZED, not backward seek', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      let setActivityCount = 0;
      mock.method((pm as any).rpcClient, 'setActivity', async () => {
        setActivityCount++;
        return true;
      });

      const initialTime = Date.now();

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 22000,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();
      assert.strictEqual(setActivityCount, 1, 'Initial update');
      const start1 = (pm as any).logicalStartTime;

      // 8 seconds pass
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 22000, // same position
        timingObservedAt: initialTime + 8000,
      });
      await flushMicrotasks();

      // Should be classified as STALE_QUANTIZED. Does NOT re-anchor.
      assert.strictEqual(
        (pm as any).logicalStartTime,
        start1,
        'STALE_QUANTIZED must not re-anchor'
      );
    });

    it('16. Same position after 27s => STALE_QUANTIZED', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      const initialTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 22000,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();
      const start1 = (pm as any).logicalStartTime;

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 22000,
        timingObservedAt: initialTime + 27000,
      });
      await flushMicrotasks();

      assert.strictEqual(
        (pm as any).logicalStartTime,
        start1,
        'STALE_QUANTIZED must not re-anchor even after 27s'
      );
    });

    it('17. +8s position over +8s observation => NORMAL_PROGRESSION', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      const initialTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 22000,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();
      const start1 = (pm as any).logicalStartTime;

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 30000, // +8s
        timingObservedAt: initialTime + 8000, // +8s
      });
      await flushMicrotasks();

      assert.strictEqual(
        (pm as any).logicalStartTime,
        start1,
        'NORMAL_PROGRESSION must not re-anchor'
      );
    });

    it('18. +63s position over +1s observation => FORWARD_SEEK', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      const initialTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 0,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();
      const start1 = (pm as any).logicalStartTime;

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 63000,
        timingObservedAt: initialTime + 1000,
      });
      await flushMicrotasks();

      assert.notStrictEqual((pm as any).logicalStartTime, start1, 'FORWARD_SEEK must re-anchor');
    });

    it('19. 90s -> 30s => BACKWARD_SEEK', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      const initialTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 90000,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();
      const start1 = (pm as any).logicalStartTime;

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 30000,
        timingObservedAt: initialTime + 1000,
      });
      await flushMicrotasks();

      assert.notStrictEqual((pm as any).logicalStartTime, start1, 'BACKWARD_SEEK must re-anchor');
    });

    it('20. out-of-order timingObservedAt ignored for re-anchor', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      const initialTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 90000,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();
      const start1 = (pm as any).logicalStartTime;

      // An out of order packet arrives with an older observedAt
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 30000, // normally backward seek
        timingObservedAt: initialTime - 5000, // out of order!
      });
      await flushMicrotasks();

      assert.strictEqual(
        (pm as any).logicalStartTime,
        start1,
        'OUT_OF_ORDER_IGNORED must not re-anchor'
      );
    });

    it('21. pause -> 10s wait -> resume at same media position excludes paused time', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      const initialTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 30000,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();
      const start1 = (pm as any).logicalStartTime;

      events.emit('playback:stateChanged', 'paused');
      await flushMicrotasks();

      assert.strictEqual((pm as any).logicalStartTime, undefined, 'Pause clears logicalStartTime');

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 30000,
        timingObservedAt: initialTime + 10000, // 10 seconds later
      });
      await flushMicrotasks();

      const newStart = (pm as any).logicalStartTime;
      assert.ok(newStart !== undefined, 'Resume should re-anchor');
      assert.notStrictEqual(
        newStart,
        start1,
        'Resume should not retain the exact old anchor time due to paused duration being excluded'
      );
      assert.strictEqual(
        newStart,
        initialTime + 10000 - 30000,
        'Logical start time must equal observedAt - playbackPosition'
      );
    });

    it('22. Discord READY while paused does not restore presence', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      const rpcClient = (pm as any).rpcClient;

      let setActivityCount = 0;
      mock.method(rpcClient, 'setActivity', async () => {
        setActivityCount++;
        return true;
      });

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: false,
        playbackPosition: 30000,
      });
      await flushMicrotasks();

      (rpcClient as any).state = 'READY';
      const onStateChangeHandler = (rpcClient as any).onStateChange;
      onStateChangeHandler('READY');
      await flushMicrotasks();

      assert.strictEqual(setActivityCount, 0, 'Should not restore presence when PAUSED');
    });

    it('23. new track resets observation state completely', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      const initialTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 90000,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();

      events.emit('track:changed', {
        title: 'Track B',
        artist: 'Artist B',
        url: 'urlB',
        isPlaying: true,
        playbackPosition: 0,
        timingObservedAt: initialTime + 1000,
      });
      await flushMicrotasks();

      assert.strictEqual((pm as any).lastPlaybackPosition, 0, 'New track resets tracking');
      assert.strictEqual((pm as any).lastTrackIdentity, 'Track B|Artist B');
    });

    it('24. TIMINGLESS_PRESERVE: Same track missing timing preserves existing anchor', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      const initialTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 22000,
        timingObservedAt: initialTime,
      });
      await flushMicrotasks();

      const start1 = (pm as any).logicalStartTime;
      assert.ok(start1 !== undefined);

      // Same track, missing timing
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: undefined,
        duration: undefined,
      });
      await flushMicrotasks();

      assert.strictEqual(
        (pm as any).logicalStartTime,
        start1,
        'TIMINGLESS_PRESERVE must retain anchor'
      );
    });

    it('25. TIMINGLESS_WAIT: New playing track with no timing does not anchor Date.now', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: undefined,
        duration: undefined,
      });
      await flushMicrotasks();

      assert.strictEqual(
        (pm as any).logicalStartTime,
        undefined,
        'TIMINGLESS_WAIT must not manufacture fake anchor'
      );
    });

    it('26. TIMING_ACQUIRED: Later timing resolves TIMINGLESS_WAIT', async () => {
      const events = new TypedEventEmitter();
      const pm = new PresenceManager(events, { clientId: '123' });
      (pm as any).rpcClient.state = 'READY';

      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: undefined,
        duration: undefined,
      });
      await flushMicrotasks();

      assert.strictEqual((pm as any).logicalStartTime, undefined);

      const observedTime = Date.now();
      events.emit('track:changed', {
        title: 'Track A',
        artist: 'Artist A',
        url: 'urlA',
        isPlaying: true,
        playbackPosition: 10000,
        timingObservedAt: observedTime,
      });
      await flushMicrotasks();

      assert.strictEqual(
        (pm as any).logicalStartTime,
        observedTime - 10000,
        'TIMING_ACQUIRED must correctly calculate anchor'
      );
    });
  });
});
