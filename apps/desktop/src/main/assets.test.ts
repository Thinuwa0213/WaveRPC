import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

describe('WaveRPC Desktop Icon & Assets Integration Tests', () => {
  const desktopRoot = path.join(__dirname, '../..');
  const assetsDir = path.join(desktopRoot, 'assets');

  it('1. Window icon asset must exist', () => {
    const iconPath = path.join(assetsDir, 'icon.png');
    assert.strictEqual(fs.existsSync(iconPath), true, `Window icon does not exist at: ${iconPath}`);
  });

  it('2. Tray icon asset must exist', () => {
    const trayIconPath = path.join(assetsDir, 'tray-icon.png');
    assert.strictEqual(
      fs.existsSync(trayIconPath),
      true,
      `Tray icon does not exist at: ${trayIconPath}`
    );
  });

  it('3. Installer / Executable ico asset must exist', () => {
    const icoPath = path.join(assetsDir, 'waverpc.ico');
    assert.strictEqual(
      fs.existsSync(icoPath),
      true,
      `Executable icon does not exist at: ${icoPath}`
    );
  });

  it('4. Main Window class source must load assets/icon.png', () => {
    const sourcePath = path.join(desktopRoot, 'src/window/main-window.ts');
    assert.strictEqual(fs.existsSync(sourcePath), true, 'MainWindow class source file missing');
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');
    assert.ok(
      sourceContent.includes('assets/icon.png'),
      'MainWindow source does not reference assets/icon.png'
    );
  });

  it('5. Tray class source must load assets/tray-icon.png and NOT assets/icon.png', () => {
    const sourcePath = path.join(desktopRoot, 'src/tray/tray.ts');
    assert.strictEqual(fs.existsSync(sourcePath), true, 'Tray class source file missing');
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');

    assert.ok(
      sourceContent.includes('assets/tray-icon.png'),
      'Tray source does not reference assets/tray-icon.png'
    );

    assert.ok(
      !sourceContent.includes('assets/icon.png'),
      'Tray source still references old assets/icon.png'
    );
  });

  it('6. Compiled preload script must exist in dist', () => {
    const preloadPath = path.join(desktopRoot, 'dist/preload/index.js');
    assert.strictEqual(
      fs.existsSync(preloadPath),
      true,
      `Preload script does not exist at: ${preloadPath}`
    );
  });

  it('7. Compiled renderer assets must exist in dist', () => {
    const htmlPath = path.join(desktopRoot, 'dist/renderer/index.html');
    const cssPath = path.join(desktopRoot, 'dist/renderer/styles.css');
    assert.strictEqual(
      fs.existsSync(htmlPath),
      true,
      `Renderer HTML does not exist at: ${htmlPath}`
    );
    assert.strictEqual(fs.existsSync(cssPath), true, `Renderer CSS does not exist at: ${cssPath}`);
  });
});
