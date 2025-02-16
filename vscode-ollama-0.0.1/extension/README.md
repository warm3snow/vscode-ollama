# VSCode Ollama

VSCode extension for Ollama integration, providing local LLM capabilities.

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

* `Ollama: Show Configuration`: Display current Ollama settings
* `Ollama: Test Connection`: Test connection to Ollama server

## Release Notes

### 0.0.1

Initial release of VSCode Ollama