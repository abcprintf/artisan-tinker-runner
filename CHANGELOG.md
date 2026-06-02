# Changelog

All notable changes to **Artisan Tinker Runner** are documented here.

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
