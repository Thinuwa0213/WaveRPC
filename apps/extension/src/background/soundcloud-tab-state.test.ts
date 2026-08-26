import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { SoundCloudTabStateManager } from './soundcloud-tab-state.js';
import { ExtensionTrackPayload } from '../websocket/messages.js';

describe('SoundCloudTabStateManager Tests', () => {
  let stateManager: SoundCloudTabStateManager;
  let trackUpdates: ExtensionTrackPayload[];
  let trackClears: number;

  beforeEach(() => {
    trackUpdates = [];
    trackClears = 0;
    stateManager = new SoundCloudTabStateManager({
      onTrackUpdate: (payload) => {
        trackUpdates.push(payload);
      },
      onTrackClear: () => {
        trackClears++;
      },
    });
  });

  it('1. TRACK_UPDATE associates active track with sender tab (playing update claims ownership)', () => {
    const payload: ExtensionTrackPayload = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/track-a',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(1, 'session-1', payload, 'https://soundcloud.com/track-a');

    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    assert.strictEqual(trackUpdates.length, 1);
    assert.deepStrictEqual(trackUpdates[0], payload);
  });

  it('2. Paused update does not steal ownership from playing tab', () => {
    const playingPayload: ExtensionTrackPayload = {
      title: 'Playing Track',
      artist: 'Artist P',
      url: 'https://soundcloud.com/track-p',
      isPlaying: true,
    };

    const pausedPayload: ExtensionTrackPayload = {
      title: 'Paused Track',
      artist: 'Artist Paused',
      url: 'https://soundcloud.com/track-paused',
      isPlaying: false,
    };

    // Tab 1 starts playing
    stateManager.handleTrackUpdate(
      1,
      'session-1',
      playingPayload,
      'https://soundcloud.com/track-p'
    );
    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);

    // Tab 2 sends a paused update
    stateManager.handleTrackUpdate(
      2,
      'session-2',
      pausedPayload,
      'https://soundcloud.com/track-paused'
    );

    // Tab 1 should still own the active playback
    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    assert.strictEqual(trackUpdates.length, 1);
    assert.deepStrictEqual(trackUpdates[0], playingPayload);
  });

  it('3. Non-active tab clear/close does not clear active presence', () => {
    const playingPayload: ExtensionTrackPayload = {
      title: 'Playing Track',
      artist: 'Artist P',
      url: 'https://soundcloud.com/track-p',
      isPlaying: true,
    };

    const pausedPayload: ExtensionTrackPayload = {
      title: 'Paused Track',
      artist: 'Artist Paused',
      url: 'https://soundcloud.com/track-paused',
      isPlaying: false,
    };

    stateManager.handleTrackUpdate(
      1,
      'session-1',
      playingPayload,
      'https://soundcloud.com/track-p'
    );
    stateManager.handleTrackUpdate(
      2,
      'session-2',
      pausedPayload,
      'https://soundcloud.com/track-paused'
    );

    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    trackUpdates = [];

    // Clear non-active tab 2
    stateManager.handleTrackClear(2, 'session-2');

    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    assert.strictEqual(trackUpdates.length, 0);
    assert.strictEqual(trackClears, 0);
  });

  it('4. Active tab close/clear selects playing replacement if available', () => {
    const playingPayload1: ExtensionTrackPayload = {
      title: 'Playing Track 1',
      artist: 'Artist 1',
      url: 'https://soundcloud.com/track-1',
      isPlaying: true,
    };

    const playingPayload2: ExtensionTrackPayload = {
      title: 'Playing Track 2',
      artist: 'Artist 2',
      url: 'https://soundcloud.com/track-2',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(
      1,
      'session-1',
      playingPayload1,
      'https://soundcloud.com/track-1'
    );
    stateManager.handleTrackUpdate(
      2,
      'session-2',
      playingPayload2,
      'https://soundcloud.com/track-2'
    );

    assert.strictEqual(stateManager.getActivePlaybackTabId(), 2);
    trackUpdates = [];

    // Close active tab 2
    stateManager.handleTabRemoved(2);

    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    assert.strictEqual(trackUpdates.length, 1);
    assert.deepStrictEqual(trackUpdates[0], playingPayload1);
    assert.strictEqual(trackClears, 0);
  });

  it('5. Active tab close/clear selects paused replacement if no playing replacement exists', () => {
    const pausedPayload: ExtensionTrackPayload = {
      title: 'Paused Track',
      artist: 'Artist Paused',
      url: 'https://soundcloud.com/track-paused',
      isPlaying: false,
    };

    const playingPayload: ExtensionTrackPayload = {
      title: 'Playing Track',
      artist: 'Artist P',
      url: 'https://soundcloud.com/track-p',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(
      1,
      'session-1',
      pausedPayload,
      'https://soundcloud.com/track-paused'
    );
    stateManager.handleTrackUpdate(
      2,
      'session-2',
      playingPayload,
      'https://soundcloud.com/track-p'
    );

    assert.strictEqual(stateManager.getActivePlaybackTabId(), 2);
    trackUpdates = [];

    // Remove active tab 2
    stateManager.handleTabRemoved(2);

    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    assert.strictEqual(trackUpdates.length, 1);
    assert.deepStrictEqual(trackUpdates[0], pausedPayload);
    assert.strictEqual(trackClears, 0);
  });

  it('6. Active tab close with no replacement emits TRACK_CLEAR once', () => {
    const playingPayload: ExtensionTrackPayload = {
      title: 'Playing Track',
      artist: 'Artist P',
      url: 'https://soundcloud.com/track-p',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(
      1,
      'session-1',
      playingPayload,
      'https://soundcloud.com/track-p'
    );
    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    trackUpdates = [];

    // Remove tab 1
    stateManager.handleTabRemoved(1);

    assert.strictEqual(stateManager.getActivePlaybackTabId(), null);
    assert.strictEqual(trackClears, 1);
    assert.strictEqual(trackUpdates.length, 0);
  });

  it('7. Navigation away behaves like removal', () => {
    const playingPayload: ExtensionTrackPayload = {
      title: 'Playing Track',
      artist: 'Artist P',
      url: 'https://soundcloud.com/track-p',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(
      1,
      'session-1',
      playingPayload,
      'https://soundcloud.com/track-p'
    );
    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);

    // Simulate tab navigation by calling handleTabRemoved
    stateManager.handleTabRemoved(1);

    assert.strictEqual(stateManager.getActivePlaybackTabId(), null);
    assert.strictEqual(trackClears, 1);
  });

  it('8. Duplicate tab removal does not emit duplicate TRACK_CLEAR', () => {
    const playingPayload: ExtensionTrackPayload = {
      title: 'Playing Track',
      artist: 'Artist P',
      url: 'https://soundcloud.com/track-p',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(
      1,
      'session-1',
      playingPayload,
      'https://soundcloud.com/track-p'
    );
    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);
    trackClears = 0;

    // Remove tab 1
    stateManager.handleTabRemoved(1);
    assert.strictEqual(trackClears, 1);

    // Try removing tab 1 again
    stateManager.handleTabRemoved(1);
    assert.strictEqual(trackClears, 1, 'Should not emit duplicate TRACK_CLEAR');
  });

  it('9. Multiple SoundCloud tabs are isolated', () => {
    const payload1: ExtensionTrackPayload = {
      title: 'Track 1',
      artist: 'Artist 1',
      url: 'https://soundcloud.com/track-1',
      isPlaying: false,
    };

    const payload2: ExtensionTrackPayload = {
      title: 'Track 2',
      artist: 'Artist 2',
      url: 'https://soundcloud.com/track-2',
      isPlaying: false,
    };

    stateManager.handleTrackUpdate(1, 'session-1', payload1, 'https://soundcloud.com/track-1');
    stateManager.handleTrackUpdate(2, 'session-2', payload2, 'https://soundcloud.com/track-2');

    const tabs = stateManager.getTabs();
    assert.strictEqual(tabs.size, 2);
    assert.deepStrictEqual(tabs.get(1), payload1);
    assert.deepStrictEqual(tabs.get(2), payload2);
  });

  it('10. No history is persisted', () => {
    const playingPayload: ExtensionTrackPayload = {
      title: 'Playing Track',
      artist: 'Artist P',
      url: 'https://soundcloud.com/track-p',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(
      1,
      'session-1',
      playingPayload,
      'https://soundcloud.com/track-p'
    );
    stateManager.handleTabRemoved(1);

    const tabs = stateManager.getTabs();
    assert.strictEqual(tabs.size, 0);
  });

  // NEW REGRESSION TESTS
  it('11. delayed old-session update after tab close is rejected', () => {
    const payload: ExtensionTrackPayload = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/track-a',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(1, 'session-1', payload, 'https://soundcloud.com/track-a');
    stateManager.handleTabRemoved(1); // Close/remove tab, S1 is tombstoned

    trackUpdates = [];

    // Send delayed update from session-1
    stateManager.handleTrackUpdate(1, 'session-1', payload, 'https://soundcloud.com/track-a');

    assert.strictEqual(trackUpdates.length, 0, 'Should reject late update from tombstoned session');
  });

  it('12. delayed old-session update after navigation is rejected', () => {
    const payload: ExtensionTrackPayload = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/track-a',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(1, 'session-1', payload, 'https://soundcloud.com/track-a');
    stateManager.handleTrackClear(1, 'session-1'); // Document navigation clear, S1 is tombstoned

    trackUpdates = [];

    // Send delayed update from session-1
    stateManager.handleTrackUpdate(1, 'session-1', payload, 'https://soundcloud.com/track-a');

    assert.strictEqual(
      trackUpdates.length,
      0,
      'Should reject late update from navigated-away session'
    );
  });

  it('13. S1 -> S2 same-tab replacement and S1 late update is rejected', () => {
    const payload1: ExtensionTrackPayload = {
      title: 'Track 1',
      artist: 'Artist 1',
      url: 'https://soundcloud.com/track-1',
      isPlaying: true,
    };

    const payload2: ExtensionTrackPayload = {
      title: 'Track 2',
      artist: 'Artist 2',
      url: 'https://soundcloud.com/track-2',
      isPlaying: true,
    };

    // Load session-1 (S1)
    stateManager.handleTrackUpdate(1, 'session-1', payload1, 'https://soundcloud.com/track-1');
    assert.strictEqual(stateManager.getActivePlaybackTabId(), 1);

    // Reload tab 1, starting session-2 (S2)
    stateManager.handleTrackUpdate(1, 'session-2', payload2, 'https://soundcloud.com/track-2');
    assert.strictEqual(trackUpdates.length, 2);
    assert.deepStrictEqual(trackUpdates[1], payload2);

    // Send delayed S1 update
    trackUpdates = [];
    stateManager.handleTrackUpdate(1, 'session-1', payload1, 'https://soundcloud.com/track-1');
    assert.strictEqual(trackUpdates.length, 0, 'Should reject stale S1 message after S2 took over');
  });

  it('14. pause does not invalidate session and resume works', () => {
    const playPayload: ExtensionTrackPayload = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/track-a',
      isPlaying: true,
    };

    const pausePayload: ExtensionTrackPayload = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/track-a',
      isPlaying: false,
    };

    // Play S1
    stateManager.handleTrackUpdate(1, 'session-1', playPayload, 'https://soundcloud.com/track-a');
    assert.strictEqual(trackUpdates.length, 1);

    // Pause S1 (should not invalidate session-1)
    stateManager.handleTrackUpdate(1, 'session-1', pausePayload, 'https://soundcloud.com/track-a');
    assert.strictEqual(trackUpdates.length, 2);
    assert.strictEqual(trackUpdates[1].isPlaying, false);

    // Resume S1 (should work)
    stateManager.handleTrackUpdate(1, 'session-1', playPayload, 'https://soundcloud.com/track-a');
    assert.strictEqual(trackUpdates.length, 3);
    assert.strictEqual(trackUpdates[2].isPlaying, true);
  });

  it('15. duplicate teardown produces one effective clear', () => {
    const payload: ExtensionTrackPayload = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/track-a',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(1, 'session-1', payload, 'https://soundcloud.com/track-a');
    assert.strictEqual(trackClears, 0);

    // Trigger clear via content script clear
    stateManager.handleTrackClear(1, 'session-1');
    assert.strictEqual(trackClears, 1);

    // Trigger clear via onUpdated navigation
    stateManager.handleTabRemoved(1);
    assert.strictEqual(trackClears, 1, 'Should not emit second clear');

    // Trigger clear via onRemoved
    stateManager.handleTabRemoved(1);
    assert.strictEqual(trackClears, 1, 'Should not emit third clear');
  });

  it('16. tombstone collection remains bounded', () => {
    // Generate 300 sessions to exceed bound of 256
    const payload: ExtensionTrackPayload = {
      title: 'Track',
      artist: 'Artist',
      url: 'https://soundcloud.com/track',
      isPlaying: true,
    };

    // Setup active state first
    stateManager.handleTrackUpdate(999, 'active-session', payload, 'https://soundcloud.com/track');

    for (let i = 0; i < 300; i++) {
      stateManager.handleTrackUpdate(1, `session-${i}`, payload, 'https://soundcloud.com/track');
      stateManager.handleTrackClear(1, `session-${i}`);
    }

    // Session-0 should have been removed from the tombstones because size is capped at 256
    trackUpdates = [];
    stateManager.handleTrackUpdate(1, 'session-0', payload, 'https://soundcloud.com/track');
    assert.strictEqual(
      trackUpdates.length,
      1,
      'session-0 should be allowed again because tombstone fell off bound'
    );
  });

  it('17. final effective clear cannot be followed by stale provider reactivation', () => {
    const payload: ExtensionTrackPayload = {
      title: 'Track A',
      artist: 'Artist A',
      url: 'https://soundcloud.com/track-a',
      isPlaying: true,
    };

    stateManager.handleTrackUpdate(1, 'session-1', payload, 'https://soundcloud.com/track-a');
    assert.strictEqual(trackClears, 0);

    // Clear A
    stateManager.handleTabRemoved(1);
    assert.strictEqual(trackClears, 1);

    // Late message from A arrives
    trackUpdates = [];
    stateManager.handleTrackUpdate(1, 'session-1', payload, 'https://soundcloud.com/track-a');
    assert.strictEqual(
      trackUpdates.length,
      0,
      'No track updates should be sent from stale session'
    );
  });
});
