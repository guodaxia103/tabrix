# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed (BREAKING — product surface pruning aligned with MKEP)

This release executes the maintainer-owned product pruning plan and removes five
non-MKEP product surfaces from the extension and native server. All
removals are intentional and make room for the MKEP Stage 3+ work
(Memory / Knowledge / Experience viewers).

- **Smart Assistant stack** (Agent + Quick Panel + Element Picker):
  - `app/native-server/src/agent/**` (19 files / 217 KB),
    `server/routes/agent.ts`, `AgentStreamManager`, `ClaudeEngine`,
    `CodexEngine`.
  - Chrome extension: sidepanel `AgentChat.vue` + `agent/` + `agent-chat/`
    - `composables/useAgent*.ts` + `styles/agent-chat.css`;
      `background/quick-panel/`, `shared/quick-panel/`, `common/agent-models.ts`;
      `entrypoints/quick-panel.content.ts`, `entrypoints/element-picker.content.ts`,
      `background/tools/browser/element-picker.ts`, `shared/element-picker/`,
      `inject-scripts/element-picker.js`.
  - Shared package: `packages/shared/src/agent-types.ts` and its re-export.
  - Native-server tests for `/agent/engines` were rewritten to assert the
    Bearer flow via `/mcp` initialize only.
- **Workflow / Record-Replay stack**:
  - `background/record-replay/` (RR-V2, ~71 files / 439 KB) and
    `background/record-replay-v3/` (RR-V3, ~63 files / 363 KB) except
    `offscreen-keepalive.ts`, which was relocated to
    `background/keepalive/offscreen-keepalive.ts` for MV3 SW keepalive.
  - MCP tools `run_flow` and `list_published_flows` and their schemas.
  - `entrypoints/builder/**` (node builder UI), `popup/components/builder/**`,
    and the popup "Quick Tools" / workflow card.
  - Sidepanel `workflows/**`, `rr-v3/**`, `SidepanelNavigator.vue`, and
    `composables/useWorkflows*`.
  - Shared package: `rr-graph.ts`, `step-types.ts`, `node-spec.ts`,
    `node-spec-registry.ts`, `node-specs-builtin.ts` and all RR tests
    (`tests/record-replay*`, `tests/rr-*`).
- **Local model / semantic engine**:
  - `utils/semantic-similarity-engine.ts`, `simd-math-engine.ts`,
    `content-indexer.ts`, `vector-database.ts`, `model-cache-manager.ts`.
  - `background/semantic-similarity.ts`, `background/storage-manager.ts`,
    `background/tools/browser/vector-search.ts` and the MCP tool
    `search_tabs_content` schema.
  - Popup `LocalModelPage.vue`, `ModelCacheManagement.vue`, `ConfirmDialog.vue`.
  - ONNX Runtime WASM assets: `app/chrome-extension/workers/` (~32 MB) and
    `public/libs/ort.min.js`.
  - Dependencies: `@xenova/transformers`, `hnswlib-wasm-static`, `@vue-flow/*`,
    `elkjs`. Offscreen document now hosts only GIF encoder + keepalive.
  - Manifest: dropped `/models/*` and `/workers/*` from
    `web_accessible_resources`, dropped `wasm-unsafe-eval` from CSP.
- **Element Marker management**:
  - `background/element-marker/**`, `inject-scripts/element-marker.js`,
    `common/element-marker-types.ts`, popup `ElementMarkerManagement.vue`,
    icon `MarkerIcon.vue`. `chrome_read_page`'s `markedElements` field
    is preserved as an empty array for contract stability.
- **Visual Editor (`web-editor-v2`)**:
  - `entrypoints/web-editor-v2/**` (61 files / 1,286 KB),
    `entrypoints/web-editor-v2.ts`, `background/web-editor/**`,
    `common/web-editor-types.ts`, `inject-scripts/web-editor.js`,
    `tests/web-editor-v2/**`, popup `EditIcon.vue`, `toggle_web_editor`
    shortcut binding.

**Sidepanel UI rebuild** (`feat(sidepanel): rebuild UI with MKEP ...`):
the old three tabs (`workflows / agent-chat / element-markers`) were
replaced with three "Coming in Stage 3x" placeholder tabs — Memory,
Knowledge, Experience — each linking to
maintainer-private MKEP planning materials.

**Data-dir helpers relocation**:
`getAgentDataDir / getDatabasePath / getDefaultWorkspaceDir /
getDefaultProjectRoot` moved from `native-server/src/agent/storage.ts`
to `native-server/src/shared/data-dirs.ts` (env vars unchanged so
existing installations keep using `~/.chrome-mcp-agent/`).

**MCP-level breaking changes** for upstream AI clients:

- `search_tabs_content` is no longer registered.
- `run_flow` and `list_published_flows` are no longer registered.
- `element_picker` is no longer registered.

Policy Phase 0's risk-tier coverage matrix and Knowledge Registry Stage
1/2 are unaffected.

### Fixed

- **CI**: `better-sqlite3` native binding (`node-v127-linux-x64`) was
  missing on GitHub Actions so all Memory / SessionManager Jest
  suites (Phases 0.1–0.3) crashed on `Could not locate the bindings
file`. Root cause: `pnpm install --ignore-scripts` **overrides**
  `pnpm.onlyBuiltDependencies`, and once pnpm 10 records the skip in
  `node_modules/.modules.yaml` a follow-up `pnpm rebuild` is still
  cached-out. The install step in `.github/workflows/ci.yml` and
  `.github/workflows/publish-npm.yml` now drops `--ignore-scripts`
  and relies on pnpm 10's default script-blocking plus the
  allow-list (`better-sqlite3` only) for supply-chain hardening.
  A belt-and-suspenders `pnpm rebuild better-sqlite3` plus a
  `require('better-sqlite3')` smoke check run immediately after
  install so the failure mode surfaces before `Core tests`.

### Added

- **MKEP Knowledge Registry — Stage 2 (HVO classifier)** — second
  data-ification pass. The GitHub object-layer rules that used to live
  as hardcoded branches in
  `read-page-high-value-objects-github.ts:classify` — T5.4.5's URL →
  `objectSubType` classifier (7 branches) plus the `GITHUB_CLASSIFICATION`
  label table (27 rows) — now ship as typed seed data in
  `app/chrome-extension/entrypoints/background/knowledge/seeds/github.ts`
  under the new `KnowledgeObjectClassifier` schema. A new
  `lookup/resolve-object-classification.ts` applies the rules in
  declaration order (URL rules first so URL-first dispatch is
  preserved), with optional `pageRole` scoping. `githubObjectLayerAdapter.classify`
  becomes **registry-first, legacy-fallback** and reuses the Stage 1
  `KNOWLEDGE_REGISTRY_MODE` flag (`on` / `off` / `diff`); production
  default stays `on`, the ARIA-role fallback continues to run TS-side.
  Scoring (`scorePrior`, `GITHUB_NOISE_PATTERNS`, `GITHUB_PREFERRED_LABELS`)
  and `collectExtraCandidates` / `GITHUB_PAGE_ROLE_TASK_SEEDS` are
  explicitly out of scope for Stage 2 and remain TS — see Stage 3.
  Added a bit-exact HVO parity suite
  (`read-page-high-value-objects-github.parity.test.ts`, 15 fixtures
  covering every URL rule, one label rule per pageRole, ARIA-fallback,
  and negatives) plus lookup unit tests
  (`knowledge-object-classification.test.ts`, 15 tests) and 5 new
  Stage 2 assertions in `knowledge-registry.test.ts`. Full extension
  suite goes from 843 → 878 tests, all green. Design document lives
  in maintainer-private Knowledge planning materials.

- **MKEP Knowledge Registry — Stage 1** — first data-ification pass of
  the Knowledge layer. The GitHub understanding-layer rules (Site
  Profile, Page Catalog, Primary Region anchors) that used to live as
  TS expressions in `read-page-understanding-github.ts` now also ship
  as typed seed data under
  `app/chrome-extension/entrypoints/background/knowledge/`
  (`types.ts` / `registry/` / `seeds/github.ts` / `lookup/`).
  `inferPageUnderstanding` becomes **registry-first, legacy-fallback
  -second**, gated by a `KNOWLEDGE_REGISTRY_MODE` internal constant
  (`on` / `off` / `diff`) so a regression can be rolled back by
  editing a single line. Per user instruction, Stage 1 carries **no
  tenancy dimension**: seeds are single-user local data. Scope is
  deliberately narrow — HVO classifier, object priors, and Douyin
  seeds all stay TS-side for Stage 2. A new parity suite
  (`read-page-understanding.parity.test.ts`) asserts bit-exact
  equivalence between the registry path and
  `githubPageFamilyAdapter` for 10 GitHub fixtures; combined with
  the existing `read-page-understanding.test.ts` / `read-page-mode.test.ts`
  / `read-page-high-value-objects-github.test.ts` suites this keeps
  the `read_page` contract stable through the migration. See
  maintainer-private Knowledge planning materials for the full design.
- **MKEP Memory Phase 0.3** — DOM action history. Every
  `chrome_click_element` / `chrome_fill_or_select` / `chrome_navigate` /
  `chrome_keyboard` call now persists a `memory_actions` row and
  returns a stable `memory://action/<uuid>` historyRef (attached to
  the owning `ExecutionStep.artifactRefs` and injected into the
  JSON body when present). Action rows carry `pre_snapshot_ref` ↦
  the most recent `memory_page_snapshots` row for the same tab in
  the same session, closing the Memory **snapshot → action →
  snapshot** evidence graph.
- `chrome_fill_or_select.value` is **never** written in plaintext:
  `args_blob` replaces the field with `"[redacted]"`, `value_summary`
  stores only `{kind, type, length, sha256}`, and `result_blob` is
  omitted entirely for `fill` because the extension message may
  echo the submitted value.
- Failed / soft-failed action attempts are also recorded
  (`status: 'failed' | 'soft_failure'`) so replay / debugging can
  see what was tried even when the call did not succeed.
- New modules: `app/native-server/src/memory/action-service.ts` and
  `app/native-server/src/memory/db/action-repository.ts`;
  `PageSnapshotRepository` gains
  `findLatestInSessionForTab({ sessionId, tabId, beforeIso })` with
  a new companion index `memory_page_snapshots_tab_captured_idx`.
- Design rationale: maintainer-private Memory planning materials.

- **MKEP Memory Phase 0.2** — `chrome_read_page` now emits a real
  `historyRef` of the form `memory://snapshot/<uuid>` and persists a
  structured slice of the read-page response into a new
  `memory_page_snapshots` SQLite table. The snapshot row also flows
  back into the owning `ExecutionStep.artifactRefs`, giving every
  read-page call a stable Memory handle that downstream tools can
  point at.
- New `app/native-server/src/memory/page-snapshot-service.ts`
  service and `app/native-server/src/memory/db/page-snapshot-repository.ts`
  repo — follow the same sync write-through pattern as Phase 0.1.
- New `app/native-server/src/mcp/tool-post-processors.ts` registry
  hooks the `chrome_read_page` success path in `handleToolCall`
  without affecting any other tool; unrelated tools pay zero overhead.
- Design rationale: maintainer-private Memory planning materials.

### Changed

- `SessionManager` now exposes a `pageSnapshots` façade
  (`PageSnapshotService | null`). Public API otherwise unchanged;
  `reset()` additionally clears `memory_page_snapshots`.

## [v2.1.0] - 2026-04-20

### Added

- `read_page` T5.4 four-layer high-value object pipeline wired into the task
  protocol:
  - Neutral `collectCandidateObjects` / `classifyCandidateObject` /
    `scoreCandidateObject` in `read-page-high-value-objects-core.ts`.
  - GitHub family adapter (`githubObjectLayerAdapter`) contributes per-role
    seeds, label classification (`nav_entry` / `record` / `control` /
    `status_item` / `entry`), and prior boosts/penalties.
  - New optional fields on `ReadPageHighValueObject`: `objectType`, `region`,
    `importance` (0..1), `reasons` (multi-step explainability), `actions`,
    `sourceKind`. `reason` (singular) remains for backward compatibility.
  - Neutral noise downranking for commit hashes, timing durations, commitlint
    prefixes, and overly long labels. GitHub-specific shell wording
    (watch/star/pin, "Search or jump to...", "Open Copilot...",
    "Skip to content", footer links) is downranked via the family adapter.

### Changed

- `read-page-task-protocol.ts` no longer owns GitHub object-layer priors or
  custom label scoring. It calls the neutral pipeline with family adapters
  and runs a two-pass score so taskMode alignment applies without coupling
  taskMode inference to family-specific scoring.
- GitHub 4 core-page ranking continues to place seed navigation entries
  (Issues / Pull requests / Actions / Summary / Jobs / ...) above
  generic interactives, and `L0` summary wording is preserved
  (`Primary repo entry points are ...`).
- Lockstep package versions moved to `2.1.0`:
  - `tabrix-monorepo`
  - `@tabrix/tabrix`
  - `@tabrix/extension`
  - `@tabrix/shared`
  - `@tabrix/wasm-simd`
- `@tabrix/tabrix` dependency updated to `@tabrix/shared@^2.1.0`.

### Verified

- T5.0~T5.4 full-chain real-browser compatibility verified end-to-end by the
  maintainer-held private acceptance suite
  (15 / 15 scenarios passed, `productLevelReady: true`, all four verdicts
  `legacyCorePassed` / `t5UnderstandingPassed` / `compatibilityPassed` /
  `recoveryCompatibilityPassed` == `true`). See
  `docs/RELEASE_NOTES_v2.1.0.md` for the acceptance envelope.

## [v2.0.9] - 2026-04-17

### Added

- Formal bridge-recovery guidance source shared by `status`, `doctor`, `report`, and MCP tool failures.
- Recovery-special smoke coverage via `tabrix smoke --bridge-recovery`.
- Public product docs now state that real browser requests can auto-recover and continue when the bridge is not ready.

### Changed

- Lockstep package versions moved to `2.0.9`:
  - `tabrix-monorepo`
  - `@tabrix/tabrix`
  - `@tabrix/extension`
  - `@tabrix/shared`
  - `@tabrix/wasm-simd`
- `@tabrix/tabrix` dependency updated to `@tabrix/shared@^2.0.9`.
- Browser automation tool failures now return a single `nextAction` instead of multi-step manual suggestions.
- `/status` bridge snapshot now includes unified recovery guidance for downstream diagnostics and reporting.

### Fixed

- Completed the formal recovery loop for browser automation requests:
  - bridge-degraded / broken recovery now attempts recovery and continues the original request when possible.
  - command-channel-not-ready cases now wait for recovery and reuse the same request path instead of stopping at advisory text.
- Unified `status / doctor / report` recovery semantics so the same fault now produces one consistent action recommendation.
- Verified real recovery acceptance on the formal path:
  - injected bridge failure -> real browser tool request -> automatic recovery -> original request success.

## [v2.0.8] - 2026-04-15

### Added

- Browser executable path detection and persistence during setup, register, and doctor flows.
- Current acceptance matrix documentation for the Claude real-session baseline.

### Changed

- Lockstep package versions moved to `2.0.8`:
  - `tabrix-monorepo`
  - `@tabrix/tabrix`
  - `@tabrix/extension`
  - `@tabrix/shared`
  - `@tabrix/wasm-simd`
- `@tabrix/tabrix` dependency updated to `@tabrix/shared@^2.0.8`.
- Browser auto-launch on Windows now prefers direct executable startup instead of `cmd /c start`.

### Fixed

- Stabilized Claude dialog acceptance flow to complete without blocking desktop prompt leftovers.
- Added structured guards for non-web tabs instead of content-script injection failures.
- Unified platform detection in browser-config tests so GitHub Actions quality checks no longer fail on cross-platform assumptions.
- Reduced extension startup noise from duplicate context menu registration and CSP-blocked data URL fetches.

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
