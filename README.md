# Coding Agent V2

[![npm version](https://img.shields.io/npm/v/coding-agent-v2.svg)](https://www.npmjs.com/package/coding-agent-v2)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/coding-agent-v2.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

Enterprise-grade AI coding assistant CLI tool with interactive terminal UI, built with React and OpenTUI.

## ✨ Features

- **Interactive Terminal UI**: Beautiful, responsive terminal interface built with React
- **AI-Powered Assistance**: Intelligent code suggestions and completions
- **Slash Commands**: Built-in commands for common operations (`/help`, `/clear`, `/exit`)
- **Keyboard Shortcuts**: Efficient navigation and control
- **Configurable**: Extensive configuration options via environment variables and config files
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **TypeScript**: Full type safety and excellent developer experience

## 🚀 Quick Start

### Installation

```bash
# Install globally
npm install -g coding-agent-v2

# Or use npx
npx coding-agent-v2
```

### Basic Usage

```bash
# Start the interactive CLI
coding-agent

# Or run directly with npx
npx coding-agent-v2
```

## 📦 Installation

### Prerequisites

- Node.js 20.0.0 or higher
- npm, yarn, or pnpm

### Global Installation

```bash
npm install -g coding-agent-v2
```

### Local Installation

```bash
# Create a new project
mkdir my-project && cd my-project
npm init -y

# Install coding-agent-v2
npm install coding-agent-v2

# Add to package.json scripts
{
  "scripts": {
    "agent": "coding-agent"
  }
}
```

## 🎯 Usage

### Interactive Mode

```bash
coding-agent
```

This launches the interactive terminal UI where you can:
- Type natural language queries
- Use slash commands (`/help`, `/clear`, `/exit`)
- Navigate with keyboard shortcuts

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Esc` | Stop current response or clear input |
| `Ctrl+L` | Clear conversation |
| `Ctrl+C` | Exit application |
| `↑/↓` | Navigate command history |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands and shortcuts |
| `/clear` | Clear the conversation history |
| `/exit` | Exit the application |
| `/models` | List available AI models |
| `/files` | Show file browser |

## ⚙️ Configuration

### Environment Variables

Configure the agent using environment variables:

```bash
# Set the AI model
export AGENT_MODEL="gpt-4"

# Set maximum steps per run
export AGENT_MAX_STEPS=1000

# Set confirmation mode
export AGENT_TOOL_CONFIRMATION_MODE="manual"

# Set logging level
export AGENT_LOG_LEVEL="INFO"
```

### Configuration Files

Create a configuration file at `~/.renx/config.json`:

```json
{
  "agent": {
    "defaultModel": "gpt-4",
    "maxSteps": 1000,
    "confirmationMode": "manual"
  },
  "log": {
    "level": "INFO",
    "format": "pretty",
    "console": true,
    "file": false
  },
  "storage": {
    "fileHistory": {
      "enabled": true,
      "maxPerFile": 20,
      "maxAgeDays": 14,
      "maxTotalMb": 500
    }
  }
}
```

### Project Configuration

Create a project-specific config at `.renx/config.json` in your project root.

## 🔧 Development

### Setup

```bash
# Clone the repository
git clone https://github.com/your-username/coding-agent-v2.git
cd coding-agent-v2

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build

```bash
# Build for production
npm run build

# Build CLI executable
npm run build:cli
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Linting and Formatting

```bash
# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

## 📁 Project Structure

```
coding-agent-v2/
├── src/
│   ├── agent/          # AI agent logic
│   ├── commands/       # Slash commands
│   ├── components/     # React components
│   ├── runtime/        # Runtime utilities
│   ├── ui/             # UI themes and styling
│   ├── utils/          # Utility functions
│   ├── App.tsx         # Main application component
│   ├── cli.ts          # CLI entry point
│   └── index.tsx       # Library entry point
├── dist/               # Compiled output
├── package.json        # Package configuration
├── tsconfig.json       # TypeScript configuration
├── tsconfig.build.json # Build TypeScript configuration
└── README.md           # This file
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow TypeScript best practices
- Write tests for new features
- Update documentation as needed
- Follow the existing code style

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [OpenTUI](https://github.com/opentui/opentui) - Terminal UI framework
- [React](https://react.dev/) - UI library
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Vitest](https://vitest.dev/) - Testing framework

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/your-username/coding-agent-v2/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-username/coding-agent-v2/discussions)
- **Documentation**: [Wiki](https://github.com/your-username/coding-agent-v2/wiki)

## 🚀 Roadmap

- [ ] Plugin system for custom commands
- [ ] Multi-model support
- [ ] Codebase analysis features
- [ ] Integration with popular IDEs
- [ ] Cloud sync for configurations
- [ ] Team collaboration features

---

**Note**: This is an enterprise-grade tool designed for professional developers. Please ensure you have appropriate API keys and permissions for the AI models you intend to use.
