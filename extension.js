const vscode = require('vscode');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

class TinkerSidebarProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this._webview = null;
        this._proc = null;
        this._replProc = null;
        this._startTime = null;
        this._stopping = false;
        this._cache = new Map();       // hash -> { output, timestamp }
        this._phpPath = 'php';
        this._envType = 'local';       // 'local' | 'sail' | 'wsl'
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
            } else if (message.command === 'resetRepl') {
                this._killReplProc();
                webviewView.webview.postMessage({ type: 'replReset' });
            } else if (message.command === 'debug') {
                console.log('[Tinker Webview]', message.text);
            }
        });

        webviewView.title = 'Artisan Tinker';
        webviewView.description = 'v2.6.0 | Ready';
        console.log('[Tinker] Webview resolved successfully');
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
            // Possibly WSL — check if wsl command exists
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

        const { cmd, args } = this.buildSpawnArgs('', envType, phpPath, rootPath);
        // For REPL mode, launch tinker without --execute
        const replArgs = envType === 'sail' ? ['tinker'] :
                         envType === 'wsl'  ? [phpPath, 'artisan', 'tinker'] :
                                              ['artisan', 'tinker'];
        const replCmd  = envType === 'sail' ? path.join(rootPath, 'vendor', 'bin', 'sail') :
                         envType === 'wsl'  ? 'wsl' : phpPath;

        try {
            this._replProc = spawn(replCmd, replArgs, {
                cwd: rootPath,
                env: process.env,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            this._replProc.on('close', () => { this._replProc = null; });
            this._replProc.on('error', () => { this._replProc = null; });
            // Brief wait for psysh to initialise
            await new Promise(r => setTimeout(r, 600));
            return true;
        } catch(e) {
            this._replProc = null;
            return false;
        }
    }

    async _executeInRepl(code, webview, rootPath, envType, phpPath) {
        const ready = await this._ensureReplProc(rootPath, envType, phpPath);
        if (!ready || !this._replProc) {
            webview.postMessage({ type: 'error', message: '❌ Could not start REPL process.' });
            return;
        }

        const marker = 'TINKER_DONE_' + crypto.randomBytes(4).toString('hex');
        const input  = code + '\necho "' + marker + '";\n';

        return new Promise((resolve) => {
            let output = '';
            const timeout = this._getTimeout();

            const timer = setTimeout(() => {
                this._replProc.stdout.off('data', onData);
                this._killReplProc();
                webview.postMessage({ type: 'error', message: '❌ REPL timeout (' + (timeout / 1000) + 's). Process killed.' });
                resolve();
            }, timeout);

            const onData = (data) => {
                output += data.toString();
                if (output.includes(marker)) {
                    clearTimeout(timer);
                    this._replProc.stdout.off('data', onData);
                    const elapsed = Date.now() - this._startTime;
                    let result = output.substring(0, output.indexOf(marker)).trim();
                    // Strip psysh prompt artifacts
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

        // Detect environment (cache detection result within a session)
        const [phpPath, envType] = await Promise.all([
            this.detectPhpPath(rootPath),
            this.detectEnv(rootPath)
        ]);
        this._phpPath = phpPath;
        this._envType = envType;

        // Notify webview of environment
        webview.postMessage({ type: 'envDetected', envType });

        // Check cache (only for isolated mode)
        if (!this._replMode) {
            const cached = this._checkCache(code);
            if (cached) {
                const elapsed = Date.now() - this._startTime;
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
    </style>
</head>
<body>
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
            <optgroup label="App">
                <option value="app()->environment();">app()->environment();</option>
                <option value="config('app.name');">config('app.name');</option>
                <option value="config('database.default');">config('database.default');</option>
                <option value="now()->toDateTimeString();">now()->toDateTimeString();</option>
            </optgroup>
            <optgroup label="Cache & Queue">
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
        </div>

        <div class="status" id="status">พร้อมใช้งาน</div>

        <!-- Output -->
        <div class="output-header">
            <span class="output-label">Output <span id="viewToggle" class="view-toggle" style="display:none;">[tree]</span></span>
            <div style="display:flex;gap:4px;">
                <button id="copyBtn" class="btn-small btn-secondary" title="Copy output">📋 Copy</button>
                <button id="clearOutputBtn" class="btn-small btn-secondary" title="Clear output">✕ Clear</button>
            </div>
        </div>
        <div class="output" id="output">// ผลลัพธ์จะแสดงที่นี่...</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const HISTORY_KEY = 'artisan_tinker_history_v2';
        const MAX_HISTORY = 15;

        const editor = document.getElementById('editor');
        const executeBtn = document.getElementById('executeBtn');
        const stopBtn = document.getElementById('stopBtn');
        const output = document.getElementById('output');
        const status = document.getElementById('status');
        const historySelect = document.getElementById('historySelect');
        const historySearch = document.getElementById('historySearch');
        const copyBtn = document.getElementById('copyBtn');
        const clearOutputBtn = document.getElementById('clearOutputBtn');
        const pinBtn = document.getElementById('pinBtn');
        const templateSelect = document.getElementById('templateSelect');
        const viewToggle = document.getElementById('viewToggle');
        const replToggle = document.getElementById('replToggle');
        const resetReplBtn = document.getElementById('resetReplBtn');
        const envBadge = document.getElementById('envBadge');
        const cachedBadge = document.getElementById('cachedBadge');

        let _lastRawOutput = '';
        let _isTreeView = false;
        let _selectedHistoryCode = '';

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

        // ── Snippet Templates ──────────────────────────────────────
        templateSelect.addEventListener('change', function() {
            if (!this.value) return;
            const pos = editor.selectionStart;
            const before = editor.value.substring(0, pos);
            const after = editor.value.substring(editor.selectionEnd);
            const sep = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
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
            const hist = getHistory();
            const q = (filter || '').toLowerCase();
            historySelect.innerHTML = '<option value="">📜 เลือก History...</option>';
            const pinned = hist.filter(function(h) { return h.pinned; });
            const unpinned = hist.filter(function(h) { return !h.pinned; });
            function addOpt(item) {
                if (q && !item.code.toLowerCase().includes(q)) return;
                const opt = document.createElement('option');
                opt.value = item.code;
                const short = item.code.length > 33 ? item.code.substring(0, 33) + '...' : item.code;
                opt.textContent = (item.pinned ? '📌 ' : '') + short + ' [' + item.time + ']';
                if (item.pinned) opt.className = 'pinned';
                historySelect.appendChild(opt);
            }
            pinned.forEach(addOpt);
            unpinned.forEach(addOpt);
        }

        function saveHistory(code) {
            if (!code) return;
            let hist = getHistory();
            const existing = hist.find(function(h) { return h.code === code; });
            hist = hist.filter(function(h) { return h.code !== code; });
            hist.unshift({ code, time: new Date().toLocaleTimeString(), pinned: existing ? existing.pinned : false });
            while (hist.length > MAX_HISTORY) {
                const idx = hist.map(function(h) { return h.pinned; }).lastIndexOf(false);
                if (idx === -1) break;
                hist.splice(idx, 1);
            }
            saveHistoryRaw(hist);
            loadHistory(historySearch.value);
        }

        function togglePin(code) {
            if (!code) return;
            let hist = getHistory();
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
            const code = _selectedHistoryCode || editor.value.trim();
            if (!code) return;
            togglePin(code);
            _selectedHistoryCode = ''; historySelect.value = '';
            status.textContent = '📌 Pin อัปเดตแล้ว';
        });
        document.getElementById('clearHistoryBtn').addEventListener('click', function() {
            localStorage.removeItem(HISTORY_KEY); loadHistory(); historySearch.value = '';
            _selectedHistoryCode = ''; status.textContent = '✅ ล้าง History แล้ว';
        });

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
                let h = '<span class="json-toggle" onclick="toggleNode(this)">▼</span>[<ul>';
                data.forEach(function(v, i) { h += '<li>' + buildTree(v) + (i < data.length-1 ? ',' : '') + '</li>'; });
                return h + '</ul>]';
            }
            if (typeof data === 'object') {
                const keys = Object.keys(data);
                if (!keys.length) return '{}';
                let h = '<span class="json-toggle" onclick="toggleNode(this)">▼</span>{<ul>';
                keys.forEach(function(k, i) { h += '<li><span class="json-key">"' + escHtml(k) + '"</span>: ' + buildTree(data[k]) + (i < keys.length-1 ? ',' : '') + '</li>'; });
                return h + '</ul>}';
            }
            return escHtml(String(data));
        }
        function toggleNode(el) {
            el.parentElement.classList.toggle('json-collapsed');
            el.textContent = el.parentElement.classList.contains('json-collapsed') ? '▶' : '▼';
        }
        function renderTree(str) {
            try {
                const d = JSON.parse(str);
                const div = document.createElement('div');
                div.className = 'json-tree'; div.innerHTML = buildTree(d); return div;
            } catch(e) { return null; }
        }

        // ── Pretty-print fallback ──────────────────────────────────
        function formatText(str) {
            str = str.trim();
            if (str.startsWith('{') || str.startsWith('[')) {
                try { return JSON.stringify(JSON.parse(str), null, 2); } catch(e) {}
            }
            if (/^(array|object)\s*\(/.test(str)) {
                let indent = 0;
                return str.split('\n').map(function(line) {
                    const t = line.trim();
                    if (/^[}\)]/.test(t)) indent = Math.max(0, indent-1);
                    const out = '  '.repeat(indent) + t;
                    if (/[\(\{]$/.test(t)) indent++;
                    return out;
                }).join('\n');
            }
            return str;
        }

        function showOutput(raw, asTree) {
            _lastRawOutput = raw; _isTreeView = asTree;
            output.textContent = '';
            if (asTree) {
                const tree = renderTree(raw);
                if (tree) { output.appendChild(tree); return; }
            }
            output.textContent = formatText(raw);
        }

        viewToggle.addEventListener('click', function() {
            _isTreeView = !_isTreeView;
            this.textContent = _isTreeView ? '[raw]' : '[tree]';
            showOutput(_lastRawOutput, _isTreeView);
        });

        // ── Output actions ─────────────────────────────────────────
        copyBtn.addEventListener('click', function() {
            const text = _lastRawOutput || output.textContent;
            if (!text) return;
            try {
                navigator.clipboard.writeText(text).then(function() {
                    copyBtn.textContent = '✅ Copied';
                    setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
                });
            } catch(e) {
                const ta = document.createElement('textarea');
                ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                copyBtn.textContent = '✅ Copied';
                setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
            }
        });

        clearOutputBtn.addEventListener('click', function() {
            output.textContent = ''; _lastRawOutput = '';
            viewToggle.style.display = 'none'; cachedBadge.style.display = 'none';
            status.textContent = 'พร้อมใช้งาน'; status.className = 'status';
        });

        // ── Execute ────────────────────────────────────────────────
        function setRunning(running) {
            executeBtn.disabled = running;
            stopBtn.style.display = running ? 'inline-block' : 'none';
        }

        executeBtn.addEventListener('click', function() {
            const code = editor.value.trim();
            if (!code) { status.textContent = '⚠️ กรุณาใส่โค้ดก่อน'; return; }
            setRunning(true);
            cachedBadge.style.display = 'none';
            viewToggle.style.display = 'none';
            status.className = 'status';
            status.textContent = '⏳ กำลังประมวลผล...';
            output.textContent = 'รอผลลัพธ์...';
            vscode.postMessage({ command: 'execute', code });
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
            const msg = event.data;
            if (msg.type === 'result') {
                const raw = msg.output || '(ไม่มีผลลัพธ์)';
                const isJson = raw.trim().startsWith('{') || raw.trim().startsWith('[');
                showOutput(raw, isJson);
                if (isJson) { viewToggle.style.display = 'inline'; viewToggle.textContent = '[raw]'; }
                cachedBadge.style.display = msg.cached ? 'inline' : 'none';
                status.className = msg.error ? 'status error' : 'status success';
                const timeLabel = msg.cached ? ' (cached)' : (msg.elapsed ? ' (' + msg.elapsed + 'ms)' : '');
                status.textContent = (msg.error ? '❌ เกิดข้อผิดพลาด' : '✅ สำเร็จ') + timeLabel;
                if (!msg.error) saveHistory(editor.value.trim());
                setRunning(false);
            } else if (msg.type === 'error') {
                output.textContent = msg.message; _lastRawOutput = msg.message;
                viewToggle.style.display = 'none'; cachedBadge.style.display = 'none';
                status.className = 'status error'; status.textContent = '❌ ล้มเหลว';
                setRunning(false);
            } else if (msg.type === 'stopped') {
                output.textContent = '⬛ หยุดการทำงานแล้ว'; _lastRawOutput = '';
                viewToggle.style.display = 'none'; cachedBadge.style.display = 'none';
                status.className = 'status'; status.textContent = 'หยุดแล้ว';
                setRunning(false);
            } else if (msg.type === 'envDetected') {
                envBadge.textContent = msg.envType;
                envBadge.className = 'badge ' + msg.envType;
            } else if (msg.type === 'replReset') {
                status.textContent = '↺ REPL reset — variables cleared';
            }
        });

        // ── Init ───────────────────────────────────────────────────
        window.onerror = function(msg, src, line) {
            vscode.postMessage({ command: 'debug', text: 'Webview error: ' + msg + ' (' + src + ':' + line + ')' });
        };
        loadHistory();
        vscode.postMessage({ command: 'debug', text: 'Webview JS initialized successfully' });
    </script>
</body>
</html>`.replace(/\${VS_CODE_ENV}/g, process.env.NODE_ENV || 'production');
    }
}

function activate(context) {
    console.log('[Artisan Tinker] Activating v2.6.0...');
    const provider = new TinkerSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('artisanTinkerView', provider)
    );
    vscode.window.showInformationMessage('🪄 Artisan Tinker Runner v2.6.0 พร้อมใช้งาน');
}

function deactivate() {
    console.log('[Artisan Tinker] Deactivated');
}

module.exports = { activate, deactivate };
