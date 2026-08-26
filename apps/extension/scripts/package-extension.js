const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const rootDir = path.join(__dirname, '../../..');
const extensionDir = path.join(__dirname, '..');
const distDir = path.join(extensionDir, 'dist');
const releaseDir = path.join(rootDir, 'release/extension');

async function run() {
  console.log('Packaging extension to ZIP...');

  // Ensure release directory exists
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }

  const zip = new AdmZip();

  function addDirectoryToZip(localDirPath, zipPathPrefix = '') {
    const files = fs.readdirSync(localDirPath);
    for (const file of files) {
      const fullPath = path.join(localDirPath, file);
      const relativeZipPath = zipPathPrefix ? `${zipPathPrefix}/${file}` : file;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        addDirectoryToZip(fullPath, relativeZipPath);
      } else {
        if (file.endsWith('.map')) {
          console.log(`Skipping sourcemap file: ${relativeZipPath}`);
          continue;
        }
        console.log(`Adding to ZIP: ${relativeZipPath}`);
        zip.addLocalFile(fullPath, zipPathPrefix);
      }
    }
  }

  if (!fs.existsSync(distDir)) {
    throw new Error(`dist directory missing: ${distDir}. Run build first.`);
  }

  addDirectoryToZip(distDir);

  const pkgPath = path.join(extensionDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = pkg.version;
  const zipPath = path.join(releaseDir, `WaveRPC-Extension-${version}.zip`);
  zip.writeZip(zipPath);

  console.log(`Extension successfully packaged to: ${zipPath}`);
  console.log(`ZIP size: ${(fs.statSync(zipPath).size / 1024).toFixed(2)} KB`);
}

run().catch((err) => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
