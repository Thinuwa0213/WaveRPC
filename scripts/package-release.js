const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..');

function runCommand(command, cwd = rootDir) {
  console.log(`\n>>> Executing: ${command}`);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
  } catch (err) {
    console.error(`\n[FATAL] Command failed with non-zero exit code: ${command}`);
    process.exit(1);
  }
}

function calculateSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

function getExpectedVersion() {
  const rootPkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(rootPkgPath)) {
    console.error(`[FATAL] Missing root package.json at: ${rootPkgPath}`);
    process.exit(1);
  }
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
  return rootPkg.version;
}

// 1. Version Validation (Fail Fast)
function checkVersions(expectedVersion) {
  console.log(`\n======================================================`);
  console.log(`[Stage 1] Validating Monorepo Version Consistency (${expectedVersion})`);
  console.log(`======================================================`);

  const packageFiles = [
    'package.json',
    'packages/shared/package.json',
    'packages/providers/package.json',
    'packages/config/package.json',
    'apps/desktop/package.json',
    'apps/extension/package.json',
  ];

  for (const relFile of packageFiles) {
    const fullPath = path.join(rootDir, relFile);
    if (!fs.existsSync(fullPath)) {
      console.error(`[FATAL] Missing package file: ${fullPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(fullPath, 'utf8');

    // Reject duplicate version keys
    const matches = content.match(/\"version\"\s*:/g);
    if (matches && matches.length > 1) {
      console.error(`[FATAL] Duplicate version keys found in: ${relFile}`);
      process.exit(1);
    }

    try {
      const parsed = JSON.parse(content);
      if (parsed.version !== expectedVersion) {
        console.error(
          `[FATAL] Version mismatch in ${relFile}. Expected "${expectedVersion}", found "${parsed.version}"`
        );
        process.exit(1);
      }
    } catch (err) {
      console.error(`[FATAL] Failed to parse JSON in ${relFile}:`, err.message);
      process.exit(1);
    }
  }

  // Validate Chrome Extension manifest
  const manifestPath = path.join(rootDir, 'apps/extension/manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`[FATAL] Missing extension manifest: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version_name !== expectedVersion) {
    console.error(
      `[FATAL] Extension manifest version_name mismatch. Expected "${expectedVersion}", found "${manifest.version_name}"`
    );
    process.exit(1);
  }
  if (!/^\d+(\.\d+){1,3}$/.test(manifest.version)) {
    console.error(
      `[FATAL] Extension manifest version "${manifest.version}" is not a valid dot-separated integer string.`
    );
    process.exit(1);
  }

  console.log(`[PASS] Version synchronization verified across all packages & manifests.`);
}

// 10-15. Validate Artifacts, Extension ZIP, SHA-256
function validateAndChecksumArtifacts(version) {
  console.log(`\n======================================================`);
  console.log(`[Stage 10-15] Validating Generated Release Artifacts & SHA-256`);
  console.log(`======================================================`);

  const releaseDir = path.join(rootDir, 'release');
  const desktopInstallerPath = path.join(releaseDir, `desktop/WaveRPC-Setup-${version}.exe`);
  const extensionZipPath = path.join(releaseDir, `extension/WaveRPC-Extension-${version}.zip`);

  // 10. Verify Desktop Installer
  if (!fs.existsSync(desktopInstallerPath)) {
    console.error(`[FATAL] Desktop installer does not exist at: ${desktopInstallerPath}`);
    process.exit(1);
  }
  const installerStat = fs.statSync(desktopInstallerPath);
  console.log(`Found Desktop Installer: ${desktopInstallerPath}`);
  console.log(`Desktop Installer Size: ${(installerStat.size / (1024 * 1024)).toFixed(2)} MB`);
  if (installerStat.size < 10 * 1024 * 1024) {
    console.error(
      '[FATAL] Desktop installer size is too small (< 10MB). Possible build truncation.'
    );
    process.exit(1);
  }

  // 10. Verify Extension ZIP
  if (!fs.existsSync(extensionZipPath)) {
    console.error(`[FATAL] Extension ZIP does not exist at: ${extensionZipPath}`);
    process.exit(1);
  }
  const zipStat = fs.statSync(extensionZipPath);
  console.log(`Found Extension ZIP: ${extensionZipPath}`);
  console.log(`Extension ZIP Size: ${(zipStat.size / 1024).toFixed(2)} KB`);
  if (zipStat.size === 0) {
    console.error('[FATAL] Extension ZIP size is 0 bytes.');
    process.exit(1);
  }

  // 11. Inspect Extension ZIP
  let AdmZip;
  try {
    AdmZip = require('adm-zip');
  } catch {
    const extensionAdmZipPath = path.join(rootDir, 'apps/extension/node_modules/adm-zip');
    AdmZip = require(extensionAdmZipPath);
  }

  const zip = new AdmZip(extensionZipPath);
  const zipEntries = zip.getEntries();
  const entryNames = zipEntries.map((e) => e.entryName);

  console.log(`Extension ZIP Entries (${entryNames.length} files):`, entryNames);

  // Check required files
  const requiredFiles = ['manifest.json', 'background.js', 'content/soundcloud.js'];
  for (const file of requiredFiles) {
    if (!entryNames.includes(file)) {
      console.error(`[FATAL] Extension ZIP missing required file: ${file}`);
      process.exit(1);
    }
  }

  // 12 & 13. Reject *.ts and *.map files, node_modules, src directories
  for (const name of entryNames) {
    if (name.endsWith('.ts')) {
      console.error(`[FATAL] Extension ZIP contains TypeScript source file: ${name}`);
      process.exit(1);
    }
    if (name.endsWith('.map')) {
      console.error(`[FATAL] Extension ZIP contains sourcemap file: ${name}`);
      process.exit(1);
    }
    if (name.startsWith('src/') || name.includes('/src/')) {
      console.error(`[FATAL] Extension ZIP contains src/ directory: ${name}`);
      process.exit(1);
    }
    if (name.startsWith('node_modules/') || name.includes('/node_modules/')) {
      console.error(`[FATAL] Extension ZIP contains node_modules/: ${name}`);
      process.exit(1);
    }
  }

  console.log(`[PASS] Extension ZIP clean of sourcemaps, sources, and development artifacts.`);

  // 14 & 15. Calculate SHA-256 and write SHA256SUMS.txt
  const installerRelPath = `desktop/WaveRPC-Setup-${version}.exe`;
  const extensionZipRelPath = `extension/WaveRPC-Extension-${version}.zip`;

  const installerHash = calculateSha256(desktopInstallerPath);
  const extensionZipHash = calculateSha256(extensionZipPath);

  const checksumContent = `${installerHash}  ${installerRelPath}\n${extensionZipHash}  ${extensionZipRelPath}\n`;
  const checksumFilePath = path.join(releaseDir, 'SHA256SUMS.txt');
  fs.writeFileSync(checksumFilePath, checksumContent, 'utf8');

  console.log(`\n======================================================`);
  console.log(`[Stage 16] Production Release Artifacts Generated (v${version})`);
  console.log(`======================================================`);
  console.log(`1. Desktop Installer : ${desktopInstallerPath}`);
  console.log(`   Size              : ${(installerStat.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`   SHA-256           : ${installerHash}`);
  console.log(`2. Extension ZIP     : ${extensionZipPath}`);
  console.log(`   Size              : ${(zipStat.size / 1024).toFixed(2)} KB`);
  console.log(`   SHA-256           : ${extensionZipHash}`);
  console.log(`3. Checksums Manifest: ${checksumFilePath}`);
  console.log(`======================================================\n`);
}

async function main() {
  const isRc = process.argv.includes('--rc');
  const expectedVersion = getExpectedVersion();

  console.log(`Starting WaveRPC Release Packaging Pipeline...`);
  console.log(
    `Target Version: ${expectedVersion} (Mode: ${isRc ? 'Release Candidate (--rc)' : 'Standard Release'})`
  );

  // Step 1: Validate Synchronized Versions
  checkVersions(expectedVersion);

  // Clean and prepare release directory
  const releaseDir = path.join(rootDir, 'release');
  if (fs.existsSync(releaseDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  }
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.mkdirSync(path.join(releaseDir, 'desktop'), { recursive: true });
  fs.mkdirSync(path.join(releaseDir, 'extension'), { recursive: true });

  // Step 2: Quality Gate - Typecheck
  runCommand('npx pnpm run typecheck');

  // Step 3: Quality Gate - Lint
  runCommand('npx pnpm run lint');

  // Step 4: Quality Gate - Format Check
  runCommand('npx pnpm run format:check');

  // Step 5: Quality Gate - Full Tests
  runCommand('npx pnpm test');

  // Step 6: Desktop Production Build
  runCommand('npx pnpm --filter @waverpc/desktop run build');

  // Step 7: Extension Production Build
  runCommand('npx pnpm --filter @waverpc/extension run build -- --prod');

  // Step 8: Desktop NSIS Packaging
  runCommand('npx pnpm --filter @waverpc/desktop run package');

  // Step 9: Extension ZIP Packaging
  runCommand('npx pnpm --filter @waverpc/extension run package');

  // Steps 10 - 16: Artifact Validation, ZIP Inspection, SHA-256 Generation & Summary
  validateAndChecksumArtifacts(expectedVersion);
}

main().catch((err) => {
  console.error('[FATAL] Release packaging pipeline failed:', err);
  process.exit(1);
});
