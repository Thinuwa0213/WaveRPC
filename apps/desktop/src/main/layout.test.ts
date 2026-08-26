import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

describe('Renderer UI Layout Regression Tests', () => {
  const stylesPath = path.join(__dirname, '../renderer/styles.css');

  it('should exist and be readable', () => {
    assert.ok(fs.existsSync(stylesPath), `styles.css should exist at ${stylesPath}`);
  });

  it('should not contain unsafe fixed heights for .app-container', () => {
    const css = fs.readFileSync(stylesPath, 'utf8');

    // Find .app-container block
    const appContainerMatch = css.match(/\.app-container\s*\{([^}]*)\}/);
    assert.ok(appContainerMatch, '.app-container class styles must be defined');

    const rules = appContainerMatch[1];
    assert.ok(
      !/(?<!-)height:\s*100vh\b/.test(rules),
      '.app-container should not have a fixed height: 100vh'
    );
    assert.ok(
      rules.includes('min-height: 100vh;'),
      '.app-container should use min-height: 100vh for scrollability'
    );
  });

  it('should have safe overflow-wrap rules for long metadata', () => {
    const css = fs.readFileSync(stylesPath, 'utf8');

    // Find .track-title block
    const trackTitleMatch = css.match(/\.track-title\s*\{([^}]*)\}/);
    assert.ok(trackTitleMatch, '.track-title class styles must be defined');
    assert.ok(
      trackTitleMatch[1].includes('overflow-wrap: anywhere;'),
      '.track-title should wrap long words with overflow-wrap: anywhere'
    );

    // Find .track-artist block
    const trackArtistMatch = css.match(/\.track-artist\s*\{([^}]*)\}/);
    assert.ok(trackArtistMatch, '.track-artist class styles must be defined');
    assert.ok(
      trackArtistMatch[1].includes('overflow-wrap: anywhere;'),
      '.track-artist should wrap long words with overflow-wrap: anywhere'
    );
  });

  it('should have responsive size constraints on artwork using clamp', () => {
    const css = fs.readFileSync(stylesPath, 'utf8');

    // Find .artwork-container block
    const artworkContainerMatch = css.match(/\.artwork-container\s*\{([^}]*)\}/);
    assert.ok(artworkContainerMatch, '.artwork-container class styles must be defined');

    const rules = artworkContainerMatch[1];
    assert.ok(
      rules.includes('clamp('),
      '.artwork-container should use clamp() for responsive size constraints'
    );
  });

  it('should keep Settings panel in normal vertical document flow', () => {
    const css = fs.readFileSync(stylesPath, 'utf8');

    // Find .settings-panel block
    const settingsPanelMatch = css.match(/\.settings-panel\s*\{([^}]*)\}/);
    assert.ok(settingsPanelMatch, '.settings-panel class styles must be defined');

    const rules = settingsPanelMatch[1];
    assert.ok(
      !rules.includes('position: absolute;'),
      '.settings-panel should not use absolute positioning'
    );
    assert.ok(
      !rules.includes('position: fixed;'),
      '.settings-panel should not use fixed positioning'
    );
  });
});
