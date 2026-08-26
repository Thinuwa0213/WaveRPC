import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PrivacySanitizer } from '../privacy/sanitizer.js';

describe('Release Candidate Verification Tests', () => {
  const rootDir = path.resolve(__dirname, '../../../../');

  it('1. All workspace packages must have synchronized version strings', () => {
    const rootPkgPath = path.join(rootDir, 'package.json');
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
    const expectedVersion = rootPkg.version;

    assert.ok(expectedVersion, 'Root package.json must declare a version');

    const packageFiles = [
      'packages/shared/package.json',
      'packages/providers/package.json',
      'packages/config/package.json',
      'apps/desktop/package.json',
      'apps/extension/package.json',
    ];

    for (const pkgRelPath of packageFiles) {
      const fullPath = path.join(rootDir, pkgRelPath);
      assert.ok(fs.existsSync(fullPath), `Package file must exist: ${pkgRelPath}`);
      const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      assert.strictEqual(
        pkg.version,
        expectedVersion,
        `Version in ${pkgRelPath} (${pkg.version}) must match root version (${expectedVersion})`
      );
    }
  });

  it('2. Chrome Extension manifest must declare valid numeric version and matching version_name', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const manifestPath = path.join(rootDir, 'apps/extension/manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.manifest_version, 3, 'Extension must be Manifest V3');
    assert.strictEqual(
      manifest.version_name,
      rootPkg.version,
      `manifest version_name (${manifest.version_name}) must match root version (${rootPkg.version})`
    );
    assert.match(
      manifest.version,
      /^\d+(\.\d+){1,3}$/,
      'manifest version must be 1 to 4 dot-separated integers'
    );
  });

  it('3. Canonical bridge port must be 6124 across desktop and extension configurations', () => {
    const desktopConfigPath = path.join(rootDir, 'apps/desktop/src/config/default.ts');
    assert.ok(fs.existsSync(desktopConfigPath), 'desktop default.ts must exist');
    const desktopConfigContent = fs.readFileSync(desktopConfigPath, 'utf8');
    assert.ok(
      desktopConfigContent.includes('defaultPort: 6124') || desktopConfigContent.includes('6124'),
      'Desktop default configuration must specify port 6124'
    );

    const extensionWsPath = path.join(rootDir, 'apps/extension/src/websocket/client.ts');
    assert.ok(fs.existsSync(extensionWsPath), 'extension client.ts must exist');
    const extensionWsContent = fs.readFileSync(extensionWsPath, 'utf8');
    assert.ok(
      extensionWsContent.includes('ws://127.0.0.1:6124'),
      'Extension WebSocket client default URL must be ws://127.0.0.1:6124'
    );
  });

  it('4. PrivacySanitizer must strip all sensitive authentication and session parameters', () => {
    const sensitiveUrl =
      'https://soundcloud.com/artist/track?access_token=secret123&token=tok&auth=bearer&session_id=sess99&client_secret=s3cr3t&key=k&api_key=ak&public_id=safe123';

    const cleaned = PrivacySanitizer.sanitizeUrl(sensitiveUrl);
    const parsed = new URL(cleaned);

    assert.strictEqual(parsed.searchParams.has('access_token'), false);
    assert.strictEqual(parsed.searchParams.has('token'), false);
    assert.strictEqual(parsed.searchParams.has('auth'), false);
    assert.strictEqual(parsed.searchParams.has('bearer'), false);
    assert.strictEqual(parsed.searchParams.has('session_id'), false);
    assert.strictEqual(parsed.searchParams.has('client_secret'), false);
    assert.strictEqual(parsed.searchParams.has('key'), false);
    assert.strictEqual(parsed.searchParams.has('api_key'), false);
    assert.strictEqual(parsed.searchParams.get('public_id'), 'safe123');
  });

  it('5. PrivacySanitizer must enforce max length and strip control characters', () => {
    const dirtyText = 'Track Title\u0000\u001F' + 'A'.repeat(200);
    const cleanedText = PrivacySanitizer.cleanText(dirtyText, 128);

    assert.strictEqual(cleanedText.length, 128);
    assert.strictEqual(cleanedText.includes('\u0000'), false);
    assert.strictEqual(cleanedText.includes('\u001F'), false);
  });
});
