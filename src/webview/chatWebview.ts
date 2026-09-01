import * as vscode from 'vscode';

interface ChatConfig {
	baseUrl: string;
	model: string;
	maxTokens: number;
	keepAlive: string;
	systemPrompt: string;
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

export function getChatWebviewContent(config: ChatConfig, webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const nonce = getNonce();
	const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'marked.min.js'));

	return `<!DOCTYPE html>
    <html>
    <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
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
            /* Agent 状态栏 */
            .agent-status {
                margin-bottom: 10px;
                padding: 8px 12px;
                border-radius: 6px;
                background: var(--vscode-editor-inactiveSelectionBackground);
                border: 1px solid var(--vscode-input-border);
                color: var(--vscode-foreground);
                font-size: 12px;
                display: none;
                white-space: pre-wrap;
                word-wrap: break-word;
            }
            /* Agent 工具调用 / 结果块 */
            .tool-activity {
                margin: 6px 0;
                border-radius: 6px;
                background: var(--vscode-editor-inactiveSelectionBackground);
                overflow: hidden;
                border: 1px solid transparent;
                border-left: 3px solid #888;
            }
            .tool-activity.collapsed .tool-activity-body {
                display: none;
            }
            .tool-activity-header {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                font-size: 12px;
                color: var(--vscode-foreground);
                cursor: pointer;
                user-select: none;
                min-width: 0;
            }
            .tool-activity-header:hover {
                background: var(--vscode-list-hoverBackground);
            }
            .tool-activity-toggle {
                font-size: 9px;
                color: var(--vscode-descriptionForeground);
                width: 10px;
                display: inline-block;
                text-align: center;
                flex-shrink: 0;
            }
            .tool-activity-icon {
                font-size: 12px;
                line-height: 1;
                flex-shrink: 0;
            }
            .tool-activity-name {
                font-weight: 600;
                flex-shrink: 0;
            }
            .tool-activity-summary {
                color: var(--vscode-descriptionForeground);
                font-size: 11px;
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                font-family: var(--vscode-editor-font-family);
            }
            .tool-activity-status {
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                flex-shrink: 0;
                font-variant-numeric: tabular-nums;
            }
            .tool-activity-status.error {
                color: var(--vscode-errorForeground);
            }
            .tool-activity-body {
                border-top: 1px solid var(--vscode-panelSection-border);
                background: var(--vscode-input-background);
                max-height: 420px;
                overflow-y: auto;
                padding: 8px 10px;
            }
            .tool-activity-section {
                margin-bottom: 10px;
            }
            .tool-activity-section:last-child {
                margin-bottom: 0;
            }
            .tool-activity-section-title {
                font-size: 10px;
                color: var(--vscode-descriptionForeground);
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin-bottom: 4px;
                font-weight: 600;
            }
            .tool-activity-args {
                margin: 0;
                display: grid;
                grid-template-columns: max-content 1fr;
                column-gap: 14px;
                row-gap: 4px;
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
            }
            .tool-activity-args dt {
                color: var(--vscode-descriptionForeground);
                white-space: nowrap;
                font-weight: 500;
            }
            .tool-activity-args dd {
                margin: 0;
                color: var(--vscode-foreground);
                word-break: break-word;
            }
            .tool-activity-pre {
                margin: 0;
                font-family: var(--vscode-editor-font-family);
                font-size: 12px;
                line-height: 1.55;
                white-space: pre-wrap;
                word-wrap: break-word;
                color: var(--vscode-foreground);
                background: transparent;
            }
            .tool-activity-pre.error {
                color: var(--vscode-errorForeground);
            }
            .tool-activity-loading {
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }

            /* Thinking 块：在结构上复用 tool-activity，但用紫色区分，默认展开 */
            .tool-activity.thinking {
                border-left-color: #7d56f4;
                background: rgba(125, 86, 244, 0.07);
            }
            .tool-activity.thinking .tool-activity-name {
                color: #7d56f4;
            }
            .tool-activity.thinking .tool-activity-body {
                max-height: 260px;
            }
            .tool-activity.thinking .tool-activity-pre {
                color: var(--vscode-foreground);
                font-size: 12.5px;
                line-height: 1.6;
                opacity: 0.92;
            }
            /* token 用量摘要 */
            .usage-footer {
                margin: 6px 0 2px;
                padding: 0 2px;
                font-size: 11px;
                color: var(--vscode-descriptionForeground);
                font-variant-numeric: tabular-nums;
                user-select: text;
            }
            /* 确认对话框 */
            .confirm-dialog {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.4);
                z-index: 2000;
                display: none;
                align-items: center;
                justify-content: center;
            }
            .confirm-content {
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-input-border);
                border-radius: 8px;
                padding: 20px;
                max-width: 480px;
                width: 90%;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
            }
            .confirm-title {
                font-weight: 600;
                margin-bottom: 10px;
                color: var(--vscode-foreground);
            }
            .confirm-tool {
                font-size: 13px;
                color: var(--vscode-textLink-foreground);
                margin-bottom: 6px;
            }
            .confirm-args {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                background: var(--vscode-input-background);
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
                padding: 8px;
                margin-bottom: 14px;
                max-height: 160px;
                overflow-y: auto;
                white-space: pre-wrap;
                word-wrap: break-word;
            }
            .confirm-buttons {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }
            #confirm-allow {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                padding: 8px 20px;
                cursor: pointer;
            }
            #confirm-allow:hover {
                background: var(--vscode-button-hoverBackground);
            }
            #confirm-deny {
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
                border: 1px solid var(--vscode-button-border);
                border-radius: 4px;
                padding: 8px 20px;
                cursor: pointer;
            }
            #input-container {
                display: flex;
                gap: 10px;
                align-items: center;
            }
            #message-input {
                flex: 1;
                box-sizing: border-box;
                padding: 14px;
                border: 1px solid var(--vscode-input-border);
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 8px;
                font-size: 15px;
                transition: opacity 0.3s ease, cursor 0.3s ease, border-color 0.3s ease;
                resize: none;
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

            .welcome-tips {
                margin: 14px 0 0 0;
                padding: 0;
                list-style: none;
                color: var(--vscode-foreground);
                font-size: 0.95em;
                line-height: 1.7;
                opacity: 0.9;
            }

            .welcome-tips li {
                margin: 0 0 8px 0;
                padding-left: 18px;
                position: relative;
            }

            .welcome-tips li::before {
                content: '▸';
                position: absolute;
                left: 2px;
                color: var(--vscode-textLink-foreground);
            }

            .welcome-tips strong {
                font-weight: 600;
                color: var(--vscode-textLink-foreground);
            }

            .welcome-footer {
                margin: 14px 0 0 0;
                color: var(--vscode-descriptionForeground);
                font-size: 0.88em;
                line-height: 1.6;
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
        <script nonce="${nonce}" src="${markedUri}"></script>
    </head>
    <body>
        <div id="chat-container"></div>
        <button class="menu-button" id="menu-button">⋯</button>
        <div class="menu" id="menu">
            <div class="menu-item" id="clear-chat">Clear Chat</div>
        </div>
        <div id="agent-status" class="agent-status"></div>
        <div class="input-wrapper">
            <div id="input-container">
                <textarea id="message-input"
                    placeholder="Ask anything, shift+enter for newline"
                    rows="1"></textarea>
                <button id="send-button">Send</button>
            </div>
            <div class="author-info">
                Created by <a href="https://github.com/warm3snow" target="_blank">warm3snow</a> |
                <a href="https://github.com/warm3snow/vscode-ollama" target="_blank">GitHub Repository</a>
            </div>
        </div>

        <div class="confirm-dialog" id="confirm-dialog">
            <div class="confirm-content">
                <div class="confirm-title" id="confirm-title">🧩 Agent 请求执行操作</div>
                <div class="confirm-tool" id="confirm-tool"></div>
                <div class="confirm-args" id="confirm-args"></div>
                <div class="confirm-buttons">
                    <button id="confirm-deny">拒绝</button>
                    <button id="confirm-allow">允许</button>
                </div>
            </div>
        </div>

        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();

            // 全局错误捕获:转发到扩展端,便于排查 webview 脚本问题
            window.addEventListener('error', (e) => {
                vscode.postMessage({
                    command: 'webviewError',
                    message: e.message,
                    stack: e.error ? e.error.stack : ''
                });
            });

            let agentModeEnabled = true;   // mandatory
            let pendingConfirmRequestId = null;
            let isGenerating = false;
            let currentModelName = 'Assistant';
            let currentConversationId = null;
            let chatContainer;
            let selectedCommandIndex = -1;

            // 转义 HTML，防止 LLM/用户输入注入脚本（XSS 防护）
            function escapeHtml(text) {
                return String(text)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;');
            }

            // 初始化单个think section
            function initThinkSection(thinkId) {
                const header = document.querySelector('[data-think-id="' + thinkId + '"]');
                const content = document.getElementById(thinkId);

                if (!header || !content) {
                    return;
                }

                if (!header.hasAttribute('data-initialized')) {
                    header.setAttribute('data-initialized', 'true');

                    // 默认展开
                    content.classList.remove('collapsed');
                    header.classList.remove('collapsed');

                    const toggle = header.querySelector('.think-toggle');
                    if (toggle) {
                        toggle.textContent = '▼';
                    }

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

            function sanitizeAssistantProtocolContent(content) {
                const slash = String.fromCharCode(92);
                let result = content
                    .split(slash + 'u003c').join('<')
                    .split(slash + 'u003e').join('>');
                const startTag = '<tool_response';
                const endTag = '</tool_response';

                while (true) {
                    const lower = result.toLowerCase();
                    const start = lower.indexOf(startTag);
                    if (start < 0) {
                        break;
                    }
                    const openingEnd = lower.indexOf('>', start + startTag.length);
                    if (openingEnd < 0) {
                        result = result.slice(0, start);
                        break;
                    }
                    const close = lower.indexOf(endTag, openingEnd + 1);
                    if (close < 0) {
                        result = result.slice(0, start);
                        break;
                    }
                    const closingEnd = lower.indexOf('>', close + endTag.length);
                    if (closingEnd < 0) {
                        result = result.slice(0, start);
                        break;
                    }
                    result = result.slice(0, start) + result.slice(closingEnd + 1);
                }

                return result.trim();
            }

            // 渲染助手内容：先提取 think 标签（扩展自身标记），其余内容转义后交给 marked
            function renderAssistantContent(processedContent, contentDiv) {
                if (processedContent.includes('<think>') && processedContent.includes('</think>')) {
                    const thinkMatch = processedContent.match(/<think>([\\s\\S]*?)<\\/think>/);
                    if (thinkMatch) {
                        const thinkContent = thinkMatch[1];
                        const remainingContent = processedContent.replace(/<think>[\\s\\S]*?<\\/think>/, '').trim();
                        const thinkId = 'think-' + Math.random().toString(36).substr(2, 9);

                        const thinkHtml = [
                            '<div class="think-section">',
                            '    <div class="think-header" data-think-id="' + thinkId + '">',
                            '        <span class="think-toggle">▼</span>',
                            '        <span>思考过程</span>',
                            '    </div>',
                            '    <div class="think-content" id="' + thinkId + '">' + escapeHtml(thinkContent).replace(/\\n/g, '<br>') + '</div>',
                            '</div>'
                        ].join('');

                        contentDiv.innerHTML = thinkHtml;

                        if (remainingContent) {
                            const responseDiv = document.createElement('div');
                            responseDiv.className = 'response-content';
                            responseDiv.innerHTML = marked.parse(escapeHtml(remainingContent), {
                                breaks: true,
                                gfm: true,
                                xhtml: true
                            });
                            contentDiv.appendChild(responseDiv);
                        }

                        setTimeout(() => initThinkSection(thinkId), 0);
                        return;
                    }
                }
                contentDiv.innerHTML = marked.parse(escapeHtml(processedContent), {
                    breaks: true,
                    gfm: true,
                    xhtml: true
                });
            }

            // 追加消息
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
                prefixDiv.textContent = isUser ? '你' : currentModelName;
                messageDiv.appendChild(prefixDiv);

                const contentDiv = document.createElement('div');
                contentDiv.className = 'message-content markdown-content';

                if (isUser) {
                    // 用户消息：转义后显示（<br> 由扩展端换行符处理）
                    contentDiv.innerHTML = escapeHtml(content).replace(/\\n/g, '<br>');
                } else {
                    // 保存原始内容供流式追加
                    contentDiv.setAttribute('data-markdown-content', content);
                    const processedContent = sanitizeAssistantProtocolContent(content);
                    renderAssistantContent(processedContent, contentDiv);
                }

                messageDiv.appendChild(contentDiv);
                currentGroup.appendChild(messageDiv);
                chatContainer.scrollTop = chatContainer.scrollHeight;
                initAllThinkSections();
            }

            // 不同工具的图标、强调色、摘要字段
            const TOOL_STYLES = {
                bash:  { icon: '\u25B7', accent: '#e06c75', label: 'Bash',  summaryField: 'command' },
                read:  { icon: '\u25A2', accent: '#61afef', label: 'Read',  summaryField: 'path' },
                write: { icon: '\u25CB', accent: '#c678dd', label: 'Write', summaryField: 'path' },
                edit:  { icon: '\u270E', accent: '#e5c07b', label: 'Edit',  summaryField: 'path' },
                grep:  { icon: '\u2315', accent: '#98c379', label: 'Grep',  summaryField: 'pattern' },
                find:  { icon: '\u2315', accent: '#56b6c2', label: 'Find',  summaryField: 'pattern' },
                ls:    { icon: '\u2630', accent: '#8a8f97', label: 'List',  summaryField: 'path' }
            };
            const DEFAULT_TOOL_STYLE = { icon: '\u2699', accent: '#8a8f97', label: 'Tool', summaryField: '' };
            const toolCards = new Map();

            function getToolStyle(toolName) {
                return TOOL_STYLES[toolName] || DEFAULT_TOOL_STYLE;
            }

            // 从参数 JSON 提取该工具最值得在折叠态显示的字段
            function summarizeArgs(toolName, argsJson) {
                if (!argsJson) {
                    return '';
                }
                let parsed;
                try {
                    parsed = JSON.parse(argsJson);
                } catch {
                    return argsJson.length > 120 ? argsJson.slice(0, 117) + '\u2026' : argsJson;
                }
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    return JSON.stringify(parsed);
                }
                const field = getToolStyle(toolName).summaryField;
                if (field && typeof parsed[field] === 'string' && parsed[field]) {
                    const value = parsed[field];
                    return value.length > 100 ? value.slice(0, 97) + '\u2026' : value;
                }
                for (const v of Object.values(parsed)) {
                    if (typeof v === 'string' && v) {
                        return v.length > 100 ? v.slice(0, 97) + '\u2026' : v;
                    }
                }
                return '';
            }

            function formatDuration(ms) {
                if (typeof ms !== 'number' || ms < 0) {
                    return '';
                }
                return ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(2) + ' s';
            }

            function getOrCreateGroup() {
                let group = chatContainer.lastElementChild;
                if (!group || !group.classList.contains('conversation-group')) {
                    group = document.createElement('div');
                    group.className = 'conversation-group';
                    chatContainer.appendChild(group);
                }
                return group;
            }

            // 创建或获取一次工具调用对应的卡片（按 toolCallId 匹配）。
            // 首次进入为「运行中」折叠态，args 已经在 body 里准备好。
            function upsertToolCard(toolCallId, toolName, argsJson) {
                if (toolCallId && toolCards.has(toolCallId)) {
                    const existing = toolCards.get(toolCallId);
                    if (argsJson) {
                        existing.summary.textContent = summarizeArgs(toolName, argsJson);
                    }
                    return existing;
                }

                const style = getToolStyle(toolName);
                const block = document.createElement('div');
                block.className = 'tool-activity collapsed tool-' + (toolName || 'default');
                block.style.borderLeftColor = style.accent;

                const header = document.createElement('div');
                header.className = 'tool-activity-header';

                const toggle = document.createElement('span');
                toggle.className = 'tool-activity-toggle';
                toggle.textContent = '\u25B8';

                const icon = document.createElement('span');
                icon.className = 'tool-activity-icon';
                icon.textContent = style.icon;

                const name = document.createElement('span');
                name.className = 'tool-activity-name';
                name.textContent = style.label;

                const summary = document.createElement('span');
                summary.className = 'tool-activity-summary';
                summary.textContent = summarizeArgs(toolName, argsJson);

                const status = document.createElement('span');
                status.className = 'tool-activity-status';
                status.textContent = 'Running\u2026';

                header.appendChild(toggle);
                header.appendChild(icon);
                header.appendChild(name);
                header.appendChild(summary);
                header.appendChild(status);

                const body = document.createElement('div');
                body.className = 'tool-activity-body';
                body.style.display = 'none';

                const argsSection = document.createElement('div');
                argsSection.className = 'tool-activity-section';
                const argsTitle = document.createElement('div');
                argsTitle.className = 'tool-activity-section-title';
                argsTitle.textContent = 'Parameters';
                argsSection.appendChild(argsTitle);
                argsSection.appendChild(buildToolCallArgsElement(argsJson));
                body.appendChild(argsSection);

                const resultSection = document.createElement('div');
                resultSection.className = 'tool-activity-section tool-activity-result';
                resultSection.style.display = 'none';
                const resultTitle = document.createElement('div');
                resultTitle.className = 'tool-activity-section-title';
                resultTitle.textContent = 'Result';
                resultSection.appendChild(resultTitle);
                const loading = document.createElement('pre');
                loading.className = 'tool-activity-pre tool-activity-loading';
                loading.textContent = 'Running\u2026';
                resultSection.appendChild(loading);
                body.appendChild(resultSection);

                header.onclick = () => {
                    const collapsed = block.classList.toggle('collapsed');
                    body.style.display = collapsed ? 'none' : '';
                    toggle.textContent = collapsed ? '\u25B8' : '\u25BE';
                };

                block.appendChild(header);
                block.appendChild(body);
                getOrCreateGroup().appendChild(block);

                const entry = { block, body, header, status, summary, resultSection };
                if (toolCallId) {
                    toolCards.set(toolCallId, entry);
                }
                chatContainer.scrollTop = chatContainer.scrollHeight;
                return entry;
            }

            // 把工具结果追加到已有的卡片：替换 loading 占位、更新状态文本。
            function completeToolCard(toolCallId, toolName, result, isError, duration) {
                const entry = toolCards.get(toolCallId) || upsertToolCard(toolCallId, toolName, '{}');
                const { status, resultSection } = entry;
                status.classList.toggle('error', !!isError);
                const time = formatDuration(duration);
                if (time) {
                    status.textContent = (isError ? 'Failed \u00B7 ' : 'Done \u00B7 ') + time;
                } else {
                    status.textContent = isError ? 'Failed' : 'Done';
                }

                const old = resultSection.querySelector('.tool-activity-pre');
                const pre = document.createElement('pre');
                pre.className = 'tool-activity-pre';
                if (isError) {
                    pre.classList.add('error');
                }
                pre.textContent = result ? result : '(No output)';
                if (old) {
                    old.replaceWith(pre);
                } else {
                    resultSection.appendChild(pre);
                }
                resultSection.style.display = '';
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            // Thinking 块：与 tool-activity 共用结构，但用紫色、默认展开、滚动展示。
            const THINKING_ICON = '\uD83E\uDDE0'; // 🧠
            let thinkingCard = null;
            let thinkingBody = null;
            let thinkingPre = null;
            let thinkingCharCount = 0;

            function upsertThinkingCard() {
                if (thinkingCard) {
                    // 已经创建过（同一次 agent run 内的第二条 thinking_delta 不会出现，这里是幂等保护）
                    return;
                }
                const block = document.createElement('div');
                block.className = 'tool-activity thinking';
                block.style.borderLeftColor = '#7d56f4';

                const header = document.createElement('div');
                header.className = 'tool-activity-header';

                const toggle = document.createElement('span');
                toggle.className = 'tool-activity-toggle';
                toggle.textContent = '\u25BE'; // 默认展开，所以是 ▾

                const icon = document.createElement('span');
                icon.className = 'tool-activity-icon';
                icon.textContent = THINKING_ICON;

                const name = document.createElement('span');
                name.className = 'tool-activity-name';
                name.textContent = 'Thinking';

                const summary = document.createElement('span');
                summary.className = 'tool-activity-summary';
                summary.textContent = 'Model is thinking\u2026';

                const status = document.createElement('span');
                status.className = 'tool-activity-status';
                status.textContent = 'Running\u2026';

                header.append(toggle, icon, name, summary, status);

                const body = document.createElement('div');
                body.className = 'tool-activity-body';
                body.style.display = '';

                const pre = document.createElement('pre');
                pre.className = 'tool-activity-pre';
                body.appendChild(pre);

                header.onclick = () => {
                    const collapsed = block.classList.toggle('collapsed');
                    body.style.display = collapsed ? 'none' : '';
                    toggle.textContent = collapsed ? '\u25B8' : '\u25BE';
                };

                block.append(header, body);
                getOrCreateGroup().appendChild(block);
                chatContainer.scrollTop = chatContainer.scrollHeight;

                thinkingCard = block;
                thinkingBody = body;
                thinkingPre = pre;
                thinkingCharCount = 0;
            }

            function appendThinkingDelta(delta) {
                if (!thinkingCard || !thinkingPre) {
                    // 没有 start 就收到了 delta（防御性）：现补一张
                    upsertThinkingCard();
                }
                thinkingPre.appendChild(document.createTextNode(delta));
                thinkingCharCount += delta.length;
                // 自动滚动到最新内容
                if (thinkingBody) {
                    thinkingBody.scrollTop = thinkingBody.scrollHeight;
                }
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            function endThinkingCard(duration) {
                if (!thinkingCard) {
                    return;
                }
                const status = thinkingCard.querySelector('.tool-activity-status');
                const summary = thinkingCard.querySelector('.tool-activity-summary');
                const time = formatDuration(duration);
                if (status) {
                    status.textContent = time ? ('Done \u00B7 ' + time) : 'Done';
                }
                if (summary) {
                    summary.textContent = thinkingCharCount > 0
                    ? (formatNumber(thinkingCharCount) + ' chars')
                    : '(No reasoning content)';
                }
                chatContainer.scrollTop = chatContainer.scrollHeight;
                // 清理引用，等待下一次 start
                thinkingCard = null;
                thinkingBody = null;
                thinkingPre = null;
                thinkingCharCount = 0;
            }

            // Agent 级别的错误（非工具错误），用一张简洁的红色卡片展示。
            function appendErrorActivity(message) {
                const block = document.createElement('div');
                block.className = 'tool-activity tool-default';
                block.style.borderLeftColor = '#e06c75';

                const header = document.createElement('div');
                header.className = 'tool-activity-header';
                const toggle = document.createElement('span');
                toggle.className = 'tool-activity-toggle';
                toggle.textContent = '\u25B8';
                const icon = document.createElement('span');
                icon.className = 'tool-activity-icon';
                icon.textContent = '\u26A0';
                const name = document.createElement('span');
                name.className = 'tool-activity-name';
                name.textContent = 'Agent';
                const summary = document.createElement('span');
                summary.className = 'tool-activity-summary';
                summary.textContent = 'Run error';
                const status = document.createElement('span');
                status.className = 'tool-activity-status error';
                status.textContent = 'Failed';
                header.append(toggle, icon, name, summary, status);

                const body = document.createElement('div');
                body.className = 'tool-activity-body';
                body.style.display = 'none';
                const pre = document.createElement('pre');
                pre.className = 'tool-activity-pre error';
                pre.textContent = message || '';
                body.appendChild(pre);

                header.onclick = () => {
                    const collapsed = block.classList.toggle('collapsed');
                    body.style.display = collapsed ? 'none' : '';
                    toggle.textContent = collapsed ? '\u25B8' : '\u25BE';
                };

                block.append(header, body);
                getOrCreateGroup().appendChild(block);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            // 把工具调用的参数 JSON 渲染成对齐的列表；如果不是 JSON 则原样显示。
            function buildToolCallArgsElement(rawDetail) {
                const argsRoot = document.createElement('div');
                argsRoot.className = 'tool-activity-args-root';
                const text = (rawDetail || '').trim();
                if (!text) {
                    argsRoot.textContent = '(No parameters)';
                    return argsRoot;
                }
                let parsed;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    const pre = document.createElement('pre');
                    pre.className = 'tool-activity-pre';
                    pre.textContent = rawDetail;
                    argsRoot.appendChild(pre);
                    return argsRoot;
                }
                if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                    const pre = document.createElement('pre');
                    pre.className = 'tool-activity-pre';
                    pre.textContent = JSON.stringify(parsed, null, 2);
                    argsRoot.appendChild(pre);
                    return argsRoot;
                }
                const dl = document.createElement('dl');
                dl.className = 'tool-activity-args';
                for (const [key, value] of Object.entries(parsed)) {
                    const dt = document.createElement('dt');
                    dt.textContent = key;
                    const dd = document.createElement('dd');
                    dd.textContent = formatToolArgValue(value);
                    dl.appendChild(dt);
                    dl.appendChild(dd);
                }
                argsRoot.appendChild(dl);
                return argsRoot;
            }

            function formatToolArgValue(value) {
                if (value === null) {
                    return 'null';
                }
                if (value === undefined) {
                    return '';
                }
                const t = typeof value;
                if (t === 'string') {
                    return value;
                }
                if (t === 'number' || t === 'boolean' || t === 'bigint') {
                    return String(value);
                }
                try {
                    return JSON.stringify(value);
                } catch {
                    return String(value);
                }
            }

            // 在对话流末尾追加一行 token 用量摘要。
            function appendUsageFooter(usage) {
                if (!usage || typeof usage.total !== 'number') {
                    return;
                }
                let group = chatContainer.lastElementChild;
                if (!group || !group.classList.contains('conversation-group')) {
                    group = document.createElement('div');
                    group.className = 'conversation-group';
                    chatContainer.appendChild(group);
                }
                const footer = document.createElement('div');
                footer.className = 'usage-footer';
                footer.textContent = 'Token usage · in ' + formatNumber(usage.input)
                    + ' · out ' + formatNumber(usage.output)
                    + ' · total ' + formatNumber(usage.total);
                group.appendChild(footer);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            function formatNumber(n) {
                const num = typeof n === 'number' ? n : 0;
                return num.toLocaleString('en-US');
            }

            // Initialize when DOM is ready
            document.addEventListener('DOMContentLoaded', () => {
                chatContainer = document.getElementById('chat-container');
                initAllThinkSections();
            });

            // Initialize UI elements
            const messageInput = document.getElementById('message-input');
            const sendButton = document.getElementById('send-button');
            const menuButton = document.getElementById('menu-button');
            const menu = document.getElementById('menu');
            const clearChatButton = document.getElementById('clear-chat');

            // 确认对话框按钮
            document.getElementById('confirm-allow').onclick = () => {
                if (pendingConfirmRequestId) {
                    vscode.postMessage({
                        command: 'confirmActionResult',
                        requestId: pendingConfirmRequestId,
                        approved: true
                    });
                }
                pendingConfirmRequestId = null;
                document.getElementById('confirm-dialog').style.display = 'none';
            };
            document.getElementById('confirm-deny').onclick = () => {
                if (pendingConfirmRequestId) {
                    vscode.postMessage({
                        command: 'confirmActionResult',
                        requestId: pendingConfirmRequestId,
                        approved: false
                    });
                }
                pendingConfirmRequestId = null;
                document.getElementById('confirm-dialog').style.display = 'none';
            };

            // Send message function
            function sendMessage() {
                const content = messageInput.value.trim();
                if (!content || isGenerating) return;

                appendMessage(content, true);
                messageInput.value = '';
                messageInput.style.height = 'auto';
                updateSendButton(true);

                vscode.postMessage({
                    command: 'sendMessage',
                    content,
                    agentMode: agentModeEnabled,
                    resetContext: false
                });
            }

            // Send button click handler
            sendButton.onclick = () => {
                if (!isGenerating) {
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

            // 清除对话的处理逻辑
            // 清空聊天视图并恢复欢迎卡片，同时重置所有前端会话状态。
            // 供「Clear Chat」按钮与 /reset 命令共用。
            function resetChatView() {
                chatContainer.innerHTML = '';
                chatContainer.appendChild(createWelcomeMessage());

                // 重置 thinking / tool 卡片状态
                thinkingCard = null;
                thinkingBody = null;
                thinkingPre = null;
                thinkingCharCount = 0;
                toolCards.clear();

                // 重置会话与确认状态
                currentConversationId = null;
                pendingConfirmRequestId = null;
                const confirmDialog = document.getElementById('confirm-dialog');
                if (confirmDialog) {
                    confirmDialog.style.display = 'none';
                }
                isGenerating = false;
                updateSendButton(false);
            }

            clearChatButton.onclick = () => {
                resetChatView();

                // 通知扩展端清理后端会话上下文:
                // - 普通对话历史 (messageHistory)
                // - Agent 会话上下文 (piRunner 持有的 Pi session)
                // 仅仅清空前端 UI 不够,否则下次 sendMessage 模型仍能"记住"旧内容。
                vscode.postMessage({ command: 'clearChat' });
                vscode.setState({ messages: [] });
                menu.classList.remove('show');
            };

            // 命令定义
            const commands = [
                {
                    name: '/reset',
                    description: '重置对话上下文',
                    execute: () => {
                        vscode.postMessage({
                            command: 'resetContext'
                        });

                        const newGroup = document.createElement('div');
                        newGroup.className = 'conversation-group';

                        const resetNotification = document.createElement('div');
                        resetNotification.className = 'message assistant-message';
                        const modelName = currentModelName || 'Assistant';
                        resetNotification.innerHTML = '<div class="message-prefix">' + modelName + '</div><div class="message-content markdown-content"><p>Conversation context has been reset.</p></div>';

                        newGroup.appendChild(resetNotification);
                        chatContainer.appendChild(newGroup);
                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }
                }
                // 可以在这里添加更多命令
            ];

            let commandSuggestions = null;

            // 命令提示的更新逻辑
            function updateCommandSuggestions(input) {
                const suggestionsDiv = document.getElementById('command-suggestions');
                if (!suggestionsDiv) {
                    const div = document.createElement('div');
                    div.id = 'command-suggestions';
                    document.querySelector('.input-wrapper').appendChild(div);
                    // CSP 兼容:事件委托代替内联 onclick
                    div.addEventListener('click', (e) => {
                        const item = e.target.closest('.command-item');
                        if (item) {
                            selectCommand(item.getAttribute('data-command'));
                        }
                    });
                    return updateCommandSuggestions(input);
                }

                // 当输入 '/' 时显示所有命令
                if (input === '/') {
                    selectedCommandIndex = -1;
                    const suggestionsHtml = commands.map((cmd, index) => '<div class="command-item" data-command="' + cmd.name + '"><span class="command-name">' + cmd.name + '</span><span class="command-description">' + cmd.description + '</span></div>').join('');
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
                        const suggestionsHtml = filteredCommands.map((cmd, index) => '<div class="command-item" data-command="' + cmd.name + '"><span class="command-name">' + cmd.name + '</span><span class="command-description">' + cmd.description + '</span></div>').join('');
                        suggestionsDiv.innerHTML = suggestionsHtml;
                        suggestionsDiv.style.display = 'block';
                    } else {
                        suggestionsDiv.style.display = 'none';
                    }
                } else {
                    suggestionsDiv.style.display = 'none';
                }
            }

            // 命令选择函数
            function selectCommand(commandName) {
                messageInput.value = commandName + ' ';
                hideCommandSuggestions();
                messageInput.focus();
            }

            // 键盘事件处理
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

            // 输入事件处理
            messageInput.addEventListener('input', (e) => {
                const input = e.target.value;
                updateCommandSuggestions(input);

                // 自动调整高度（box-sizing: border-box）
                e.target.style.height = 'auto';
                // scrollHeight 含 padding 但不含 border；border-box 下 height 含 padding+border，
                // 补上 border 高度，避免每次敲字产生 2px 的滚动抖动。
                const borderHeight = e.target.offsetHeight - e.target.clientHeight;
                const newHeight = Math.min(e.target.scrollHeight + borderHeight, 200);
                e.target.style.height = newHeight + 'px';
            });

            // 点击外部关闭提示
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

                messageInput.disabled = generating;
                messageInput.style.opacity = generating ? '0.7' : '1';
                messageInput.style.cursor = generating ? 'not-allowed' : 'text';
            }

            // 构建欢迎消息
            function createWelcomeMessage() {
                const welcomeDiv = document.createElement('div');
                welcomeDiv.className = 'message assistant-message welcome-message';
                welcomeDiv.innerHTML = [
                    '<div class="welcome-content">',
                    '  <h2 class="welcome-title">',
                    '    👋 Welcome to VSCode Ollama!',
                    '  </h2>',
                    '  <p class="welcome-text">',
                    '    <a href="https://github.com/warm3snow/vscode-ollama" class="welcome-link">[vscode-ollama]</a> is a VS Code extension powered by local Ollama — chat with models or let them code for you, all running privately on your machine.',
                    '  </p>',
                    '  <ul class="welcome-tips">',
                    '    <li>Agent mode needs a model with <strong>tool calling</strong> support (e.g. llama3.1, qwen3).</li>',
                    '  </ul>',
                    '  <p class="welcome-footer">',
                    '    GitHub: <a href="https://github.com/warm3snow/vscode-ollama" class="welcome-link">https://github.com/warm3snow/vscode-ollama</a>',
                    '    <br>',
                    '    Star the repo to support ongoing development!',
                    '  </p>',
                    '</div>'
                ].join('');
                return welcomeDiv;
            }

            // Message event listener
            window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'resetChat') {
                    resetChatView();
                } else if (message.command === 'streamMessage') {

                    if (message.newMessage) {
                        currentConversationId = message.conversationId;
                        appendMessage('', false);
                    }

                    const selector = '.assistant-message[data-conversation-id="' + message.conversationId + '"] .message-content';
                    let messageDiv = document.querySelector(selector);

                    // 兜底：如果消息尚未创建（例如 Agent 在无内容输出时直接结束），创建一条空消息
                    if (!messageDiv && message.conversationId) {
                        currentConversationId = message.conversationId;
                        appendMessage('', false);
                        messageDiv = document.querySelector(selector);
                    }

                    if (messageDiv) {
                        const currentText = messageDiv.getAttribute('data-markdown-content') || '';
                        const newText = currentText + message.content;
                        messageDiv.setAttribute('data-markdown-content', newText);

                        const processedContent = sanitizeAssistantProtocolContent(newText);
                        renderAssistantContent(processedContent, messageDiv);

                        chatContainer.scrollTop = chatContainer.scrollHeight;
                    }

                    // 当消息完成时重置状态
                    if (message.done) {
                        currentConversationId = null;
                        updateSendButton(false);
                        messageInput.focus();
                    }
                } else if (message.command === 'agentStatus') {
                    const statusEl = document.getElementById('agent-status');
                    if (!statusEl) {
                        return;
                    }
                    const ev = message.event;
                    if (ev.type === 'thinking_start') {
                        upsertThinkingCard();
                    } else if (ev.type === 'thinking_delta') {
                        appendThinkingDelta(ev.thinkingDelta);
                    } else if (ev.type === 'thinking_end') {
                        endThinkingCard(ev.duration);
                    } else if (ev.type === 'tool_call') {
                        statusEl.textContent = '🔧 ' + (ev.toolName || 'tool');
                        statusEl.style.display = 'block';
                        upsertToolCard(ev.toolCallId, ev.toolName, ev.args);
                    } else if (ev.type === 'tool_result') {
                        statusEl.textContent = '✅ ' + (ev.toolName || 'tool');
                        statusEl.style.display = 'block';
                        completeToolCard(ev.toolCallId, ev.toolName, ev.result, ev.isError, ev.duration);
                    } else if (ev.type === 'done') {
                        statusEl.style.display = 'none';
                    } else if (ev.type === 'usage') {
                        appendUsageFooter(ev.usage);
                    } else if (ev.type === 'error') {
                        statusEl.textContent = '⚠️ ' + (ev.message || 'Agent error');
                        statusEl.style.display = 'block';
                        appendErrorActivity(ev.message);
                    }
                } else if (message.command === 'confirmAction') {
                    pendingConfirmRequestId = message.request.requestId;
                    const isPlan = message.request.kind === 'plan';
                    document.getElementById('confirm-title').textContent = isPlan ? '📋 Agent proposes an implementation plan' : '🧩 Agent requests to perform an operation';
                    document.getElementById('confirm-tool').textContent = isPlan ? 'Implementation Plan' : message.request.toolName;
                    document.getElementById('confirm-args').textContent = message.request.args || '{}';
                    document.getElementById('confirm-dialog').style.display = 'flex';
                } else if (message.command === 'welcomeMessage') {
                    chatContainer.appendChild(createWelcomeMessage());
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                } else if (message.command === 'updateModelName') {
                    currentModelName = message.modelName;
                }
            });

            // Initialize on load
            window.addEventListener('load', () => {
                vscode.postMessage({
                    command: 'webviewReady'
                });
            });
        </script>
    </body>
    </html>`;
}
