const fs = require('fs');
const path = require('path');

// 16x16 purple dot PNG icon base64 string
const base64Data =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAYklEQVR42mNkQAO/gZgBCZhgbKz8/z+MhQ4OIIpxADn4PzIYH8BmAIlxAH45dAMwy+E1gBQApgPwy6HrglkOrwGkADAegF0OfRQMZAMQ7QWsh9eB/yCagF1aGkPDKT7tAQD2ZtPj+X3QSwAAAABJRU5ErkJggg==';

const assetsDir = path.join(__dirname, '../assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

const outputPath = path.join(assetsDir, 'icon.png');
fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
console.log(`Generated placeholder icon.png at ${outputPath}`);
