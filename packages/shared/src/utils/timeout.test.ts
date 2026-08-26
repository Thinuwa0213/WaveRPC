import { describe, it } from 'node:test';
import assert from 'node:assert';
import { withTimeout } from './timeout.js';

describe('withTimeout Utility Unit Tests', () => {
  it('should resolve normally when promise completes before timeout', async () => {
    const fastPromise = new Promise<string>((resolve) => setTimeout(() => resolve('success'), 10));
    const result = await withTimeout(fastPromise, 100, 'fallback');
    assert.strictEqual(result, 'success');
  });

  it('should return fallback value when promise exceeds timeout', async () => {
    const slowPromise = new Promise<string>((resolve) => setTimeout(() => resolve('slow'), 200));
    const result = await withTimeout(slowPromise, 20, 'fallback');
    assert.strictEqual(result, 'fallback');
  });

  it('should return fallback value and log warning when promise rejects', async () => {
    const failingPromise = Promise.reject(new Error('Failure'));
    let loggedMsg = '';
    const mockLogger = {
      warn: (msg: string) => {
        loggedMsg = msg;
      },
    };
    const result = await withTimeout(failingPromise, 100, 'fallback', 'TestOperation', mockLogger);
    assert.strictEqual(result, 'fallback');
    assert.ok(loggedMsg.includes('TestOperation'));
  });
});
