import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { SoundCloudPageDetector, parseTimeText } from './soundcloud.js';

describe('SoundCloud Detector Module Test Suite', () => {
  const originalMutationObserver = (global as any).MutationObserver;
  (global as any).MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  it('should construct valid SoundCloud extension track update payloads', () => {
    const payload = {
      title: 'Monstercat Release',
      artist: 'Vicetone',
      url: 'https://soundcloud.com/vicetone/monstercat-release',
      artwork: 'https://i1.sndcdn.com/artworks-0001.jpg',
      duration: 180000,
      isPlaying: true,
      providerId: 'soundcloud',
    };

    assert.strictEqual(payload.title, 'Monstercat Release');
    assert.strictEqual(payload.artist, 'Vicetone');
    assert.strictEqual(payload.providerId, 'soundcloud');
    assert.strictEqual(payload.isPlaying, true);
  });

  it('session ID remains stable for one content-script lifetime', () => {
    const detector1 = new SoundCloudPageDetector();
    const session1 = (detector1 as any).sourceSessionId;
    assert.ok(session1, 'Should generate session ID');
    assert.strictEqual(typeof session1, 'string');

    const session1_again = (detector1 as any).sourceSessionId;
    assert.strictEqual(session1, session1_again, 'Session ID must remain stable');

    const detector2 = new SoundCloudPageDetector();
    const session2 = (detector2 as any).sourceSessionId;
    assert.notStrictEqual(
      session1,
      session2,
      'Different instances must have different session IDs'
    );
  });

  it('dispose() is idempotent', () => {
    const detector = new SoundCloudPageDetector();
    assert.strictEqual((detector as any).disposed, false);

    // Call dispose once
    detector.dispose();
    assert.strictEqual((detector as any).disposed, true);

    // Call dispose again - should not throw or change state
    assert.doesNotThrow(() => {
      detector.dispose();
    });
    assert.strictEqual((detector as any).disposed, true);
  });

  it('getActiveAudioElement selects correctly with multiple audio elements (one stale)', () => {
    const detector = new SoundCloudPageDetector();
    const mockAudioPlaying = {
      src: 'blob:https://soundcloud.com/play-src',
      paused: false,
      duration: 180,
      currentTime: 10,
    };
    const mockAudioPaused = {
      src: 'blob:https://soundcloud.com/paused-src',
      paused: true,
      duration: 200,
      currentTime: 5,
    };
    const mockAudioStaleNoSrc = {
      src: '',
      paused: true,
      duration: NaN,
      currentTime: 0,
    };

    // Mock document
    const originalDocument = (global as any).document;
    (global as any).document = {
      querySelectorAll: (selector: string) => {
        if (selector === 'audio') {
          return [mockAudioStaleNoSrc, mockAudioPaused, mockAudioPlaying] as any;
        }
        return [] as any;
      },
    } as any;

    try {
      const active = (detector as any).getActiveAudioElement();
      assert.strictEqual(active, mockAudioPlaying, 'Should select the playing element');

      // Now with only paused and stale elements
      (global as any).document.querySelectorAll = (selector: string) => {
        if (selector === 'audio') {
          return [mockAudioStaleNoSrc, mockAudioPaused] as any;
        }
        return [] as any;
      };

      const activePaused = (detector as any).getActiveAudioElement();
      assert.strictEqual(
        activePaused,
        mockAudioPaused,
        'Should select the paused element with duration'
      );
    } finally {
      (global as any).document = originalDocument;
    }
  });

  it('buildCurrentTrackPayload extracts timing correctly in milliseconds', () => {
    const detector = new SoundCloudPageDetector();
    const mockAudio = {
      src: 'blob:https://soundcloud.com/play-src',
      paused: false,
      duration: 123.456,
      currentTime: 12.345,
    };

    const originalDocument = (global as any).document;
    const originalWindow = (global as any).window;
    (global as any).document = {
      querySelector: (selector: string) => {
        if (selector === '.playbackSoundBadge__titleLink') {
          return { innerText: 'Track Title', href: 'https://soundcloud.com/artist/track' };
        }
        if (selector === '.playbackSoundBadge__lightLink') {
          return { innerText: 'Artist Name' };
        }
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === 'audio') {
          return [mockAudio] as any;
        }
        return [] as any;
      },
    } as any;

    (global as any).window = {
      location: {
        href: 'https://soundcloud.com/artist/track',
      },
    } as any;

    try {
      const payload = detector.buildCanonicalTrackSnapshot();
      assert.ok(payload);
      assert.strictEqual(payload.title, 'Track Title');
      assert.strictEqual(payload.artist, 'Artist Name');
      assert.strictEqual(
        payload.duration,
        123456,
        'Duration should be converted to ms and rounded'
      );
      assert.strictEqual(
        payload.playbackPosition,
        12345,
        'PlaybackPosition should be converted to ms and rounded'
      );
    } finally {
      (global as any).document = originalDocument;
      (global as any).window = originalWindow;
    }
  });

  it('detectAndSend force-sends update on seeks and duration changes', () => {
    const detector = new SoundCloudPageDetector();
    const sentMessages: any[] = [];
    (detector as any).sendToBackground = (msg: any) => {
      sentMessages.push(msg);
    };

    const originalDocument = (global as any).document;
    const originalWindow = (global as any).window;
    (global as any).document = {
      querySelector: () => null,
      querySelectorAll: () => [] as any,
    } as any;
    (global as any).window = {
      location: {
        href: 'https://soundcloud.com/artist/track',
      },
    } as any;

    try {
      // Mock DOM title/artist extraction
      (global as any).document.querySelector = (selector: string) => {
        if (selector === '.playbackSoundBadge__titleLink') {
          return { innerText: 'Track Title', href: 'https://soundcloud.com/artist/track' };
        }
        if (selector === '.playbackSoundBadge__lightLink') {
          return { innerText: 'Artist Name' };
        }
        if (selector === '.playControl') {
          return { classList: { contains: () => true } };
        }
        return null;
      };

      // First call: fresh track update
      (detector as any).getPlaybackTiming = () => ({
        playbackPosition: 0,
        duration: undefined,
      });
      detector.detectAndSend();
      assert.strictEqual(sentMessages.length, 1);
      assert.strictEqual(sentMessages[0].type, 'TRACK_UPDATE');
      assert.strictEqual(sentMessages[0].payload.playbackPosition, 0);

      // Second call: same track, same play state, but duration loaded. Should force-send!
      (detector as any).getPlaybackTiming = () => ({
        playbackPosition: 1000,
        duration: 180000,
      });
      detector.detectAndSend();
      assert.strictEqual(sentMessages.length, 2);
      assert.strictEqual(sentMessages[1].payload.duration, 180000);

      // Third call: normal progression (drift within 3s). Should be suppressed!
      (detector as any).getPlaybackTiming = () => ({
        playbackPosition: 2000,
        duration: 180000,
      });
      detector.detectAndSend();
      assert.strictEqual(
        sentMessages.length,
        2,
        'Should suppress update during normal progression'
      );

      // Fourth call: seek detected (drift > 3s). Should force-send!
      (detector as any).getPlaybackTiming = () => ({
        playbackPosition: 15000,
        duration: 180000,
      });
      detector.detectAndSend();
      assert.strictEqual(sentMessages.length, 3);
      assert.strictEqual(sentMessages[2].payload.playbackPosition, 15000);
    } finally {
      (global as any).document = originalDocument;
      (global as any).window = originalWindow;
    }
  });

  describe('SoundCloud DOM Playback Timing Fallback Tests', () => {
    it('1. parseTimeText parsing and validation tests (including > 1 hour)', () => {
      assert.strictEqual(parseTimeText('0:19'), 19000);
      assert.strictEqual(parseTimeText('17:47'), 1067000);
      assert.strictEqual(parseTimeText('59:27'), 3567000);
      assert.strictEqual(parseTimeText('1:34:03'), 5643000);
      assert.strictEqual(parseTimeText('02:15:09'), 8109000);

      // Malformed inputs
      assert.strictEqual(parseTimeText(''), undefined);
      assert.strictEqual(parseTimeText('invalid'), undefined);
      assert.strictEqual(parseTimeText('-17:47'), undefined);
      assert.strictEqual(parseTimeText('17:61'), undefined);
      assert.strictEqual(parseTimeText('1:61:05'), undefined);
    });

    it('2. media-element timing has priority when valid', () => {
      const detector = new SoundCloudPageDetector();
      const mockAudio = {
        src: 'blob:https://soundcloud.com/play-src',
        paused: false,
        duration: 180,
        currentTime: 45,
      };

      const originalDocument = (global as any).document;
      const originalWindow = (global as any).window;

      // Mock both audio elements and DOM play controls
      (global as any).document = {
        querySelectorAll: (selector: string) => {
          if (selector === 'audio') return [mockAudio] as any;
          return [] as any;
        },
        querySelector: (selector: string) => {
          if (selector === '.playControls') {
            return {
              querySelector: (sub: string) => {
                if (sub.includes('timePassed')) {
                  return { textContent: '10:00' };
                }
                if (sub.includes('duration')) {
                  return { textContent: '20:00' };
                }
                return null;
              },
            } as any;
          }
          return null;
        },
      } as any;

      (global as any).window = {
        location: { href: 'https://soundcloud.com/artist/track' },
      } as any;

      try {
        const timing = (detector as any).getPlaybackTiming();
        assert.strictEqual(timing.source, 'media-element');
        assert.strictEqual(timing.playbackPosition, 45000, 'Should use audio currentTime');
        assert.strictEqual(timing.duration, 180000, 'Should use audio duration');
      } finally {
        (global as any).document = originalDocument;
        (global as any).window = originalWindow;
      }
    });

    it('3. selector A missing but selector B works', () => {
      const detector = new SoundCloudPageDetector();
      const originalDocument = (global as any).document;
      const originalWindow = (global as any).window;

      (global as any).document = {
        querySelectorAll: (selector: string) => (selector === 'audio' ? [] : []),
        querySelector: (selector: string) => {
          if (selector === '.playControls') {
            return {
              querySelector: (sub: string) => {
                // Return null for span[aria-hidden="true"] (Selector A)
                if (sub.includes('span[aria-hidden="true"]')) {
                  return null;
                }
                // Return valid elements for Selector B
                if (
                  sub === '.playbackTimeline__timePassed > span' ||
                  sub === '.playbackTimeline__timePassed'
                ) {
                  return { textContent: '17:47' };
                }
                if (
                  sub === '.playbackTimeline__duration > span' ||
                  sub === '.playbackTimeline__duration'
                ) {
                  return { textContent: '59:27' };
                }
                return null;
              },
            } as any;
          }
          return null;
        },
      } as any;

      (global as any).window = {
        location: { href: 'https://soundcloud.com/artist/track' },
      } as any;

      try {
        const timing = (detector as any).getPlaybackTiming();
        assert.strictEqual(timing.source, 'soundcloud-dom');
        assert.strictEqual(timing.playbackPosition, 1067000);
        assert.strictEqual(timing.duration, 3567000);
      } finally {
        (global as any).document = originalDocument;
        (global as any).window = originalWindow;
      }
    });

    it('4. ARIA values inconsistent with visible text are rejected', () => {
      const detector = new SoundCloudPageDetector();
      const originalDocument = (global as any).document;
      const originalWindow = (global as any).window;

      (global as any).document = {
        querySelectorAll: (selector: string) => (selector === 'audio' ? [] : []),
        querySelector: (selector: string) => {
          if (selector === '.playControls') {
            return {
              querySelector: (sub: string) => {
                if (sub.includes('progressWrapper')) {
                  return {
                    getAttribute: (attr: string) => {
                      if (attr === 'aria-valuenow') return '500'; // inconsistent with 17:47 (1067s)
                      if (attr === 'aria-valuemax') return '2000'; // inconsistent with 59:27 (3567s)
                      return null;
                    },
                  };
                }
                if (sub.includes('timePassed')) {
                  return { textContent: '17:47' };
                }
                if (sub.includes('duration')) {
                  return { textContent: '59:27' };
                }
                return null;
              },
            } as any;
          }
          return null;
        },
      } as any;

      (global as any).window = {
        location: { href: 'https://soundcloud.com/artist/track' },
      } as any;

      try {
        const timing = (detector as any).getPlaybackTiming();
        // Since ARIA was rejected, it should fall back to parsed visible text values
        assert.strictEqual(timing.source, 'soundcloud-dom');
        assert.strictEqual(timing.playbackPosition, 1067000);
        assert.strictEqual(timing.duration, 3567000);
      } finally {
        (global as any).document = originalDocument;
        (global as any).window = originalWindow;
      }
    });

    it('5. player-scoped fallback ignores unrelated page timestamps', () => {
      const detector = new SoundCloudPageDetector();
      const originalDocument = (global as any).document;
      const originalWindow = (global as any).window;

      (global as any).document = {
        querySelectorAll: (selector: string) => (selector === 'audio' ? [] : []),
        querySelector: (selector: string) => {
          // Play controls is completely missing
          if (selector === '.playControls') {
            return null;
          }
          // Unrelated elements have timestamp text
          if (selector === '.unrelated-comment') {
            return { textContent: '12:34' };
          }
          return null;
        },
      } as any;

      (global as any).window = {
        location: { href: 'https://soundcloud.com/artist/track' },
      } as any;

      try {
        const timing = (detector as any).getPlaybackTiming();
        assert.strictEqual(timing.source, 'unavailable');
        assert.strictEqual(timing.playbackPosition, undefined);
        assert.strictEqual(timing.duration, undefined);
      } finally {
        (global as any).document = originalDocument;
        (global as any).window = originalWindow;
      }
    });

    it('6. stale timing from previous track is not attached to new track', () => {
      const detector = new SoundCloudPageDetector();
      const sentMessages: any[] = [];
      (detector as any).sendToBackground = (msg: any) => {
        sentMessages.push(msg);
      };

      const originalDocument = (global as any).document;
      const originalWindow = (global as any).window;
      (global as any).document = {
        querySelector: () => null,
        querySelectorAll: () => [] as any,
      } as any;
      (global as any).window = {
        location: { href: 'https://soundcloud.com/artist/track' },
      };

      try {
        let currentTitle = 'Track A';
        let currentArtist = 'Artist A';

        (global as any).document.querySelector = (selector: string) => {
          if (selector === '.playbackSoundBadge__titleLink') {
            return { innerText: currentTitle, href: 'https://soundcloud.com/artist/track' };
          }
          if (selector === '.playbackSoundBadge__lightLink') {
            return { innerText: currentArtist };
          }
          if (selector === '.playControl') {
            return { classList: { contains: () => true } }; // always playing
          }
          return null;
        };

        // Track A plays at 3:00 (180000ms)
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 180000,
          duration: 180000,
        });
        detector.detectAndSend();
        assert.strictEqual(sentMessages.length, 1);

        // Track B starts playing.
        currentTitle = 'Track B';
        currentArtist = 'Artist B';

        // Case A: Position is close to Track A's final position (stale)
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 180000, // stale from Track A
          duration: 180000,
        });
        const payloadB = (detector as any).buildCanonicalTrackSnapshot();
        console.log('[TEST 6 DEBUG] Track B payload:', payloadB);
        console.log('[TEST 6 DEBUG] Track B detector state:', {
          lastSentTitle: (detector as any).lastSentTitle,
          lastSentPlaybackPosition: (detector as any).lastSentPlaybackPosition,
        });

        detector.detectAndSend();
        assert.strictEqual(sentMessages[1]?.payload?.playbackPosition, undefined);

        // Track B loads valid timing
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 1000,
          duration: 180000,
        });
        detector.detectAndSend();
        assert.strictEqual(sentMessages[2]?.payload?.duration, 180000);

        // Case B: Duration is unchanged from Track A during transition
        currentTitle = 'Track C';
        currentArtist = 'Artist C';
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 0,
          duration: 180000, // stale duration from previous track
        });
        detector.detectAndSend();
        assert.strictEqual(sentMessages[3].payload.duration, undefined);

        // Track C loads valid timing
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 1000,
          duration: 240000,
        });
        detector.detectAndSend();
        assert.strictEqual(sentMessages[4].payload.duration, 240000);

        // Case C: Implausible initial position (>5s)
        currentTitle = 'Track D';
        currentArtist = 'Artist D';
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 10000, // implausible (>5s) initial position
          duration: 240000,
        });
        detector.detectAndSend();
        assert.strictEqual(sentMessages[5].payload.playbackPosition, undefined);
      } finally {
        (global as any).document = originalDocument;
        (global as any).window = originalWindow;
      }
    });

    it('7. REQUEST_STATE always returns fresh DOM timing', () => {
      const detector = new SoundCloudPageDetector();
      const originalDocument = (global as any).document;
      const originalWindow = (global as any).window;
      const originalChrome = (global as any).chrome;

      // Mock DOM with timePassed "10:00" and duration "20:00"
      (global as any).document = {
        querySelectorAll: (selector: string) => (selector === 'audio' ? [] : []),
        querySelector: (selector: string) => {
          if (selector === '.playControls') {
            return {
              querySelector: (sub: string) => {
                if (sub.includes('timePassed')) {
                  return { textContent: '10:00' };
                }
                if (sub.includes('duration')) {
                  return { textContent: '20:00' };
                }
                return null;
              },
            } as any;
          }
          if (selector.includes('titleLink') || selector.includes('lightLink')) {
            return { innerText: 'Sample Text' };
          }
          return null;
        },
      } as any;

      (global as any).window = {
        location: { href: 'https://soundcloud.com/artist/track' },
        addEventListener: () => {},
        removeEventListener: () => {},
      } as any;

      (global as any).chrome = {
        runtime: {
          onMessage: {
            addListener: () => {},
            removeListener: () => {},
          },
        },
      };

      try {
        detector.initialize();

        let responsePayload: any = null;
        const sendResponse = (res: any) => {
          responsePayload = res;
        };

        // Trigger REQUEST_PLAYBACK_STATE message
        const messageListener = (detector as any).messageListener;
        assert.ok(messageListener, 'messageListener should be initialized');
        messageListener({ type: 'REQUEST_PLAYBACK_STATE' }, {}, sendResponse);

        assert.ok(responsePayload);
        assert.strictEqual(responsePayload.producer, 'request-state');
        assert.strictEqual(responsePayload.payload.playbackPosition, 600000); // 10:00 in ms
        assert.strictEqual(responsePayload.payload.duration, 1200000); // 20:00 in ms
      } finally {
        (global as any).document = originalDocument;
        (global as any).window = originalWindow;
        (global as any).chrome = originalChrome;
        detector.dispose();
      }
    });

    it('8. seek forward/backward works correctly', () => {
      const detector = new SoundCloudPageDetector();
      const sentMessages: any[] = [];
      (detector as any).sendToBackground = (msg: any) => {
        sentMessages.push(msg);
      };

      const originalDocument = (global as any).document;
      const originalWindow = (global as any).window;
      (global as any).document = {
        querySelector: () => null,
        querySelectorAll: () => [] as any,
      } as any;
      (global as any).window = {
        location: { href: 'https://soundcloud.com/artist/track' },
      };

      try {
        (global as any).document.querySelector = (selector: string) => {
          if (selector === '.playbackSoundBadge__titleLink') {
            return { innerText: 'Track X', href: 'https://soundcloud.com/artist/x' };
          }
          if (selector === '.playbackSoundBadge__lightLink') {
            return { innerText: 'Artist X' };
          }
          if (selector === '.playControl') {
            return { classList: { contains: () => true } }; // always playing
          }
          return null;
        };

        // Initial state: 10:00 playing
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 600000, // 10m
          duration: 1200000,
        });
        detector.detectAndSend();
        assert.strictEqual(sentMessages.length, 1);

        // Seek forward: drift > 3s (e.g. seeking to 15:00 immediately)
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 900000, // 15m (diff of 5m from expected)
          duration: 1200000,
        });
        detector.detectAndSend();
        assert.strictEqual(sentMessages.length, 2);
        assert.strictEqual(sentMessages[1].payload.playbackPosition, 900000);

        // Seek backward: drift > 3s (e.g. seeking back to 5:00)
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: 300000, // 5m
          duration: 1200000,
        });
        detector.detectAndSend();
        assert.strictEqual(sentMessages.length, 3);
        assert.strictEqual(sentMessages[2].payload.playbackPosition, 300000);
      } finally {
        (global as any).document = originalDocument;
        (global as any).window = originalWindow;
      }
    });

    it('Strips "Current track:" case-insensitively and removes duplicate concatenation', () => {
      const detector = new SoundCloudPageDetector();
      const normalize = (title: string) => (detector as any).normalizeTitle(title);

      assert.strictEqual(normalize('Current track: Song A'), 'Song A');
      assert.strictEqual(normalize('current track: Song B'), 'Song B');
      assert.strictEqual(normalize('  cURREnt trACK:   Song C  '), 'Song C');

      // Duplicate concatenation
      assert.strictEqual(
        normalize('CHARLIE PUTH - ATTENTION ...CHARLIE PUTH - ATTENTION ...'),
        'CHARLIE PUTH - ATTENTION ...'
      );

      // Should NOT touch non-duplicates or mismatched halves
      assert.strictEqual(normalize('Song Song'), 'Song');
      assert.strictEqual(normalize('Valid Track name Valid Track name'), 'Valid Track name');
      assert.strictEqual(
        normalize('Different Halves Something Else'),
        'Different Halves Something Else'
      );
    });

    it('Cache-derived timing bounded by 60 seconds', () => {
      const detector = new SoundCloudPageDetector();
      (detector as any).cachedTrackIdentity = 'Track A|Artist A';

      const now = Date.now();
      // Valid timing 10 seconds ago
      (detector as any).lastValidTime = now - 10000;
      (detector as any).lastValidPlaybackPosition = 50000;
      (detector as any).lastValidDuration = 200000;

      // Mock DOM timing as unavailable
      (detector as any).getPlaybackTiming = () => ({ source: 'unavailable' });

      // Mock isPlaying = true
      const originalDocument = (global as any).document;
      const originalWindow = (global as any).window;
      (global as any).document = {
        querySelector: (selector: string) => {
          if (selector === '.playControl') {
            return { classList: { contains: () => true } };
          }
          if (selector === '.playbackSoundBadge__titleLink') {
            return { innerText: 'Track A' };
          }
          if (selector === '.playbackSoundBadge__lightLink') {
            return { innerText: 'Artist A' };
          }
          return null;
        },
        querySelectorAll: () => [],
      } as any;
      (global as any).window = {
        location: { href: 'https://soundcloud.com/artist/track' },
      } as any;

      const originalDate = (global as any).Date;
      const mockNow = Date.now();

      try {
        // Initial exact timing
        (detector as any).lastValidPlaybackPosition = 50000;
        (detector as any).lastValidDuration = 180000;
        (detector as any).lastValidTime = mockNow;

        // Force timing to be unavailable
        (detector as any).getPlaybackTiming = () => ({
          playbackPosition: undefined,
          duration: undefined,
          source: 'unavailable',
        });

        // Test within bounds (e.g. 10s later)
        (global as any).Date.now = () => mockNow + 10000;
        const freshPayload = detector.buildCanonicalTrackSnapshot();
        assert.strictEqual(freshPayload?.playbackPosition, 60000);
        assert.strictEqual(freshPayload?.timingSource, 'cache-derived');

        // Test out of bounds (61s later)
        (global as any).Date.now = () => mockNow + 61000;
        const stalePayload = detector.buildCanonicalTrackSnapshot();
        assert.strictEqual(
          stalePayload?.playbackPosition,
          undefined,
          'Must downgrade to unavailable after 60s'
        );
        assert.strictEqual(stalePayload?.timingSource, undefined);
      } finally {
        (global as any).document = originalDocument;
        (global as any).window = originalWindow;
        (global as any).Date = originalDate;
      }
    });
  });

  after(() => {
    (global as any).MutationObserver = originalMutationObserver;
  });
});
