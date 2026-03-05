#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tsxCliPath = require.resolve('tsx/dist/cli.mjs');
const entry = path.resolve(__dirname, '..', 'src', 'cli.ts');

const result = spawnSync(process.execPath, [tsxCliPath, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
