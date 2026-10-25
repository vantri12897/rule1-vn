// Danh sách ngắn cho phân tích trend sâu: dùng đúng logic của website (index.html) qua trình duyệt không giao diện.
// Cách chạy (trong thư mục repo):  node tools/shortlist.mjs [số mã, mặc định 15]  → in JSON ra stdout
// Tiêu chí A: đủ điều kiện lọc, Big 5 ≥ 4 (tài chính 4/4), BBIT7 ≥ 3; xếp theo Giá/MOS R2 tăng dần (gần giá trị nhất trước).
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const N = +(process.argv[2] || 15), PORT = 8799;
const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(root + '/playwright/index.mjs');
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
let out = [];
try {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.route('**/*', r => { const u = r.request().url(); return u.startsWith(`http://localhost:${PORT}`) ? r.continue() : r.abort(); });
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => typeof rows !== 'undefined' && rows.length > 100 && !LOADING, null, { timeout: 60000 });
  out = await p.evaluate(n => rows.filter(a => a.eligible && a.score >= Math.min(4, a.maxScore) && a.b5s >= 3 && a.gapR2 != null)
    .sort((x, y) => x.gapR2 - y.gapR2).slice(0, n)
    .map(a => ({ t: a.ticker, name: a.s.name, exchange: a.exchange, sector: a.sector, financial: a.s.financial, price: a.price,
      big5: `${a.score}/${a.maxScore}`, bbit7: a.b5s, mosR1: a.mosR1 && Math.round(a.mosR1), mosR2: a.mosR2 && Math.round(a.mosR2),
      gapR1: a.gapR1 != null ? +(a.gapR1 * 100).toFixed(0) : null, gapR2: +(a.gapR2 * 100).toFixed(0), spike: !!a.niSpike,
      fscore: a.fsc, qProfit: a.qg ? { p: a.qg.p, yoy: a.qg.yoy } : null })), N);
  await b.close();
} finally { srv.kill(); }
console.log(JSON.stringify(out, null, 1));
