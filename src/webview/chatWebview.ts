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
                <button onclick="sendMessage()">Send</button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');
            const webSearchButton = document.getElementById('web-search');
            let webSearchEnabled = false;

            webSearchButton.addEventListener('click', () => {
                webSearchEnabled = !webSearchEnabled;
                webSearchButton.classList.toggle('active', webSearchEnabled);
                const status = webSearchButton.querySelector('.status');
                status.style.color = webSearchEnabled ? '#4CAF50' : '#666';
            });

            function appendMessage(content, isUser) {
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${isUser ? 'user-message' : 'assistant-message'}\`;
                messageDiv.textContent = content;
                chatContainer.appendChild(messageDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            async function sendMessage() {
                const content = messageInput.value.trim();
                if (!content) return;

                appendMessage(content, true);
                messageInput.value = '';

                vscode.postMessage({
                    command: 'sendMessage',
                    content,
                    webSearch: webSearchEnabled
                });
            }

            messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'receiveMessage') {
                    appendMessage(message.content, false);
                } else if (message.command === 'streamMessage') {
                    if (!message.done) {
                        if (!document.querySelector('.message.assistant-message.streaming')) {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'message assistant-message streaming';
                            chatContainer.appendChild(messageDiv);
                        }
                        
                        const streamingDiv = document.querySelector('.message.assistant-message.streaming');
                        if (streamingDiv) {
                            streamingDiv.textContent = (streamingDiv.textContent || '') + message.content;
                        }
                    } else {
                        const streamingDiv = document.querySelector('.message.assistant-message.streaming');
                        if (streamingDiv) {
                            streamingDiv.classList.remove('streaming');
                        }
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }
                }
            });
        </script>
    </body>
    </html>`;
} 