#!/usr/bin/env node
import { runCli } from './cli/index';

void runCli()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(message);
    process.exitCode = 1;
  });
