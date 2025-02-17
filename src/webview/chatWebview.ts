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
        </style>
    </head>
    <body>
        <div id="chat-container"></div>
        <div class="input-wrapper">
            <button id="web-search">
                <span>联网搜索</span>
                <span class="status">●</span>
            </button>
            <div id="input-container">
                <input type="text" id="message-input" placeholder="有问题，尽管问，shift+enter换行" />
                <button id="send-button" onclick="handleSendClick()">Send</button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');
            const webSearchButton = document.getElementById('web-search');
            const sendButton = document.getElementById('send-button');
            let webSearchEnabled = false;
            let isGenerating = false;

            function updateSendButton(generating) {
                isGenerating = generating;
                sendButton.textContent = generating ? 'Stop' : 'Send';
                sendButton.classList.toggle('sending', generating);
            }

            function handleSendClick() {
                if (isGenerating) {
                    // 发送停止命令
                    vscode.postMessage({
                        command: 'stopGeneration'
                    });
                    updateSendButton(false);
                } else {
                    sendMessage();
                }
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
            }

            function formatMessage(content: string): string {
                // 处理代码块
                content = content.replace(/```([\s\S]*?)```/g, (match, code) => {
                    return `<pre class="code-block"><code>${code}</code></pre>`;
                });

                // 处理行内代码
                content = content.replace(/`([^`]+)`/g, '<code>$1</code>');

                // 处理换行和段落
                content = content
                    // 将连续的多个换行替换为两个换行（形成段落）
                    .replace(/\n{3,}/g, '\n\n')
                    // 将单个换行替换为 <br>
                    .replace(/\n/g, '<br>')
                    // 将段落（两个换行）替换为段落标签
                    .replace(/<br><br>/g, '</p><p>');

                // 包装在段落标签中
                return `<p>${content}</p>`;
            }

            async function sendMessage() {
                const content = messageInput.value.trim();
                if (!content) return;

                appendMessage(content, true);
                messageInput.value = '';
                updateSendButton(true);

                vscode.postMessage({
                    command: 'sendMessage',
                    content,
                    webSearch: webSearchEnabled
                });
            }

            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
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
                            // 清除任何可能存在的流式消息
                            const streamingMessages = document.querySelectorAll('.message.assistant-message.streaming');
                            streamingMessages.forEach(msg => {
                                msg.classList.remove('streaming');
                            });
                            
                            // 创建新的消息 div
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'message assistant-message streaming';
                            chatContainer.appendChild(messageDiv);
                        }
                        
                        const streamingDiv = document.querySelector('.message.assistant-message.streaming');
                        if (streamingDiv) {
                            const formattedContent = formatMessage(
                                processThinkTags((streamingDiv.textContent || '') + message.content)
                            );
                            streamingDiv.innerHTML = formattedContent;
                        }
                    } else {
                        const streamingDiv = document.querySelector('.message.assistant-message.streaming');
                        if (streamingDiv) {
                            streamingDiv.classList.remove('streaming');
                        }
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                        updateSendButton(false);
                    }
                } else if (message.command === 'receiveMessage') {
                    appendMessage(message.content, false);
                }
            });
        </script>
    </body>
    </html>`;
} 