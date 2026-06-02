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

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'execute') {
                await this.runTinkerCode(message.code, webviewView.webview);
            }
        });
    }

    getHtmlForWebview(webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
    <style>
        body { font-family: var(--vscode-font-family); padding: 8px; color: var(--vscode-foreground); font-size: 13px; }
        textarea { width: 100%; min-height: 80px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 6px; font-family: monospace; resize: vertical; }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 6px; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .output { background: var(--vscode-editor-background); border: 1px solid var(--vscode-editorGroup-border); border-radius: 4px; padding: 6px; font-family: monospace; white-space: pre-wrap; max-height: 200px; overflow-y: auto; margin-top: 8px; font-size: 12px; }
        .status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; text-align: right; }
    </style>
</head>
<body>
    <div>
        <textarea id="codeInput" placeholder="พิมพ์ PHP code ที่นี่...\nเช่น: User::count();"></textarea>
        <button id="executeBtn">▶ Execute in Tinker</button>
        <div class="status" id="status">พร้อมใช้งาน</div>
        <div class="output" id="output">// ผลลัพธ์จะแสดงที่นี่...</div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const codeInput = document.getElementById('codeInput');
        const executeBtn = document.getElementById('executeBtn');
        const output = document.getElementById('output');
        const status = document.getElementById('status');

        executeBtn.addEventListener('click', () => {
            const code = codeInput.value.trim();
            if (!code) { status.textContent = '⚠️ กรุณาใส่โค้ดก่อน'; return; }
            executeBtn.disabled = true;
            status.textContent = '⏳ กำลังประมวลผล...';
            output.textContent = 'รอผลลัพธ์...';
            vscode.postMessage({ command: 'execute', code });
        });

        codeInput.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') executeBtn.click();
        });

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.type === 'result') {
                output.textContent = msg.output;
                status.textContent = msg.error ? '❌ เกิดข้อผิดพลาด' : '✅ สำเร็จ';
            } else if (msg.type === 'error') {
                output.textContent = msg.message;
                status.textContent = '❌ ล้มเหลว';
            }
            executeBtn.disabled = false;
        });
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

        return new Promise((resolve) => {
            const proc = spawn('php', ['artisan', 'tinker', '--execute', code], {
                cwd: rootPath, shell: true, env: process.env
            });

            let stdout = '', stderr = '';
            proc.stdout.on('data', d => stdout += d.toString());
            proc.stderr.on('data', d => stderr += d.toString());

            proc.on('close', code => {
                if (stderr && !stdout) {
                    webview.postMessage({ type: 'error', message: stderr.trim() });
                } else {
                    webview.postMessage({ type: 'result', output: stdout.trim() || '(ไม่มีผลลัพธ์)', error: code !== 0 });
                }
                resolve();
            });

            proc.on('error', err => {
                webview.postMessage({ type: 'error', message: `❌ เริ่มกระบวนการไม่สำเร็จ: ${err.message}` });
                resolve();
            });
        });
    }
}

function activate(context) {
    const provider = new TinkerSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('artisanTinkerView', provider)
    );

    vscode.window.showInformationMessage('🪄 Artisan Tinker Runner เปิดใช้งานแล้ว! ดูไอคอนที่แถบด้านซ้าย');
}

function deactivate() {}

module.exports = { activate, deactivate };