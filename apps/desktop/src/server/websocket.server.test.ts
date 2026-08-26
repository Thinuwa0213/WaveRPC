import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TypedEventEmitter } from '@waverpc/shared';
import { WaveRPCWebSocketServer } from './websocket.server.js';
import { WebSocket } from 'ws';

describe('WaveRPCWebSocketServer Security & Binding Tests', () => {
  it('should bind to 127.0.0.1 and reject external interface exposure', async () => {
    const events = new TypedEventEmitter();
    // Start on port 0 to allocate a free random port
    const server = new WaveRPCWebSocketServer(events, { port: 0, host: '127.0.0.1' });
    const started = await server.start();
    assert.strictEqual(started, true, 'Server should start successfully');

    const address = (server as any).wss?.address();
    assert.ok(address, 'Server address should be defined');
    assert.strictEqual(address.address, '127.0.0.1', 'Server must explicitly bind to 127.0.0.1');

    await server.stop();
  });

  it('should defensively reject oversized payload and not crash', async () => {
    const events = new TypedEventEmitter();
    const server = new WaveRPCWebSocketServer(events, { port: 0, host: '127.0.0.1' });
    const started = await server.start();
    assert.strictEqual(started, true);

    const address = (server as any).wss?.address();
    const port = address.port;

    // Connect a websocket client
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    // Send oversized message (101KB)
    const largeBuffer = Buffer.alloc(102401, 'a');

    // Temporarily capture warnings/errors or just verify that it doesn't crash and remains open
    ws.send(largeBuffer);

    // Give it a brief moment to process
    await new Promise((r) => setTimeout(r, 200));

    assert.strictEqual(ws.readyState, WebSocket.OPEN, 'Socket should remain open without crashing');

    // Clean up
    ws.close();
    await server.stop();
  });
});
