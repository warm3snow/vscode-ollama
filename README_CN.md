# VSCode Ollama 扩展

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

[English](README.md) | [中文](README_CN.md)

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

## 📺 使用教程

观看快速入门视频教程：

<video src="resources/tutorial.mp4" width="100%"></video>

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

### 配置项
- `ollama.baseUrl` - 服务器地址
- `ollama.model` - 默认模型
- `ollama.maxTokens` - 最大令牌数
- `ollama.keepAlive` - 保持连接时间
- `ollama.performanceMode` - 性能模式

## ❤️ 支持与捐赠

如果你觉得这个扩展程序很有用，你可以通过以下方式支持开发者：

<details>
<summary>💰 捐赠方式</summary>

<p align="center">支持开发者</p>

<table>
  <tr>
    <td align="center">
      <img src="resources/wechat.jpg" alt="微信支付" width="240"/>
      <br/>
      WeChat Pay
    </td>
    <td align="center">
      <img src="resources/alipay.jpg" alt="支付宝" width="240"/>
      <br/>
      Alipay
    </td>
  </tr>
</table>

### 🪙 Cryptocurrency

<table>
  <tr>
    <td>
      <b>Bitcoin</b>
    </td>
    <td>
      <b>Native Segwit</b><br/>
      <code>bc1qskds324wteq5kfmxh63g624htzwd34gky0f0q5</code>
      <br/><br/>
      <b>Taproot</b><br/>
      <code>bc1pk0zud9csztjrkqew54v2nv7g3kq0xc2n80jatkmz9axkve4trfcqp0aksf</code>
    </td>
  </tr>
  <tr>
    <td>
      <b>Ethereum</b>
    </td>
    <td>
      <code>0xB0DA3bbC5e9f8C4b4A12d493A72c33dBDf1A9803</code>
    </td>
  </tr>
  <tr>
    <td>
      <b>Solana</b>
    </td>
    <td>
      <code>AMvPLymJm4TZZgvrYU7DCVn4uuzh6gfJiHWNK35gmUzd</code>
    </td>
  </tr>
</table>

</details>

你的支持有助于维护和改进这个扩展程序！感谢你！ ❤️ 
- ⭐ 在 [GitHub 仓库](https://github.com/warm3snow/vscode-ollama) 上给个星标
- 📝 提交问题或反馈意见
- 🚀 为代码库做贡献
- 💬 分享给你的朋友们

## 📝 发布说明

查看 [CHANGELOG.md](CHANGELOG.md) 获取发布说明。

## 📝 许可证

本扩展基于 [MIT 许可证](LICENSE) 授权。
