import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TypedEventEmitter } from '@waverpc/shared';
import { ExtensionMessageHandler } from './message.handler.js';

describe('ExtensionMessageHandler PING Tests', () => {
  it('should accept PING without emitting any events or mutating state', () => {
    const events = new TypedEventEmitter();
    let eventCount = 0;
    events.on('provider:activated', () => {
      eventCount++;
    });
    events.on('track:changed', () => {
      eventCount++;
    });
    events.on('playback:stateChanged', () => {
      eventCount++;
    });

    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage(JSON.stringify({ type: 'PING' }));

    assert.strictEqual(result, true, 'PING should be handled successfully');
    assert.strictEqual(eventCount, 0, 'PING should not emit any status or presence events');
  });

  it('should accept TRACK_UPDATE and preserve duration and playbackPosition in emitted event', () => {
    const events = new TypedEventEmitter();
    let emittedTrack: any = null;
    events.on('track:changed', (track) => {
      emittedTrack = track;
    });

    const handler = new ExtensionMessageHandler(events);
    const payload = {
      title: 'Monstercat Release',
      artist: 'Vicetone',
      url: 'https://soundcloud.com/vicetone/monstercat-release',
      duration: 180000,
      isPlaying: true,
      playbackPosition: 45000,
    };
    const result = handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload,
      })
    );

    assert.strictEqual(result, true, 'TRACK_UPDATE should be handled successfully');
    assert.ok(emittedTrack, 'track:changed should be emitted');
    assert.strictEqual(emittedTrack.title, 'Monstercat Release');
    assert.strictEqual(
      emittedTrack.playbackPosition,
      45000,
      'playbackPosition should be preserved'
    );
    assert.strictEqual(emittedTrack.duration, 180000, 'duration should be preserved');
  });
});

describe('ExtensionMessageHandler Schema Validation Tests', () => {
  it('should reject malformed JSON', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage('{invalid-json');
    assert.strictEqual(result, false);
  });

  it('should reject unknown message type', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage(JSON.stringify({ type: 'UNKNOWN_TYPE', payload: {} }));
    assert.strictEqual(result, false);
  });

  it('should reject TRACK_UPDATE when payload is not an object', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage(
      JSON.stringify({ type: 'TRACK_UPDATE', payload: 'not-an-object' })
    );
    assert.strictEqual(result, false);
  });

  it('should reject TRACK_UPDATE with title as number', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 123,
          artist: 'Vicetone',
          url: 'https://soundcloud.com/vicetone/monstercat-release',
        },
      })
    );
    assert.strictEqual(result, false);
  });

  it('should reject TRACK_UPDATE with duration as string', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Monstercat Release',
          artist: 'Vicetone',
          url: 'https://soundcloud.com/vicetone/monstercat-release',
          duration: '180000',
        },
      })
    );
    assert.strictEqual(result, false);
  });

  it('should reject TRACK_UPDATE with NaN / Infinity timing', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);

    // NaN
    const resNaN = handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Title',
          artist: 'Artist',
          url: 'https://soundcloud.com/url',
          playbackPosition: NaN,
        },
      })
    );
    assert.strictEqual(resNaN, false);

    // Infinity
    const resInf = handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Title',
          artist: 'Artist',
          url: 'https://soundcloud.com/url',
          playbackPosition: Infinity,
        },
      })
    );
    assert.strictEqual(resInf, false);
  });

  it('should reject TRACK_UPDATE with negative playbackPosition', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Title',
          artist: 'Artist',
          url: 'https://soundcloud.com/url',
          playbackPosition: -100,
        },
      })
    );
    assert.strictEqual(result, false);
  });

  it('should reject TRACK_UPDATE with invalid timingSource', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage(
      JSON.stringify({
        type: 'TRACK_UPDATE',
        payload: {
          title: 'Title',
          artist: 'Artist',
          url: 'https://soundcloud.com/url',
          timingSource: 'invalid-source-type',
        },
      })
    );
    assert.strictEqual(result, false);
  });

  it('should reject PLAYBACK_UPDATE with invalid playbackState', () => {
    const events = new TypedEventEmitter();
    const handler = new ExtensionMessageHandler(events);
    const result = handler.handleMessage(
      JSON.stringify({
        type: 'PLAYBACK_UPDATE',
        payload: {
          playbackState: 'invalid-state',
        },
      })
    );
    assert.strictEqual(result, false);
  });
});
