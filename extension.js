const vscode = require('vscode');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

class TinkerSidebarProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
        this._webview = null;
        this._proc = null;
        this._startTime = null;
        this._stopping = false;
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
                if (this._proc) {
                    this._stopping = true;
                    this._proc.kill();
                    this._proc = null;
                    webviewView.webview.postMessage({ type: 'stopped' });
                }
            } else if (message.command === 'debug') {
                console.log('[Tinker Webview]', message.text);
            }
        });

        webviewView.title = 'Artisan Tinker';
        webviewView.description = 'v2.5.0 | Ready';
        console.log('[Tinker] Webview resolved successfully');
    }

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
        button {
            background: var(--btn); color: var(--btn-fg);
            border: none; cursor: pointer; font-weight: 500;
        }
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

        /* JSON Tree */
        .json-tree { font-family: monospace; font-size: 11px; line-height: 1.6; }
        .json-tree ul { list-style: none; margin: 0; padding-left: 16px; }
        .json-tree li { position: relative; }
        .json-toggle {
            cursor: pointer; user-select: none;
            display: inline-block; width: 12px; text-align: center;
            color: var(--fg); opacity: 0.6; margin-right: 2px;
        }
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
        <h3>🪄 Artisan Tinker</h3>

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
            <button id="pinBtn" class="btn-small btn-secondary" title="Pin/Unpin snippet ที่เลือก">📌</button>
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

        let _lastRawOutput = '';
        let _isTreeView = false;
        let _selectedHistoryCode = '';

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

        function saveHistoryRaw(hist) {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
        }

        function loadHistory(filter) {
            const hist = getHistory();
            const q = (filter || '').toLowerCase();
            historySelect.innerHTML = '<option value="">📜 เลือก History...</option>';

            // Pinned first, then unpinned
            const pinned = hist.filter(function(h) { return h.pinned; });
            const unpinned = hist.filter(function(h) { return !h.pinned; });

            function addOption(item) {
                if (q && !item.code.toLowerCase().includes(q)) return;
                const opt = document.createElement('option');
                opt.value = item.code;
                const short = item.code.length > 33 ? item.code.substring(0, 33) + '...' : item.code;
                opt.textContent = (item.pinned ? '📌 ' : '') + short + ' [' + item.time + ']';
                if (item.pinned) opt.className = 'pinned';
                historySelect.appendChild(opt);
            }

            pinned.forEach(addOption);
            unpinned.forEach(addOption);
        }

        function saveHistory(code) {
            if (!code) return;
            let hist = getHistory();
            const existing = hist.find(function(h) { return h.code === code; });
            hist = hist.filter(function(h) { return h.code !== code; });
            hist.unshift({
                code: code,
                time: new Date().toLocaleTimeString(),
                pinned: existing ? existing.pinned : false
            });
            if (hist.length > MAX_HISTORY) {
                // Don't trim pinned items
                let count = hist.filter(function(h) { return !h.pinned; }).length;
                while (hist.length > MAX_HISTORY && count > 0) {
                    const idx = hist.map(function(h) { return h.pinned; }).lastIndexOf(false);
                    if (idx !== -1) { hist.splice(idx, 1); count--; }
                    else break;
                }
            }
            saveHistoryRaw(hist);
            loadHistory(historySearch.value);
        }

        function togglePin(code) {
            if (!code) return;
            let hist = getHistory();
            hist = hist.map(function(h) {
                return h.code === code ? Object.assign({}, h, { pinned: !h.pinned }) : h;
            });
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
            _selectedHistoryCode = '';
            historySelect.value = '';
            status.textContent = '📌 Pin อัปเดตแล้ว';
        });

        document.getElementById('clearHistoryBtn').addEventListener('click', function() {
            localStorage.removeItem(HISTORY_KEY);
            loadHistory();
            historySearch.value = '';
            _selectedHistoryCode = '';
            status.textContent = '✅ ล้าง History แล้ว';
        });

        // ── JSON Tree Viewer ───────────────────────────────────────
        function buildTree(data, isRoot) {
            if (data === null) return '<span class="json-null">null</span>';
            if (typeof data === 'boolean') return '<span class="json-bool">' + data + '</span>';
            if (typeof data === 'number') return '<span class="json-num">' + data + '</span>';
            if (typeof data === 'string') return '<span class="json-str">"' + escHtml(data) + '"</span>';

            if (Array.isArray(data)) {
                if (data.length === 0) return '<span>[]</span>';
                let html = '<span class="json-toggle" onclick="toggleNode(this)">▼</span>[<ul>';
                data.forEach(function(v, i) {
                    html += '<li>' + buildTree(v, false) + (i < data.length - 1 ? ',' : '') + '</li>';
                });
                html += '</ul>]';
                return html;
            }

            if (typeof data === 'object') {
                const keys = Object.keys(data);
                if (keys.length === 0) return '<span>{}</span>';
                let html = '<span class="json-toggle" onclick="toggleNode(this)">▼</span>{<ul>';
                keys.forEach(function(k, i) {
                    html += '<li><span class="json-key">"' + escHtml(k) + '"</span>: ' + buildTree(data[k], false) + (i < keys.length - 1 ? ',' : '') + '</li>';
                });
                html += '</ul>}';
                return html;
            }
            return escHtml(String(data));
        }

        function escHtml(s) {
            return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        function toggleNode(el) {
            const li = el.parentElement;
            const collapsed = li.classList.toggle('json-collapsed');
            el.textContent = collapsed ? '▶' : '▼';
        }

        function renderTree(jsonStr) {
            try {
                const data = JSON.parse(jsonStr);
                const div = document.createElement('div');
                div.className = 'json-tree';
                div.innerHTML = buildTree(data, true);
                return div;
            } catch(e) { return null; }
        }

        function showOutput(raw, asTree) {
            _lastRawOutput = raw;
            _isTreeView = asTree;
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

        // ── Pretty-Print (text fallback) ───────────────────────────
        function formatText(str) {
            str = str.trim();
            if (str.startsWith('{') || str.startsWith('[')) {
                try { return JSON.stringify(JSON.parse(str), null, 2); } catch(e) {}
            }
            if (/^(array|object)\s*\(/.test(str)) {
                let indent = 0;
                return str.split('\n').map(function(line) {
                    const t = line.trim();
                    if (/^[}\)]/.test(t)) indent = Math.max(0, indent - 1);
                    const out = '  '.repeat(indent) + t;
                    if (/[\(\{]$/.test(t)) indent++;
                    return out;
                }).join('\n');
            }
            return str;
        }

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
                ta.value = text;
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                copyBtn.textContent = '✅ Copied';
                setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
            }
        });

        clearOutputBtn.addEventListener('click', function() {
            output.textContent = '';
            _lastRawOutput = '';
            viewToggle.style.display = 'none';
            status.textContent = 'พร้อมใช้งาน';
            status.className = 'status';
        });

        // ── Execute ────────────────────────────────────────────────
        function setRunning(isRunning) {
            executeBtn.disabled = isRunning;
            stopBtn.style.display = isRunning ? 'inline-block' : 'none';
        }

        executeBtn.addEventListener('click', function() {
            const code = editor.value.trim();
            if (!code) { status.textContent = '⚠️ กรุณาใส่โค้ดก่อน'; return; }
            setRunning(true);
            status.className = 'status';
            status.textContent = '⏳ กำลังประมวลผล...';
            output.textContent = 'รอผลลัพธ์...';
            viewToggle.style.display = 'none';
            vscode.postMessage({ command: 'execute', code: code });
        });

        stopBtn.addEventListener('click', function() {
            vscode.postMessage({ command: 'stopProcess' });
        });

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
                if (isJson) {
                    viewToggle.style.display = 'inline';
                    viewToggle.textContent = '[raw]';
                }
                status.className = msg.error ? 'status error' : 'status success';
                const timeLabel = msg.elapsed ? ' (' + msg.elapsed + 'ms)' : '';
                status.textContent = (msg.error ? '❌ เกิดข้อผิดพลาด' : '✅ สำเร็จ') + timeLabel;
                if (!msg.error) saveHistory(editor.value.trim());
                setRunning(false);
            } else if (msg.type === 'error') {
                output.textContent = msg.message;
                _lastRawOutput = msg.message;
                viewToggle.style.display = 'none';
                status.className = 'status error';
                status.textContent = '❌ ล้มเหลว';
                setRunning(false);
            } else if (msg.type === 'stopped') {
                output.textContent = '⬛ หยุดการทำงานแล้ว';
                _lastRawOutput = '';
                viewToggle.style.display = 'none';
                status.className = 'status';
                status.textContent = 'หยุดแล้ว';
                setRunning(false);
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

        console.log('[Tinker] Executing:', code);
        this._startTime = Date.now();
        this._stopping = false;

        // Write code to a temp file to support multi-line safely
        const tmpFile = path.join(rootPath, '.tinker_tmp.php');
        const wrappedCode = '<?php\n' + code + '\n';

        return new Promise((resolve) => {
            try { fs.writeFileSync(tmpFile, wrappedCode); } catch(e) {
                webview.postMessage({ type: 'error', message: '❌ Could not write temp file: ' + e.message });
                resolve(); return;
            }

            this._proc = spawn('php', ['artisan', 'tinker', '--execute', code], {
                cwd: rootPath,
                env: process.env
            });

            let stdout = '';
            let stderr = '';
            this._proc.stdout.on('data', function(d) { stdout += d.toString(); });
            this._proc.stderr.on('data', function(d) { stderr += d.toString(); });

            this._proc.on('close', (exitCode) => {
                try { fs.unlinkSync(tmpFile); } catch(e) {}

                if (this._stopping) {
                    this._stopping = false;
                    this._proc = null;
                    resolve(); return;
                }
                this._proc = null;
                const elapsed = Date.now() - this._startTime;
                console.log('[Tinker] Exit code:', exitCode, 'elapsed:', elapsed + 'ms');

                if (stdout || exitCode === 0) {
                    webview.postMessage({
                        type: 'result',
                        output: stdout.trim() || '(ไม่มีผลลัพธ์)',
                        error: exitCode !== 0,
                        elapsed: elapsed
                    });
                    if (exitCode === 0) {
                        vscode.window.showInformationMessage('Tinker: executed in ' + elapsed + 'ms');
                    } else {
                        vscode.window.showWarningMessage('Tinker: finished with errors (' + elapsed + 'ms)');
                    }
                } else {
                    const errText = stderr.trim();
                    let friendlyMsg;
                    if (/artisan/i.test(errText) && /not found|No such file/i.test(errText)) {
                        friendlyMsg = '❌ artisan not found. Open a Laravel project folder.';
                    } else if (errText.length > 300) {
                        const firstLine = errText.split('\n').find(function(l) { return l.trim().length > 0; }) || errText;
                        friendlyMsg = '❌ ' + firstLine.trim();
                    } else {
                        friendlyMsg = '❌ ' + errText;
                    }
                    webview.postMessage({ type: 'error', message: friendlyMsg });
                    vscode.window.showErrorMessage('Tinker: ' + friendlyMsg.replace(/^❌\s*/, '').substring(0, 80));
                }
                resolve();
            });

            this._proc.on('error', (err) => {
                try { fs.unlinkSync(tmpFile); } catch(e) {}
                this._proc = null;
                console.error('[Tinker] Spawn error:', err);
                let friendlyMsg;
                if (err.code === 'ENOENT') {
                    friendlyMsg = '❌ PHP not found. Ensure php is in your PATH or configure it in settings.';
                } else {
                    friendlyMsg = '❌ Could not start process: ' + err.message;
                }
                webview.postMessage({ type: 'error', message: friendlyMsg });
                vscode.window.showErrorMessage('Tinker: ' + friendlyMsg.replace(/^❌\s*/, ''));
                resolve();
            });
        });
    }
}

function activate(context) {
    console.log('[Artisan Tinker] Activating v2.5.0...');
    const provider = new TinkerSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('artisanTinkerView', provider)
    );
    vscode.window.showInformationMessage('🪄 Artisan Tinker Runner v2.5.0 พร้อมใช้งาน');
}

function deactivate() {
    console.log('[Artisan Tinker] Deactivated');
}

module.exports = { activate, deactivate };
