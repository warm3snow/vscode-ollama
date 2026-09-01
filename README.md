# VSCode Ollama

<p align="center">
  <img src="resources/logo.png" alt="VSCode Ollama Logo" width="128"/>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=warm3snow.vscode-ollama">
    <img src="https://img.shields.io/visual-studio-marketplace/i/warm3snow.vscode-ollama?logo=visual-studio-code" alt="Downloads"/>
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=warm3snow.vscode-ollama">
    <img src="https://img.shields.io/visual-studio-marketplace/r/warm3snow.vscode-ollama?logo=visual-studio-code" alt="Rating"/>
  </a>
  <a href="https://github.com/warm3snow/vscode-ollama">
    <img src="https://img.shields.io/github/stars/warm3snow/vscode-ollama?style=social" alt="GitHub stars"/>
  </a>
  <a href="https://github.com/warm3snow/vscode-ollama/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"/>
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README_CN.md">中文</a>
</p>

Bring the power of [Ollama](https://ollama.com) into VS Code — run local LLMs, chat, and let an autonomous coding agent read and modify your workspace, all without leaving your editor.

## ✨ Features

| | |
|---|---|
| 🤖 **Local LLMs** | Run models locally via Ollama with low-latency, private responses and instant model switching. |
| 💬 **Intelligent Chat** | Streaming output, visualized thought process, and preserved chat history. |
| 🛠️ **Coding Agent** | An autonomous agent with `read` / `write` / `edit` / `grep` / `find` / `ls` / `bash` tools that reads and modifies your workspace. Risky operations ask for confirmation first. |
| 🧩 **Subagents** | Delegate work to built-in `codebase-search` / `plan` / `implement` / `review` agents, in serial or parallel. |
| ⚙️ **Flexible Configuration** | Custom server address, model, token limits, and per-agent tool/confirmation settings. |

## 📸 Screenshots

<p align="center">
  <img src="resources/chat.png" alt="Chat Interface" width="800"/>
  <br/>
  <em>Chat interface with live agent activity</em>
</p>

<p align="center">
  <img src="resources/settings.png" alt="Settings Interface" width="800"/>
  <br/>
  <em>Settings page</em>
</p>

## 🚀 Installation

### 1. Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

Pull a model before use:

```bash
ollama pull qwen2.5-coder:7b
```

### 2. Install the Extension

Open the Extensions view in VS Code, search for **"VSCode Ollama"**, and click **Install**.

### 3. Configure

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run **"Ollama: Settings"**, then set your server address and default model.

## 📖 Usage

Open the Command Palette and run **"Ollama: Open Chat"** to start a conversation.

### Commands

| Command | Description |
|---|---|
| `Ollama: Open Chat` | Open the chat interface |
| `Ollama: Settings` | Open the settings page |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send message |
| `Shift + Enter` | Insert a new line |

### Settings

| Setting | Default | Description |
|---|---|---|
| `vscode-ollama.baseUrl` | `http://127.0.0.1:11434` | Ollama server address |
| `vscode-ollama.model` | `deepseek-r1:32b` | Default model |
| `vscode-ollama.maxTokens` | `4096` | Maximum response tokens |
| `vscode-ollama.keepAlive` | `5 minutes` | Model keep-alive duration |
| `vscode-ollama.systemPrompt` | — | System prompt for chat conversations |

### Coding Agent

Chat requests run in Agent mode by default — the model decides which files to read, which commands to run, and how to change the code, while the panel shows its thinking, tool calls, and results.

The agent supports the `/reset` command to clear the context and drop the current session.

The agent can delegate to subagents with an isolated context window:

- `codebase-search` — locate relevant code and return structured findings
- `plan` — turn context and requirements into a concrete implementation plan
- `implement` — execute a task with full tool access
- `review` — review code for quality and security

> ⚠️ Agent mode requires Node ≥ 22.19 (a recent VS Code build). On older builds plain chat still works and Agent mode reports a clear message.
>
> Your local model must support tool calling for the agent to actually invoke tools.

## 🤝 Support

If this extension helps you, here are a few ways to show support:

- ⭐ Star the [repository](https://github.com/warm3snow/vscode-ollama)
- 🚀 Contribute to the codebase
- 💬 Share it with your friends

## 📄 Release Notes

See [CHANGELOG.md](CHANGELOG.md).

## 📄 License

Licensed under the [MIT License](LICENSE).

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=warm3snow/vscode-ollama&type=Date)](https://star-history.com/#warm3snow/vscode-ollama&Date)
