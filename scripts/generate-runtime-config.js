const fs = require('fs');
const path = require('path');

const backendUrl = process.env.BACKEND_URL || '';
const outDir = path.join(__dirname, '..', 'public');
const outPath = path.join(outDir, 'runtime-config.js');

const content = `// generated runtime-config.js\nwindow.API_BASE_URL_OVERRIDE = ${JSON.stringify(backendUrl)};\n`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, content, { encoding: 'utf8' });
console.log(`Wrote ${outPath} with BACKEND_URL=${backendUrl}`);
