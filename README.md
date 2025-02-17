# VSCode Ollama Extension

<p align="center">
  <img src="resources/logo.png" alt="VSCode Ollama Logo" width="128"/>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=vscode-ollama">
    <img src="https://img.shields.io/visual-studio-marketplace/v/vscode-ollama.svg?color=blue&label=VS%20Code%20Marketplace&logo=visual-studio-code" alt="Visual Studio Marketplace Version">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=vscode-ollama">
    <img src="https://img.shields.io/visual-studio-marketplace/d/vscode-ollama.svg?color=blue&label=Downloads&logo=visual-studio-code" alt="Visual Studio Marketplace Downloads">
  </a>
  <a href="https://github.com/warm3snow/vscode-ollama/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/warm3snow/vscode-ollama.svg?color=blue&label=License&logo=github" alt="License">
  </a>
</p>

VSCode Ollama 是一个强大的 Visual Studio Code 扩展，它将 Ollama 的本地 LLM 能力无缝集成到您的开发环境中。

## ✨ 特性

- 🤖 **本地 LLM 支持**
  - 基于 Ollama 的本地模型运行
  - 支持多种模型切换
  - 低延迟响应

- 🔍 **联网搜索**
  - 实时网络信息集成
  - 智能搜索结果整合
  - 准确的信息引用

- 💡 **智能对话**
  - 流式响应输出
  - 思考过程可视化
  - 对话历史保存

- ⚙️ **灵活配置**
  - 自定义服务器地址
  - 可调节性能模式
  - 模型参数配置

## 🚀 快速开始

1. **安装 Ollama**
   ```bash
   # macOS
   brew install ollama

   # Linux
   curl -fsSL https://ollama.com/install.sh | sh
   ```

2. **安装扩展**
   - 在 VS Code 中打开扩展市场
   - 搜索 "VSCode Ollama"
   - 点击安装

3. **配置扩展**
   - 打开命令面板 (Ctrl+Shift+P / Cmd+Shift+P)
   - 输入 "Ollama: Settings"
   - 配置服务器地址和默认模型

4. **开始使用**
   - 使用命令 "Ollama: Open Chat" 开始对话
   - 在聊天界面选择模型
   - 开启/关闭联网搜索
   - 发送消息开始交互

## 📝 使用说明

### 命令列表
- `Ollama: Open Chat` - 打开聊天界面
- `Ollama: Settings` - 打开设置页面
- `Ollama: Test Connection` - 测试服务器连接

### 快捷键
- `Shift + Enter` - 在聊天输入框中换行
- `Enter` - 发送消息
- `Esc` - 关闭当前面板

### 配置项

## Features

- Configure and use Ollama models directly from VSCode
- Customize model settings including max tokens and performance mode
- Test connection to Ollama server
- View current configuration

## Requirements

- VSCode 1.60.0 or higher
- Ollama installed and running locally

## Extension Settings

This extension contributes the following settings:

* `vscode-ollama.baseUrl`: Ollama server URL
* `vscode-ollama.model`: Selected Ollama model
* `vscode-ollama.maxTokens`: Maximum tokens for context and response
* `vscode-ollama.keepAlive`: Model keep-alive duration
* `vscode-ollama.performanceMode`: Performance mode selection

## Commands

* `Ollama: Open Settings`: Display current Ollama settings
* `Ollama: Test Server Connection`: Test connection to Ollama server
* `Ollama: Refresh Models`: Refresh available models list
* `Ollama: Open Chat`: Open chat interface to interact with Ollama

## Release Notes

### 0.0.1

Initial release of VSCode Ollama
