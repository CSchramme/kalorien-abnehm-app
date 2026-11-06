// Erzeugt die PNG-App-Icons aus public/img/icon.svg (benötigt Playwright + Chromium).
//   node scripts/make-icons.mjs
//   (Playwright wird über NODE_PATH gefunden, z. B. NODE_PATH=$(npm root -g) node scripts/make-icons.mjs)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
// Für "maskable" und Apple: volle Fläche ohne abgerundete Ecken, Motiv in der sicheren Zone
const fullBleed = svg.replace('rx="116"', 'rx="0"');
const maskable = fullBleed.replace('<rect width="512" height="512" rx="0" fill="url(#g)"/>',
  '<rect width="512" height="512" fill="url(#g)"/><g transform="translate(256 256) scale(0.8) translate(-256 -256)">')
  .replace('</svg>', '</g></svg>');

const targets = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
  ['apple-touch-icon.png', 180, fullBleed],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, source] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(dir, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('✓', name);
}
await browser.close();
