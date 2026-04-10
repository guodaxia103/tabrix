# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v2.0.5] - 2026-04-10

### Added

- Release-readiness gate script for tag/version/release-notes consistency.
- Formal release process docs in English and Chinese.
- Repository spellcheck baseline for Tabrix terms.

### Changed

- Batch-B dependency upgrades: `markstream-vue`, `dotenv`, `commander`, `pino`.
- CI/release workflow now includes stronger release metadata checks.
- Command examples standardized to explicit package filter `@tabrix/tabrix`.

### Fixed

- Reduced release failures caused by version drift and incomplete release metadata.
- Reduced editor false positives (`Unknown word`) for project naming.

## [v2.0.3] - 2026-04-10

### Added

- Post-publish npm visibility verification in release workflow.

### Changed

- Added explicit npm `publishConfig` (`access: public`, npm registry URL) to package metadata.

### Fixed

- Reduced false-positive release success when npm package visibility lags after publish.

## [v2.0.2] - 2026-04-10

### Added

- Scoped package identity for npm publishing: `@tabrix/tabrix`.
- Release workflow npm diagnostics with auth precheck (`npm whoami`) and provenance fallback publish path.

### Changed

- Install command docs migrated to scoped package usage.
- Release workflow now resolves package name/version dynamically from `app/native-server/package.json`.
- Tarball detection now follows real `npm pack` output instead of hard-coded names.

### Fixed

- Fixed npm publication status checks for scoped package names.
- Reduced npm publish failures related to unscoped package ownership ambiguity.

## [v2.0.1] - 2026-04-10

### Added

- Manual release input `publish_npm` in GitHub Actions (`false` by default for manual runs).

### Changed

- Release workflow now checks out tag refs directly via `actions/checkout`.
- Release install step now uses `pnpm install --frozen-lockfile --ignore-scripts`.
- Added Node 24 actions runtime preference for workflow compatibility.

### Fixed

- Fixed manual tag dispatch failures in release workflow checkout stage.
- Fixed install-stage failure caused by lifecycle scripts requiring prebuilt artifacts.
- Ensured GitHub Release asset publishing can complete before npm publish failure is surfaced.

## [v2.0.0] - 2026-04-10

### Added

- Latest-install standardization for public users: `npm install -g @tabrix/tabrix@latest` and `pnpm install -g @tabrix/tabrix@latest`.
- Git tag based npm auto-publish workflow (`v*` / `tabrix-v*`) with provenance.
- Portable assistant skill renamed to `tabrix_browser` and linked in README.

### Changed

- Rebranded package and default CLI from `mcp-chrome-bridge` to `tabrix`.
- Preserved legacy command aliases for migration compatibility.
- Refined public documentation scope and removed internal planning docs from open-source surface.

### Fixed

- Resolved npm publish/install risk by replacing workspace dependency with semver dependency for `@tabrix/shared`.
- Added compatibility fallback for remote-access message enums across shared package versions.

### Notes

- Tabrix is a community-maintained continuation of `hangwin/mcp-chrome`.
- We appreciate and acknowledge all previous maintainers and contributors.

## [v0.0.5]

### Improved

- **Image Compression**: Compress base64 images when using screenshot tool
- **Interactive Elements Detection Optimization**: Enhanced interactive elements detection tool with expanded search scope, now supports finding interactive div elements

## [v0.0.4]

### Added

- **STDIO Connection Support**: Added support for connecting to the MCP server via standard input/output (stdio) method
- **Console Output Capture Tool**: New `chrome_console` tool for capturing browser console output

## [v0.0.3]

### Added

- **Inject script tool**: For injecting content scripts into web page
- **Send command to inject script tool**: For sending commands to the injected script

## [v0.0.2]

### Added

- **Conditional Semantic Engine Initialization**: Smart cache-based initialization that only loads models when cached versions are available
- **Enhanced Model Cache Management**: Comprehensive cache management system with automatic cleanup and size limits
- **Windows Platform Compatibility**: Full support for Windows Chrome Native Messaging with registry-based manifest detection
- **Cache Statistics and Manual Management**: User interface for viewing cache stats and manual cache cleanup
- **Concurrent Initialization Protection**: Prevents duplicate initialization attempts across components

### Improved

- **Startup Performance**: Dramatically reduced startup time when no model cache exists (from ~3s to ~0.5s)
- **Memory Usage**: Optimized memory consumption through on-demand model loading
- **Cache Expiration Logic**: Intelligent cache expiration (14 days) with automatic cleanup
- **Error Handling**: Enhanced error handling for model initialization failures
- **Component Coordination**: Simplified initialization flow between semantic engine and content indexer

### Fixed

- **Windows Native Host Issues**: Resolved Node.js environment conflicts with multiple NVM installations
- **Race Condition Prevention**: Eliminated concurrent initialization attempts that could cause conflicts
- **Cache Size Management**: Automatic cleanup when cache exceeds 500MB limit
- **Model Download Optimization**: Prevents unnecessary model downloads during plugin startup

### Technical Improvements

- **ModelCacheManager**: Added `isModelCached()` and `hasAnyValidCache()` methods for cache detection
- **SemanticSimilarityEngine**: Added cache checking functions and conditional initialization logic
- **Background Script**: Implemented smart initialization based on cache availability
- **VectorSearchTool**: Simplified to passive initialization model
- **ContentIndexer**: Enhanced with semantic engine readiness checks

### Documentation

- Added comprehensive conditional initialization documentation
- Updated cache management system documentation
- Created troubleshooting guides for Windows platform issues

## [v0.0.1]

### Added

- **Core Browser Tools**: Complete set of browser automation tools for web interaction
  - **Click Tool**: Intelligent element clicking with coordinate and selector support
  - **Fill Tool**: Form filling with text input and selection capabilities
  - **Screenshot Tool**: Full page and element-specific screenshot capture
  - **Navigation Tools**: URL navigation and page interaction utilities
  - **Keyboard Tool**: Keyboard input simulation and hotkey support

- **Vector Search Engine**: Advanced semantic search capabilities
  - **Content Indexing**: Automatic indexing of browser tab content
  - **Semantic Similarity**: AI-powered text similarity matching
  - **Vector Database**: Efficient storage and retrieval of embeddings
  - **Multi-language Support**: Comprehensive multilingual text processing

- **Native Host Integration**: Seamless communication with external applications
  - **Chrome Native Messaging**: Bidirectional communication channel
  - **Cross-platform Support**: Windows, macOS, and Linux compatibility
  - **Message Protocol**: Structured messaging system for tool execution

- **AI Model Integration**: State-of-the-art language models for semantic processing
  - **Transformer Models**: Support for multiple pre-trained models
  - **ONNX Runtime**: Optimized model inference with WebAssembly
  - **Model Management**: Dynamic model loading and switching
  - **Performance Optimization**: SIMD acceleration and memory pooling

- **User Interface**: Intuitive popup interface for extension management
  - **Model Selection**: Easy switching between different AI models
  - **Status Monitoring**: Real-time initialization and download progress
  - **Settings Management**: User preferences and configuration options
  - **Cache Management**: Visual cache statistics and cleanup controls

### Technical Foundation

- **Extension Architecture**: Robust Chrome extension with background scripts and content injection
- **Worker-based Processing**: Offscreen document for heavy computational tasks
- **Memory Management**: LRU caching and efficient resource utilization
- **Error Handling**: Comprehensive error reporting and recovery mechanisms
- **TypeScript Implementation**: Full type safety and modern JavaScript features

### Initial Features

- Multi-tab content analysis and search
- Real-time semantic similarity computation
- Automated web page interaction
- Cross-platform native messaging
- Extensible tool framework for future enhancements
