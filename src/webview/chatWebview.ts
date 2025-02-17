import * as vscode from 'vscode';

export function getChatWebviewContent(config: any): string {
    return `<!DOCTYPE html>
    <html>
    <head>
        <style>
            body {
                padding: 20px;
                color: var(--vscode-foreground);
                font-family: var(--vscode-font-family);
                display: flex;
                flex-direction: column;
                height: 100vh;
                margin: 0;
            }
            #chat-container {
                flex: 1;
                overflow-y: auto;
                margin-bottom: 20px;
                padding: 15px;
                border: 1px solid var(--vscode-input-border);
                border-radius: 6px;
                background: var(--vscode-editor-background);
            }
            .message {
                margin: 10px 0;
                padding: 12px;
                border-radius: 6px;
                max-width: 85%;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
            }
            .user-message {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                margin-left: 0;
                border-top-left-radius: 2px;
            }
            .assistant-message {
                background: var(--vscode-input-background);
                margin-right: 0;
                border-top-right-radius: 2px;
            }
            .input-wrapper {
                position: relative;
                border: 1px solid var(--vscode-input-border);
                border-radius: 6px;
                padding: 15px;
                background: var(--vscode-editor-background);
            }
            #web-search {
                position: absolute;
                top: -30px;
                left: 15px;
                z-index: 1;
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                border: 1px solid var(--vscode-button-border);
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
            }
            #web-search.active {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }
            #web-search .status {
                color: #666;
                font-size: 10px;
            }
            #input-container {
                display: flex;
                gap: 10px;
                align-items: center;
            }
            #message-input {
                flex: 1;
                padding: 12px;
                border: 2px solid var(--vscode-input-border);
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 6px;
                font-size: 14px;
                transition: all 0.3s ease;
                resize: none;
                min-height: 24px;
                max-height: 200px;
                outline: none;
            }
            #message-input:focus {
                border-color: var(--vscode-focusBorder);
                box-shadow: 0 0 0 2px var(--vscode-focusBorder, #007fd4)33;
            }
            #message-input:hover:not(:focus) {
                border-color: var(--vscode-input-border);
                box-shadow: 0 0 0 1px var(--vscode-input-border);
            }
            button {
                padding: 8px 16px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.2s ease;
                min-width: 80px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            button:hover {
                background: var(--vscode-button-hoverBackground);
                transform: translateY(-1px);
            }
            button:active {
                transform: translateY(0);
            }
            .think-content {
                margin: 8px 0;
                padding: 8px 12px;
                background: var(--vscode-textBlockQuote-background);
                border-left: 3px solid var(--vscode-textBlockQuote-border);
                font-size: 0.9em;
                color: var(--vscode-textBlockQuote-foreground);
            }
            .think-header {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                user-select: none;
                color: var(--vscode-textLink-foreground);
                font-size: 0.9em;
            }
            .think-header:hover {
                color: var(--vscode-textLink-activeForeground);
            }
            .think-toggle {
                display: inline-block;
                width: 12px;
                height: 12px;
                text-align: center;
                line-height: 12px;
                transition: transform 0.2s;
            }
            .think-content.collapsed {
                display: none;
            }
            .think-header.collapsed .think-toggle {
                transform: rotate(-90deg);
            }
            .sending {
                background: var(--vscode-errorForeground) !important;
            }
            
            .sending:hover {
                background: var(--vscode-errorForeground) !important;
                opacity: 0.8;
            }

            .menu-button {
                position: absolute;
                top: 10px;
                right: 10px;
                padding: 4px 8px;
                background: transparent;
                border: none;
                cursor: pointer;
                font-size: 16px;
                min-width: auto;
                color: var(--vscode-foreground);
                opacity: 0.6;
            }
            
            .menu-button:hover {
                opacity: 1;
                background: transparent;
                transform: none;
            }
            
            .menu {
                position: absolute;
                top: 40px;
                right: 10px;
                background: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 4px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                display: none;
                z-index: 1000;
            }
            
            .menu.show {
                display: block;
            }
            
            .menu-item {
                padding: 8px 16px;
                cursor: pointer;
                color: var(--vscode-foreground);
                font-size: 13px;
                white-space: nowrap;
            }
            
            .menu-item:hover {
                background: var(--vscode-list-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div id="chat-container"></div>
        <button class="menu-button" id="menu-button">⋮</button>
        <div class="menu" id="menu">
            <div class="menu-item" id="clear-chat">清除对话</div>
        </div>
        <div class="input-wrapper">
            <button id="web-search">
                <span>联网搜索</span>
                <span class="status">●</span>
            </button>
            <div id="input-container">
                <textarea id="message-input" 
                    placeholder="有问题，尽管问，shift+enter换行" 
                    rows="1"></textarea>
                <button id="send-button">Send</button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');
            const webSearchButton = document.getElementById('web-search');
            const sendButton = document.getElementById('send-button');
            const menuButton = document.getElementById('menu-button');
            const menu = document.getElementById('menu');
            const clearChatButton = document.getElementById('clear-chat');
            let webSearchEnabled = false;
            let isGenerating = false;

            // 恢复对话历史
            const state = vscode.getState() || { messages: [] };
            state.messages.forEach(msg => {
                appendMessage(msg.content, msg.isUser);
            });

            // 菜单按钮点击事件
            menuButton.onclick = (e) => {
                e.stopPropagation();
                menu.classList.toggle('show');
            };

            // 点击菜单外区域关闭菜单
            document.addEventListener('click', (e) => {
                if (!menu.contains(e.target) && e.target !== menuButton) {
                    menu.classList.remove('show');
                }
            });

            // 清除对话按钮点击事件
            clearChatButton.onclick = () => {
                chatContainer.innerHTML = '';
                vscode.setState({ messages: [] });
                menu.classList.remove('show');
            };

            // 发送按钮点击事件
            sendButton.onclick = () => {
                if (isGenerating) {
                    vscode.postMessage({
                        command: 'stopGeneration'
                    });
                    updateSendButton(false);
                } else {
                    sendMessage();
                }
            };

            // 联网搜索按钮点击事件
            webSearchButton.onclick = () => {
                webSearchEnabled = !webSearchEnabled;
                webSearchButton.classList.toggle('active', webSearchEnabled);
                const status = webSearchButton.querySelector('.status');
                if (status) {
                    status.style.color = webSearchEnabled ? '#4CAF50' : '#666';
                }
            };

            // 输入框事件处理
            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    if (e.shiftKey) {
                        return; // Shift+Enter 换行
                    }
                    e.preventDefault();
                    if (!isGenerating) {
                        sendMessage();
                    } else {
                        vscode.postMessage({
                            command: 'stopGeneration'
                        });
                        updateSendButton(false);
                    }
                }
            });

            // 输入框自动调整高度
            messageInput.addEventListener('input', function() {
                this.style.height = 'auto';
                const newHeight = Math.min(this.scrollHeight, 200);
                this.style.height = newHeight + 'px';
            });

            function updateSendButton(generating) {
                isGenerating = generating;
                sendButton.textContent = generating ? 'Stop' : 'Send';
                sendButton.classList.toggle('sending', generating);
            }

            function sendMessage() {
                const content = messageInput.value.trim();
                if (!content) return;

                appendMessage(content, true);
                messageInput.value = '';
                messageInput.style.height = 'auto';
                updateSendButton(true);

                vscode.postMessage({
                    command: 'sendMessage',
                    content,
                    webSearch: webSearchEnabled
                });
            }

            function processThinkTags(content) {
                const thinkRegex = /<think>(.*?)<\\/think>/gs;
                let lastIndex = 0;
                let result = '';
                let match;
                let thinkCount = 0;

                while ((match = thinkRegex.exec(content)) !== null) {
                    // Add text before the <think> tag
                    result += content.slice(lastIndex, match.index);
                    
                    // Add the think content with collapsible UI
                    const thinkContent = match[1].trim();
                    result += \`
                        <div class="think-section">
                            <div class="think-header" onclick="toggleThink(this)">
                                <span class="think-toggle">▼</span>
                                <span>思考过程 #\${++thinkCount}</span>
                            </div>
                            <div class="think-content">\${thinkContent}</div>
                        </div>
                    \`;
                    
                    lastIndex = match.index + match[0].length;
                }

                // Add any remaining text after the last <think> tag
                result += content.slice(lastIndex);
                return result;
            }

            function toggleThink(header) {
                const content = header.nextElementSibling;
                content.classList.toggle('collapsed');
                header.classList.toggle('collapsed');
            }

            function appendMessage(content, isUser) {
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${isUser ? 'user-message' : 'assistant-message'}\`;
                
                if (isUser) {
                    messageDiv.textContent = content;
                } else {
                    messageDiv.innerHTML = processThinkTags(content);
                }
                
                chatContainer.appendChild(messageDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;

                // 保存消息到状态
                const state = vscode.getState() || { messages: [] };
                state.messages.push({ content, isUser });
                vscode.setState(state);
            }

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'resetChat') {
                    // 清除所有正在流式传输的消息
                    const streamingMessages = document.querySelectorAll('.message.assistant-message.streaming');
                    streamingMessages.forEach(msg => {
                        msg.classList.remove('streaming');
                    });
                } else if (message.command === 'streamMessage') {
                    if (!message.done) {
                        if (message.newMessage) {
                            // 创建新的消息 div
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'message assistant-message streaming';
                            chatContainer.appendChild(messageDiv);
                        }
                        
                        const streamingDiv = document.querySelector('.message.assistant-message.streaming');
                        if (streamingDiv) {
                            streamingDiv.innerHTML = processThinkTags(
                                (streamingDiv.textContent || '') + message.content
                            );
                        }
                    } else {
                        const streamingDiv = document.querySelector('.message.assistant-message.streaming');
                        if (streamingDiv) {
                            streamingDiv.classList.remove('streaming');
                            // 保存完成的消息到状态
                            const state = vscode.getState() || { messages: [] };
                            state.messages.push({ 
                                content: streamingDiv.innerHTML, 
                                isUser: false 
                            });
                            vscode.setState(state);
                        }
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                        updateSendButton(false);
                    }
                } else if (message.command === 'receiveMessage') {
                    appendMessage(message.content, false);
                } else if (message.command === 'welcomeMessage') {
                    // 创建并添加欢迎消息
                    const welcomeDiv = document.createElement('div');
                    welcomeDiv.className = 'message assistant-message';
                    welcomeDiv.innerHTML = \`
                        <div style="
                            background: var(--vscode-textLink-activeForeground);
                            padding: 15px;
                            border-radius: 8px;
                            margin-bottom: 20px;
                            animation: fadeIn 0.5s ease-in;
                        ">
                            <h2 style="margin: 0 0 10px 0; color: var(--vscode-button-foreground);">
                                👋 Welcome to VSCode Ollama!
                            </h2>
                            <p style="margin: 0; color: var(--vscode-button-foreground);">
                                <a href="https://github.com/warm3snow/vscode-ollama" style="color: var(--vscode-button-foreground);">
                                [vscode-ollama] </a>是一款基于本地 Ollama 服务的 VS Code 扩展，支持模型配置、联网查询等多种特性。欢迎关注GitHub仓库并Star以支持开发者持续优化！
                                <br><br>
                                GitHub 仓库：<a href="https://github.com/warm3snow/vscode-ollama" style="color: var(--vscode-button-foreground);">
                                    https://github.com/warm3snow/vscode-ollama
                                </a>
                            </p>
                        </div>
                    \`;
                    chatContainer.appendChild(welcomeDiv);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
            });

            window.addEventListener('load', () => {
                // 通知扩展 webview 已准备就绪
                vscode.postMessage({
                    command: 'webviewReady'
                });
            });
        </script>
    </body>
    </html>`;
} 