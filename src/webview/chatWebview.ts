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
            
            // 新增: 检测看起来像是思考文本的内容并包装为think标签
            // 思考文本的特征：包含特定的引导词、提到用户输入、分析过程等
            const thinkingPatterns = [
                /(?:Alright|Okay|First|I should|I need|Let's|Let me|Looking at|Based on),?\\s+so\\s+(?:I|we)\\s+(?:need|should|have to|want to|could|might|can|will)\\s+(?:to\\s+)?(?:figure|respond|check|understand|think|analyze|consider|reply|handle)/i,
                /The user (?:is asking|asked|mentioned|said|wants|said|provided)/i,
                /(?:Putting|Breaking|Let's start|Let me analyze|I'll analyze|To summarize|In summary)/i
            ];
            
            // 检查内容是否已经包含think标签，如果不包含则检查是否符合思考模式
            if (!content.includes('<think>') && !content.includes('</think>')) {
                // 检查是否有任何思考模式匹配
                const hasThinkingPattern = thinkingPatterns.some(pattern => {
                    return pattern.test(content);
                });
                
                // 如果匹配思考模式，且不是单句回复，则包装为think标签
                if (hasThinkingPattern && content.split('\\n').length > 2) {
                    // 查找可能的最后一段思考后的实际回复（通常是简短的响应）
                    const contentParts = content.split('\\n\\n');
                    
                    // 如果最后一段是简短的回复（少于100个字符），保留为实际回复
                    if (contentParts.length > 1 && contentParts[contentParts.length - 1].length < 100) {
                        const actualResponse = contentParts.pop();
                        const thinkingContent = contentParts.join('\\n\\n');
                        content = '<think>' + thinkingContent + '</think>\\n\\n' + actualResponse;
                    } else {
                        // 整个内容都是思考，最后一行可能是总结
                        const lines = content.split('\\n');
                        if (lines.length > 1 && lines[lines.length - 1].length < 100) {
                            const actualResponse = lines.pop();
                            const thinkingContent = lines.join('\\n');
                            content = '<think>' + thinkingContent + '</think>\\n' + actualResponse;
                        } else {
                            // 整个内容都是思考
                            content = '<think>' + content + '</think>';
                        }
                    }
                }
            }
            
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
            console.log('Initializing think section:', thinkId);
            const header = document.querySelector('[data-think-id="' + thinkId + '"]');
            const content = document.getElementById(thinkId);
            
            if (!header || !content) {
                console.log('Could not find header or content for think section:', thinkId);
                return;
            }
            
            if (!header.hasAttribute('data-initialized')) {
                header.setAttribute('data-initialized', 'true');
                
                // 默认展开 - 移除 collapsed 类
                content.classList.remove('collapsed');
                header.classList.remove('collapsed');
                
                // 确保toggle按钮显示为展开状态
                const toggle = header.querySelector('.think-toggle');
                if (toggle) {
                    toggle.textContent = '▼';
                }
                
                // 添加点击事件
                header.addEventListener('click', function() {
                    console.log('Think header clicked for:', thinkId);
                    content.classList.toggle('collapsed');
                    header.classList.toggle('collapsed');
                    
                    const toggle = header.querySelector('.think-toggle');
                    if (toggle) {
                        toggle.textContent = content.classList.contains('collapsed') ? '▶' : '▼';
                    }
                });
                
                console.log('Think section initialized:', thinkId);
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
            prefixDiv.textContent = isUser ? '你' : '- ' + currentModelName;
            messageDiv.appendChild(prefixDiv);
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content markdown-content';
            
            if (isUser) {
                // 对用户消息，直接将 <br> 转换为换行符
                contentDiv.innerHTML = content.replace(/<br>/g, '\\n');
            } else {
                console.log('Raw assistant message:', content);
                
                // 保存原始内容
                contentDiv.setAttribute('data-markdown-content', content);
                
                // 处理转义字符
                let processedContent = content.replace(/\\\\u003c/g, '<')
                                           .replace(/\\\\u003e/g, '>');
                
                // 检查是否包含think标签
                if (processedContent.includes('<think>')) {
                    console.log('Message contains think tags, handling specially');
                    
                    // 分离思考内容和实际回复
                    const thinkMatch = processedContent.match(/<think>([\\s\\S]*?)<\\/think>/);
                    
                    if (thinkMatch) {
                        const thinkContent = thinkMatch[1];
                        const remainingContent = processedContent.replace(/<think>[\\s\\S]*?<\\/think>/, '').trim();
                        
                        // 生成唯一ID
                        const thinkId = 'think-' + Math.random().toString(36).substr(2, 9);
                        
                        // 先添加思考部分
                        const thinkHtml = [
                            '<div class="think-section">',
                            '    <div class="think-header" data-think-id="' + thinkId + '">',
                            '        <span class="think-toggle">▼</span>',
                            '        <span>思考过程</span>',
                            '    </div>',
                            '    <div class="think-content" id="' + thinkId + '">' + thinkContent.replace(/\\n/g, '<br>') + '</div>',
                            '</div>'
                        ].join('');
                        
                        // 然后添加实际回复部分
                        const markedOptions = {
                            breaks: true,
                            gfm: true,
                            xhtml: true
                        };
                        
                        contentDiv.innerHTML = thinkHtml;
                        
                        if (remainingContent) {
                            const responseDiv = document.createElement('div');
                            responseDiv.className = 'response-content';
                            responseDiv.innerHTML = marked.parse(remainingContent, markedOptions);
                            contentDiv.appendChild(responseDiv);
                        }
                        
                        // 在下一个事件循环中初始化思考部分
                        setTimeout(() => initThinkSection(thinkId), 0);
                    } else {
                        // 如果没有正确匹配think标签，则按常规处理
                        contentDiv.innerHTML = marked.parse(processedContent, {
                            breaks: true,
                            gfm: true,
                            xhtml: true
                        });
                    }
                } else {
                    // 没有think标签的常规处理
                    contentDiv.innerHTML = marked.parse(processedContent, {
                        breaks: true,
                        gfm: true,
                        xhtml: true
                    });
                }
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
                border: 1px solid var(--vscode-input-border);
                border-radius: 12px;
                background: var(--vscode-editor-background);
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
                display: flex;
                flex-direction: column;
                scroll-behavior: smooth; /* 平滑滚动 */
            }
            .message {
                margin: 10px 0;
                padding: 16px 18px; /* 增加所有消息的内边距 */
                border-radius: 16px;
                max-width: 80%;
                background: transparent;
                display: flex;
                flex-direction: column;
                position: relative;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15); /* 加深阴影 */
                transition: all 0.2s ease;
            }
            .message-prefix {
                font-size: 0.9em;
                margin-bottom: 8px;
                opacity: 0.9;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 5px;
                color: var(--vscode-foreground);
            }
            .user-message .message-prefix {
                align-self: flex-end; /* 用户消息前缀靠右 */
                color: white;
            }
            /* 添加用户和助手头像样式 */
            .message-prefix::before {
                content: '';
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                margin-right: 6px;
                background-position: center;
                background-size: cover;
                font-size: 13px;
                line-height: 1;
            }
            
            .user-message .message-prefix::before {
                order: 2; /* 将用户头像放在文字右边 */
                margin-right: 0;
                margin-left: 6px;
                color: rgba(var(--vscode-textLink-foreground-rgb), 0.7); /* 更柔和的颜色 */
                content: '👤';
                opacity: 0.8;
            }
            
            .assistant-message .message-prefix::before {
                background-color: transparent;
                color: var(--vscode-textLink-foreground);
                content: '🤖';
                opacity: 0.8;
            }
            .message-content {
                margin-left: 0;
                white-space: pre-wrap;
                word-wrap: break-word;
                line-height: 1.5;
            }
            .user-message .message-content {
                color: var(--vscode-button-foreground);
            }
            .conversation-group {
                padding: 6px 12px;
                margin: 12px 0;
                border-radius: 8px;
                transition: background-color 0.2s ease;
                display: flex;
                flex-direction: column;
            }
            .message:hover {
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
            }
            .user-message:hover {
                background-color: rgba(var(--vscode-textLink-foreground-rgb), 0.2);
            }
            .input-wrapper {
                position: relative;
                margin-bottom: 32px;
                padding: 18px;
                background: var(--vscode-editor-background);
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
                border: 1px solid var(--vscode-input-border);
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
                padding: 14px;
                border: 1px solid var(--vscode-input-border);
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 8px;
                font-size: 15px;
                transition: opacity 0.3s ease, cursor 0.3s ease, border-color 0.3s ease;
                resize: none;
                min-height: 24px;
                max-height: 200px;
                outline: none;
                font-family: var(--vscode-font-family);
                line-height: 1.5;
            }
            #message-input:focus {
                outline: none;
                border-color: var(--vscode-focusBorder);
                box-shadow: 0 0 0 1px var(--vscode-focusBorder);
            }
            #message-input:hover:not(:focus) {
                border-color: var(--vscode-input-border);
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
            #send-button {
                padding: 12px 20px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-weight: 500;
                transition: all 0.2s ease;
                min-width: 80px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
            }
            #send-button:hover {
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

            /* 添加Markdown样式 */
            .markdown-content {
                line-height: 1.6;
            }
            
            .markdown-content p {
                margin-top: 0.4em;
                margin-bottom: 0.4em;
            }
            
            .markdown-content h1, 
            .markdown-content h2, 
            .markdown-content h3, 
            .markdown-content h4 {
                margin-top: 1em;
                margin-bottom: 0.5em;
                font-weight: 600;
            }
            
            .markdown-content ul, 
            .markdown-content ol {
                padding-left: 1.5em;
                margin: 0.5em 0;
            }
            
            .markdown-content li {
                margin-bottom: 0.25em;
            }
            
            .markdown-content blockquote {
                border-left: 4px solid var(--vscode-textBlockQuote-border);
                margin: 0.5em 0;
                padding: 0.5em 1em;
                background: var(--vscode-textBlockQuote-background);
                color: var(--vscode-textBlockQuote-foreground);
                border-radius: 0 4px 4px 0;
            }
            
            .markdown-content a {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
            }
            
            .markdown-content a:hover {
                text-decoration: underline;
                color: var(--vscode-textLink-activeForeground);
            }
            
            .markdown-content table {
                border-collapse: collapse;
                width: 100%;
                margin: 1em 0;
            }
            
            .markdown-content th, 
            .markdown-content td {
                border: 1px solid var(--vscode-input-border);
                padding: 8px 12px;
            }
            
            .markdown-content th {
                background: var(--vscode-editor-inactiveSelectionBackground);
                font-weight: 600;
            }
            
            /* 改进图片样式 */
            .markdown-content img {
                max-width: 100%;
                border-radius: 8px;
                margin: 0.5em 0;
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
                margin: 12px 0 15px 0;
                background: var(--vscode-editor-background);
                border-radius: 10px;
                overflow: hidden;
                border: 1px solid var(--vscode-input-border);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
                width: 100%; /* 确保思考部分宽度一致 */
                transition: all 0.3s ease;
            }

            .think-header {
                padding: 10px 14px;
                cursor: pointer;
                user-select: none;
                display: flex !important;
                align-items: center;
                gap: 8px;
                color: var(--vscode-textLink-foreground);
                font-size: 0.9em;
                background: var(--vscode-editor-background);
                border-bottom: 1px solid var(--vscode-input-border);
                transition: background-color 0.2s ease;
            }

            .think-header:hover {
                background: var(--vscode-list-hoverBackground);
            }
            
            /* 改进思考切换按钮样式 */
            .think-toggle {
                display: inline-flex;
                justify-content: center;
                align-items: center;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                background-color: var(--vscode-textLink-foreground);
                color: var(--vscode-button-foreground);
                font-size: 10px;
                transition: transform 0.3s ease, background-color 0.2s ease;
            }
            
            .think-header:hover .think-toggle {
                background-color: var(--vscode-textLink-activeForeground);
            }

            .think-content {
                padding: 14px 16px;
                white-space: pre-wrap;
                word-wrap: break-word;
                transition: all 0.3s ease;
                max-height: 800px;
                overflow: hidden;
                opacity: 1;
                font-size: 0.95em;
                line-height: 1.5;
                background: var(--vscode-editor-inactiveSelectionBackground);
                color: var(--vscode-foreground);
                border-top: 1px solid var(--vscode-input-border);
            }
            
            /* 思考过程内容里的段落间距 */
            .think-content p {
                margin: 0.4em 0;
            }
            
            .think-content.collapsed {
                max-height: 0 !important;
                padding-top: 0 !important;
                padding-bottom: 0 !important;
                opacity: 0 !important;
                border-top: none !important;
                display: none !important;
            }

            .think-header.collapsed .think-toggle {
                transform: rotate(-90deg);
            }
            
            /* Style for the actual response content after think section */
            .response-content {
                margin-top: 15px;
                width: 100%;
            }
            
            /* Make sure code blocks and other content fit well */
            .markdown-content {
                width: 100%;
            }
            
            .markdown-content pre {
                width: 100%;
                max-width: 100%;
                overflow-x: auto;
            }
            
            /* Adjust spacing for better readability */
            .message-content.markdown-content p {
                margin-top: 0.3em;
                margin-bottom: 0.3em;
            }

            /* Add some space between conversation groups for better readability */
            .conversation-group + .conversation-group {
                margin-top: 16px;
            }

            /* 添加消息出现动画 */
            @keyframes messageAppear {
                from {
                    opacity: 0;
                    transform: translateY(10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            .message {
                animation: messageAppear 0.3s ease forwards;
            }

            .user-message {
                margin-left: auto; /* 用户消息靠右 */
                margin-right: 0;
                background-color: rgba(var(--vscode-textLink-foreground-rgb), 0.15); /* 更柔和的背景色 */
                border-radius: 18px 18px 4px 18px;
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
                padding: 14px 18px;
                border: 1px solid rgba(var(--vscode-textLink-foreground-rgb), 0.2); /* 添加淡边框 */
            }
            
            .user-message .message-content {
                color: var(--vscode-foreground); /* 使用主题的标准文字颜色 */
                font-size: 1.05em;
                font-weight: normal;
                letter-spacing: 0.01em;
            }
            
            .user-message .message-prefix {
                align-self: flex-end; /* 用户消息前缀靠右 */
                color: var(--vscode-descriptionForeground); /* 使用描述文字颜色 */
                font-weight: 500;
                margin-bottom: 8px;
                opacity: 0.8;
            }

            /* 欢迎消息样式优化 */
            .welcome-message {
                max-width: 100% !important;
                width: 100%;
                margin: 12px 0 24px 0 !important;
                padding: 0 !important;
                background: transparent !important;
                box-shadow: none !important;
                border: none !important;
            }

            .welcome-content {
                background: linear-gradient(to right, 
                                           rgba(var(--vscode-textLink-foreground-rgb), 0.1), 
                                           rgba(var(--vscode-textLink-foreground-rgb), 0.05));
                border-radius: 12px;
                padding: 20px 24px;
                border: 1px solid rgba(var(--vscode-textLink-foreground-rgb), 0.2);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
                transition: all 0.3s ease;
                animation: fadeIn 0.5s ease-in;
            }
            
            .welcome-title {
                margin: 0 0 16px 0;
                color: var(--vscode-foreground);
                font-size: 1.4em;
                font-weight: 600;
                letter-spacing: 0.01em;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .welcome-text {
                margin: 0;
                color: var(--vscode-foreground);
                font-size: 1em;
                line-height: 1.6;
                opacity: 0.9;
            }
            
            .welcome-link {
                color: var(--vscode-textLink-foreground);
                text-decoration: none;
                font-weight: 500;
            }
            
            .welcome-link:hover {
                text-decoration: underline;
                color: var(--vscode-textLink-activeForeground);
            }
            
            /* 添加CSS变量提取函数 */
            :root {
                --vscode-textLink-foreground-rgb: 0, 120, 212;
            }
            
            .vscode-dark:root {
                --vscode-textLink-foreground-rgb: 43, 136, 216;
            }
            
            @keyframes fadeIn {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        </style>
        <script>
            // Import marked from CDN instead
            const markedScript = document.createElement('script');
            markedScript.src = 'https://cdn.jsdelivr.net/npm/marked@9.0.0/marked.min.js';
            document.head.appendChild(markedScript);
            
            markedScript.onload = function() {
                // Configure marked to allow HTML
                if (typeof marked !== 'undefined') {
                    marked.setOptions({
                        gfm: true,
                        breaks: true,
                        sanitize: false, // This is crucial - don't sanitize HTML content
                        renderer: new marked.Renderer()
                    });
                    console.log('Marked library loaded and configured');
                }
            };
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
                const welcomeMessage = chatContainer.querySelector('.welcome-message');
                
                // 清除所有消息
                chatContainer.innerHTML = '';
                
                // 如果存在欢迎消息，重新添加
                if (welcomeMessage) {
                    chatContainer.appendChild(welcomeMessage.cloneNode(true));
                } else {
                    // 如果没有欢迎消息，创建新的
                    const welcomeDiv = document.createElement('div');
                    welcomeDiv.className = 'message assistant-message welcome-message';
                    welcomeDiv.innerHTML = \`
                        <div class="welcome-content">
                            <h2 class="welcome-title">
                                👋 Welcome to VSCode Ollama!
                            </h2>
                            <p class="welcome-text">
                                <a href="https://github.com/warm3snow/vscode-ollama" class="welcome-link">
                                [vscode-ollama] </a>是一款基于本地 Ollama 服务的 VS Code 扩展，支持模型配置、联网查询等多种特性。欢迎关注GitHub仓库并Star以支持开发者持续优化！
                                <br><br>
                                GitHub 仓库：<a href="https://github.com/warm3snow/vscode-ollama" class="welcome-link">
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
                    console.log('Stream message chunk:', message.content);
                    console.log('Contains think tag:', message.content.includes('<think>') || message.content.includes('</think>'));
                    
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
                            
                            console.log('Stream update - newText:', newText);
                            console.log('Contains think tags:', newText.includes('<think>'));
                            
                            // 处理转义字符
                            let processedContent = newText.replace(/\\\\u003c/g, '<')
                                                       .replace(/\\\\u003e/g, '>');
                            
                            // 检查是否包含think标签
                            if (processedContent.includes('<think>') && processedContent.includes('</think>')) {
                                console.log('Stream message contains complete think tags');
                                
                                // 分离思考内容和实际回复
                                const thinkMatch = processedContent.match(/<think>([\\s\\S]*?)<\\/think>/);
                                
                                if (thinkMatch) {
                                    const thinkContent = thinkMatch[1];
                                    const remainingContent = processedContent.replace(/<think>[\\s\\S]*?<\\/think>/, '').trim();
                                    
                                    // 生成唯一ID
                                    const thinkId = 'think-' + Math.random().toString(36).substr(2, 9);
                                    
                                    // 先添加思考部分
                                    const thinkHtml = [
                                        '<div class="think-section">',
                                        '    <div class="think-header" data-think-id="' + thinkId + '">',
                                        '        <span class="think-toggle">▼</span>',
                                        '        <span>思考过程</span>',
                                        '    </div>',
                                        '    <div class="think-content" id="' + thinkId + '">' + thinkContent.replace(/\\n/g, '<br>') + '</div>',
                                        '</div>'
                                    ].join('');
                                    
                                    // 然后添加实际回复部分
                                    const markedOptions = {
                                        breaks: true,
                                        gfm: true,
                                        xhtml: true
                                    };
                                    
                                    messageDiv.innerHTML = thinkHtml;
                                    
                                    if (remainingContent) {
                                        const responseDiv = document.createElement('div');
                                        responseDiv.className = 'response-content';
                                        responseDiv.innerHTML = marked.parse(remainingContent, markedOptions);
                                        messageDiv.appendChild(responseDiv);
                                    }
                                    
                                    // 在下一个事件循环中初始化思考部分
                                    setTimeout(() => initThinkSection(thinkId), 0);
                                } else {
                                    // 如果未正确匹配，则按常规处理
                                    messageDiv.innerHTML = marked.parse(processedContent, {
                                        breaks: true,
                                        gfm: true,
                                        xhtml: true
                                    });
                                }
                            } else {
                                // 部分更新或没有think标签时，按常规处理
                                messageDiv.innerHTML = marked.parse(processedContent, {
                                    breaks: true,
                                    gfm: true,
                                    xhtml: true
                                });
                            }
                            
                            // 滚动到底部
                            chatContainer.scrollTop = chatContainer.scrollHeight;
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
                    welcomeDiv.className = 'message assistant-message welcome-message';
                    welcomeDiv.innerHTML = \`
                        <div class="welcome-content">
                            <h2 class="welcome-title">
                                👋 Welcome to VSCode Ollama!
                            </h2>
                            <p class="welcome-text">
                                <a href="https://github.com/warm3snow/vscode-ollama" class="welcome-link">
                                [vscode-ollama] </a>是一款基于本地 Ollama 服务的 VS Code 扩展，支持模型配置、联网查询等多种特性。欢迎关注GitHub仓库并Star以支持开发者持续优化！
                                <br><br>
                                GitHub 仓库：<a href="https://github.com/warm3snow/vscode-ollama" class="welcome-link">
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