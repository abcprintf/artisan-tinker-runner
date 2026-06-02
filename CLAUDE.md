# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Package extension for distribution
npx vsce package

# Install dependencies
npm install

# Lint
npx eslint extension.js src/
```

To test locally: press **F5** in VS Code to launch the Extension Development Host, then open a Laravel project folder.

## Architecture

This is a single-file VS Code extension (`extension.js`) with no build step.

**Extension host (`extension.js`):**
- `TinkerSidebarProvider` registers as a `WebviewViewProvider` for the `artisanTinkerView` sidebar panel
- On message `execute`: spawns `php artisan tinker --execute <code>` via `child_process.spawn` (no `shell: true` — intentional, prevents shell injection)
- Posts `{ type: 'result' | 'error' }` messages back to the webview
- The HTML for the webview is returned inline as a `String.raw` template to avoid nested template literal issues

**Webview (inlined in `extension.js`, originally prototyped in `src/webview.js`):**
- Pure browser JS — no bundler, no framework
- Uses `localStorage` (key `artisan_tinker_history_v2`) to persist up to 15 history entries
- Communicates with the extension host via `vscode.postMessage` / `window.addEventListener('message', ...)`
- `src/webview.js` and `src/webview.html` are legacy/prototype files; the active webview code lives inside `extension.js`

**Activation:** triggered only when the workspace contains an `artisan` file (`workspaceContains:artisan`).

## Key Constraints

- The webview HTML uses `String.raw` to avoid escaping conflicts with nested template literals. Use `.replace()` for any Node.js → webview variable injection, not `${}` interpolation.
- `spawn` must remain `shell: false` (default) to avoid shell injection when executing user-provided PHP code.
- No test framework is configured. Manual testing requires the Extension Development Host.
