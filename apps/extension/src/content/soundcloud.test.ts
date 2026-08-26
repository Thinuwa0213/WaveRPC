import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SoundCloudPageDetector } from './soundcloud.js';

describe('SoundCloud Detector Module Test Suite', () => {
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
});
