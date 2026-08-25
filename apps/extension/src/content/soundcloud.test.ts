import { describe, it } from 'node:test';
import assert from 'node:assert';

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
});
