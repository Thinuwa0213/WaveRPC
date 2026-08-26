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
});
