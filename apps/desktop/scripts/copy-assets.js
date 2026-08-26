const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src/renderer');
const distDir = path.join(__dirname, '../dist/renderer');

function copyFolderSync(from, to) {
  if (!fs.existsSync(to)) {
    fs.mkdirSync(to, { recursive: true });
  }
  fs.readdirSync(from).forEach((element) => {
    const stat = fs.lstatSync(path.join(from, element));
    if (stat.isFile()) {
      if (element.endsWith('.html') || element.endsWith('.css')) {
        fs.copyFileSync(path.join(from, element), path.join(to, element));
        console.log(`Copied static asset: ${element}`);
      }
    }
  });
}

try {
  if (fs.existsSync(srcDir)) {
    copyFolderSync(srcDir, distDir);
  } else {
    console.warn(`Source directory ${srcDir} does not exist. Skipping asset copy.`);
  }
} catch (err) {
  console.error('Failed to copy assets:', err);
  process.exit(1);
}
