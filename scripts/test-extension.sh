#!/bin/bash

# 打包扩展
echo "Packaging extension..."
vsce package

# 卸载现有扩展
echo "Uninstalling existing extension..."
code --uninstall-extension vscode-ollama-1.2.0.vsix

# 安装新扩展
echo "Installing new extension..."
code --install-extension vscode-ollama-1.2.0.vsix

echo "Extension test process completed!" 