import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('System Privacy Rules Test Suite', () => {
  it('should verify Chrome Extension manifest has no sensitive permissions', () => {
    const manifestPath = path.resolve(process.cwd(), '../../apps/extension/manifest.json');
    assert.strictEqual(fs.existsSync(manifestPath), true, 'manifest.json must exist');

    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const permissions: string[] = manifestContent.permissions || [];

    assert.strictEqual(
      permissions.includes('cookies'),
      false,
      'Extension must NOT request cookies permission'
    );
    assert.strictEqual(
      permissions.includes('history'),
      false,
      'Extension must NOT request history permission'
    );
    assert.strictEqual(
      permissions.includes('tabs'),
      false,
      'Extension must NOT request tabs permission'
    );

    const hostPermissions: string[] = manifestContent.host_permissions || [];
    assert.strictEqual(
      hostPermissions.every((perm) => perm.includes('soundcloud.com')),
      true,
      'Host permissions must be restricted to music provider domains'
    );
  });

  it('should verify WebSocket server binds exclusively to localhost', () => {
    const serverPath = path.resolve(
      process.cwd(),
      '../../apps/desktop/src/server/websocket.server.ts'
    );
    assert.strictEqual(fs.existsSync(serverPath), true, 'websocket.server.ts must exist');

    const serverContent = fs.readFileSync(serverPath, 'utf-8');
    assert.strictEqual(
      serverContent.includes("options?.host ?? '127.0.0.1'"),
      true,
      'WebSocket server host must default to 127.0.0.1 loopback'
    );
  });

  it('should verify zero remote telemetry endpoints exist in codebase', () => {
    const packageJsonPath = path.resolve(process.cwd(), '../../package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');

    assert.strictEqual(
      content.includes('google-analytics'),
      false,
      'No analytics packages allowed'
    );
    assert.strictEqual(content.includes('sentry'), false, 'No remote telemetry trackers allowed');
    assert.strictEqual(content.includes('mixpanel'), false, 'No third-party tracking allowed');
  });
});
