// Import a frontend TypeScript module (e.g. src/lib/reportMath.ts) into a node
// test: bundle it with esbuild (already installed with the backend's tsx) into a
// temporary .mjs file and import that. Lets the suite test the report maths
// the screens run, without a browser.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadEsbuild() {
  for (const base of [path.join(ROOT, 'backend'), ROOT]) {
    try {
      return createRequire(path.join(base, 'package.json'))('esbuild');
    } catch { /* try the next */ }
  }
  throw new Error('esbuild not found (install backend dependencies)');
}

/** Import `relPath` (relative to the repo root) as an ES module. */
export async function importTs(relPath) {
  const esbuild = loadEsbuild();
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, relPath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const file = path.join(os.tmpdir(), `qa-ts-${crypto.randomBytes(6).toString('hex')}.mjs`);
  fs.writeFileSync(file, out.outputFiles[0].text);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
