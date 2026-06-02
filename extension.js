const vscode = require('vscode');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

class TinkerSidebarProvider {
    constructor(extensionUri) {
        this.extensionUri = extensionUri;
    }

    resolveWebviewView(webviewView, context, token) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        // ตั้งค่า HTML ทันที
        webviewView.webview.html = this.getHtmlForWebview();

        // รับข้อความจาก Webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'execute') {
                await this.runTinkerCode(message.code, webviewView.webview);
            } else if (message.command === 'debug') {
                console.log('[Tinker Webview]', message.text);
            }
        });

        // Debug: แจ้งสถานะ
        webviewView.title = 'Artisan Tinker';
        webviewView.description = 'v2.2.2 | Ready';
        console.log('[Tinker] Webview resolved successfully');
    }

    getHtmlForWebview() {
        return `<!DOCTYPE html>
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
        select, textarea, button {
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
        .output {
            background: var(--vscode-editor-background, #1e1e1e);
            border: 1px solid var(--vscode-editorGroup-border, #333);
            border-radius: 4px; padding: 6px;
            font-family: monospace; white-space: pre-wrap;
            max-height: 160px; overflow-y: auto; font-size: 11px;
        }
        .status { font-size: 11px; text-align: right; margin-top: 2px; }
        .status.error { color: var(--error); }
        .status.success { color: var(--success); }
        #debugBox {
            position: fixed; top: 0; left: 0; right: 0;
            background: #333; color: #ff9; font-size: 10px;
            padding: 2px 4px; text-align: center; z-index: 999;
        }
    </style>
</head>
<body>
    <div id="debugBox">🔄 Loading Webview...</div>
    <div class="container" style="margin-top: 20px;">
        <h3>🪄 Artisan Tinker</h3>
        <div class="history-row">
            <select id="historySelect"><option value="">📜 เลือก History...</option></select>
            <button id="clearHistoryBtn" style="width: 32px;">🗑️</button>
        </div>
        <textarea id="editor" placeholder="พิมพ์ PHP code ที่นี่...\nเช่น: User::count();" spellcheck="false"></textarea>
        <button id="executeBtn">▶ Execute in Tinker</button>
        <div class="status" id="status">พร้อมใช้งาน</div>
        <div class="output" id="output">// ผลลัพธ์จะแสดงที่นี่...</div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const HISTORY_KEY = 'artisan_tinker_history_v2';
        const MAX_HISTORY = 15;
        const debugBox = document.getElementById('debugBox');

        try {
            debugBox.textContent = '✅ Webview Loaded | Initializing...';
            const editor = document.getElementById('editor');
            const executeBtn = document.getElementById('executeBtn');
            const output = document.getElementById('output');
            const status = document.getElementById('status');
            const historySelect = document.getElementById('historySelect');

            function loadHistory() {
                try {
                    const hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
                    historySelect.innerHTML = '<option value="">📜 เลือก History...</option>';
                    hist.forEach(item => {
                        const opt = document.createElement('option');
                        opt.value = item.code;
                        const short = item.code.length > 35 ? item.code.substring(0, 35) + '...' : item.code;
                        opt.textContent = short + ' [' + item.time + ']';
                        historySelect.appendChild(opt);
                    });
                    debugBox.textContent = '✅ Ready | History: ' + hist.length + ' items';
                } catch(e) { debugBox.textContent = '⚠️ History load error: ' + e.message; }
            }

            function saveHistory(code) {
                if (!code) return;
                try {
                    let hist = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
                    hist = hist.filter(h => h.code !== code);
                    hist.unshift({ code, time: new Date().toLocaleTimeString() });
                    if (hist.length > MAX_HISTORY) hist.pop();
                    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist));
                    loadHistory();
                } catch(e) { console.error(e); }
            }

            document.getElementById('clearHistoryBtn').addEventListener('click', function() {
                localStorage.removeItem(HISTORY_KEY);
                loadHistory();
                status.textContent = '✅ ล้าง History แล้ว';
            });

            historySelect.addEventListener('change', function(e) {
                if (e.target.value) {
                    editor.value = e.target.value;
                    editor.focus();
                }
                e.target.value = '';
            });

            executeBtn.addEventListener('click', function() {
                const code = editor.value.trim();
                if (!code) { status.textContent = '⚠️ กรุณาใส่โค้ดก่อน'; return; }
                executeBtn.disabled = true;
                status.className = 'status';
                status.textContent = '⏳ กำลังประมวลผล...';
                output.textContent = 'รอผลลัพธ์...';
                vscode.postMessage({ command: 'execute', code });
            });

            document.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    executeBtn.click();
                }
            });

            window.addEventListener('message', function(event) {
                const msg = event.data;
                if (msg.type === 'result') {
                    output.textContent = msg.output;
                    status.className = msg.error ? 'status error' : 'status success';
                    status.textContent = msg.error ? '❌ เกิดข้อผิดพลาด' : '✅ สำเร็จ';
                    saveHistory(editor.value.trim());
                } else if (msg.type === 'error') {
                    output.textContent = msg.message;
                    status.className = 'status error';
                    status.textContent = '❌ ล้มเหลว';
                }
                executeBtn.disabled = false;
            });

            // Init
            loadHistory();
            vscode.postMessage({ command: 'debug', text: 'Webview JS initialized successfully' });
        } catch(err) {
            debugBox.textContent = '❌ JS Error: ' + err.message;
            document.body.innerHTML += '<pre style="color:red;margin-top:20px;">' + err.stack + '</pre>';
            vscode.postMessage({ command: 'debug', text: 'JS Init Failed: ' + err.message });
        }
    </script>
</body>
</html>`;
    }

    async runTinkerCode(code, webview) {
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            webview.postMessage({ type: 'error', message: '❌ ไม่พบ workspace' });
            return;
        }

        const rootPath = workspace.uri.fsPath;
        if (!fs.existsSync(path.join(rootPath, 'artisan'))) {
            webview.postMessage({ type: 'error', message: '❌ ไม่พบไฟล์ artisan ในโฟลเดอร์นี้' });
            return;
        }

        console.log('[Tinker] Executing:', code);

        return new Promise((resolve) => {
            const proc = spawn('php', ['artisan', 'tinker', '--execute', code], {
                cwd: rootPath, shell: true, env: process.env
            });

            let stdout = '', stderr = '';
            proc.stdout.on('data', d => stdout += d.toString());
            proc.stderr.on('data', d => stderr += d.toString());

            proc.on('close', exitCode => {
                console.log(`[Tinker] Exit code: ${exitCode}`);
                if (stderr && !stdout) {
                    webview.postMessage({ type: 'error', message: stderr.trim() });
                } else {
                    webview.postMessage({ type: 'result', output: stdout.trim() || '(ไม่มีผลลัพธ์)', error: exitCode !== 0 });
                }
                resolve();
            });

            proc.on('error', err => {
                console.error('[Tinker] Spawn error:', err);
                webview.postMessage({ type: 'error', message: `❌ เริ่มกระบวนการไม่สำเร็จ: ${err.message}` });
                resolve();
            });
        });
    }
}

function activate(context) {
    console.log('[Artisan Tinker] Activating v2.2.2...');
    const provider = new TinkerSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('artisanTinkerView', provider)
    );
    vscode.window.showInformationMessage('🪄 Artisan Tinker Runner v2.2.2 พร้อมใช้งาน');
}

function deactivate() {
    console.log('[Artisan Tinker] Deactivated');
}

module.exports = { activate, deactivate };