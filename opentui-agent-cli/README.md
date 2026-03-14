# Renx Code

`renx` is a terminal AI coding assistant.

- Package: `@renxqoo/renx-code`
- Command: `renx`

## Features

`renx` can help you:

- read and explain a codebase
- edit files directly in your project
- fix build errors and runtime errors
- generate code, tests, and scripts
- inspect logs and terminal output
- work inside the current directory as the active workspace

## Install

Requirements:

- Node.js `20+`

Install:

```bash
npm i -g @renxqoo/renx-code --registry=https://registry.npmjs.org
```

Run:

```bash
renx
```

## Configuration

Config locations:

- global: `~/.renx/config.json`
- project: `<your-project>/.renx/config.json`

Priority:

1. environment variables
2. project config
3. global config
4. defaults

Example:

```json
{
  "agent": {
    "defaultModel": "qwen3.5-plus",
    "maxSteps": 10000,
    "confirmationMode": "manual"
  },
  "models": {
    "my-model": {
      "provider": "openai",
      "name": "My Model",
      "baseURL": "https://api.openai.com/v1",
      "envApiKey": "OPENAI_API_KEY",
      "model": "gpt-5.4"
    }
  }
}
```

## Publish

Useful local release commands:

```bash
npm run pack:dry
npm run pack:tgz
npm run publish:patch
npm run publish:minor
npm run publish:major
```

Version rules:

- `publish:patch`: small fix, `0.0.1`
- `publish:minor`: new feature, `0.1.0`
- `publish:major`: breaking change or refactor, `1.0.0`
