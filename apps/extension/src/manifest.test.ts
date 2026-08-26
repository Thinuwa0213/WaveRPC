import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

function stripCommentsAndSourceMaps(content: string): string {
  // Strip block comments
  let clean = content.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip single-line comments (ignoring URL protocols like http://, ws://)
  clean = clean.replace(/(^|[^:])\/\/.*$/gm, '$1');
  // Strip source mapping URL comment at the end of the file
  clean = clean.replace(/\/\/#\s*sourceMappingURL=.*$/gm, '');
  return clean;
}

describe('Extension Manifest Build Tests', () => {
  const distPath = path.join(__dirname, '../dist');
  const manifestPath = path.join(distPath, 'manifest.json');

  it('should copy manifest.json to dist directory and contain correct references', () => {
    assert.ok(
      fs.existsSync(manifestPath),
      `manifest.json should exist in dist/ folder at path: ${manifestPath}`
    );

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);

    // Verify properties
    assert.strictEqual(manifest.manifest_version, 3, 'Manifest version should be 3');
    assert.strictEqual(manifest.name, 'WaveRPC', 'Extension name should be WaveRPC');

    // Verify background configuration matches ESM format
    assert.ok(manifest.background, 'Background configuration should exist');
    assert.strictEqual(
      manifest.background.service_worker,
      'background.js',
      'Service worker script should be background.js'
    );
    assert.strictEqual(manifest.background.type, 'module', 'Service worker type should be module');

    // Verify referenced files exist relative to manifest.json (which is in dist/)
    const backgroundWorker = path.join(distPath, manifest.background.service_worker);
    assert.ok(
      fs.existsSync(backgroundWorker),
      `Service worker file should exist at: ${backgroundWorker}`
    );

    for (const scriptInfo of manifest.content_scripts) {
      for (const scriptFile of scriptInfo.js) {
        const fullScriptPath = path.join(distPath, scriptFile);
        assert.ok(
          fs.existsSync(fullScriptPath),
          `Content script file should exist at: ${fullScriptPath}`
        );
      }
    }
  });

  it('should not contain browser-incompatible CommonJS or Node references in executable code', () => {
    const filesToCheck = [
      path.join(distPath, 'background.js'),
      path.join(distPath, 'content/soundcloud.js'),
    ];

    const forbiddenPatterns = [
      { pattern: /require\(/, name: 'require(' },
      { pattern: /\bmodule\.exports\b/, name: 'module.exports' },
      { pattern: /\bexports\./, name: 'exports.' },
      { pattern: /\bexports\s*=/, name: 'exports =' },
      { pattern: /\bprocess\b/, name: 'process' },
      { pattern: /\b__dirname\b/, name: '__dirname' },
      { pattern: /\b__filename\b/, name: '__filename' },
    ];

    for (const file of filesToCheck) {
      assert.ok(fs.existsSync(file), `Compiled file should exist: ${file}`);
      const content = fs.readFileSync(file, 'utf8');
      const cleanContent = stripCommentsAndSourceMaps(content);

      for (const { pattern, name } of forbiddenPatterns) {
        assert.ok(
          !pattern.test(cleanContent),
          `Compiled file ${path.basename(file)} should not contain ${name} in executable code`
        );
      }
    }
  });

  it('should attempt to connect to the correct WebSocket endpoint', () => {
    const backgroundWorker = path.join(distPath, 'background.js');
    assert.ok(fs.existsSync(backgroundWorker), 'background.js should exist');
    const content = fs.readFileSync(backgroundWorker, 'utf8');

    // Check for the WebSocket server connection call to ws://127.0.0.1:6124
    assert.ok(
      content.includes('ws://127.0.0.1:6124'),
      'background.js must contain connection url: ws://127.0.0.1:6124'
    );
  });
});
