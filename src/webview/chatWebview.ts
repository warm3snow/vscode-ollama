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
            }
            .message {
                margin: 10px 0;
                padding: 10px;
                border-radius: 4px;
            }
            .user-message {
                background: var(--vscode-input-background);
            }
            .assistant-message {
                background: var(--vscode-editor-background);
            }
            #input-container {
                display: flex;
                gap: 10px;
                padding: 10px;
            }
            #message-input {
                flex: 1;
                padding: 8px;
                border: 1px solid var(--vscode-input-border);
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 4px;
            }
            button {
                padding: 8px 16px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
            button:hover {
                background: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div id="chat-container"></div>
        <div id="input-container">
            <input type="text" id="message-input" placeholder="Type your message..." />
            <button onclick="sendMessage()">Send</button>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');

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
                    content
                });
            }

            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
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