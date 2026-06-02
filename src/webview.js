// This file runs inside the webview context (browser-like environment)
// It communicates with the extension via vscode.postMessage()

const vscode = acquireVsCodeApi();
const codeInput = document.getElementById('codeInput');
const executeBtn = document.getElementById('executeBtn');
const output = document.getElementById('output');
const status = document.getElementById('status');

executeBtn.addEventListener('click', () => {
    const code = codeInput.value.trim();
    if (!code) {
        vscode.postMessage({ command: 'info', text: 'Please enter some code first' });
        return;
    }
    executeBtn.disabled = true;
    status.textContent = 'Executing...';
    output.textContent = '⏳ Running...';
    
    vscode.postMessage({ command: 'execute', code });
});

// Listen for responses from extension host
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'result':
            output.textContent = message.output;
            status.textContent = message.error ? '❌ Error' : '✅ Done';
            break;
        case 'error':
            output.textContent = 'Error: ' + message.message;
            status.textContent = '❌ Failed';
            break;
    }
    executeBtn.disabled = false;
});

// Optional: Allow Ctrl+Enter to execute
codeInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executeBtn.click();
    }
});