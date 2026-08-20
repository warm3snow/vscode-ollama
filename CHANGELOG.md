# Change Log

All notable changes to the "vscode-ollama" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.


## [1.3.0] - 2026-08-19

### Added
- Coding agent mode: the model can use tools (`read` / `write` / `edit` / `grep` / `find` / `ls` / `bash`) instead of only direct chat
  - Read/search/list tools run automatically; file edits and command execution are sandboxed to the workspace
  - Multi-turn context persistence so the agent keeps the full session history
  - "vibe" / "go on" continue signal: the agent autonomously keeps working until the task is done, no repeated prompts needed
- Agent status bar showing the model's tool activity (thinking / tool call / result)
- Skill system: the agent auto-loads matching skills from `skills/*.md` (workspace first, then extension-bundled)
- Plan mode: prefix a request with `/plan` (or open-ended codebase questions) to propose a plan first, then execute automatically
- Web search as a tool (`web_search`), decided by the LLM per-question; codebase questions prefer `grep` / `find` / `ls` / `read`
- `scripts/verify-webview.js` checks webview script syntax and CSP safety; runs as part of `npm run compile`

### Changed
- Switched from Ollama's raw `/api/chat` to the OpenAI-compatible `/v1/chat/completions` endpoint (standard `tool_calls` pairing, SSE streaming, `max_tokens`)
- Unified build to esbuild (outputs `dist/extension.js`); `marked.min.js` is bundled locally for the webview
- Added Content Security Policy with nonce-based scripts to both webviews
- Rewrote the agent system prompt (Cline-style) with hard rules: codebase questions MUST use tools, real-time questions MUST use `web_search`, never ask the user to run commands
- Intent judgment now fully handled by the LLM; removed all regex-based intent detection
- `grep` tool falls back to POSIX `grep` when ripgrep is not installed

### Fixed
- Message history ordering bug (system prompt was appended to the end of the context)
- Streaming response parsing when a JSON line is split across chunks
- Webview script syntax errors and CSP-blocked handlers that broke chat sending and the model dropdown
- XSS risk: LLM/user content is now HTML-escaped before rendering
- Tool calls placed inside `message.content` (e.g. qwen2.5-coder) are now parsed via `<tool_call>` tags or bare JSON
- Removed stale `src/extension.js` that conflicted with `extension.ts`

## [1.2.1] - 2025-08-21

### Changed
- Translated chat homepage UI to English (welcome message, menu, input placeholder)

## [1.2.0] - 2025-02-26

### Added
- Enhanced web search functionality
  - Use Bing as default search engine
  - Added DuckDuckGo as fallback search engine
  - Improved search reliability and stability
- Added 'Thinking' time for DeepSeek model

### Changed
- Refined chat view interface
  - UI/UX improvements
  - Enhanced visual presentation
  - Optimized response handling

### Fixed
- Fixed web search functionality issues
  - Improved error handling for search engines
  - Enhanced page content fetching mechanism
- Fixed various stability issues
- Fixed /reset not working properly

## [1.1.0] - 2025-02-24

### Changed
- Moved connection test functionality to settings page
- Improved output message formatting
- Enhanced overall user interface organization

## [1.0.4] - 2025-02-21

### Fixed
- Fixed an issue where new chat responses were displayed in the wrong position after stopping generation
- Fixed incorrect message appending in multiple conversation threads
- Optimized streaming response handling logic for chat messages

## [1.0.3] - 2025-02-20

### Added
- Support for web search
- Support deepseek-r1 reasoning model

### Changed
- Optimized text display for better readability
- Improved message rendering performance and stability

### Fixed
- Fixed incomplete display of English text
- Fixed message formatting issues
- Fixed newline character display issues
- Fixed response styling issues

## [1.0.2] - 2025-02-20

### Added
- Added "/reset" command to reset the conversation context
- Added system prompt configuration support

### Fixed
- Fixed chat message context management based on maxTokens setting
- Improved message history token limit handling

## [1.0.1] - 2025-02-18

### Added
- Additional features in the `...`menu
  - Theme switching functionality (Coming Soon!!!)
  - Chat history clear

### Changed
- Improved chat interface styling
  - Enhanced chat history and input box borders
  - Unified border colors and thickness
  - Better overall visual experience

### Fixed
- Fixed welcome message loss after clearing chat
- Fixed theme state synchronization issues
- Fixed various TypeScript type checking issues

## [1.0.0] - 2025-02-17

### Initial Release
- Local Ollama service integration
- Multiple LLM model configuration support
- Web search capability
- Intuitive chat interface
- Model configuration and performance mode settings

### Added
- Initial release with core functionalities
- Local LLM support with Ollama integration
  - Multiple model support and easy switching
  - Low-latency responses
  - Secure and private environment
- Web search capability(Coming Soon!!!)
  - Real-time information integration
  - Smart search results synthesis
  - Accurate information citation
- Streaming chat interface
  - Markdown support
  - Code-aware context
  - Syntax highlighting
- Chat history preservation
  - Local storage
  - Session management
  - Export functionality
- Thought process visualization
  - Step-by-step reasoning
  - Intermediate results display
- Customizable settings
  - Server configuration
  - Model selection
  - Performance modes
  - Token management
  - Keep-alive settings

### Technical
- VS Code API integration
- WebView implementation
- Ollama API integration
- Error handling and recovery
- Performance optimizations