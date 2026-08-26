const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const distTestDir = path.join(rootDir, 'dist-test');

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function run() {
  const isTest = process.argv.includes('--test');
  const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
  const sourcemap = !isProd;

  console.log('Cleaning build directories...');
  cleanDir(distDir);
  if (isTest) {
    cleanDir(distTestDir);
  }

  fs.mkdirSync(distDir, { recursive: true });

  const alias = {
    '@waverpc/shared': path.resolve(rootDir, '../../packages/shared/src/index.ts'),
  };

  console.log(`Bundling extension assets (isProd: ${isProd})...`);

  // 1. Bundle background.ts (ESM)
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/background.ts')],
    bundle: true,
    outfile: path.join(distDir, 'background.js'),
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    sourcemap,
    alias,
  });

  // 2. Bundle content/soundcloud.ts (IIFE)
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/content/soundcloud.ts')],
    bundle: true,
    outfile: path.join(distDir, 'content/soundcloud.js'),
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    sourcemap,
    alias,
  });

  // 3. Copy manifest.json
  const srcManifest = path.join(rootDir, 'manifest.json');
  const destManifest = path.join(distDir, 'manifest.json');
  if (fs.existsSync(srcManifest)) {
    fs.copyFileSync(srcManifest, destManifest);
    console.log('Copied manifest.json to dist');
  } else {
    console.warn('manifest.json not found!');
  }

  // 4. Bundle test if requested
  if (isTest) {
    fs.mkdirSync(distTestDir, { recursive: true });
    await esbuild.build({
      entryPoints: [
        path.join(rootDir, 'src/manifest.test.ts'),
        path.join(rootDir, 'src/websocket/client.test.ts'),
        path.join(rootDir, 'src/background/soundcloud-tab-state.test.ts'),
        path.join(rootDir, 'src/content/soundcloud.test.ts'),
      ],
      bundle: true,
      outdir: distTestDir,
      outbase: path.join(rootDir, 'src'),
      format: 'cjs',
      platform: 'node',
      target: 'es2022',
      sourcemap: true,
      alias,
    });
    console.log('Bundled test assets.');
  }

  console.log('Build completed successfully.');
}

run().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
