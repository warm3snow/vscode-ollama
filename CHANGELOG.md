# Change Log

All notable changes to the "vscode-ollama" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.2.0] - 2025-02-26

### Added
- Enhanced web search functionality
  - Use Bing as default search engine
  - Added DuckDuckGo as fallback search engine
  - Improved search reliability and stability

### Changed
- Refined chat view interface
  - UI/UX improvements
  - Enhanced visual presentation
  - Optimized response handling

### Fixed
- Fixed web search functionality issues
  - Improved error handling for search engines
  - Enhanced page content fetching mechanism
- Fixed think time settings for DeepSeek model
- Fixed various stability issues

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