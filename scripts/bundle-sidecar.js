/**
 * Bundles the standalone server and its dependencies into src-tauri/sidecar/
 * for Tauri to include as a bundled resource.
 *
 * This script:
 * 1. Copies the Vite-built server bundle (dist-standalone/index.cjs)
 * 2. Copies externalized node_modules (fastify, @fastify/cors, @fastify/static)
 * 3. Copies the local bun binary for the sidecar runtime
 *
 * Run after: vite build --config vite.sidecar.config.ts
 */

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const sidecarDir = resolve(root, 'src-tauri/sidecar');
const distDir = resolve(root, 'dist-standalone');

// Ensure sidecar dir exists
mkdirSync(sidecarDir, { recursive: true });

// 1. Copy server bundle
const serverSrc = resolve(distDir, 'index.cjs');
if (!existsSync(serverSrc)) {
  console.error(`ERROR: ${serverSrc} not found. Run 'vite build --config vite.sidecar.config.ts' first.`);
  process.exit(1);
}
cpSync(serverSrc, resolve(sidecarDir, 'server.cjs'));
console.log('Copied server.cjs');

// Also copy sourcemap if it exists
const mapSrc = resolve(distDir, 'index.cjs.map');
if (existsSync(mapSrc)) {
  cpSync(mapSrc, resolve(sidecarDir, 'server.cjs.map'));
  console.log('Copied server.cjs.map');
}

// 2. Copy externalized node_modules
const externalPackages = ['fastify', '@fastify/cors', '@fastify/static'];
const nodeModulesSrc = resolve(root, 'node_modules');
const nodeModulesDst = resolve(sidecarDir, 'node_modules');
mkdirSync(nodeModulesDst, { recursive: true });

for (const pkg of externalPackages) {
  const src = resolve(nodeModulesSrc, pkg);
  const dst = resolve(nodeModulesDst, pkg);
  if (existsSync(src)) {
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
    console.log(`Copied node_modules/${pkg}`);
  } else {
    console.warn(`WARNING: node_modules/${pkg} not found, skipping`);
  }
}

// Also copy transitive dependencies that fastify needs at runtime
// These are resolved dynamically and must be present
const fastifyTransitive = [
  'fast-json-stringify',
  'ajv',
  'ajv-formats',
  'fast-uri',
  'find-my-way',
  'light-my-request',
  'rfdc',
  'pino',
  'pino-std-serializers',
  'fast-redact',
  'on-exit-leak-free',
  'sonic-boom',
  'atomic-sleep',
  'abstract-logging',
  'avvio',
  'fast-content-type-parse',
  'process-warning',
  'require-from-string',
  '@fastify/error',
  '@fastify/merge-json-schemas',
  '@fastify/send',
  '@fastify/accept-negotiator',
  'toad-cache',
  'safe-regex2',
  'ret',
  'fast-deep-equal',
  'json-schema-traverse',
  'uri-js',
  'safe-stable-stringify',
  'thread-stream',
  'real-require',
];

for (const pkg of fastifyTransitive) {
  const src = resolve(nodeModulesSrc, pkg);
  const dst = resolve(nodeModulesDst, pkg);
  if (existsSync(src) && !existsSync(dst)) {
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
  }
}
console.log('Copied fastify transitive dependencies');

// 3. Copy bun binary
let bunPath;
try {
  bunPath = execSync('which bun', { encoding: 'utf-8' }).trim();
} catch {
  console.error('ERROR: bun not found on PATH');
  process.exit(1);
}
cpSync(bunPath, resolve(sidecarDir, 'bun'));
// Make executable
execSync(`chmod +x "${resolve(sidecarDir, 'bun')}"`);
console.log(`Copied bun from ${bunPath}`);

// 4. Create a package.json stub so require() resolution works
writeFileSync(
  resolve(sidecarDir, 'package.json'),
  JSON.stringify({ name: 'claude-devtools-sidecar', private: true, type: 'commonjs' }, null, 2)
);
console.log('Created package.json stub');

console.log('\nSidecar bundle complete at src-tauri/sidecar/');
