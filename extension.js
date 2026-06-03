const vscode = require('vscode');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

class TinkerSidebarProvider {
    constructor(extensionUri, context) {
        this.extensionUri = extensionUri;
        this._context = context;
        this._webview = null;
        this._proc = null;
        this._replProc = null;
        this._startTime = null;
        this._stopping = false;
        this._cache = new Map();       // hash -> { output, timestamp }
        this._phpPath = 'php';
        this._envType = 'local';       // 'local' | 'sail' | 'wsl'
        this._envOverride = null;      // manual override from webview
        this._replMode = false;
    }

    resolveWebviewView(webviewView, context, token) {
        this._webview = webviewView.webview;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this.getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'execute') {
                await this.runTinkerCode(message.code, webviewView.webview);
            } else if (message.command === 'stopProcess') {
                this._stopCurrentProc(webviewView.webview);
            } else if (message.command === 'setReplMode') {
                this._replMode = message.enabled;
                if (!this._replMode) { this._killReplProc(); }
                console.log('[Tinker] REPL mode:', this._replMode);
            } else if (message.command === 'setEnvType') {
                this._envOverride = message.envType;
                this._envType = message.envType;
                this._killReplProc(); // restart REPL with new env
            } else if (message.command === 'resetRepl') {
                this._killReplProc();
                webviewView.webview.postMessage({ type: 'replReset' });
            } else if (message.command === 'shareGist') {
                await this._shareGist(message.code, message.output, webviewView.webview);
            } else if (message.command === 'runTest') {
                await this._runTest(message.filter, webviewView.webview);
            } else if (message.command === 'tutorialDone') {
                this._context.globalState.update('tutorialSeen_v1', true);
            } else if (message.command === 'debug') {
                console.log('[Tinker Webview]', message.text);
            } else if (message.command === 'aiSuggest') {
                await this._handleAiSuggest(message.code, webviewView.webview);
            } else if (message.command === 'saveSnippet') {
                if (message.name && message.code) {
                    const snips = this._context.workspaceState.get('tinkerSnippets', []);
                    snips.push({ id: Date.now().toString(), name: message.name, code: message.code, createdAt: new Date().toISOString() });
                    await this._context.workspaceState.update('tinkerSnippets', snips);
                    webviewView.webview.postMessage({ type: 'snippetsUpdated', snippets: snips });
                }
            } else if (message.command === 'deleteSnippet') {
                const snips = this._context.workspaceState.get('tinkerSnippets', []).filter(s => s.id !== message.id);
                await this._context.workspaceState.update('tinkerSnippets', snips);
                webviewView.webview.postMessage({ type: 'snippetsUpdated', snippets: snips });
            } else if (message.command === 'getSnippets') {
                webviewView.webview.postMessage({ type: 'snippetsUpdated', snippets: this._context.workspaceState.get('tinkerSnippets', []) });
            }
        });

        webviewView.title = 'Artisan Tinker';
        webviewView.description = 'v3.0.0 | Ready';
        console.log('[Tinker] Webview resolved successfully');

        // Show tutorial on first run
        const tutorialSeen = this._context.globalState.get('tutorialSeen_v1', false);
        if (!tutorialSeen) {
            setTimeout(function() {
                webviewView.webview.postMessage({ type: 'showTutorial' });
            }, 800);
        }
    }

    // ── Environment detection ────────────────────────────────────

    async detectPhpPath(rootPath) {
        const cfg = vscode.workspace.getConfiguration('artisan-tinker-runner');
        const custom = cfg.get('phpPath', '');
        if (custom) return custom;

        return new Promise((resolve) => {
            const cmd = process.platform === 'win32' ? 'where' : 'which';
            const p = spawn(cmd, ['php'], { env: process.env });
            let out = '';
            p.stdout.on('data', d => { out += d.toString(); });
            p.on('close', code => {
                resolve(code === 0 && out.trim() ? out.trim().split('\n')[0].trim() : 'php');
            });
            p.on('error', () => resolve('php'));
        });
    }

    async detectEnv(rootPath) {
        // Laravel Sail
        const sailBin = path.join(rootPath, 'vendor', 'bin', 'sail');
        const hasCompose = fs.existsSync(path.join(rootPath, 'docker-compose.yml'))
                        || fs.existsSync(path.join(rootPath, 'docker-compose.yaml'));
        if (fs.existsSync(sailBin) && hasCompose) return 'sail';

        // WSL: running on Windows, workspace path starts with \\wsl$ or /mnt/
        if (process.platform === 'win32' && rootPath.startsWith('\\\\wsl')) return 'wsl';
        if (process.platform !== 'win32' && rootPath.startsWith('/mnt/')) {
            const wslExists = await new Promise(resolve => {
                const p = spawn('wsl', ['--version'], { env: process.env });
                p.on('close', c => resolve(c === 0));
                p.on('error', () => resolve(false));
            });
            if (wslExists) return 'wsl';
        }

        return 'local';
    }

    buildSpawnArgs(code, envType, phpPath, rootPath) {
        if (envType === 'sail') {
            return {
                cmd: path.join(rootPath, 'vendor', 'bin', 'sail'),
                args: ['tinker', '--execute', code]
            };
        }
        if (envType === 'wsl') {
            return {
                cmd: 'wsl',
                args: [phpPath, 'artisan', 'tinker', '--execute', code]
            };
        }
        return { cmd: phpPath, args: ['artisan', 'tinker', '--execute', code] };
    }

    // ── Cache ────────────────────────────────────────────────────

    _cacheKey(code) {
        return crypto.createHash('md5').update(code).digest('hex');
    }

    _checkCache(code) {
        const cfg = vscode.workspace.getConfiguration('artisan-tinker-runner');
        if (!cfg.get('cacheEnabled', true)) return null;
        const ttl = (cfg.get('cacheTtl', 30)) * 1000;
        const entry = this._cache.get(this._cacheKey(code));
        if (entry && Date.now() - entry.timestamp < ttl) return entry;
        return null;
    }

    _setCache(code, output) {
        const cfg = vscode.workspace.getConfiguration('artisan-tinker-runner');
        if (!cfg.get('cacheEnabled', true)) return;
        this._cache.set(this._cacheKey(code), { output, timestamp: Date.now() });
    }

    // ── Process helpers ──────────────────────────────────────────

    _stopCurrentProc(webview) {
        if (this._proc) {
            this._stopping = true;
            this._proc.kill();
            this._proc = null;
            webview.postMessage({ type: 'stopped' });
        }
    }

    _killReplProc() {
        if (this._replProc) {
            try { this._replProc.kill(); } catch(e) {}
            this._replProc = null;
        }
    }

    _getTimeout() {
        const cfg = vscode.workspace.getConfiguration('artisan-tinker-runner');
        return (cfg.get('timeout', 30)) * 1000;
    }

    // ── Persistent REPL ──────────────────────────────────────────

    async _ensureReplProc(rootPath, envType, phpPath) {
        if (this._replProc) return true;

        const replArgs = envType === 'sail'
            ? ['tinker']
            : envType === 'wsl'
                ? [phpPath, 'artisan', 'tinker']
                : ['artisan', 'tinker'];
        const replCmd = envType === 'sail'
            ? path.join(rootPath, 'vendor', 'bin', 'sail')
            : (envType === 'wsl' ? 'wsl' : phpPath);

        return new Promise((resolve) => {
            this._replProc = spawn(replCmd, replArgs, {
                cwd: rootPath,
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            this._replProc.on('error', () => { this._replProc = null; resolve(false); });
            setTimeout(() => resolve(!!this._replProc), 600);
        });
    }

    async _executeInRepl(code, webview, rootPath, envType, phpPath) {
        const ok = await this._ensureReplProc(rootPath, envType, phpPath);
        if (!ok) {
            webview.postMessage({ type: 'error', message: '❌ Could not start persistent REPL process.' });
            return;
        }

        const marker = '___TINKER_DONE_' + Date.now() + '___';
        const input = code + "\necho '" + marker + "';\n";
        const timeout = this._getTimeout();

        return new Promise((resolve) => {
            let output = '';
            const timer = setTimeout(() => {
                this._replProc.stdout.off('data', onData);
                webview.postMessage({ type: 'error', message: '❌ REPL execution timed out after ' + (timeout / 1000) + 's.' });
                resolve();
            }, timeout);

            const onData = (data) => {
                output += data.toString();
                if (output.includes(marker)) {
                    clearTimeout(timer);
                    this._replProc.stdout.off('data', onData);
                    const elapsed = Date.now() - this._startTime;
                    let result = output.substring(0, output.indexOf(marker)).trim();
                    result = result.replace(/^>>>\s*/gm, '').trim();
                    webview.postMessage({ type: 'result', output: result || '(ไม่มีผลลัพธ์)', error: false, elapsed, cached: false });
                    vscode.window.showInformationMessage('Tinker REPL: executed in ' + elapsed + 'ms');
                    resolve();
                }
            };

            this._replProc.stdout.on('data', onData);

            try {
                this._replProc.stdin.write(input);
            } catch(e) {
                clearTimeout(timer);
                this._replProc.stdout.off('data', onData);
                this._killReplProc();
                webview.postMessage({ type: 'error', message: '❌ REPL stdin write failed: ' + e.message });
                resolve();
            }
        });
    }

    // ── Main execution ───────────────────────────────────────────

    async runTinkerCode(code, webview) {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            webview.postMessage({ type: 'error', message: '❌ No workspace open. Open a Laravel project folder first.' });
            return;
        }
        const rootPath = workspace.uri.fsPath;
        if (!fs.existsSync(path.join(rootPath, 'artisan'))) {
            webview.postMessage({ type: 'error', message: '❌ No artisan file found. Open a Laravel project folder.' });
            return;
        }

        const [phpPath, detectedEnv] = await Promise.all([
            this.detectPhpPath(rootPath),
            this._envOverride ? Promise.resolve(this._envOverride) : this.detectEnv(rootPath)
        ]);
        const envType = detectedEnv;
        this._phpPath = phpPath;
        this._envType = envType;

        webview.postMessage({ type: 'envDetected', envType });

        if (!this._replMode) {
            const cached = this._checkCache(code);
            if (cached) {
                webview.postMessage({ type: 'result', output: cached.output, error: false, elapsed: 0, cached: true });
                return;
            }
        }

        this._startTime = Date.now();
        this._stopping = false;

        if (this._replMode) {
            return this._executeInRepl(code, webview, rootPath, envType, phpPath);
        }

        // ── Isolated mode ────────────────────────────────────────
        const { cmd, args } = this.buildSpawnArgs(code, envType, phpPath, rootPath);
        const timeout = this._getTimeout();

        return new Promise((resolve) => {
            this._proc = spawn(cmd, args, { cwd: rootPath, env: process.env });

            let stdout = '';
            let stderr = '';
            this._proc.stdout.on('data', d => { stdout += d.toString(); });
            this._proc.stderr.on('data', d => { stderr += d.toString(); });

            const timer = setTimeout(() => {
                if (this._proc) {
                    this._stopping = true;
                    this._proc.kill();
                    this._proc = null;
                    webview.postMessage({ type: 'error', message: '❌ Execution timed out after ' + (timeout / 1000) + 's.' });
                    vscode.window.showWarningMessage('Tinker: execution timed out.');
                    resolve();
                }
            }, timeout);

            this._proc.on('close', (exitCode) => {
                clearTimeout(timer);
                if (this._stopping) {
                    this._stopping = false;
                    this._proc = null;
                    resolve(); return;
                }
                this._proc = null;
                const elapsed = Date.now() - this._startTime;
                console.log('[Tinker] Exit:', exitCode, envType, elapsed + 'ms');

                if (stdout || exitCode === 0) {
                    const output = stdout.trim() || '(ไม่มีผลลัพธ์)';
                    if (exitCode === 0) this._setCache(code, output);
                    webview.postMessage({ type: 'result', output, error: exitCode !== 0, elapsed, cached: false });
                    if (exitCode === 0) {
                        vscode.window.showInformationMessage('Tinker: executed in ' + elapsed + 'ms [' + envType + ']');
                    } else {
                        vscode.window.showWarningMessage('Tinker: finished with errors (' + elapsed + 'ms)');
                    }
                } else {
                    const errText = stderr.trim();
                    let msg;
                    if (/artisan/i.test(errText) && /not found|No such file/i.test(errText)) {
                        msg = '❌ artisan not found. Open a Laravel project folder.';
                    } else if (errText.length > 300) {
                        const first = errText.split('\n').find(l => l.trim()) || errText;
                        msg = '❌ ' + first.trim();
                    } else {
                        msg = '❌ ' + errText;
                    }
                    webview.postMessage({ type: 'error', message: msg });
                    vscode.window.showErrorMessage('Tinker: ' + msg.replace(/^❌\s*/, '').substring(0, 80));
                }
                resolve();
            });

            this._proc.on('error', (err) => {
                clearTimeout(timer);
                this._proc = null;
                const msg = err.code === 'ENOENT'
                    ? '❌ PHP not found. Ensure php is in your PATH or set artisan-tinker-runner.phpPath in settings.'
                    : '❌ Could not start process: ' + err.message;
                webview.postMessage({ type: 'error', message: msg });
                vscode.window.showErrorMessage('Tinker: ' + msg.replace(/^❌\s*/, ''));
                resolve();
            });
        });
    }

    // ── Share via Gist ───────────────────────────────────────────

    async _shareGist(code, output, webview) {
        webview.postMessage({ type: 'shareStatus', status: 'posting' });

        const body = JSON.stringify({
            description: 'Artisan Tinker snippet — shared via artisan-tinker-runner',
            public: false,
            files: {
                'tinker.php': { content: code || '// (empty)' },
                'output.txt': { content: output || '// (no output)' }
            }
        });

        return new Promise((resolve) => {
            const req = https.request({
                hostname: 'api.github.com',
                path: '/gists',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'User-Agent': 'artisan-tinker-runner-vscode'
                }
            }, (res) => {
                let data = '';
                res.on('data', d => { data += d; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.html_url) {
                            vscode.env.openExternal(vscode.Uri.parse(json.html_url));
                            webview.postMessage({ type: 'shareStatus', status: 'done', url: json.html_url });
                        } else {
                            webview.postMessage({ type: 'shareStatus', status: 'error', message: 'GitHub API error: ' + (json.message || 'unknown') });
                        }
                    } catch(e) {
                        webview.postMessage({ type: 'shareStatus', status: 'error', message: 'Failed to parse response' });
                    }
                    resolve();
                });
            });
            req.on('error', (e) => {
                webview.postMessage({ type: 'shareStatus', status: 'error', message: e.message });
                resolve();
            });
            req.write(body);
            req.end();
        });
    }

    // ── Test Runner ──────────────────────────────────────────────

    async _runTest(filter, webview) {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            webview.postMessage({ type: 'testResult', output: '❌ No workspace open.', error: true });
            return;
        }
        const rootPath = workspace.uri.fsPath;
        if (!fs.existsSync(path.join(rootPath, 'artisan'))) {
            webview.postMessage({ type: 'testResult', output: '❌ No artisan file found.', error: true });
            return;
        }

        const phpPath = await this.detectPhpPath(rootPath);
        const args = ['artisan', 'test'];
        if (filter && filter.trim()) { args.push('--filter', filter.trim()); }

        webview.postMessage({ type: 'testResult', output: '⏳ Running tests...', error: false, running: true });

        const timeout = this._getTimeout() * 6; // tests need more time

        return new Promise((resolve) => {
            const proc = spawn(phpPath, args, { cwd: rootPath, env: process.env });
            let output = '';

            const timer = setTimeout(() => {
                proc.kill();
                webview.postMessage({ type: 'testResult', output: output + '\n❌ Test run timed out.', error: true });
                resolve();
            }, timeout);

            proc.stdout.on('data', d => { output += d.toString(); });
            proc.stderr.on('data', d => { output += d.toString(); });
            proc.on('close', (code) => {
                clearTimeout(timer);
                webview.postMessage({ type: 'testResult', output: output.trim() || '(no output)', error: code !== 0 });
                resolve();
            });
            proc.on('error', (e) => {
                clearTimeout(timer);
                webview.postMessage({ type: 'testResult', output: '❌ ' + e.message, error: true });
                resolve();
            });
        });
    }

    async _handleAiSuggest(code, webview) {
        if (!vscode.lm) {
            webview.postMessage({ type: 'aiError', text: 'Language Model API not available (requires VS Code 1.90+).' });
            return;
        }
        let models;
        try {
            models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        } catch (e) {
            webview.postMessage({ type: 'aiError', text: 'Could not access Copilot: ' + e.message });
            return;
        }
        if (!models || models.length === 0) {
            webview.postMessage({ type: 'aiError', text: 'GitHub Copilot not available. Please install and sign in to GitHub Copilot.' });
            return;
        }
        const model = models[0];
        const msgs = [
            vscode.LanguageModelChatMessage.User(
                'You are a Laravel Tinker expert. Given this PHP snippet, suggest an improved or extended version. Return only raw PHP code with no markdown fences or explanation:\n\n' + code
            )
        ];
        const cts = new vscode.CancellationTokenSource();
        try {
            const req = await model.sendRequest(msgs, {}, cts.token);
            for await (const chunk of req.text) {
                webview.postMessage({ type: 'aiChunk', text: chunk });
            }
            webview.postMessage({ type: 'aiDone' });
        } catch (e) {
            webview.postMessage({ type: 'aiError', text: 'AI request failed: ' + e.message });
        } finally {
            cts.dispose();
        }
    }

    // ── Webview HTML ─────────────────────────────────────────────

    getHtmlForWebview() {
        return String.raw`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
    <style>
        :root {
            --bg: var(--vscode-input-background, #1e1e1e);
            --fg: var(--vscode-input-foreground, #d4d4d4);
            --border: var(--vscode-input-border, #3c3c3c);
            --btn: var(--vscode-button-background, #0e639c);
            --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
            --btn-fg: var(--vscode-button-foreground, #ffffff);
            --btn-secondary: var(--vscode-button-secondaryBackground, #3a3d41);
            --btn-secondary-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
            --error: #f48771;
            --success: #89d185;
            --pinned-color: #cca700;
        }
        body {
            font-family: var(--vscode-font-family, sans-serif);
            padding: 10px; margin: 0;
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--fg); font-size: 13px;
        }
        .container { display: flex; flex-direction: column; gap: 8px; }
        h3 { margin: 0; font-size: 14px; font-weight: 600; }
        select, textarea, button, input[type="text"] {
            font-family: inherit; font-size: 12px;
            background: var(--bg); color: var(--fg);
            border: 1px solid var(--border); border-radius: 4px;
            padding: 6px; width: 100%; box-sizing: border-box;
        }
        textarea { min-height: 120px; resize: vertical; line-height: 1.5; }
        button { background: var(--btn); color: var(--btn-fg); border: none; cursor: pointer; font-weight: 500; }
        button:hover { background: var(--btn-hover); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-secondary { background: var(--btn-secondary); color: var(--fg); border: none; }
        .btn-secondary:hover { background: var(--btn-secondary-hover); }
        .btn-danger { background: #c72e0f; color: #fff; border: none; }
        .btn-danger:hover { background: #e33b1a; }
        .btn-small { width: auto; padding: 4px 8px; font-size: 11px; }
        .row { display: flex; gap: 6px; align-items: center; }
        .output-header { display: flex; gap: 4px; align-items: center; justify-content: space-between; }
        .output-label { font-size: 11px; opacity: 0.6; }
        .output {
            background: var(--vscode-editor-background, #1e1e1e);
            border: 1px solid var(--vscode-editorGroup-border, #333);
            border-radius: 4px; padding: 6px;
            font-family: monospace; white-space: pre-wrap;
            max-height: 220px; overflow-y: auto; font-size: 11px;
        }
        .status { font-size: 11px; text-align: right; margin-top: 2px; }
        .status.error { color: var(--error); }
        .status.success { color: var(--success); }
        input[type="text"]::placeholder { opacity: 0.5; }
        option.pinned { color: var(--pinned-color); }

        /* Meta bar */
        .meta-bar { display: flex; gap: 6px; align-items: center; font-size: 10px; opacity: 0.7; flex-wrap: wrap; }
        .badge {
            padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;
            background: var(--btn-secondary); color: var(--fg);
        }
        .badge.sail { background: #1d6fa5; color: #fff; }
        .badge.wsl  { background: #5a2ca0; color: #fff; }
        .badge.local { background: #2d7a2d; color: #fff; }
        #envBadge:hover { opacity: 0.8; }
        .badge.cached { background: #8a6914; color: #fff; }
        .badge.repl { background: #7a2d7a; color: #fff; }

        /* Toggle switch */
        .switch-row { display: flex; align-items: center; gap: 8px; font-size: 11px; }
        .switch { position: relative; display: inline-block; width: 32px; height: 16px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
            position: absolute; cursor: pointer; inset: 0;
            background: var(--btn-secondary); border-radius: 16px;
            transition: background 0.2s;
        }
        .slider:before {
            content: ''; position: absolute;
            height: 12px; width: 12px; left: 2px; bottom: 2px;
            background: var(--fg); border-radius: 50%; transition: transform 0.2s;
        }
        input:checked + .slider { background: #7a2d7a; }
        input:checked + .slider:before { transform: translateX(16px); }

        /* JSON Tree */
        .json-tree { font-family: monospace; font-size: 11px; line-height: 1.6; }
        .json-tree ul { list-style: none; margin: 0; padding-left: 16px; }
        .json-toggle { cursor: pointer; user-select: none; display: inline-block; width: 12px; text-align: center; opacity: 0.6; margin-right: 2px; }
        .json-toggle:hover { opacity: 1; }
        .json-key { color: #9cdcfe; }
        .json-str { color: #ce9178; }
        .json-num { color: #b5cea8; }
        .json-bool { color: #569cd6; }
        .json-null { color: #569cd6; opacity: 0.7; }
        .json-collapsed > ul { display: none; }
        .view-toggle { font-size: 10px; opacity: 0.6; cursor: pointer; margin-left: 6px; }
        .view-toggle:hover { opacity: 1; }

        /* Query Log Table */
        .query-table { width: 100%; border-collapse: collapse; font-size: 10px; font-family: monospace; }
        .query-table th { background: var(--btn-secondary); padding: 4px 6px; text-align: left; font-size: 10px; font-weight: 600; position: sticky; top: 0; }
        .query-table td { padding: 3px 6px; border-top: 1px solid var(--border); vertical-align: top; word-break: break-all; }
        .query-table tr:hover td { background: rgba(255,255,255,0.04); }
        .query-sql { color: #9cdcfe; }
        .query-time { color: #b5cea8; white-space: nowrap; }
        .query-bindings { color: #ce9178; opacity: 0.8; }

        /* Test Runner panel */
        .collapsible-panel { border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
        .panel-header {
            background: var(--btn-secondary); padding: 5px 8px;
            display: flex; align-items: center; justify-content: space-between;
            font-size: 11px; cursor: pointer; user-select: none;
        }
        .panel-body { padding: 6px; display: none; flex-direction: column; gap: 6px; }
        .panel-body.open { display: flex; }
        .test-output {
            background: var(--vscode-editor-background, #1e1e1e);
            border: 1px solid var(--border); border-radius: 3px;
            padding: 6px; font-family: monospace; white-space: pre-wrap;
            max-height: 160px; overflow-y: auto; font-size: 10px;
        }
        .test-pass { color: #89d185; }
        .test-fail { color: #f48771; }

        /* Analytics panel */
        .analytics-body { padding: 6px 8px; display: none; flex-wrap: wrap; gap: 8px; }
        .analytics-body.open { display: flex; }
        .stat-item { display: flex; flex-direction: column; align-items: center; min-width: 52px; }
        .stat-num { font-size: 18px; font-weight: 700; color: var(--btn-hover); line-height: 1; }
        .stat-lbl { font-size: 9px; opacity: 0.6; text-align: center; margin-top: 2px; }

        /* Tutorial overlay */
        .tutorial-overlay {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.75); z-index: 100;
            align-items: center; justify-content: center;
        }
        .tutorial-overlay.visible { display: flex; }
        .tutorial-card {
            background: var(--vscode-editor-background, #1e1e1e);
            border: 1px solid var(--border); border-radius: 8px;
            padding: 20px; max-width: 280px; width: 90%;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        }
        .tutorial-step-num { font-size: 10px; opacity: 0.5; margin-bottom: 6px; }
        .tutorial-icon { font-size: 28px; margin-bottom: 8px; }
        .tutorial-title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
        .tutorial-desc { font-size: 12px; opacity: 0.8; line-height: 1.5; margin-bottom: 16px; }
        .tutorial-dots { display: flex; gap: 6px; justify-content: center; margin-bottom: 14px; }
        .tutorial-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--btn-secondary); }
        .tutorial-dot.active { background: var(--btn-hover); }
        .tutorial-actions { display: flex; gap: 8px; justify-content: flex-end; }
    </style>
</head>
<body>
    <!-- Tutorial overlay -->
    <div class="tutorial-overlay" id="tutorialOverlay">
        <div class="tutorial-card">
            <div class="tutorial-step-num" id="tutStepNum">Step 1 of 5</div>
            <div class="tutorial-icon" id="tutIcon">✍️</div>
            <div class="tutorial-title" id="tutTitle">Write PHP Code</div>
            <div class="tutorial-desc" id="tutDesc">Type any PHP expression in the editor and press ▶ Execute (or Ctrl+Enter) to run it via artisan tinker.</div>
            <div class="tutorial-dots" id="tutDots"></div>
            <div class="tutorial-actions">
                <button class="btn-secondary btn-small" id="tutSkip">Skip tour</button>
                <button class="btn-small" id="tutNext">Next →</button>
            </div>
        </div>
    </div>

    <div class="container">
        <div class="row" style="justify-content:space-between;">
            <h3>🪄 Artisan Tinker</h3>
            <div class="meta-bar">
                <span id="envBadge" class="badge local">local</span>
                <span id="cachedBadge" class="badge cached" style="display:none;">cached</span>
            </div>
        </div>

        <!-- REPL mode toggle -->
        <div class="switch-row">
            <label class="switch">
                <input type="checkbox" id="replToggle">
                <span class="slider"></span>
            </label>
            <span>Persistent REPL</span>
            <button id="resetReplBtn" class="btn-small btn-secondary" style="display:none;" title="Reset REPL session">↺ Reset</button>
        </div>

        <!-- Snippet Templates -->
        <select id="templateSelect">
            <option value="">🧩 Insert template...</option>
            <optgroup label="Models">
                <option value="User::count();">User::count();</option>
                <option value="User::all();">User::all();</option>
                <option value="User::find(1);">User::find(1);</option>
                <option value="User::where('email', 'test@example.com')->first();">User::where('email', ...)->first();</option>
                <option value="User::latest()->limit(5)->get();">User::latest()->limit(5)->get();</option>
            </optgroup>
            <optgroup label="Database">
                <option value="DB::table('users')->count();">DB::table('users')->count();</option>
                <option value="DB::select('SELECT 1');">DB::select('SELECT 1');</option>
                <option value="Schema::getColumnListing('users');">Schema::getColumnListing('users');</option>
            </optgroup>
            <optgroup label="Query Log">
                <option value="DB::enableQueryLog();">DB::enableQueryLog();</option>
                <option value="DB::enableQueryLog();\nUser::all();\n$q = DB::getQueryLog();\nreturn $q;">🗄️ Capture query log</option>
            </optgroup>
            <optgroup label="App">
                <option value="app()->environment();">app()->environment();</option>
                <option value="config('app.name');">config('app.name');</option>
                <option value="config('database.default');">config('database.default');</option>
                <option value="now()->toDateTimeString();">now()->toDateTimeString();</option>
            </optgroup>
            <optgroup label="Cache &amp; Queue">
                <option value="Cache::get('key');">Cache::get('key');</option>
                <option value="Cache::flush();">Cache::flush();</option>
                <option value="Queue::size();">Queue::size();</option>
            </optgroup>
            <optgroup label="Auth">
                <option value="Auth::user();">Auth::user();</option>
                <option value="Hash::make('password');">Hash::make('password');</option>
            </optgroup>
        </select>

        <!-- History -->
        <input type="text" id="historySearch" placeholder="🔍 ค้นหา history...">
        <div class="row">
            <select id="historySelect" style="flex:1;"><option value="">📜 เลือก History...</option></select>
            <button id="pinBtn" class="btn-small btn-secondary" title="Pin/Unpin snippet">📌</button>
            <button id="clearHistoryBtn" class="btn-small btn-secondary" style="width:32px;" title="ล้าง History">🗑️</button>
        </div>

        <!-- Editor -->
        <textarea id="editor" placeholder="พิมพ์ PHP code ที่นี่...\nรองรับหลายบรรทัด เช่น:\n$users = User::all();\n$users->count();" spellcheck="false"></textarea>

        <!-- Actions -->
        <div class="row">
            <button id="executeBtn" style="flex:1;">▶ Execute in Tinker</button>
            <button id="stopBtn" class="btn-danger btn-small" style="display:none;" title="หยุดการทำงาน">■ Stop</button>
            <button id="aiSuggestBtn" class="btn-secondary btn-small" title="Get AI code suggestion via GitHub Copilot">✨ AI</button>
        </div>

        <!-- AI Suggestion panel -->
        <div id="aiPanel" style="display:none;margin-top:6px;">
            <div id="aiOutput" style="font-family:var(--vscode-editor-font-family,monospace);white-space:pre-wrap;font-size:12px;padding:8px;border:1px solid var(--vscode-focusBorder);border-radius:3px;max-height:180px;overflow:auto;background:var(--vscode-editor-background);"></div>
            <div style="display:flex;gap:4px;margin-top:4px;">
                <button id="aiAcceptBtn" class="btn-small">✓ Accept</button>
                <button id="aiDismissBtn" class="btn-secondary btn-small">✕ Dismiss</button>
            </div>
        </div>

        <div class="status" id="status">พร้อมใช้งาน</div>

        <!-- Output -->
        <div class="output-header">
            <span class="output-label">Output <span id="viewToggle" class="view-toggle" style="display:none;">[tree]</span></span>
            <div style="display:flex;gap:4px;">
                <button id="shareBtn" class="btn-small btn-secondary" title="Share as GitHub Gist" style="display:none;">🌐 Share</button>
                <button id="copyBtn" class="btn-small btn-secondary" title="Copy output">📋 Copy</button>
                <button id="clearOutputBtn" class="btn-small btn-secondary" title="Clear output">✕ Clear</button>
            </div>
        </div>
        <div class="output" id="output">// ผลลัพธ์จะแสดงที่นี่...</div>

        <!-- Test Runner panel -->
        <div class="collapsible-panel">
            <div class="panel-header" id="testPanelHeader">
                <span>🧪 Test Runner</span>
                <span id="testToggleArrow">▸</span>
            </div>
            <div class="panel-body" id="testPanelBody">
                <input type="text" id="testFilter" placeholder="Filter (e.g. UserTest) — empty runs all tests">
                <button id="runTestBtn">▶ Run Artisan Test</button>
                <div class="test-output" id="testOutput" style="display:none;"></div>
            </div>
        </div>

        <!-- Analytics panel -->
        <div class="collapsible-panel">
            <div class="panel-header" id="analyticsHeader">
                <span>📈 Usage Stats</span>
                <span id="analyticsArrow">▸</span>
            </div>
            <div class="analytics-body" id="analyticsBody">
                <div class="stat-item"><div class="stat-num" id="statRuns">0</div><div class="stat-lbl">Runs</div></div>
                <div class="stat-item"><div class="stat-num" id="statCacheHits">0</div><div class="stat-lbl">Cache hits</div></div>
                <div class="stat-item"><div class="stat-num" id="statReplRuns">0</div><div class="stat-lbl">REPL runs</div></div>
                <div class="stat-item"><div class="stat-num" id="statShares">0</div><div class="stat-lbl">Shares</div></div>
                <div class="stat-item"><div class="stat-num" id="statTests">0</div><div class="stat-lbl">Tests run</div></div>
                <div style="width:100%;margin-top:4px;">
                    <button id="resetStatsBtn" class="btn-small btn-secondary" style="font-size:10px;opacity:0.6;">Reset stats</button>
                </div>
            </div>
        </div>

        <!-- Project Snippets panel -->
        <div class="collapsible-panel">
            <div class="panel-header" id="snippetsPanelHeader">
                <span>📁 Project Snippets</span>
                <span id="snippetsArrow">▸</span>
            </div>
            <div class="panel-body" id="snippetsPanelBody" style="display:none;">
                <select id="snippetSelect" style="width:100%;margin-bottom:4px;"><option value="">— no snippets saved —</option></select>
                <div style="display:flex;gap:4px;">
                    <button id="loadSnippetBtn" class="btn-small" title="Load selected snippet into editor">Load</button>
                    <button id="saveSnippetBtn" class="btn-secondary btn-small" title="Save current editor code as a snippet">Save</button>
                    <button id="deleteSnippetBtn" class="btn-danger btn-small" title="Delete selected snippet">Delete</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        var vscode = acquireVsCodeApi();
        var HISTORY_KEY = 'artisan_tinker_history_v2';
        var ANALYTICS_KEY = 'tinker_analytics_v1';
        var MAX_HISTORY = 15;

        var editor = document.getElementById('editor');
        var executeBtn = document.getElementById('executeBtn');
        var stopBtn = document.getElementById('stopBtn');
        var output = document.getElementById('output');
        var status = document.getElementById('status');
        var historySelect = document.getElementById('historySelect');
        var historySearch = document.getElementById('historySearch');
        var copyBtn = document.getElementById('copyBtn');
        var shareBtn = document.getElementById('shareBtn');
        var clearOutputBtn = document.getElementById('clearOutputBtn');
        var pinBtn = document.getElementById('pinBtn');
        var templateSelect = document.getElementById('templateSelect');
        var viewToggle = document.getElementById('viewToggle');
        var replToggle = document.getElementById('replToggle');
        var resetReplBtn = document.getElementById('resetReplBtn');
        var envBadge = document.getElementById('envBadge');
        var cachedBadge = document.getElementById('cachedBadge');

        var _lastRawOutput = '';
        var _viewMode = 'text';
        var _selectedHistoryCode = '';

        // ── Analytics ─────────────────────────────────────────────
        function getAnalytics() {
            try { return JSON.parse(localStorage.getItem(ANALYTICS_KEY) || '{}'); } catch(e) { return {}; }
        }
        function saveAnalytics(a) { localStorage.setItem(ANALYTICS_KEY, JSON.stringify(a)); }
        function trackEvent(event) {
            var a = getAnalytics();
            a[event] = (a[event] || 0) + 1;
            saveAnalytics(a);
        }
        function renderAnalytics() {
            var a = getAnalytics();
            document.getElementById('statRuns').textContent = a.runs || 0;
            document.getElementById('statCacheHits').textContent = a.cacheHits || 0;
            document.getElementById('statReplRuns').textContent = a.replRuns || 0;
            document.getElementById('statShares').textContent = a.shares || 0;
            document.getElementById('statTests').textContent = a.tests || 0;
        }
        document.getElementById('analyticsHeader').addEventListener('click', function() {
            var body = document.getElementById('analyticsBody');
            var open = body.classList.toggle('open');
            document.getElementById('analyticsArrow').textContent = open ? '▾' : '▸';
            if (open) renderAnalytics();
        });
        document.getElementById('resetStatsBtn').addEventListener('click', function() {
            localStorage.removeItem(ANALYTICS_KEY);
            renderAnalytics();
        });

        // ── REPL toggle ───────────────────────────────────────────
        replToggle.addEventListener('change', function() {
            vscode.postMessage({ command: 'setReplMode', enabled: this.checked });
            resetReplBtn.style.display = this.checked ? 'inline-block' : 'none';
            status.textContent = this.checked ? '🔄 Persistent REPL mode' : 'พร้อมใช้งาน';
        });

        resetReplBtn.addEventListener('click', function() {
            vscode.postMessage({ command: 'resetRepl' });
            status.textContent = '↺ REPL session reset';
        });

        var _envModes = ['local', 'sail', 'wsl'];
        envBadge.style.cursor = 'pointer';
        envBadge.title = 'Click to switch mode';
        envBadge.addEventListener('click', function() {
            var cur = _envModes.indexOf(envBadge.textContent);
            var next = _envModes[(cur + 1) % _envModes.length];
            envBadge.textContent = next;
            envBadge.className = 'badge ' + next;
            vscode.postMessage({ command: 'setEnvType', envType: next });
            status.textContent = '⚙️ Mode: ' + next;
        });

        // ── Snippet Templates ──────────────────────────────────────
        templateSelect.addEventListener('change', function() {
            if (!this.value) return;
            var pos = editor.selectionStart;
            var before = editor.value.substring(0, pos);
            var after = editor.value.substring(editor.selectionEnd);
            var sep = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
            editor.value = before + sep + this.value + '\n' + after;
            editor.focus();
            this.value = '';
        });

        // ── History ────────────────────────────────────────────────
        function getHistory() {
            try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
            catch(e) { return []; }
        }
        function saveHistoryRaw(hist) { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist)); }
        function loadHistory(filter) {
            var hist = getHistory();
            var q = (filter || '').toLowerCase();
            historySelect.innerHTML = '<option value="">📜 เลือก History...</option>';
            var pinned = hist.filter(function(h) { return h.pinned; });
            var unpinned = hist.filter(function(h) { return !h.pinned; });
            function addOpt(item) {
                if (q && !item.code.toLowerCase().includes(q)) return;
                var opt = document.createElement('option');
                opt.value = item.code;
                var short = item.code.length > 33 ? item.code.substring(0, 33) + '...' : item.code;
                opt.textContent = (item.pinned ? '📌 ' : '') + short + ' [' + item.time + ']';
                if (item.pinned) opt.className = 'pinned';
                historySelect.appendChild(opt);
            }
            pinned.forEach(addOpt);
            unpinned.forEach(addOpt);
        }
        function saveHistory(code) {
            if (!code) return;
            var hist = getHistory();
            var existing = hist.find(function(h) { return h.code === code; });
            hist = hist.filter(function(h) { return h.code !== code; });
            hist.unshift({ code: code, time: new Date().toLocaleTimeString(), pinned: existing ? existing.pinned : false });
            while (hist.length > MAX_HISTORY) {
                var idx = hist.map(function(h) { return h.pinned; }).lastIndexOf(false);
                if (idx === -1) break;
                hist.splice(idx, 1);
            }
            saveHistoryRaw(hist);
            loadHistory(historySearch.value);
        }
        function togglePin(code) {
            if (!code) return;
            var hist = getHistory();
            hist = hist.map(function(h) { return h.code === code ? Object.assign({}, h, { pinned: !h.pinned }) : h; });
            saveHistoryRaw(hist);
            loadHistory(historySearch.value);
        }
        historySearch.addEventListener('input', function() { loadHistory(this.value); });
        historySelect.addEventListener('change', function(e) {
            _selectedHistoryCode = e.target.value;
            if (e.target.value) { editor.value = e.target.value; editor.focus(); }
        });
        pinBtn.addEventListener('click', function() {
            var code = _selectedHistoryCode || editor.value.trim();
            if (!code) return;
            togglePin(code);
            _selectedHistoryCode = ''; historySelect.value = '';
            status.textContent = '📌 Pin อัปเดตแล้ว';
        });
        document.getElementById('clearHistoryBtn').addEventListener('click', function() {
            localStorage.removeItem(HISTORY_KEY); loadHistory(); historySearch.value = '';
            _selectedHistoryCode = ''; status.textContent = '✅ ล้าง History แล้ว';
        });

        // ── Query Log Detection ────────────────────────────────────
        function isQueryLog(data) {
            return Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null && 'query' in data[0] && 'time' in data[0];
        }
        function renderQueryTable(queries) {
            var table = document.createElement('table');
            table.className = 'query-table';
            var thead = table.createTHead();
            var hr = thead.insertRow();
            ['#', 'Query', 'Bindings', 'ms'].forEach(function(h) {
                var th = document.createElement('th');
                th.textContent = h;
                hr.appendChild(th);
            });
            var tbody = table.createTBody();
            queries.forEach(function(q, i) {
                var tr = tbody.insertRow();
                tr.insertCell().textContent = i + 1;
                var tdSql = tr.insertCell(); tdSql.className = 'query-sql'; tdSql.textContent = q.query || '';
                var tdBind = tr.insertCell(); tdBind.className = 'query-bindings';
                tdBind.textContent = (q.bindings && q.bindings.length) ? JSON.stringify(q.bindings) : '-';
                var tdTime = tr.insertCell(); tdTime.className = 'query-time';
                tdTime.textContent = (q.time !== undefined ? parseFloat(q.time).toFixed(2) : '?') + 'ms';
            });
            return table;
        }

        // ── JSON Tree ──────────────────────────────────────────────
        function escHtml(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }
        function buildTree(data) {
            if (data === null) return '<span class="json-null">null</span>';
            if (typeof data === 'boolean') return '<span class="json-bool">' + data + '</span>';
            if (typeof data === 'number') return '<span class="json-num">' + data + '</span>';
            if (typeof data === 'string') return '<span class="json-str">"' + escHtml(data) + '"</span>';
            if (Array.isArray(data)) {
                if (!data.length) return '[]';
                var h = '<span class="json-toggle" onclick="toggleNode(this)">▼</span>[<ul>';
                data.forEach(function(v, i) { h += '<li>' + buildTree(v) + (i < data.length-1 ? ',' : '') + '</li>'; });
                return h + '</ul>]';
            }
            if (typeof data === 'object') {
                var keys = Object.keys(data);
                if (!keys.length) return '{}';
                var h2 = '<span class="json-toggle" onclick="toggleNode(this)">▼</span>{<ul>';
                keys.forEach(function(k, i) { h2 += '<li><span class="json-key">"' + escHtml(k) + '"</span>: ' + buildTree(data[k]) + (i < keys.length-1 ? ',' : '') + '</li>'; });
                return h2 + '</ul>}';
            }
            return escHtml(String(data));
        }
        function toggleNode(el) {
            el.parentElement.classList.toggle('json-collapsed');
            el.textContent = el.parentElement.classList.contains('json-collapsed') ? '▶' : '▼';
        }
        function tryParseJson(str) {
            try { return JSON.parse(str); } catch(e) { return null; }
        }

        // ── Pretty-print fallback ──────────────────────────────────
        function formatText(str) {
            str = str.trim();
            if (str.startsWith('{') || str.startsWith('[')) {
                try { return JSON.stringify(JSON.parse(str), null, 2); } catch(e) {}
            }
            if (/^(array|object)\s*\(/.test(str)) {
                var indent = 0;
                return str.split('\n').map(function(line) {
                    var t = line.trim();
                    if (/^[}\)]/.test(t)) indent = Math.max(0, indent-1);
                    var out = '  '.repeat(indent) + t;
                    if (/[\(\{]$/.test(t)) indent++;
                    return out;
                }).join('\n');
            }
            return str;
        }

        function showOutput(raw, mode) {
            _lastRawOutput = raw;
            _viewMode = mode || 'text';
            output.textContent = '';
            output.style.whiteSpace = 'pre-wrap';

            if (_viewMode === 'table') {
                var parsed = tryParseJson(raw);
                if (parsed && isQueryLog(parsed)) {
                    output.style.whiteSpace = 'normal';
                    output.appendChild(renderQueryTable(parsed));
                    return;
                }
                _viewMode = 'text';
            }
            if (_viewMode === 'tree') {
                var parsed2 = tryParseJson(raw);
                if (parsed2 !== null) {
                    var div = document.createElement('div');
                    div.className = 'json-tree';
                    div.innerHTML = buildTree(parsed2);
                    output.appendChild(div);
                    return;
                }
                _viewMode = 'text';
            }
            output.textContent = formatText(raw);
        }

        viewToggle.addEventListener('click', function() {
            if (_viewMode !== 'text') {
                _viewMode = 'text'; this.textContent = '[tree]';
            } else {
                var parsed = tryParseJson(_lastRawOutput);
                if (parsed && isQueryLog(parsed)) { _viewMode = 'table'; this.textContent = '[raw]'; }
                else { _viewMode = 'tree'; this.textContent = '[raw]'; }
            }
            showOutput(_lastRawOutput, _viewMode);
        });

        // ── Output actions ─────────────────────────────────────────
        copyBtn.addEventListener('click', function() {
            var text = _lastRawOutput || output.textContent;
            if (!text) return;
            try {
                navigator.clipboard.writeText(text).then(function() {
                    copyBtn.textContent = '✅ Copied';
                    setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
                });
            } catch(e) {
                var ta = document.createElement('textarea');
                ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                copyBtn.textContent = '✅ Copied';
                setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
            }
        });

        shareBtn.addEventListener('click', function() {
            var code = editor.value.trim();
            var out = _lastRawOutput;
            if (!code && !out) { status.textContent = '⚠️ Nothing to share'; return; }
            vscode.postMessage({ command: 'shareGist', code: code, output: out });
            trackEvent('shares');
        });

        clearOutputBtn.addEventListener('click', function() {
            output.textContent = ''; _lastRawOutput = ''; _viewMode = 'text';
            viewToggle.style.display = 'none'; cachedBadge.style.display = 'none';
            shareBtn.style.display = 'none';
            status.textContent = 'พร้อมใช้งาน'; status.className = 'status';
        });

        // ── Test Runner panel ──────────────────────────────────────
        document.getElementById('testPanelHeader').addEventListener('click', function() {
            var body = document.getElementById('testPanelBody');
            var open = body.classList.toggle('open');
            document.getElementById('testToggleArrow').textContent = open ? '▾' : '▸';
        });

        document.getElementById('runTestBtn').addEventListener('click', function() {
            var filter = document.getElementById('testFilter').value;
            vscode.postMessage({ command: 'runTest', filter: filter });
            trackEvent('tests');
            var testOut = document.getElementById('testOutput');
            testOut.style.display = 'block';
            testOut.textContent = '⏳ Running...';
            testOut.className = 'test-output';
        });

        // ── Execute ────────────────────────────────────────────────
        function setRunning(running) {
            executeBtn.disabled = running;
            stopBtn.style.display = running ? 'inline-block' : 'none';
        }

        executeBtn.addEventListener('click', function() {
            var code = editor.value.trim();
            if (!code) { status.textContent = '⚠️ กรุณาใส่โค้ดก่อน'; return; }
            setRunning(true);
            cachedBadge.style.display = 'none';
            shareBtn.style.display = 'none';
            viewToggle.style.display = 'none';
            status.className = 'status';
            status.textContent = '⏳ กำลังประมวลผล...';
            output.textContent = 'รอผลลัพธ์...';
            vscode.postMessage({ command: 'execute', code: code });
        });

        stopBtn.addEventListener('click', function() { vscode.postMessage({ command: 'stopProcess' }); });

        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (!executeBtn.disabled) executeBtn.click();
            }
        });

        // ── Messages from host ─────────────────────────────────────
        window.addEventListener('message', function(event) {
            var msg = event.data;

            if (msg.type === 'result') {
                var raw = msg.output || '(ไม่มีผลลัพธ์)';
                var parsed = tryParseJson(raw);
                var mode = 'text';
                if (parsed !== null) {
                    if (isQueryLog(parsed)) { mode = 'table'; viewToggle.textContent = '[raw]'; }
                    else { mode = 'tree'; viewToggle.textContent = '[raw]'; }
                    viewToggle.style.display = 'inline';
                }
                showOutput(raw, mode);
                shareBtn.style.display = 'inline-block';
                cachedBadge.style.display = msg.cached ? 'inline' : 'none';
                status.className = msg.error ? 'status error' : 'status success';
                var timeLabel = msg.cached ? ' (cached)' : (msg.elapsed ? ' (' + msg.elapsed + 'ms)' : '');
                status.textContent = (msg.error ? '❌ เกิดข้อผิดพลาด' : '✅ สำเร็จ') + timeLabel;
                if (!msg.error) saveHistory(editor.value.trim());
                setRunning(false);
                if (msg.cached) trackEvent('cacheHits');
                else if (replToggle.checked) trackEvent('replRuns');
                else trackEvent('runs');

            } else if (msg.type === 'error') {
                output.textContent = msg.message; _lastRawOutput = msg.message;
                viewToggle.style.display = 'none'; cachedBadge.style.display = 'none'; shareBtn.style.display = 'none';
                status.className = 'status error'; status.textContent = '❌ ล้มเหลว';
                setRunning(false);

            } else if (msg.type === 'stopped') {
                output.textContent = '⬛ หยุดการทำงานแล้ว'; _lastRawOutput = '';
                viewToggle.style.display = 'none'; cachedBadge.style.display = 'none'; shareBtn.style.display = 'none';
                status.className = 'status'; status.textContent = 'หยุดแล้ว';
                setRunning(false);

            } else if (msg.type === 'envDetected') {
                envBadge.textContent = msg.envType;
                envBadge.className = 'badge ' + msg.envType;
                envBadge.title = 'Click to switch mode';

            } else if (msg.type === 'replReset') {
                status.textContent = '↺ REPL reset — variables cleared';

            } else if (msg.type === 'shareStatus') {
                if (msg.status === 'posting') {
                    shareBtn.textContent = '⏳ Sharing...'; shareBtn.disabled = true;
                } else if (msg.status === 'done') {
                    shareBtn.textContent = '✅ Shared'; shareBtn.disabled = false;
                    setTimeout(function() { shareBtn.textContent = '🌐 Share'; }, 2500);
                    status.textContent = '🌐 Gist opened in browser';
                } else {
                    shareBtn.textContent = '❌ Failed'; shareBtn.disabled = false;
                    setTimeout(function() { shareBtn.textContent = '🌐 Share'; }, 2500);
                    status.textContent = '❌ Share failed: ' + (msg.message || '');
                }

            } else if (msg.type === 'testResult') {
                var testOut = document.getElementById('testOutput');
                testOut.style.display = 'block';
                testOut.textContent = msg.output || '(no output)';
                testOut.className = 'test-output ' + (msg.error ? 'test-fail' : 'test-pass');

            } else if (msg.type === 'showTutorial') {
                startTutorial();
            } else if (msg.type === 'aiChunk') {
                aiOutput.textContent += msg.text;
                aiOutput.scrollTop = aiOutput.scrollHeight;
            } else if (msg.type === 'aiDone') {
                aiAcceptBtn.style.display = 'inline-block';
                aiDismissBtn.style.display = 'inline-block';
                status.textContent = '✨ AI suggestion ready';
            } else if (msg.type === 'aiError') {
                aiPanel.style.display = 'none';
                status.classList.add('error');
                status.textContent = '❌ ' + msg.text;
            } else if (msg.type === 'snippetsUpdated') {
                renderSnippets(msg.snippets);
            }
        });

        // ── Interactive Tutorial ───────────────────────────────────
        var TUTORIAL_STEPS = [
            { icon: '✍️', title: 'Write PHP Code', desc: 'Type any PHP expression in the editor. Press ▶ Execute or Ctrl+Enter to run it via artisan tinker.' },
            { icon: '🧩', title: 'Use Templates', desc: 'Pick a snippet from the template dropdown to insert common Laravel code instantly. Includes a Query Log capture template.' },
            { icon: '📜', title: 'History & Pins', desc: 'Every successful run is saved in History. Search, select, and 📌 pin your most-used snippets so they never get evicted.' },
            { icon: '🔄', title: 'Persistent REPL', desc: 'Toggle "Persistent REPL" to keep a single tinker process alive between runs — variables persist across executions.' },
            { icon: '🌐', title: 'Share & Test Runner', desc: 'After a run, click 🌐 Share to post your snippet as a GitHub Gist. Use 🧪 Test Runner panel to run php artisan test directly.' }
        ];
        var _tutStep = 0;

        function startTutorial() {
            _tutStep = 0;
            renderTutStep();
            document.getElementById('tutorialOverlay').classList.add('visible');
        }

        function renderTutStep() {
            var step = TUTORIAL_STEPS[_tutStep];
            document.getElementById('tutStepNum').textContent = 'Step ' + (_tutStep + 1) + ' of ' + TUTORIAL_STEPS.length;
            document.getElementById('tutIcon').textContent = step.icon;
            document.getElementById('tutTitle').textContent = step.title;
            document.getElementById('tutDesc').textContent = step.desc;
            document.getElementById('tutNext').textContent = _tutStep < TUTORIAL_STEPS.length - 1 ? 'Next →' : '✓ Done';
            var dots = document.getElementById('tutDots');
            dots.innerHTML = '';
            TUTORIAL_STEPS.forEach(function(_, i) {
                var d = document.createElement('div');
                d.className = 'tutorial-dot' + (i === _tutStep ? ' active' : '');
                dots.appendChild(d);
            });
        }

        document.getElementById('tutNext').addEventListener('click', function() {
            if (_tutStep < TUTORIAL_STEPS.length - 1) {
                _tutStep++;
                renderTutStep();
            } else {
                closeTutorial();
            }
        });
        document.getElementById('tutSkip').addEventListener('click', closeTutorial);

        function closeTutorial() {
            document.getElementById('tutorialOverlay').classList.remove('visible');
            vscode.postMessage({ command: 'tutorialDone' });
        }

        // ── AI Suggest ─────────────────────────────────────────────
        var aiPanel = document.getElementById('aiPanel');
        var aiOutput = document.getElementById('aiOutput');
        var aiSuggestBtn = document.getElementById('aiSuggestBtn');
        var aiAcceptBtn = document.getElementById('aiAcceptBtn');
        var aiDismissBtn = document.getElementById('aiDismissBtn');

        aiSuggestBtn.addEventListener('click', function() {
            var code = editor.value.trim();
            if (!code) { status.textContent = '⚠️ Write some PHP code first.'; return; }
            aiOutput.textContent = '';
            aiPanel.style.display = 'block';
            aiAcceptBtn.style.display = 'none';
            aiDismissBtn.style.display = 'none';
            status.textContent = '🤖 AI กำลังคิด...';
            vscode.postMessage({ command: 'aiSuggest', code: code });
        });

        aiAcceptBtn.addEventListener('click', function() {
            editor.value = aiOutput.textContent;
            aiPanel.style.display = 'none';
            status.textContent = '✅ AI suggestion accepted';
        });

        aiDismissBtn.addEventListener('click', function() {
            aiPanel.style.display = 'none';
            aiOutput.textContent = '';
        });

        // ── Project Snippets ───────────────────────────────────────
        var _snippets = [];
        var snippetSelect = document.getElementById('snippetSelect');

        document.getElementById('snippetsPanelHeader').addEventListener('click', function() {
            var body = document.getElementById('snippetsPanelBody');
            var arrow = document.getElementById('snippetsArrow');
            var open = body.style.display !== 'none';
            body.style.display = open ? 'none' : 'block';
            arrow.textContent = open ? '▸' : '▾';
            if (!open) { vscode.postMessage({ command: 'getSnippets' }); }
        });

        document.getElementById('saveSnippetBtn').addEventListener('click', function() {
            var code = editor.value.trim();
            if (!code) { status.textContent = '⚠️ Nothing to save.'; return; }
            var name = window.prompt('Snippet name:');
            if (!name || !name.trim()) { return; }
            vscode.postMessage({ command: 'saveSnippet', name: name.trim(), code: code });
        });

        document.getElementById('loadSnippetBtn').addEventListener('click', function() {
            var id = snippetSelect.value;
            var snip = _snippets.find(function(s) { return s.id === id; });
            if (snip) { editor.value = snip.code; status.textContent = '📁 Snippet loaded: ' + snip.name; }
        });

        document.getElementById('deleteSnippetBtn').addEventListener('click', function() {
            var id = snippetSelect.value;
            if (!id) { return; }
            var snip = _snippets.find(function(s) { return s.id === id; });
            if (snip && window.confirm('Delete snippet "' + snip.name + '"?')) {
                vscode.postMessage({ command: 'deleteSnippet', id: id });
            }
        });

        function renderSnippets(snippets) {
            _snippets = snippets || [];
            snippetSelect.innerHTML = _snippets.length === 0
                ? '<option value="">— no snippets saved —</option>'
                : _snippets.map(function(s) { return '<option value="' + s.id + '">' + s.name.replace(/</g, '&lt;') + '</option>'; }).join('');
        }

        // ── Init ───────────────────────────────────────────────────
        window.onerror = function(msg, src, line) {
            vscode.postMessage({ command: 'debug', text: 'Webview error: ' + msg + ' (' + src + ':' + line + ')' });
        };
        loadHistory();
        vscode.postMessage({ command: 'getSnippets' });
        vscode.postMessage({ command: 'debug', text: 'Webview JS initialized successfully' });
    </script>
</body>
</html>`.replace(/\${VS_CODE_ENV}/g, process.env.NODE_ENV || 'production');
    }
}

function activate(context) {
    console.log('[Artisan Tinker] Activating v3.0.0...');
    const provider = new TinkerSidebarProvider(context.extensionUri, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('artisanTinkerView', provider)
    );
    vscode.window.showInformationMessage('🪄 Artisan Tinker Runner v3.0.0 พร้อมใช้งาน');
}

function deactivate() {
    console.log('[Artisan Tinker] Deactivated');
}

module.exports = { activate, deactivate };
