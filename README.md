# 🪄 Artisan Tinker Runner

> A lightweight VS Code / Cursor extension to execute PHP code directly in **Artisan Tinker** from a dedicated sidebar panel — no terminal, no file switching, no setup.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🖥️ **Sidebar Panel** | Dedicated panel in Activity Bar, always accessible, theme-aware |
| ⚡ **Quick Execution** | Run PHP code via `php artisan tinker --execute` safely |
| 🛑 **Stop Process** | Kill a runaway or infinite-loop process instantly with the Stop button |
| 📜 **Execution History** | Auto-saves successful snippets (up to 15) with timestamps |
| 🔍 **Search History** | Filter history dropdown in real-time by keyword |
| 🎨 **Pretty-Print Output** | Auto-formats JSON and `var_dump`/`print_r` output for readability |
| ⏱️ **Execution Time** | Shows elapsed milliseconds after each run |
| 📋 **Copy / Clear Output** | One-click copy to clipboard or clear the output area |
| 🛡️ **Friendly Error Messages** | Human-readable errors for PHP not found, missing artisan, and crashes |
| ⌨️ **Keyboard Shortcut** | `Ctrl+Enter` / `Cmd+Enter` to execute instantly |
| 🌓 **Auto Theme Sync** | UI adapts automatically to any VS Code / Cursor theme |
| 📦 **Zero Config** | Just open a Laravel project and start tinkering |
| 🔐 **Safe Execution** | `shell: false` prevents shell injection; each run is isolated |

---

## 📦 Installation

### From Marketplace (Recommended)
1. Open **VS Code** or **Cursor**
2. Press `Ctrl+Shift+X` (Extensions)
3. Search: `Artisan Tinker Runner`
4. Click **Install** → Reload when prompted

### From VSIX (Local / Offline)
```bash
git clone https://github.com/abcprintf/artisan-tinker-runner.git
cd artisan-tinker-runner
npm install
npx vsce package
code --install-extension ./artisan-tinker-runner-*.vsix
```

---

## 🚀 Usage

### Basic Flow
```
1. Open a Laravel project (must contain `artisan` in root)
2. Click the 🪄 terminal icon in the Activity Bar
3. Type or paste PHP code in the editor
4. Press ▶ Execute or Ctrl+Enter / Cmd+Enter
5. View formatted output instantly below
6. Use the 📜 History dropdown (or search box) to recall previous snippets
```

### Example Snippets
```php
// Count records
User::count();

// Inspect environment
app()->environment();

// Pretty-print an array (auto-formatted)
dump(config('app'));

// Complex query
App\Models\Order::with('user')->where('status', 'pending')->get();
```

### Keyboard Shortcuts
| Action | Windows / Linux | macOS |
|--------|-----------------|-------|
| Execute | `Ctrl + Enter` | `Cmd + Enter` |
| Stop process | Click **■ Stop** button | Same |

---

## ⚙️ How It Works

- **Execution**: `child_process.spawn('php', ['artisan', 'tinker', '--execute', code])` — `shell: false` prevents special-character injection
- **Stop Process**: Sends `SIGTERM` to the child process; a `_stopping` guard prevents duplicate result messages
- **Pretty-Print**: JSON is formatted with `JSON.stringify(parsed, null, 2)`; `var_dump`/`print_r` output is re-indented by bracket depth
- **History**: Stored in Webview `localStorage` — persists across sessions, scoped to the extension
- **Themes**: All colors use `var(--vscode-*)` CSS variables — zero extra configuration needed

### Security
- No `eval()` or `shell: true`
- No network requests or telemetry
- CSP restricts Webview to inline scripts only

---

## 🛠️ Development

### Prerequisites
- PHP 8.0+ in system `PATH`
- Node.js 18+ & npm
- VS Code 1.85+ or Cursor

### Run Locally
```bash
npm install      # install dependencies
# Press F5 in VS Code → opens Extension Development Host
npx eslint extension.js src/   # lint
npx vsce package               # build .vsix
```

### Debugging
| Goal | How |
|------|-----|
| View Node.js logs | `Ctrl+Shift+P` → `Developer: Show Logs` → `Extension Host` |
| Debug Webview JS | `Ctrl+Shift+P` → `Developer: Open Webview Developer Tools` |
| Reload extension | `Ctrl+Shift+P` → `Developer: Reload Window` |

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| `❌ PHP not found` | Ensure `php` is in `PATH`. Test: `php -v` in terminal |
| `❌ No artisan file found` | Open the Laravel project **root** as workspace (not a subfolder) |
| Blank / white webview | Open Webview Developer Tools → Console tab for details |
| `(ไม่มีผลลัพธ์)` shown | Use `echo`, `return`, or `dump()` — `--execute` only captures explicit output |
| Process hangs | Click **■ Stop** to kill the process immediately |
| History not saving | Check Webview Console for `localStorage` errors |

---

## 🤝 Contributing

1. Fork → `git checkout -b feature/your-feature`
2. Make changes → `git commit -m 'feat: ...'`
3. `git push origin feature/your-feature` → open a Pull Request

---

## 📬 Support

- 🐛 **Bugs**: [GitHub Issues](https://github.com/abcprintf/artisan-tinker-runner/issues)
- 💡 **Feature Requests**: [GitHub Discussions](https://github.com/abcprintf/artisan-tinker-runner/discussions)
