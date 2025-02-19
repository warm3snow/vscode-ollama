# Change Log

All notable changes to the "vscode-ollama" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.1] - 2025-02-18

### Added
- Theme switching functionality
  - Quick theme toggle through menu (Light/Dark)
  - Real-time theme state synchronization
  - Enhanced visual feedback for theme changes

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