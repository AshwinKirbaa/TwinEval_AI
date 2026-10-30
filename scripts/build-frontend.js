const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'public');
const destination = path.join(root, 'dist');

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });

const apiBase = (process.env.TWINEVAL_API_BASE || '').replace(/\/$/, '');
const aiUrl = 'http://127.0.0.1:8000';
const runtime = [
    `window.TWINEVAL_API_BASE = ${JSON.stringify(apiBase)};`,
    `window.TWINEVAL_AI_URL = ${JSON.stringify(aiUrl)};`,
    ''
].join('\n');

fs.writeFileSync(path.join(destination, 'js', 'runtime-config.js'), runtime, 'utf8');
for (const name of fs.readdirSync(destination)) {
    if (!name.endsWith('.html')) continue;
    const file = path.join(destination, name);
    let html = fs.readFileSync(file, 'utf8');
    const tag = '<script src="js/runtime-config.js"></script>';
    if (!html.includes(tag)) {
        html = html.replace(/<\/head>/i, `  ${tag}\n</head>`);
        fs.writeFileSync(file, html, 'utf8');
    }
}

console.log(`Frontend built in ${destination}`);
console.log(`API: ${apiBase || '(same origin)'}`);
console.log(`AI:  ${aiUrl}`);
