import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { marked } from 'marked';

// 在文件顶部添加类型声明
declare global {
    interface Window {
        toggleThink: (header: HTMLElement) => void;
    }
}

export function getChatWebviewContent(config: any): string {
    // Remove the file reading code
    // const markedPath = path.join(__dirname, '..', 'lib', 'marked.min.js');
    // const marked = fs.readFileSync(markedPath, 'utf-8');

    // Define the processMessage function as a string
    const processMessageFn = `
        function processMessage(content) {
            // 1. 处理转义字符
            content = content.replace(/\\\\u003c/g, '<')
                           .replace(/\\\\u003e/g, '>');
            
            // 2. 将 <br> 转换为实际的换行符，这样 marked 可以正确处理
            content = content.replace(/<br>/g, '\\n');
            
            // 3. 处理思考标签
            content = content.replace(/<think>([\\\\s\\\\S]*?)<\\/think>/g, (match, p1) => {
                // 生成唯一ID
                const thinkId = 'think-' + Math.random().toString(36).substr(2, 9);
                
                const html = [
                    '<div class="think-section">',
                    '    <div class="think-header" data-think-id="' + thinkId + '">',
                    '        <span class="think-toggle">▼</span>',
                    '        <span>思考过程</span>',
                    '    </div>',
                    '    <div class="think-content" id="' + thinkId + '">' + p1.replace(/\\n/g, '<br>') + '</div>',
                    '</div>'
                ].join('');

                // 确保在下一个事件循环中初始化这个think section
                setTimeout(() => initThinkSection(thinkId), 0);
                
                return html;
            });
            
            return content;
        }

        // 初始化单个think section
        function initThinkSection(thinkId) {
            const header = document.querySelector('[data-think-id="' + thinkId + '"]');
            const content = document.getElementById(thinkId);
            
            if (!header || !content) return;
            
            if (!header.hasAttribute('data-initialized')) {
                header.setAttribute('data-initialized', 'true');
                
                header.addEventListener('click', function() {
                    content.classList.toggle('collapsed');
                    header.classList.toggle('collapsed');
                    
                    const toggle = header.querySelector('.think-toggle');
                    if (toggle) {
                        toggle.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
                    }
                });
            }
        }

        // 初始化所有think sections
        function initAllThinkSections() {
            const headers = document.querySelectorAll('.think-header[data-think-id]');
            headers.forEach(header => {
                const thinkId = header.getAttribute('data-think-id');
                if (thinkId) {
                    initThinkSection(thinkId);
                }
            });
        }
    `;

    // 添加会话ID追踪
    let currentConversationId: string | null = null;

    // 修改 appendMessage 函数
    const appendMessageFn = `
        function appendMessage(content, isUser) {
            let currentGroup = chatContainer.lastElementChild;
            
            if (isUser || !currentGroup || !currentGroup.classList.contains('conversation-group')) {
                currentGroup = document.createElement('div');
                currentGroup.className = 'conversation-group';
                chatContainer.appendChild(currentGroup);
            }

            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (isUser ? 'user-message' : 'assistant-message');
            
            if (!isUser) {
                messageDiv.setAttribute('data-conversation-id', currentConversationId || '');
            }
            
            const prefixDiv = document.createElement('div');
            prefixDiv.className = 'message-prefix';
            prefixDiv.textContent = isUser ? '- 我' : '- ' + currentModelName;
            messageDiv.appendChild(prefixDiv);
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content markdown-content';
            
            if (isUser) {
                // 对用户消息，直接将 <br> 转换为换行符
                contentDiv.innerHTML = content.replace(/<br>/g, '\\n');
            } else {
                // 保存原始 markdown 内容
                contentDiv.setAttribute('data-markdown-content', content);
                
                // 使用 marked 的配置来允许 HTML 标签
                const markedOptions = {
                    breaks: true,        // 将换行符转换为 <br>
                    gfm: true,          // 启用 GitHub 风格的 markdown
                    xhtml: true,        // 使用 xhtml 格式的标签
                };
                
                contentDiv.innerHTML = marked.parse(processMessage(content), markedOptions);
            }
            
            messageDiv.appendChild(contentDiv);
            currentGroup.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;

            // Initialize new think sections in the message
            initAllThinkSections();
        }
    `;

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
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                background: var(--vscode-editor-background);
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
            }
            .message {
                margin: 10px 0;
                padding: 12px;
                border-radius: 8px;
                max-width: 85%;
                background: transparent;
            }
            .message-prefix {
                color: var(--vscode-textLink-foreground);
                font-size: 0.9em;
                margin-bottom: 4px;
                opacity: 0.8;
            }
            .message-content {
                margin-left: 8px;
                white-space: pre-wrap;
                word-wrap: break-word;
            }
            .user-message {
                color: var(--vscode-foreground);
                margin-left: 0;
                opacity: 0.9;
            }
            .assistant-message {
                color: var(--vscode-foreground);
                margin-right: 0;
                opacity: 1;
            }
            .input-wrapper {
                position: relative;
                margin-bottom: 32px;
                padding: 15px;
                background: var(--vscode-editor-background);
                border-radius: 8px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
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
                border: none;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 6px;
                font-size: 14px;
                transition: opacity 0.3s ease, cursor 0.3s ease;
                resize: none;
                min-height: 24px;
                max-height: 200px;
                outline: none;
            }
            #message-input:focus {
                outline: none;
                background: var(--vscode-input-background);
            }
            #message-input:hover:not(:focus) {
                outline: none;
                background: var(--vscode-input-background);
            }
            #message-input:disabled {
                opacity: 0.7;
                cursor: not-allowed;
                background: var(--vscode-input-background) !important;
                color: var(--vscode-input-foreground) !important;
            }
            #message-input:disabled::placeholder {
                color: var(--vscode-input-placeholderForeground);
                opacity: 0.7;
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
                white-space: pre-wrap;
                word-wrap: break-word;
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

            /* 优化菜单按钮位置和样式 */
            .menu-button {
                position: absolute;
                top: 15px;          /* 调整垂直位置 */
                right: 15px;        /* 调整水平位置 */
                padding: 8px 12px;  /* 增加点击区域 */
                background: transparent;
                border: none;
                cursor: pointer;
                font-size: 20px;
                min-width: auto;
                color: var(--vscode-foreground);
                opacity: 0.6;
                line-height: 0.5;
                transition: opacity 0.2s ease;
            }
            
            .menu-button:hover {
                opacity: 1;
            }
            
            /* 菜单样式优化 */
            .menu {
                position: absolute;
                top: 40px;
                right: 15px;
                background: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                z-index: 1000;
                min-width: 120px;
                display: none;
            }
            
            .menu.show {
                display: block;
            }
            
            /* 修改二级菜单样式 */
            .has-submenu {
                position: relative;
                padding-right: 24px;
            }

            .has-submenu::after {
                content: '◀'; /* 改为左箭头 */
                position: absolute;
                right: 8px;
                top: 50%;
                transform: translateY(-50%);
                font-size: 10px;
                opacity: 0.7;
            }

            .submenu {
                position: absolute;
                right: 100%; /* 改为右侧100% */
                top: 0;
                background: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                display: none;
                min-width: 120px;
                margin-right: 4px; /* 添加间距 */
            }

            .has-submenu:hover .submenu {
                display: block;
            }

            .menu-item {
                padding: 8px 16px;
                cursor: pointer;
                color: var(--vscode-foreground);
                font-size: 13px;
                white-space: nowrap;
                transition: background-color 0.2s ease;
            }
            
            .menu-item:hover {
                background: var(--vscode-list-hoverBackground);
            }

            .menu-item.active {
                color: var(--vscode-textLink-foreground);
            }

            .menu-separator {
                height: 1px;
                background-color: var(--vscode-dropdown-border);
                margin: 4px 0;
            }

            /* 美化聊天容器边框 */
            .conversation-group {
                padding: 12px;
                margin: 8px 0;
                border-radius: 8px;
                transition: background-color 0.2s ease;
            }

            .conversation-group:nth-child(odd) {
                background-color: var(--vscode-editor-background);
            }

            .conversation-group:nth-child(even) {
                background-color: var(--vscode-editor-inactiveSelectionBackground);
            }

            /* 添加Markdown样式 */
            .markdown-content {
                line-height: 1.6;
            }
            .markdown-content code {
                background: var(--vscode-textCodeBlock-background);
                padding: 2px 6px;
                border-radius: 4px;
                font-family: var(--vscode-editor-font-family);
                font-size: 0.9em;
            }
            .markdown-content pre {
                background: var(--vscode-textCodeBlock-background);
                padding: 16px;
                border-radius: 6px;
                overflow-x: auto;
            }
            .markdown-content pre code {
                background: none;
                padding: 0;
            }
            .markdown-content blockquote {
                border-left: 4px solid var(--vscode-textBlockQuote-border);
                margin: 0;
                padding-left: 16px;
                color: var(--vscode-textBlockQuote-foreground);
            }
            .markdown-content table {
                border-collapse: collapse;
                width: 100%;
                margin: 16px 0;
            }
            .markdown-content th, .markdown-content td {
                border: 1px solid var(--vscode-input-border);
                padding: 8px;
            }

            .think-section,
            .think-header,
            .think-toggle,
            .think-content {
                display: none;
            }

            /* 命令提示样式 */
            .command-suggestions {
                position: absolute;
                bottom: 100%;
                left: 0;
                right: 0;
                background: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 6px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                z-index: 1000;
                max-height: 200px;
                overflow-y: auto;
            }

            .command-item {
                padding: 8px 12px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .command-item:hover,
            .command-item.selected {
                background: var(--vscode-list-hoverBackground);
            }

            .command-name {
                color: var(--vscode-textLink-foreground);
                font-weight: 500;
            }

            .command-description {
                color: var(--vscode-descriptionForeground);
                font-size: 0.9em;
            }

            /* 添加命令建议相关的样式 */
            #command-suggestions {
                position: absolute;
                top: -120px;
                left: 0;
                right: 0;
                background: var(--vscode-dropdown-background);
                border: 1px solid var(--vscode-dropdown-border);
                border-radius: 4px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                z-index: 1000;
            }
            .command-item {
                padding: 8px 12px;
                cursor: pointer;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .command-item:hover, .command-item.selected {
                background: var(--vscode-list-hoverBackground);
            }
            .command-name {
                color: var(--vscode-foreground);
                font-weight: bold;
            }
            .command-description {
                color: var(--vscode-descriptionForeground);
                font-size: 0.9em;
                margin-left: 12px;
            }

            /* 修改作者信息样式 */
            .author-info {
                position: absolute;
                bottom: -24px;
                right: 0;
                padding: 4px 8px;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                text-align: right;
                opacity: 0.8;
            }

            .author-info a {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
            }

            .author-info a:hover {
                text-decoration: underline;
            }

            .save-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                background: var(--vscode-notificationToast-background);
                color: var(--vscode-notificationToast-foreground);
                padding: 8px 16px;
                border-radius: 4px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                z-index: 1000;
                animation: fadeInOut 2s ease-in-out;
            }

            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateY(-20px); }
                10% { opacity: 1; transform: translateY(0); }
                90% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-20px); }
            }

            .think-section {
                margin: 10px 0;
                background: var(--vscode-editor-inactiveSelectionBackground);
                border-radius: 6px;
                overflow: hidden;
            }

            .think-header {
                padding: 8px 12px;
                cursor: pointer;
                user-select: none;
                display: flex;
                align-items: center;
                gap: 8px;
                color: var(--vscode-textLink-foreground);
                font-size: 0.9em;
                background: var(--vscode-editor-background);
            }

            .think-header:hover {
                background: var(--vscode-list-hoverBackground);
            }

            .think-toggle {
                display: inline-block;
                transition: transform 0.2s;
                font-family: monospace;
                width: 12px;
                text-align: center;
            }

            .think-content {
                padding: 12px;
                border-top: 1px solid var(--vscode-input-border);
                white-space: pre-wrap;
                word-wrap: break-word;
                transition: all 0.3s ease;
                max-height: 1000px;
                overflow: hidden;
                opacity: 1;
            }

            .think-content.collapsed {
                max-height: 0;
                padding-top: 0;
                padding-bottom: 0;
                opacity: 0;
                border-top: none;
            }

            .think-header.collapsed .think-toggle {
                transform: rotate(-90deg);
            }
        </style>
        <script>
            // Import marked from CDN instead
            const markedScript = document.createElement('script');
            markedScript.src = 'https://cdn.jsdelivr.net/npm/marked@9.0.0/marked.min.js';
            document.head.appendChild(markedScript);
        </script>
    </head>
    <body>
        <div id="chat-container"></div>
        <button class="menu-button" id="menu-button">⋯</button>
        <div class="menu" id="menu">
            <div class="menu-item" id="clear-chat">清除对话</div>
            <div class="menu-separator"></div>
            <div class="menu-item has-submenu">
                主题切换
                <div class="submenu">
                    <div class="menu-item" id="theme-light">浅色主题</div>
                    <div class="menu-item" id="theme-dark">深色主题</div>
                </div>
            </div>
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
            <div class="author-info">
                Created by <a href="https://github.com/warm3snow" target="_blank">warm3snow</a> | 
                <a href="https://github.com/warm3snow/vscode-ollama" target="_blank">GitHub Repository</a>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            let webSearchEnabled = false;
            let isGenerating = false;
            let currentModelName = 'Assistant';
            let chatContainer;

            // Initialize when DOM is ready
            document.addEventListener('DOMContentLoaded', () => {
                chatContainer = document.getElementById('chat-container');
                // 初始化所有已存在的think sections
                initAllThinkSections();
            });

            ${processMessageFn}
            ${appendMessageFn}

            // Initialize UI elements
            const messageInput = document.getElementById('message-input');
            const webSearchButton = document.getElementById('web-search');
            const sendButton = document.getElementById('send-button');
            const menuButton = document.getElementById('menu-button');
            const menu = document.getElementById('menu');
            const clearChatButton = document.getElementById('clear-chat');

            // Log initialization
            console.log('Webview initialized');
            console.log('Initial web search state:', webSearchEnabled);

            // Web search button click handler
            webSearchButton.onclick = () => {
                webSearchEnabled = !webSearchEnabled;
                webSearchButton.classList.toggle('active', webSearchEnabled);
                const status = webSearchButton.querySelector('.status');
                if (status) {
                    status.style.color = webSearchEnabled ? '#4CAF50' : '#666';
                }
                console.log('Web search toggled:', webSearchEnabled);
            };

            // Send message function
            function sendMessage() {
                const content = messageInput.value.trim();
                if (!content || isGenerating) return;

                console.log('Preparing to send message:', {
                    content,
                    webSearch: webSearchEnabled
                });

                appendMessage(content, true);
                messageInput.value = '';
                messageInput.style.height = 'auto';
                updateSendButton(true);

                vscode.postMessage({
                    command: 'sendMessage',
                    content,
                    webSearch: webSearchEnabled,
                    resetContext: false
                });
            }

            // Send button click handler
            sendButton.onclick = () => {
                if (!isGenerating) {
                    console.log('Sending message with web search:', webSearchEnabled);
                    sendMessage();
                } else {
                    vscode.postMessage({
                        command: 'stopGeneration'
                    });
                    updateSendButton(false);
                }
            };

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

            // 修改清除对话的处理逻辑
            clearChatButton.onclick = () => {
                // 保存欢迎消息
                const welcomeMessage = chatContainer.querySelector('.message:first-child');
                
                // 清除所有消息
                chatContainer.innerHTML = '';
                
                // 如果存在欢迎消息，重新添加
                if (welcomeMessage && welcomeMessage.innerHTML.includes('Welcome to VSCode Ollama')) {
                    chatContainer.appendChild(welcomeMessage.cloneNode(true));
                } else {
                    // 如果没有欢迎消息，创建新的
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
                }

                // 重置状态
                vscode.setState({ messages: [] });
                menu.classList.remove('show');
            };

            // 修改命令定义
            const commands = [
                {
                    name: '/reset',
                    description: '重置对话上下文',
                    execute: () => {
                        // 清空消息历史
                        vscode.postMessage({
                            command: 'sendMessage',
                            content: '重置对话上下文',
                            webSearch: webSearchEnabled,
                            modelName: currentModelName,
                            resetContext: true
                        });
                        updateSendButton(true); // 更新按钮状态
                    }
                }
                // 可以在这里添加更多命令
            ];

            let commandSuggestions = null;
            let selectedCommandIndex = -1;

            // 修改命令提示的更新逻辑
            function updateCommandSuggestions(input) {
                const suggestionsDiv = document.getElementById('command-suggestions');
                if (!suggestionsDiv) {
                    // 如果建议框不存在，创建它
                    const div = document.createElement('div');
                    div.id = 'command-suggestions';
                    document.querySelector('.input-wrapper').appendChild(div);
                    return updateCommandSuggestions(input);
                }

                // 当输入 '/' 时显示所有命令
                if (input === '/') {
                    selectedCommandIndex = -1;
                    const suggestionsHtml = commands.map((cmd, index) => \`
                        <div class="command-item" data-command="\${cmd.name}" onclick="selectCommand('\${cmd.name}')">
                            <span class="command-name">\${cmd.name}</span>
                            <span class="command-description">\${cmd.description}</span>
                        </div>
                    \`).join('');
                    
                    suggestionsDiv.innerHTML = suggestionsHtml;
                    suggestionsDiv.style.display = 'block';
                }
                // 当输入以 '/' 开头的其他内容时，进行过滤
                else if (input.startsWith('/')) {
                    const query = input.toLowerCase();
                    const filteredCommands = commands.filter(cmd => 
                        cmd.name.toLowerCase().startsWith(query)
                    );

                    if (filteredCommands.length > 0) {
                        selectedCommandIndex = -1;
                        const suggestionsHtml = filteredCommands.map((cmd, index) => \`
                            <div class="command-item" data-command="\${cmd.name}" onclick="selectCommand('\${cmd.name}')">
                                <span class="command-name">\${cmd.name}</span>
                                <span class="command-description">\${cmd.description}</span>
                            </div>
                        \`).join('');
                        
                        suggestionsDiv.innerHTML = suggestionsHtml;
                        suggestionsDiv.style.display = 'block';
                    } else {
                        suggestionsDiv.style.display = 'none';
                    }
                } else {
                    suggestionsDiv.style.display = 'none';
                }
            }

            // 添加命令选择函数
            function selectCommand(commandName) {
                messageInput.value = commandName + ' ';
                hideCommandSuggestions();
                messageInput.focus();
            }

            // 修改键盘事件处理
            messageInput.addEventListener('keydown', (e) => {
                const suggestionsDiv = document.getElementById('command-suggestions');
                const isVisible = suggestionsDiv && suggestionsDiv.style.display === 'block';

                if (isVisible) {
                    const items = suggestionsDiv.querySelectorAll('.command-item');
                    
                    if (e.key === 'Tab') {
                        e.preventDefault();
                        if (items.length > 0) {
                            const command = items[0].getAttribute('data-command');
                            if (command) {
                                selectCommand(command);
                            }
                        }
                    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        
                        if (e.key === 'ArrowUp') {
                            selectedCommandIndex = selectedCommandIndex <= 0 ? items.length - 1 : selectedCommandIndex - 1;
                        } else {
                            selectedCommandIndex = selectedCommandIndex >= items.length - 1 ? 0 : selectedCommandIndex + 1;
                        }

                        items.forEach((item, index) => {
                            item.classList.toggle('selected', index === selectedCommandIndex);
                        });

                        if (selectedCommandIndex >= 0) {
                            const command = items[selectedCommandIndex].getAttribute('data-command');
                            if (command) {
                                messageInput.value = command + ' ';
                            }
                        }
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        if (selectedCommandIndex >= 0) {
                            const command = items[selectedCommandIndex].getAttribute('data-command');
                            if (command) {
                                selectCommand(command);
                            }
                        }
                    } else if (e.key === 'Escape') {
                        hideCommandSuggestions();
                    }
                } else if (e.key === 'Enter' && !e.shiftKey) {
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

            // 修改输入事件处理
            messageInput.addEventListener('input', (e) => {
                const input = e.target.value;
                updateCommandSuggestions(input);
                
                // 保持原有的自动调整高度功能
                e.target.style.height = 'auto';
                const newHeight = Math.min(e.target.scrollHeight, 200);
                e.target.style.height = newHeight + 'px';
            });

            // 添加点击外部关闭提示的处理
            document.addEventListener('click', (e) => {
                const suggestionsDiv = document.getElementById('command-suggestions');
                const inputWrapper = document.querySelector('.input-wrapper');
                if (suggestionsDiv && !inputWrapper.contains(e.target)) {
                    hideCommandSuggestions();
                }
            });

            function hideCommandSuggestions() {
                const suggestionsDiv = document.getElementById('command-suggestions');
                if (suggestionsDiv) {
                    suggestionsDiv.style.display = 'none';
                    selectedCommandIndex = -1;
                }
            }

            function updateSendButton(generating) {
                isGenerating = generating;
                sendButton.textContent = generating ? 'Stop' : 'Send';
                sendButton.classList.toggle('sending', generating);
                
                // 更新输入框状态和光标样式
                messageInput.disabled = generating;
                messageInput.style.opacity = generating ? '0.7' : '1';
                messageInput.style.cursor = generating ? 'not-allowed' : 'text';
            }

            // Message event listener
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'resetChat') {
                    // 清除所有正在流式传输的消息
                    const streamingMessages = document.querySelectorAll('.message.assistant-message.streaming');
                    streamingMessages.forEach(msg => {
                        msg.classList.remove('streaming');
                    });
                } else if (message.command === 'streamMessage') {
                    console.log('Stream message content:', {
                        content: message.content,
                        newMessage: message.newMessage,
                        done: message.done
                    });
                    
                    if (message.newMessage) {
                        currentConversationId = message.conversationId;
                        appendMessage(message.content, false);
                    } else {
                        // 使用字符串连接而不是嵌套的模板字符串
                        const selector = '.assistant-message[data-conversation-id="' + message.conversationId + '"] .message-content';
                        const messageDiv = document.querySelector(selector);
                        if (messageDiv) {
                            const currentText = messageDiv.getAttribute('data-markdown-content') || '';
                            const newText = currentText + message.content;
                            messageDiv.setAttribute('data-markdown-content', newText);
                            
                            // 使用相同的 marked 配置
                            const markedOptions = {
                                breaks: true,
                                gfm: true,
                                xhtml: true,
                            };
                            
                            messageDiv.innerHTML = marked.parse(processMessage(newText), markedOptions);
                            
                            // 如果存在代码块，确保滚动到底部
                            if (messageDiv.querySelector('pre')) {
                                chatContainer.scrollTop = chatContainer.scrollHeight;
                            }
                        }
                    }

                    // 当消息完成时重置状态
                    if (message.done) {
                        currentConversationId = null;
                        updateSendButton(false);
                        messageInput.focus();
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
                } else if (message.command === 'updateModelName') {
                    currentModelName = message.modelName;
                } else if (message.command === 'saveSuccess') {
                    // 添加保存成功的提示
                    const notification = document.createElement('div');
                    notification.className = 'save-notification';
                    notification.textContent = '设置已保存';
                    document.body.appendChild(notification);

                    // 2秒后自动移除提示
                    setTimeout(() => {
                        notification.remove();
                    }, 2000);
                } else if (message.command === 'forceEndChat') {
                    // 强制结束当前对话，确保下一次对话会创建新的对话组
                    const streamingDiv = document.querySelector('.message.assistant-message.streaming');
                    if (streamingDiv) {
                        streamingDiv.classList.remove('streaming');
                    }
                    // 创建新的空对话组，为下一次对话做准备
                    const newGroup = document.createElement('div');
                    newGroup.className = 'conversation-group';
                    chatContainer.appendChild(newGroup);
                }
            });

            // Initialize on load
            window.addEventListener('load', () => {
                vscode.postMessage({
                    command: 'webviewReady'
                });
            });

            // 更新选中状态
            function updateSelection() {
                const items = document.querySelectorAll('.command-item');
                items.forEach((item, index) => {
                    if (index === selectedCommandIndex) {
                        item.classList.add('selected');
                        const command = item.getAttribute('data-command');
                        if (command) {
                            document.getElementById('message-input').value = command;
                        }
                    } else {
                        item.classList.remove('selected');
                    }
                });
            }

            // 修改主题切换相关代码
            const themeLightItem = document.getElementById('theme-light');
            const themeDarkItem = document.getElementById('theme-dark');

            // 更新主题菜单项状态
            function updateThemeMenuState(isDark) {
                if (!themeLightItem || !themeDarkItem) {
                    return;
                }
                
                // 更新菜单项状态
                themeLightItem.classList.toggle('active', !isDark);
                themeDarkItem.classList.toggle('active', isDark);
            }

            // 初始化主题状态
            const isDarkTheme = document.body.classList.contains('vscode-dark');
            updateThemeMenuState(isDarkTheme);

            // 添加主题切换事件监听
            if (themeLightItem) {
                themeLightItem.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    vscode.postMessage({
                        command: 'toggleTheme',
                        theme: 'light'
                    });
                    menu.classList.remove('show');
                };
            }

            if (themeDarkItem) {
                themeDarkItem.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    vscode.postMessage({
                        command: 'toggleTheme',
                        theme: 'dark'
                    });
                    menu.classList.remove('show');
                };
            }

            // 监听主题变化消息
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'themeChanged') {
                    updateThemeMenuState(message.isDark);
                }
            });
        </script>
    </body>
    </html>`;
}