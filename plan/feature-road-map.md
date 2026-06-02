📦 ROADMAP: ARTISAN TINKER RUNNER FEATURE DEVELOPMENT
=====================================================
Last updated: 2026-06-02 | Based on competitive analysis vs Laravel Runner, Tinkerun, Tinker This, Tinker Here

🏆 UNIQUE VALUE vs COMPETITORS
─────────────────────────────────────────────────────────────────────────────────
✅ ALREADY UNIQUE  │ Execution History (localStorage) — ไม่มีคู่แข่งตัวไหนทำ
                   │ Inline textarea sidebar — ไม่ต้องสร้าง .php file ใหม่
⚠️  GAP (DANGER)   │ Stop runaway process — Laravel Runner มี แต่เรายังไม่มี
                   │ Color-coded / Pretty output — Laravel Runner ทำได้ดีมาก
🎯 DIFFERENTIATOR  │ Pretty-Print, Execution Time, Pin Snippets — ไม่มีคู่แข่งทำเลย

PHASE 1: STABILITY & DIFFERENTIATION (Weeks 1-2) [PRIORITY: P0 | IMPACT: HIGH]
─────────────────────────────────────────────────────────────────────────────────
FEATURE                │ USER BENEFIT                                │ EFFORT │ UNIQUE? │ TECHNICAL NOTES
───────────────────────┼─────────────────────────────────────────────┼────────┼─────────┼────────────────────────────────────
🛡️ Error Boundary Layer│ friendly message ทุก failure point          │ Low    │ ✅ YES  │ 4 cases ด้านล่าง → message + action hint
🛑 Stop Process        │ หยุด infinite loop / process ค้างได้ทันที   │ Low    │ ❌ GAP  │ proc.kill() + cancel button ใน webview
🎨 Pretty-Print Output │ อ่าน dump/dd(), array, object ง่ายขึ้น      │ Med    │ ✅ YES  │ Regex replace + JSON.stringify indent
⏱️ Execution Time      │ รู้ว่าโค้ดใช้เวลากี่ ms                     │ Low    │ ✅ YES  │ Date.now() before/after spawn
📋 Copy/Clear Output   │ ไม่ต้องก๊อปปี้ด้วยมือ ล้างผลเก่าได้ทันที    │ Low    │ ❌ GAP  │ navigator.clipboard + DOM toggle
🔍 Search History      │ หา snippet เก่าได้รวดเร็ว                   │ Low    │ ✅ YES  │ input filter + Array.includes
🌓 Auto Theme Sync     │ UI เปลี่ยนสีตาม VS Code theme อัตโนมัติ     │ Low    │ ➖ MED  │ vscode.workspace.onDidChangeConfiguration
🔔 Toast Notifications │ แจ้งเตือนแบบไม่ขัดจังหวะ                   │ Low    │ ➖ MED  │ vscode.window.withProgress / showInformationMessage
───────────────────────┴─────────────────────────────────────────────┴────────┴─────────┴────────────────────────────────────

  ERROR CASES (🛡️ Error Boundary):
  • php ไม่อยู่ใน PATH           → "PHP not found. Check PATH or configure PHP Path in settings."
  • ไม่มีไฟล์ artisan             → "No artisan file found. Open a Laravel project folder."
  • artisan tinker crash (stderr) → Parse stderr → แยก Laravel exception vs PHP fatal → แสดงเฉพาะบรรทัดสำคัญ
  • infinite loop / hang          → แสดง warning + ปุ่ม Stop (Stop Process feature)
  • webview JS crash              → ซ่อน debugBox หลัง init สำเร็จ แสดงเฉพาะตอน error จริง

PHASE 2: DEVELOPER PRODUCTIVITY (Weeks 3-4) [PRIORITY: P1 | IMPACT: VERY HIGH]
─────────────────────────────────────────────────────────────────────────────────
FEATURE                │ USER BENEFIT                                │ EFFORT │ UNIQUE? │ TECHNICAL NOTES
───────────────────────┼─────────────────────────────────────────────┼────────┼─────────┼────────────────────────────────────
📌 Pin Favorite Snippets│ เก็บ snippet สำคัญไว้ด้านบนเสมอ           │ Low    │ ✅ YES  │ localStorage + UI pin/unpin toggle
🔁 Multi-Line Support  │ รันโค้ดหลายบรรทัดได้โดยไม่ error            │ Low    │ ➖ MED  │ Handle \n escape + trim properly
🧩 Snippet Templates   │ กดเลือก template ที่ใช้บ่อยได้ทันที          │ Med    │ ✅ YES  │ JSON config + quickpick UI
📊 Result Tree Viewer  │ คลิกดู nested array/object ได้เหมือน console │ High   │ ✅ YES  │ JSON-tree-view library หรือ custom recursive DOM
🎯 Basic Auto-Complete │ พิมพ์ Facades/Models แล้วขึ้น suggestion     │ High   │ ➖ MED  │ Monaco editor + completionItemProvider
───────────────────────┴─────────────────────────────────────────────┴────────┴─────────┴────────────────────────────────────

PHASE 3: ENVIRONMENT & PERFORMANCE (Weeks 5-6) [PRIORITY: P1 | IMPACT: HIGH]
─────────────────────────────────────────────────────────────────────────────────
FEATURE                │ USER BENEFIT                                │ EFFORT │ UNIQUE? │ TECHNICAL NOTES
───────────────────────┼─────────────────────────────────────────────┼────────┼─────────┼────────────────────────────────────
🌐 PHP Path Auto-Detect│ ไม่ต้อง config PHP path เอง                 │ Low    │ ➖ MED  │ which/where command fallback + settings.json
📉 Memory/Timeout Guard│ ป้องกัน process ค้าง/กิน RAM เกิน           │ Med    │ ➖ MED  │ proc.kill() + timeout setTimeout + memory check
⚡ Execution Cache     │ โค้ดเดิมไม่รันซ้ำภายใน 30s                  │ Med    │ ✅ YES  │ Map cache + crypto hash + TTL
🐳 Docker/WSL/SSH      │ รันบน environment ต่างๆ ได้                  │ High   │ ❌ GAP  │ Detect .env/compose/WSL → switch exec command
🔄 Persistent REPL     │ ตัวแปรจำค่าข้ามการรันได้ (stateful)          │ High   │ ✅ YES  │ spawn stdio:pipe + keep process alive + prompt parsing
───────────────────────┴─────────────────────────────────────────────┴────────┴─────────┴────────────────────────────────────

PHASE 4: ADVANCED & COLLABORATION (Weeks 7-8+) [PRIORITY: P2 | IMPACT: MEDIUM]
─────────────────────────────────────────────────────────────────────────────────
FEATURE                │ USER BENEFIT                                │ EFFORT │ UNIQUE? │ TECHNICAL NOTES
───────────────────────┼─────────────────────────────────────────────┼────────┼─────────┼────────────────────────────────────
🗄️ Query Log Viewer    │ แยกดู SQL ที่รันใน tinker ได้ชัดเจน         │ High   │ ✅ YES  │ Parse DB::getQueryLog() → tree table
🌐 Share via Gist/URL  │ ส่ง snippet ให้ทีมผ่าน link ได้ทันที        │ Med    │ ✅ YES  │ GitHub API / paste.bin + env.openExternal
🧪 Test Runner Integration│ รัน PHPUnit/Feature test snippets โดยตรง│ High   │ ✅ YES  │ Detect test namespace → spawn artisan test
📈 Usage Analytics     │ ผู้พัฒนาเห็นฟีเจอร์ที่ใช้บ่อย/น้อย          │ Low    │ ➖ MED  │ Telemetry (opt-in) + anonymized events
🎓 Interactive Tutorial│ สอนใช้ extension ครั้งแรกที่ติดตั้ง          │ Med    │ ✅ YES  │ Webview walkthrough + step highlight
───────────────────────┴─────────────────────────────────────────────┴────────┴─────────┴────────────────────────────────────

📊 PRIORITY GUIDE
P0 = Must-have (Blocks adoption / closes dangerous gap vs competitors)
P1 = High value, improves daily workflow
P2 = Nice-to-have, expands ecosystem

🏷️  UNIQUE GUIDE
✅ YES = ไม่มีคู่แข่งทำ → จุดขายหลัก
❌ GAP = คู่แข่งมีแล้ว แต่เรายังไม่มี → ต้องปิดช่องโหว่
➖ MED = มีบางตัวทำแล้ว แต่ implementation ของเราต่างกัน

⚙️ IMPLEMENTATION CHECKLIST PER FEATURE
[ ] Update package.json contributes (commands/keybindings/views)
[ ] Add webview HTML/JS or extension.js logic
[ ] Handle error states & loading indicators
[ ] Update README.md with usage example
[ ] Bump version & vsce package → test locally
[ ] Publish to Marketplace

💡 RECOMMENDED EXECUTION ORDER
1️⃣ Phase 1 (🛡️ Error Boundary + 🛑 Stop Process ก่อนเลย) → 2️⃣ Phase 2 → 3️⃣ Phase 3 → 4️⃣ Phase 4
✅ แต่ละ Phase ให้ทำทีละ 1-2 feature → รวบรวม feedback → อัปเดต → Publish minor version
🔒 ทุก feature ที่เกี่ยวกับ process/execution ต้องมี timeout + error boundary เสมอ