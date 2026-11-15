require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const { LANGS, AGES, MODES, system, lessonTool, wrapupTool } = require('./lib/prompt');
const mock = require('./lib/mock');

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const HAS_KEY = !!process.env.ANTHROPIC_API_KEY;
const USE_MOCK = process.env.MOCK === '1' || !HAS_KEY;
const client = HAS_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const HOST = process.env.HOST || '127.0.0.1';
const IS_LOCAL = HOST === '127.0.0.1' || HOST === 'localhost';
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SECURE_COOKIE = process.env.NODE_ENV === 'production';
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT) || 200;       // 全站每天最多呼叫 AI 幾次
const HOURLY_PER_IP = Number(process.env.HOURLY_PER_IP) || 60;    // 每個來源每小時最多幾次
const SESSION_DAYS = 30;

// 對外開放卻沒設密碼 = 任何人都能刷你的金鑰，直接拒絕啟動
if (!IS_LOCAL && !ACCESS_CODE) {
  console.error('錯誤：對外開放（HOST 不是 127.0.0.1）時必須設定 ACCESS_CODE，否則任何人都能花你的 API 費用。');
  process.exit(1);
}
if (!IS_LOCAL && !process.env.SESSION_SECRET) {
  console.warn('提醒：未設定 SESSION_SECRET，每次重啟後大家都要重新登入。');
}

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// 兒童隱私：不記錄任何使用者輸入內容，只在出錯時印錯誤訊息

// ---------- 登入與限流 ----------
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}
function loggedIn(req) {
  if (!ACCESS_CODE) return true;
  const [exp, sig] = getCookie(req, 'kw_session').split('.');
  return !!(exp && sig && Number(exp) > Date.now() && safeEq(sig, sign(exp)));
}
function makeLimiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 60000).unref();
  return (key) => {
    const n = Date.now(); let h = hits.get(key);
    if (!h || h.reset < n) { h = { count: 0, reset: n + windowMs }; hits.set(key, h); }
    h.count++; return h.count <= max;
  };
}
const loginOk = makeLimiter(8, 10 * 60 * 1000);
const ipOk = makeLimiter(HOURLY_PER_IP, 60 * 60 * 1000);
let day = new Date().toDateString(), dayCount = 0;

app.post('/api/login', (req, res) => {
  if (!loginOk(req.ip)) return res.status(429).json({ error: '試太多次了，請 10 分鐘後再試。' });
  if (!ACCESS_CODE || !safeEq(String(req.body.code || ''), ACCESS_CODE)) return res.status(401).json({ error: '密碼不對喔。' });
  const exp = String(Date.now() + SESSION_DAYS * 86400000);
  res.setHeader('Set-Cookie', `kw_session=${exp}.${sign(exp)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${SECURE_COOKIE ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'kw_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/status', (req, res) => res.json({ mock: USE_MOCK, needLogin: !!ACCESS_CODE, loggedIn: loggedIn(req) }));

// 其餘 /api 都要登入，並套用用量上限
app.use('/api', (req, res, next) => {
  if (!loggedIn(req)) return res.status(401).json({ error: '請先輸入密碼。', needLogin: true });
  if (!ipOk(req.ip)) return res.status(429).json({ error: '今天用得有點多，休息一下再來喔。' });
  if (!USE_MOCK) {
    const d = new Date().toDateString();
    if (d !== day) { day = d; dayCount = 0; }
    if (++dayCount > DAILY_LIMIT) return res.status(429).json({ error: '今天的上課次數用完了，明天再來喔。' });
  }
  next();
});

const COLORS = ['black', 'blue', 'red', 'green', 'orange', 'purple', 'gray'];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function cleanElement(e) {
  if (!e || typeof e.type !== 'string') return null;
  const out = { type: e.type, color: COLORS.includes(e.color) ? e.color : 'black', fill: !!e.fill, dashed: !!e.dashed };
  ['x', 'y', 'x2', 'y2', 'w', 'h', 'r'].forEach((k) => { if (e[k] !== undefined) out[k] = num(e[k]); });
  if (Array.isArray(e.points)) {
    out.points = e.points.slice(0, 60).map((p) => [num(p[0]), num(p[1])]);
  }
  if (e.type === 'text') {
    out.text = String(e.text || '').slice(0, 40);
    out.size = Math.min(80, Math.max(28, num(e.size, 32)));
  }
  return out;
}

function cleanLesson(raw) {
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 40).map((s) => ({
    say: String(s.say || '').slice(0, 600),
    clear: !!s.clear,
    pause_for_student: !!s.pause_for_student,
    draw: (Array.isArray(s.draw) ? s.draw : []).slice(0, 30).map(cleanElement).filter(Boolean),
  })).filter((s) => s.say);
  return { title: String(raw.title || '小課堂').slice(0, 60), steps };
}

async function callTool(sys, content, tool) {
  // 部分新模型不支援強制 tool_choice，改用 auto，並在提示中要求一定要呼叫工具；沒呼叫就重試一次
  const hint = `\n\n務必呼叫 ${tool.name} 工具回覆，不要輸出其他文字。`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: sys + hint,
      tools: [tool],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content }],
    });
    const block = res.content.find((b) => b.type === 'tool_use');
    if (block) return block.input;
  }
  throw new Error('模型沒有回傳結構化內容');
}

function pick(body) {
  const mode = MODES[body.mode] ? body.mode : 'topic';
  const lang = LANGS[body.lang] ? body.lang : 'zh-TW';
  const age = AGES[body.age] ? body.age : 'mid';
  return { mode, lang, age };
}

// 開一堂新課：文字 + 圖片 + PDF/文字檔
app.post('/api/lesson', async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ mock: true, ...mock.lesson });
    const { mode, lang, age } = pick(req.body);
    const content = [];
    for (const f of (req.body.files || []).slice(0, 4)) {
      const t = String(f.mediaType || '');
      if (t.startsWith('image/')) {
        content.push({ type: 'image', source: { type: 'base64', media_type: t, data: f.data } });
      } else if (t === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: t, data: f.data } });
      } else if (t.startsWith('text/')) {
        content.push({ type: 'text', text: `【孩子上傳的文字檔】\n${Buffer.from(f.data, 'base64').toString('utf8').slice(0, 20000)}` });
      }
    }
    const q = String(req.body.question || '').slice(0, 2000);
    content.push({ type: 'text', text: `孩子的問題或想學的內容：${q || '（請依照上傳的內容開一堂課）'}` });
    const raw = await callTool(system(mode, lang, age), content, lessonTool);
    res.json(cleanLesson(raw));
  } catch (e) {
    console.error('[lesson]', e.message);
    res.status(500).json({ error: '老師剛剛卡住了，請再試一次。' });
  }
});

// 孩子打斷提問 / 回答老師的問題
app.post('/api/ask', async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ mock: true, ...mock.ask });
    const { mode, lang, age } = pick(req.body);
    const said = (Array.isArray(req.body.said) ? req.body.said : []).slice(-30).map((s) => String(s).slice(0, 300));
    const board = JSON.stringify(req.body.board || []).slice(0, 5000);
    const remaining = (Array.isArray(req.body.remaining) ? req.body.remaining : []).slice(0, 20).map((s) => String(s).slice(0, 200));
    const text =
      `課程標題：${String(req.body.title || '').slice(0, 60)}\n` +
      `到目前為止老師說過：\n${said.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n` +
      `白板上目前的內容（JSON）：${board}\n` +
      `原本還沒講的步驟大綱：${remaining.join(' / ') || '（沒有了）'}\n\n` +
      `孩子現在說：${String(req.body.question || '').slice(0, 1000)}\n\n` +
      '請換個方式回應孩子（若是回答你的問題就先評語再繼續），可以接著白板內容畫，也可以 clear 重畫。' +
      '回應後把原本還沒講完的重點用簡短步驟帶完。steps 控制在 3~8 步。';
    const raw = await callTool(system(mode, lang, age), [{ type: 'text', text }], lessonTool);
    res.json(cleanLesson(raw));
  } catch (e) {
    console.error('[ask]', e.message);
    res.status(500).json({ error: '老師剛剛卡住了，請再試一次。' });
  }
});

// 課後筆記與小測驗
app.post('/api/wrapup', async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ mock: true, ...mock.wrapup });
    const { lang, age } = pick(req.body);
    const said = (Array.isArray(req.body.said) ? req.body.said : []).slice(-60).map((s) => String(s).slice(0, 300));
    const text =
      `課程標題：${String(req.body.title || '').slice(0, 60)}\n老師講過的內容：\n${said.join('\n')}\n\n` +
      '請依這堂課整理 3~5 條重點筆記，並出 3 題選擇題（每題 3 個選項），語氣鼓勵、適合兒童。';
    const sys = `${system('topic', lang, age)}\n這次請改用 make_wrapup 工具回覆。`;
    const raw = await callTool(sys, [{ type: 'text', text }], wrapupTool);
    const quiz = (raw.quiz || []).slice(0, 5).map((q) => ({
      q: String(q.q || ''),
      options: (q.options || []).slice(0, 4).map(String),
      answer: Math.max(0, Math.min(num(q.answer), (q.options || []).length - 1)),
      explain: String(q.explain || ''),
    }));
    res.json({ notes: (raw.notes || []).slice(0, 6).map(String), quiz });
  } catch (e) {
    console.error('[wrapup]', e.message);
    res.status(500).json({ error: '筆記整理失敗，請再試一次。' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`小白板老師已啟動： http://localhost:${PORT}（監聽 ${HOST}）`);
  console.log(ACCESS_CODE ? '已啟用密碼保護' : '未設密碼（僅限本機使用）');
  console.log(USE_MOCK ? '目前是【示範模式】（沒有金鑰或 MOCK=1）' : `已連線 Claude，模型：${MODEL}`);
});
