# VSCode Ollama Extension

<p align="center">
  <img src="resources/logo.png" alt="VSCode Ollama Logo" width="128"/>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=warm3snow.vscode-ollama">
    <img src="https://img.shields.io/visual-studio-marketplace/v/warm3snow.vscode-ollama.svg?color=blue&label=VS%20Code%20Marketplace&logo=visual-studio-code" alt="Visual Studio Marketplace Version">
    </a>
    <a href="https://marketplace.visualstudio.com/items?itemName=warm3snow.vscode-ollama">
    <img src="https://img.shields.io/visual-studio-marketplace/d/warm3snow.vscode-ollama.svg?color=blue&label=Downloads&logo=visual-studio-code" alt="Visual Studio Marketplace Downloads">
  </a>
  <a href="https://github.com/warm3snow/vscode-ollama/blob/master/LICENSE">
    <img src="https://img.shields.io/github/license/warm3snow/vscode-ollama.svg?color=blue&label=License&logo=github" alt="License">
  </a>
</p>

[English](README.md) | [中文](README_CN.md)

VSCode Ollama is a powerful Visual Studio Code extension that seamlessly integrates Ollama's local LLM capabilities into your development environment.

## ✨ Features

- 🤖 **Local LLM Support**
  - Local model execution based on Ollama
  - Multiple model switching support
  - Low-latency responses

- 🔍 **Web Search** [Coming Soon]
  - Real-time web information integration
  - Smart search results synthesis
  - Accurate information citation

- 💡 **Intelligent Chat**
  - Streaming response output
  - Thought process visualization
  - Chat history preservation

- ⚙️ **Flexible Configuration**
  - Custom server address
  - Adjustable performance modes
  - Model parameter configuration

## 🚀 Quick Start

1. **Install Ollama**
   ```bash
   # macOS
   brew install ollama

   # Linux
   curl -fsSL https://ollama.com/install.sh | sh
   ```

2. **Install Extension**
   - Open Extensions in VS Code
   - Search for "VSCode Ollama"
   - Click Install

3. **Configure Extension**
   - Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
   - Type "Ollama: Settings"
   - Configure server address and default model

4. **Start Using**
   - Use command "Ollama: Open Chat" to start conversation
   - Select model in chat interface
   - Toggle web search
   - Send message to interact

## 📝 Usage

### Commands
- `Ollama: Open Chat` - Open chat interface
- `Ollama: Settings` - Open settings page
- `Ollama: Test Connection` - Test server connection

### Shortcuts
- `Shift + Enter` - New line in chat input
- `Enter` - Send message
- `Esc` - Close current panel