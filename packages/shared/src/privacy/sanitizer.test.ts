import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PrivacySanitizer } from './sanitizer.js';
import { Track } from '../types/track.js';

describe('PrivacySanitizer Test Suite', () => {
  it('should remove sensitive query parameters from URLs', () => {
    const rawUrl =
      'https://soundcloud.com/artist/track?access_token=secret123&token=abc&auth=xyz&bearer=token123&session_id=sess456&client_secret=topsecret&api_key=key789&public_id=101';
    const sanitizedUrl = PrivacySanitizer.sanitizeUrl(rawUrl);

    assert.strictEqual(sanitizedUrl.includes('access_token'), false, 'Should strip access_token');
    assert.strictEqual(sanitizedUrl.includes('token='), false, 'Should strip token');
    assert.strictEqual(sanitizedUrl.includes('auth='), false, 'Should strip auth');
    assert.strictEqual(sanitizedUrl.includes('bearer='), false, 'Should strip bearer');
    assert.strictEqual(sanitizedUrl.includes('session_id='), false, 'Should strip session_id');
    assert.strictEqual(
      sanitizedUrl.includes('client_secret='),
      false,
      'Should strip client_secret'
    );
    assert.strictEqual(sanitizedUrl.includes('api_key='), false, 'Should strip api_key');
    assert.strictEqual(
      sanitizedUrl.includes('public_id=101'),
      true,
      'Should preserve non-sensitive public query parameters'
    );
  });

  it('should strip control characters from text strings', () => {
    const dirtyTitle = 'Synthwave\u0000 Dreams\u001F \u007FSpecial';
    const cleanTitle = PrivacySanitizer.cleanText(dirtyTitle);

    assert.strictEqual(cleanTitle, 'Synthwave Dreams Special');
  });

  it('should enforce maximum string length limits', () => {
    const longString = 'A'.repeat(200);
    const cleaned = PrivacySanitizer.cleanText(longString, 128);

    assert.strictEqual(cleaned.length, 128);
  });

  it('should preserve safe public track metadata', () => {
    const rawTrack: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      artwork: 'https://i1.sndcdn.com/artworks-0001-t500x500.jpg',
      duration: 243000,
      isPlaying: true,
    };

    const sanitized = PrivacySanitizer.sanitizeTrack(rawTrack);

    assert.strictEqual(sanitized.title, 'Midnight City');
    assert.strictEqual(sanitized.artist, 'M83');
    assert.strictEqual(sanitized.url, 'https://soundcloud.com/m83/midnight-city');
    assert.strictEqual(sanitized.artwork, 'https://i1.sndcdn.com/artworks-0001-t500x500.jpg');
    assert.strictEqual(sanitized.duration, 243000);
    assert.strictEqual(sanitized.isPlaying, true);
  });

  it('should preserve and clamp valid duration and playbackPosition properties', () => {
    const rawTrack: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      duration: 243000,
      isPlaying: true,
      playbackPosition: 250000, // greater than duration
    };

    const sanitized = PrivacySanitizer.sanitizeTrack(rawTrack);
    assert.strictEqual(sanitized.duration, 243000, 'Should preserve duration');
    assert.strictEqual(
      sanitized.playbackPosition,
      243000,
      'Should clamp playbackPosition to duration'
    );

    const rawTrackNoDuration: Track = {
      title: 'Midnight City',
      artist: 'M83',
      url: 'https://soundcloud.com/m83/midnight-city',
      isPlaying: true,
      playbackPosition: 250000,
    };
    const sanitizedNoDuration = PrivacySanitizer.sanitizeTrack(rawTrackNoDuration);
    assert.strictEqual(sanitizedNoDuration.duration, undefined, 'Duration should remain undefined');
    assert.strictEqual(
      sanitizedNoDuration.playbackPosition,
      250000,
      'Should preserve playbackPosition when duration is missing'
    );
  });
});
