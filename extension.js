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
        webviewView.description = 'v2.4.0 | Ready';
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
        }
        body {
            font-family: var(--vscode-font-family, sans-serif);
            padding: 10px; margin: 0;
            background: var(--vscode-editor-background, #1e1e1e);
            color: var(--fg); font-size: 13px;
        }
        .container { display: flex; flex-direction: column; gap: 8px; }
        h3 { margin: 0; font-size: 14px; font-weight: 600; }
        .history-row { display: flex; gap: 6px; align-items: center; }
        select, textarea, button, input[type="text"] {
            font-family: inherit; font-size: 12px;
            background: var(--bg); color: var(--fg);
            border: 1px solid var(--border); border-radius: 4px;
            padding: 6px; width: 100%; box-sizing: border-box;
        }
        textarea { min-height: 100px; resize: vertical; line-height: 1.4; }
        button {
            background: var(--btn); color: var(--btn-fg);
            border: none; cursor: pointer; font-weight: 500;
        }
        button:hover { background: var(--btn-hover); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-secondary {
            background: var(--btn-secondary); color: var(--fg); border: none;
        }
        .btn-secondary:hover { background: var(--btn-secondary-hover); }
        .btn-danger { background: #c72e0f; color: #fff; border: none; }
        .btn-danger:hover { background: #e33b1a; }
        .btn-small { width: auto; padding: 4px 8px; font-size: 11px; }
        .action-row { display: flex; gap: 6px; align-items: center; }
        .output-header {
            display: flex; gap: 4px; align-items: center;
            justify-content: space-between;
        }
        .output-label { font-size: 11px; opacity: 0.6; }
        .output {
            background: var(--vscode-editor-background, #1e1e1e);
            border: 1px solid var(--vscode-editorGroup-border, #333);
            border-radius: 4px; padding: 6px;
            font-family: monospace; white-space: pre-wrap;
            max-height: 200px; overflow-y: auto; font-size: 11px;
        }
        .status { font-size: 11px; text-align: right; margin-top: 2px; }
        .status.error { color: var(--error); }
        .status.success { color: var(--success); }
        input[type="text"]::placeholder { opacity: 0.5; }
    </style>
</head>
<body>
    <div class="container">
        <h3>🪄 Artisan Tinker</h3>

        <input type="text" id="historySearch" placeholder="🔍 ค้นหา history...">
        <div class="history-row">
            <select id="historySelect"><option value="">📜 เลือก History...</option></select>
            <button id="clearHistoryBtn" class="btn-small btn-secondary" style="width:32px;" title="ล้าง History">🗑️</button>
        </div>

        <textarea id="editor" placeholder="พิมพ์ PHP code ที่นี่...\nเช่น: User::count();" spellcheck="false"></textarea>

        <div class="action-row">
            <button id="executeBtn" style="flex:1;">▶ Execute in Tinker</button>
            <button id="stopBtn" class="btn-danger btn-small" style="display:none;" title="หยุดการทำงาน">■ Stop</button>
        </div>

        <div class="status" id="status">พร้อมใช้งาน</div>

        <div class="output-header">
            <span class="output-label">Output</span>
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

        // ── History ───────────────────────────────────────────────
        function getHistory() {
            try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
            catch(e) { return []; }
        }

        function loadHistory(filter) {
            const hist = getHistory();
            const q = (filter || '').toLowerCase();
            historySelect.innerHTML = '<option value="">📜 เลือก History...</option>';
            hist.forEach(function(item) {
                if (q && !item.code.toLowerCase().includes(q)) return;
                const opt = document.createElement('option');
                opt.value = item.code;
                const short = item.code.length > 35 ? item.code.substring(0, 35) + '...' : item.code;
                opt.textContent = short + ' [' + item.time + ']';
                historySelect.appendChild(opt);
            });
        }

        function saveHistory(code) {
            if (!code) return;
            let hist = getHistory();
            hist = hist.filter(function(h) { return h.code !== code; });
            hist.unshift({ code: code, time: new Date().toLocaleTimeString() });
            if (hist.length > MAX_HISTORY) hist.pop();
            localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
            loadHistory(historySearch.value);
        }

        historySearch.addEventListener('input', function() {
            loadHistory(this.value);
        });

        historySelect.addEventListener('change', function(e) {
            if (e.target.value) { editor.value = e.target.value; editor.focus(); }
            e.target.value = '';
        });

        document.getElementById('clearHistoryBtn').addEventListener('click', function() {
            localStorage.removeItem(HISTORY_KEY);
            loadHistory();
            historySearch.value = '';
            status.textContent = '✅ ล้าง History แล้ว';
        });

        // ── Pretty-print ──────────────────────────────────────────
        function formatOutput(str) {
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

        // ── Output actions ────────────────────────────────────────
        copyBtn.addEventListener('click', function() {
            const text = output.textContent;
            if (!text) return;
            try {
                navigator.clipboard.writeText(text).then(function() {
                    copyBtn.textContent = '✅ Copied';
                    setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
                });
            } catch(e) {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
                copyBtn.textContent = '✅ Copied';
                setTimeout(function() { copyBtn.textContent = '📋 Copy'; }, 1500);
            }
        });

        clearOutputBtn.addEventListener('click', function() {
            output.textContent = '';
            status.textContent = 'พร้อมใช้งาน';
            status.className = 'status';
        });

        // ── Execute ───────────────────────────────────────────────
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

        // ── Messages from host ────────────────────────────────────
        window.addEventListener('message', function(event) {
            const msg = event.data;
            if (msg.type === 'result') {
                output.textContent = formatOutput(msg.output || '(ไม่มีผลลัพธ์)');
                status.className = msg.error ? 'status error' : 'status success';
                const timeLabel = msg.elapsed ? ' (' + msg.elapsed + 'ms)' : '';
                status.textContent = (msg.error ? '❌ เกิดข้อผิดพลาด' : '✅ สำเร็จ') + timeLabel;
                if (!msg.error) saveHistory(editor.value.trim());
                setRunning(false);
            } else if (msg.type === 'error') {
                output.textContent = msg.message;
                status.className = 'status error';
                status.textContent = '❌ ล้มเหลว';
                setRunning(false);
            } else if (msg.type === 'stopped') {
                output.textContent = '⬛ หยุดการทำงานแล้ว';
                status.className = 'status';
                status.textContent = 'หยุดแล้ว';
                setRunning(false);
            }
        });

        // ── Init ──────────────────────────────────────────────────
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

        return new Promise((resolve) => {
            this._proc = spawn('php', ['artisan', 'tinker', '--execute', code], {
                cwd: rootPath,
                env: process.env
            });

            let stdout = '';
            let stderr = '';
            this._proc.stdout.on('data', function(d) { stdout += d.toString(); });
            this._proc.stderr.on('data', function(d) { stderr += d.toString(); });

            this._proc.on('close', (exitCode) => {
                if (this._stopping) {
                    this._stopping = false;
                    this._proc = null;
                    resolve();
                    return;
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
    console.log('[Artisan Tinker] Activating v2.4.0...');
    const provider = new TinkerSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('artisanTinkerView', provider)
    );
    vscode.window.showInformationMessage('🪄 Artisan Tinker Runner v2.4.0 พร้อมใช้งาน');
}

function deactivate() {
    console.log('[Artisan Tinker] Deactivated');
}

module.exports = { activate, deactivate };
