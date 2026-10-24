/**
 * Copies the classic (non-module) p5 build into public/vendor for the sandboxed
 * sketch iframe. The iframe loads it as an ordinary <script>, so the package
 * "exports" map and the Vite module graph are intentionally bypassed.
 *
 * public/vendor is generated and ignored by git.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/vendor');

mkdirSync(outDir, { recursive: true });

const copies = [['node_modules/p5/lib/p5.min.js', 'public/vendor/p5.min.js']];

for (const [from, to] of copies) {
  copyFileSync(resolve(root, from), resolve(root, to));
  console.log(`synced ${to}`);
}
