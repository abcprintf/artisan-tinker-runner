# 🛠️ Development Guide — Artisan Tinker Runner

## Prerequisites

- PHP 8.0+ in system `PATH`
- Node.js 18+ & npm
- VS Code 1.85+ or Cursor

---

## Run Locally

```bash
npm install
```

Press **F5** in VS Code to launch the **Extension Development Host** — opens a new VS Code window with the extension loaded.

> Open any Laravel project folder (must contain `artisan`) in the Extension Development Host window.

---

## Lint & Package

```bash
# Lint
npx eslint extension.js src/

# Build .vsix
npx vsce package
```

---

## Architecture

| File | Purpose |
|------|---------|
| `extension.js` | Main extension — host-side Node.js code, process spawning, webview provider |
| `src/webview.js` | Legacy prototype (not active) |
| `src/webview.html` | Legacy prototype (not active) |
| `package.json` | Extension manifest, commands, settings, activation events |

The active webview HTML/JS is **inlined inside `extension.js`** as a `String.raw` template string.

### Key Constraints

- Webview HTML uses `String.raw` — never use `${}` interpolation inside the template. Use `.replace()` for injecting Node.js values.
- `spawn` must keep `shell: false` (default) to prevent shell injection when executing user PHP code.
- All webview colors use `var(--vscode-*)` CSS variables for auto theme support.

---

## Debugging

| Goal | How |
|------|-----|
| View Node.js (host) logs | `Ctrl+Shift+P` → `Developer: Show Logs` → `Extension Host` |
| Debug Webview JS | `Ctrl+Shift+P` → `Developer: Open Webview Developer Tools` |
| Reload extension | `Ctrl+Shift+P` → `Developer: Reload Window` |

---

## Publishing

```bash
# Login with Personal Access Token (Marketplace → Manage scope)
npx vsce login workitdee

# Publish
npx vsce publish
```

Or upload `.vsix` manually at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).

---

## Versioning

Bump `version` in `package.json`, update `CHANGELOG.md`, then publish.
