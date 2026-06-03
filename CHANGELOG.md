# Changelog

## [3.2.4] - 2026-06-03

### Fixed

- Save template button (💾) silently did nothing — `window.prompt()` and `window.confirm()` are disabled in VS Code webview sandbox and always return `null`. Replaced with `vscode.window.showInputBox()` for naming and `vscode.window.showWarningMessage()` for delete confirmation.
- Save template now shows proper success/error feedback in the status bar.

## [3.2.2] - 2026-06-03

### Changed

- Moved 💾 Save Template button next to the **▶ Execute in Tinker** button for quicker access after a run.

## [3.2.0] - 2026-06-03

### Added

- **Project Templates**: templates are now stored as `.php` files inside `.tinker-templates/` in the workspace root — commit the folder to git and the whole team shares the same templates automatically.
- **Saved Templates panel**: collapsible panel listing saved templates with 📄 icon, name, **Load** and **🗑️ Delete** per row.

### Removed

- Hardcoded built-in example templates (User::count, DB::table, etc.) — replaced by the project-level template system.
- **Project Snippets** panel and its `workspaceState` storage — superseded by the file-based template system which is git-shareable.

---

## [3.1.1] - 2026-06-03

### Added

- Output section is now collapsible — click the output header to toggle it open/closed.

---

## [3.1.0] - 2026-06-03

### Removed

- Removed AI Suggest feature temporarily (compatibility issues with Cursor and non-Copilot editors)

---

## [3.0.7] - 2026-06-03

### Fixed

- Ask AI Submit now immediately shows "Thinking..." and the Stop button without waiting for the extension host — prevents blank silent state when the host encounters an unexpected error
- Wrapped entire AI request flow in an outer try/catch so any unhandled error surfaces as a visible error message instead of silently doing nothing

---

## [3.0.6] - 2026-06-03

### Fixed

- Extension failed to activate — parameter named `prompt` in `_handleAiSuggest` conflicted with a `const prompt` declaration inside the same function (SyntaxError). Renamed parameter to `userPrompt`.
- Ask AI Submit did nothing — `_handleAiSuggest` was referencing undefined `message` variable instead of its own parameters, causing a silent ReferenceError before any response was sent back to the webview

---

## [3.0.4] - 2026-06-03

### Added

- Ask AI now shows a "Thinking..." status and a Stop button while the AI is generating a response
- Stop button cancels the in-progress AI request and shows whatever was generated so far (Accept or Dismiss)

---

## [3.0.3] - 2026-06-03

### Fixed

- Ask AI now displays error messages in the output panel instead of silently resetting when the AI request fails
- Improved error message when no compatible AI model is found (e.g. when using Cursor without GitHub Copilot)

---

## [3.0.2] - 2026-06-03

### Fixed

- Fixed "✨ AI" button not showing the input panel when the editor is empty (moved validation to Submit)

---

## [3.0.1] - 2026-06-03

### Added

- **✨ AI Suggest — @mention Model context** — Click "✨ AI" to open the prompt input. Type your question + `@ModelName` (e.g. `@User @Order`) to attach that Model's schema as context before sending to Copilot. Press Ctrl+Enter or Submit to receive the suggestion.
- **✨ AI Suggest — Smart Model filter** — Auto-detects Model names from the code you've written (e.g. `User::`, `new Order()`) and loads only the relevant files. Supports projects with 100+ Models.
- **✨ AI Suggest — Project Model context** — Reads `app/Models/*.php` and extracts `$fillable`, `$casts`, `$table`, and relations so Copilot understands your project's actual schema.

### Fixed

- Excluded `.claude/` folder from VSIX package

---

## [3.0.0] - 2026-06-03

### Added

- **✨ AI Code Suggestions** — New "✨ AI" button next to Execute. Uses the VS Code Language Model API (GitHub Copilot) to stream PHP/Laravel code suggestions. Click Accept to insert the suggestion into the editor, or Dismiss to close the panel. Requires GitHub Copilot extension and VS Code 1.90+.
- **📁 Project Snippets Library** — Save named PHP snippets scoped to the current workspace (stored in VS Code `workspaceState`, isolated per project). New collapsible "Project Snippets" panel with Load, Save, and Delete actions — separate from the global run history.

### Changed

- Minimum VS Code version bumped to `1.90.0` (required for Language Model API)

---


## [2.9.1] - 2026-06-03

### Fixed

- **Activity bar icon** — Replaced complex multi-color SVG (gradients/filters) with monochromatic `currentColor` SVG so VS Code can theme it correctly
- **Mode switcher** — `local`/`sail`/`wsl` badge is now clickable to manually override auto-detected environment; cycles through modes and persists until next reload

---

## [2.9.0] - 2026-06-03

### Changed

- **Housekeeping** — Added `.vscodeignore` to slim down VSIX package (excludes `plan/`, `src/`, `screens/`, dev docs). Removed `CLAUDE.md` from version control.

---

## [2.8.0] - 2026-06-03

### Fixed & Improved

- **Activity bar icon** — Fixed icon not displaying by switching from unsupported `$(terminal)` codicon to `icon.svg` path
- **Publisher** — Changed publisher ID from `abcprintf` to `workitdee`
- **README** — Cleaned up for Marketplace: screenshot now uses relative path (bundled in `.vsix`), removed private repo clone instructions
- **DEVELOPMENT.md** — New developer setup guide with architecture notes, debugging tips, and publish instructions

---

## [2.7.0] - 2026-06-02

### Added — Phase 4: Advanced & Collaboration

- **🗄️ Query Log Viewer** — Output automatically detected as a query log (`DB::getQueryLog()` result) and rendered as an interactive table showing #, SQL, bindings, and execution time. New "🗄️ Capture query log" template inserted for quick use.
- **🌐 Share via Gist** — "🌐 Share" button appears after every successful run. Posts code + output as a secret GitHub Gist (anonymous, no token required) and opens it in the browser.
- **🧪 Test Runner** — Collapsible 🧪 Test Runner panel runs `php artisan test` directly from the sidebar. Supports an optional `--filter` to target specific test classes or methods.
- **📈 Usage Analytics** — Local-only 📈 Usage Stats panel (no telemetry, never leaves your machine) tracks total runs, cache hits, REPL runs, Gist shares, and test executions. Stored in webview `localStorage`.
- **🎓 Interactive Tutorial** — 5-step guided walkthrough shown automatically on first install. Covers code editing, templates, history/pins, REPL mode, and sharing. Skippable. Never shown again after completion.

All notable changes to **Artisan Tinker Runner** are documented here.

---

## [2.6.0] — 2026-06-02

### Added
- **PHP Path Auto-Detect** — Runs `which`/`where php` at startup; override with `artisan-tinker-runner.phpPath` in VS Code settings
- **Timeout Guard** — Kills the process after a configurable timeout (default 30s); configure via `artisan-tinker-runner.timeout`
- **Execution Cache** — MD5-keyed in-memory cache with configurable TTL (default 30s); shows `cached` badge in UI; disable via `artisan-tinker-runner.cacheEnabled`
- **Laravel Sail / Docker Detection** — Auto-detects `vendor/bin/sail` + `docker-compose.yml` and switches to `sail tinker` automatically
- **WSL Support** — Detects WSL workspace paths (`\\wsl$`, `/mnt/`) and routes execution via `wsl` command
- **Persistent REPL** — Toggle switch keeps a single `php artisan tinker` process alive between runs; code sent via stdin with a unique marker; Reset button clears the session
- **Environment badge** — Small badge in UI shows current detected environment: `local` / `sail` / `wsl`
- **Settings** — Four new VS Code settings: `phpPath`, `timeout`, `cacheEnabled`, `cacheTtl`

### Changed
- Version bump `2.5.0` → `2.6.0`

---

## [2.5.0] — 2026-06-02

### Added
- **Pin Favorite Snippets** — Pin/unpin history items via the 📌 button; pinned snippets always appear at the top of the dropdown in gold color
- **Snippet Templates** — 14 ready-to-use Laravel snippets in a dropdown, grouped into Models, Database, App, Cache/Queue, and Auth; click to insert at cursor position
- **Result Tree Viewer** — JSON output is automatically rendered as a collapsible tree; toggle between tree and raw view with `[raw]` / `[tree]`
- **Multi-Line Support** — Code is written to a temporary `.tinker_tmp.php` file before execution, ensuring multi-line PHP works reliably; temp file is cleaned up after each run

### Changed
- History items now carry a `pinned` boolean field; pinned items are preserved when the 15-item limit is reached (unpinned items are trimmed first)
- Version bump `2.4.0` → `2.5.0`

---

## [2.4.0] — 2026-06-02

### Added
- **Stop Process** — `■ Stop` button kills a running `php artisan tinker` process immediately; prevents infinite loops from freezing the panel
- **Search History** — Real-time text filter above the history dropdown
- **Pretty-Print Output** — JSON auto-formatted with `JSON.stringify(null, 2)`; `var_dump`/`print_r` output re-indented by bracket depth
- **Execution Time** — Elapsed milliseconds shown in status bar after each run
- **Copy Output** — One-click copy of the output area to clipboard
- **Clear Output** — One-click button to reset the output area
- **Error Boundary** — Friendly messages for all failure points:
  - `php` not in `PATH` (ENOENT) → `"PHP not found. Ensure php is in your PATH."`
  - No `artisan` in workspace → `"No artisan file found. Open a Laravel project folder."`
  - Long stderr stack traces → truncated to first meaningful line
- **Toast Notifications** — `vscode.window` info/warning/error messages after each execution

### Changed
- Error gate changed from `stderr && !stdout` to `exitCode !== 0 && !stdout` — fixes false errors when Laravel emits deprecation warnings on stderr during successful runs
- `proc` promoted to `this._proc` instance property to support cancellation
- `webviewView.webview` saved as `this._webview` for future use outside `resolveWebviewView`
- Removed debug status bar overlay from UI (replaced by proper status indicators)
- Version bump `2.2.4` → `2.4.0`

---

## [2.3.0] — 2026-05-xx

### Changed
- Rewrote Webview HTML using `String.raw` to prevent nested template literal conflicts
- Improved message handling between extension host and webview
- Refined execution history management

---

## [2.2.2] — 2026-05-xx

### Added
- Execution history stored in Webview `localStorage` (up to 15 entries with timestamps)
- History dropdown with recall and clear functionality
- Debug status bar in Webview for load diagnostics

### Changed
- Improved Webview HTML structure and styling
- Updated extension metadata (repository URL, description)

---

## [1.0.0] — 2026-05-xx

### Added
- Initial release
- Sidebar panel registered as `artisanTinkerView` in Activity Bar
- Execute PHP code via `php artisan tinker --execute` using `child_process.spawn` (`shell: false`)
- `Ctrl+Enter` / `Cmd+Enter` keyboard shortcut
- Auto-activation on workspaces containing an `artisan` file
- MIT License
