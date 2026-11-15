const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const HEX = { black: '#222', blue: '#2563eb', red: '#dc2626', green: '#16a34a', orange: '#ea580c', purple: '#7c3aed', gray: '#6b7280' };
const LANG_VOICE = { 'zh-TW': 'zh-TW', 'zh-CN': 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', vi: 'vi-VN', th: 'th-TH' };

const S = {
  mode: 'topic', title: '', queue: [], said: [], board: [],
  runId: 0, playing: false, paused: false, resumeFn: null,
  waitingStudent: false, files: [], busy: false,
};

// ---------- 小工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function tick(ms, id) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (id !== S.runId) return false;
    while (S.paused) { await new Promise((r) => (S.resumeFn = r)); if (id !== S.runId) return false; }
    await sleep(40);
  }
  return id === S.runId;
}
function ctx() { return { mode: S.mode, lang: $('lang').value, age: $('age').value }; }
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin(); throw new Error(j.error || '請先輸入密碼。'); }
  if (!r.ok) throw new Error(j.error || '連線失敗');
  return j;
}
function setStatus(t) { $('status').textContent = t || ''; }
function readB64(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// ---------- 首頁 ----------
function showLogin() { $('login').hidden = false; $('code').value = ''; $('loginErr').textContent = ''; setTimeout(() => $('code').focus(), 50); }
async function doLogin() {
  const code = $('code').value;
  if (!code) return;
  $('loginBtn').disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $('loginErr').textContent = j.error || '登入失敗'; $('code').select(); }
    else { $('login').hidden = true; }
  } catch (e) { $('loginErr').textContent = '連線失敗，請檢查網路'; }
  $('loginBtn').disabled = false;
}
$('loginBtn').addEventListener('click', doLogin);
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) doLogin(); });
fetch('/api/status').then((r) => r.json()).then((s) => { $('demoBanner').hidden = !s.mock; if (s.needLogin && !s.loggedIn) showLogin(); }).catch(() => {});

document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.mode').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); S.mode = b.dataset.mode;
  $('question').placeholder = S.mode === 'homework' ? '把作業題目打在這裡，或拍照上傳' : S.mode === 'exam' ? '例如：國語第三課要考什麼？' : '例如：為什麼天空是藍色的？';
}));
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { $('question').value = c.textContent; }));

async function addFile(input) {
  const f = input.files[0]; input.value = '';
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) { alert('檔案太大了，請選 10MB 以下的檔案'); return; }
  const mediaType = f.type || (f.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
  S.files = [{ name: f.name, mediaType, data: await readB64(f) }];
  $('fileName').textContent = '已選：' + f.name;
}
$('fileImg').addEventListener('change', (e) => addFile(e.target));
$('fileDoc').addEventListener('change', (e) => addFile(e.target));

$('startBtn').addEventListener('click', async () => {
  unlockTTS();
  const q = $('question').value.trim();
  if (!q && !S.files.length) { $('question').focus(); $('question').placeholder = '請先告訴老師你想學什麼喔'; return; }
  $('startBtn').disabled = true; $('startBtn').textContent = '老師準備中…';
  try {
    const lesson = await post('/api/lesson', { ...ctx(), question: q, files: S.files });
    startClass(lesson, q);
  } catch (e) { alert(e.message); }
  $('startBtn').disabled = false; $('startBtn').textContent = '開始上課 ▶';
});

$('homeBtn').addEventListener('click', () => {
  S.runId++; speechSynthesis.cancel();
  $('class').hidden = true; $('home').hidden = false;
  S.files = []; $('fileName').textContent = '';
});

// ---------- 上課 ----------
function startClass(lesson, q) {
  S.runId++; speechSynthesis.cancel();
  S.title = lesson.title; S.queue = lesson.steps.slice(); S.said = []; S.board = [];
  S.waitingStudent = false; S.paused = false; $('pauseBtn').textContent = '⏸ 暫停';
  $('layer').innerHTML = ''; $('chat').innerHTML = ''; $('wrapup').hidden = true;
  $('lessonTitle').textContent = lesson.title;
  $('home').hidden = true; $('class').hidden = false;
  if (q) addBubble('kid', q);
  play();
}

function addBubble(who, text) {
  const d = document.createElement('div');
  d.className = 'bubble ' + who; d.textContent = text;
  $('chat').appendChild(d); $('chat').scrollTop = $('chat').scrollHeight;
  return d;
}

async function play() {
  if (S.playing) return;
  S.playing = true;
  const id = ++S.runId;
  setStatus('');
  while (S.queue.length) {
    const step = S.queue.shift();
    const ok = await playStep(step, id);
    if (!ok) return;           // 被打斷，新的 play 會接手
    if (step.pause_for_student) {
      S.waitingStudent = true; setStatus('✋ 換你回答囉');
      S.playing = false; $('askInput').focus(); return;
    }
  }
  S.playing = false; finish();
}

async function playStep(step, id) {
  if (step.clear) { $('layer').innerHTML = ''; S.board = []; }
  const bubble = addBubble('teacher', '');
  S.said.push(step.say);

  const typing = (async () => {
    for (let i = 1; i <= step.say.length; i++) {
      bubble.textContent = step.say.slice(0, i);
      $('chat').scrollTop = $('chat').scrollHeight;
      if (!(await tick(28, id))) return false;
    }
    return true;
  })();
  const drawing = (async () => {
    for (const el of step.draw || []) {
      drawEl(el); S.board.push(el);
      if (!(await tick(650, id))) return false;
    }
    return true;
  })();
  const speaking = speak(step.say, id);

  const r = await Promise.all([typing, drawing, speaking]);
  if (id !== S.runId) return false;
  return (await tick(500, id)) && r.every((x) => x !== false);
}

// ---------- 朗讀 ----------
// iOS Safari 規定：朗讀必須在「使用者點擊」的當下啟動過一次，之後才允許在非點擊的時機朗讀
let ttsKeep = null; // 保留參照，避免某些瀏覽器在朗讀途中把語音物件回收
function normLang() { return (LANG_VOICE[$('lang').value] || 'zh-TW'); }
function pickVoice(lang) {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices();
  const l = lang.toLowerCase();
  const fix = (v) => v.lang.toLowerCase().replace('_', '-');
  return vs.find((v) => fix(v) === l) || vs.find((v) => fix(v).startsWith(l.slice(0, 2))) || null;
}
function unlockTTS() {
  if (!('speechSynthesis' in window) || !$('ttsOn').checked) return;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* 忽略 */ }
}
function speak(text, id) {
  return new Promise((resolve) => {
    if (!$('ttsOn').checked || !('speechSynthesis' in window)) return resolve(true);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = normLang();
    const v = pickVoice(u.lang); if (v) u.voice = v;
    u.rate = $('age').value === 'low' ? 0.85 : 0.95;
    u.onend = () => resolve(true);
    u.onerror = (e) => {
      if (e && (e.error === 'not-allowed' || e.error === 'synthesis-failed')) setStatus('🔇 朗讀被擋住了：請把手機靜音關掉，再按一次「朗讀」開關');
      resolve(true);
    };
    ttsKeep = u;
    speechSynthesis.speak(u);
    setTimeout(() => resolve(true), 30000);
  });
}

// ---------- 畫圖 ----------
function mk(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function drawEl(el) {
  const c = HEX[el.color] || HEX.black;
  const x = clamp(el.x || 0, 0, 1000), y = clamp(el.y || 0, 0, 600);
  const base = { stroke: c, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' };
  if (el.dashed) base['stroke-dasharray'] = '14 10';
  const fillAttrs = el.fill ? { fill: c, 'fill-opacity': 0.25 } : {};
  let n;
  switch (el.type) {
    case 'line': case 'arrow':
      n = mk('line', { ...base, x1: x, y1: y, x2: clamp(el.x2 || 0, 0, 1000), y2: clamp(el.y2 || 0, 0, 600) });
      if (el.type === 'arrow') n.setAttribute('marker-end', 'url(#arrowhead)');
      break;
    case 'rect': n = mk('rect', { ...base, ...fillAttrs, x, y, width: clamp(el.w || 50, 1, 1000), height: clamp(el.h || 50, 1, 600), rx: 8 }); break;
    case 'circle': n = mk('circle', { ...base, ...fillAttrs, cx: x, cy: y, r: clamp(el.r || 30, 1, 400) }); break;
    case 'ellipse': n = mk('ellipse', { ...base, ...fillAttrs, cx: x, cy: y, rx: clamp((el.w || 100) / 2, 1, 500), ry: clamp((el.h || 60) / 2, 1, 300) }); break;
    case 'polygon': case 'polyline':
      n = mk(el.type, { ...base, ...(el.type === 'polygon' ? fillAttrs : {}), points: (el.points || []).map((p) => `${clamp(p[0], 0, 1000)},${clamp(p[1], 0, 600)}`).join(' ') });
      break;
    case 'text': {
      // 手機上白板會縮小，字要放大到實際約 17px 以上；並把文字夾在畫布內，避免被切掉
      const bw = $('board').getBoundingClientRect().width || 1000;
      const fs = Math.min(90, Math.max(clamp(el.size || 32, 28, 80), Math.round((17 * 1000) / bw)));
      const half = ((el.text || '').length * fs) / 2;
      const tx = clamp(x, Math.min(half + 12, 500), Math.max(1000 - half - 12, 500));
      n = mk('text', { x: tx, y, 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 700, fill: c, style: 'font-family:inherit;white-space:pre' });
      n.textContent = el.text || '';
      break; }
    default: return;
  }
  $('layer').appendChild(n);
  // 動畫：線條描繪、文字淡入
  if (el.type === 'text' || el.fill) {
    n.style.opacity = 0; n.getBoundingClientRect(); n.style.transition = 'opacity .6s'; n.style.opacity = 1;
    if (el.fill && el.type !== 'text') { n.style.strokeDasharray = ''; }
  }
  if (el.type !== 'text' && n.getTotalLength) {
    const len = n.getTotalLength();
    if (!el.dashed) {
      n.style.strokeDasharray = len; n.style.strokeDashoffset = len;
      n.getBoundingClientRect();
      n.style.transition = 'stroke-dashoffset .7s ease'; n.style.strokeDashoffset = 0;
    }
  }
}

// ---------- 控制與提問 ----------
$('pauseBtn').addEventListener('click', () => {
  S.paused = !S.paused;
  $('pauseBtn').textContent = S.paused ? '▶ 繼續' : '⏸ 暫停';
  if (S.paused) speechSynthesis.pause(); else { speechSynthesis.resume(); if (S.resumeFn) S.resumeFn(); }
});
$('skipBtn').addEventListener('click', () => {
  // 跳過目前步驟：直接重新播放剩下的
  if (!S.queue.length) return;
  S.runId++; S.playing = false; speechSynthesis.cancel(); S.paused = false; $('pauseBtn').textContent = '⏸ 暫停';
  if (S.resumeFn) S.resumeFn();
  play();
});
$('ttsOn').addEventListener('change', () => {
  if (!('speechSynthesis' in window)) { alert('這個瀏覽器不支援朗讀'); $('ttsOn').checked = false; return; }
  speechSynthesis.cancel();
  if (!$('ttsOn').checked) return;
  const msgs = { 'zh-TW': '朗讀開啟了', 'zh-CN': '朗读开启了', en: 'Read aloud is on', ja: '読み上げをオンにしました', ko: '읽어주기를 켰어요', es: 'Lectura activada', fr: 'Lecture activée', de: 'Vorlesen ist an', vi: 'Đã bật đọc to', th: 'เปิดการอ่านออกเสียงแล้ว' };
  const u = new SpeechSynthesisUtterance(msgs[$('lang').value] || msgs['zh-TW']);
  u.lang = normLang(); const v = pickVoice(u.lang); if (v) u.voice = v;
  ttsKeep = u; speechSynthesis.speak(u);
});

async function ask() {
  unlockTTS();
  const q = $('askInput').value.trim();
  if (!q || S.busy) return;
  S.busy = true; $('askBtn').disabled = true; $('askInput').value = '';
  S.runId++; S.playing = false; speechSynthesis.cancel(); S.paused = false; $('pauseBtn').textContent = '⏸ 暫停';
  if (S.resumeFn) S.resumeFn();
  addBubble('kid', q); setStatus('老師想一想…');
  const remaining = S.queue.map((s) => s.say);
  try {
    const r = await post('/api/ask', { ...ctx(), title: S.title, said: S.said, board: S.board, remaining, question: q });
    S.queue = r.steps; S.waitingStudent = false;
    play();
  } catch (e) { addBubble('teacher', '😅 ' + e.message); setStatus(''); }
  S.busy = false; $('askBtn').disabled = false;
}
$('askBtn').addEventListener('click', ask);
$('askInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) ask(); });

// ---------- 課後筆記與小測驗 ----------
async function finish() {
  setStatus('✅ 這堂課講完囉');
  const box = $('wrapup'); box.hidden = false; box.innerHTML = '<h3>📒 整理筆記中…</h3>';
  try {
    const r = await post('/api/wrapup', { ...ctx(), title: S.title, said: S.said });
    renderWrapup(r);
  } catch (e) { box.innerHTML = '<h3>筆記整理失敗</h3><button class="btn" id="retryWrap">再試一次</button>'; $('retryWrap').onclick = finish; }
}

function renderWrapup(r) {
  const box = $('wrapup'); box.innerHTML = '';
  const h = document.createElement('h3'); h.textContent = '📒 今天學到'; box.appendChild(h);
  const ul = document.createElement('ul');
  r.notes.forEach((n) => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
  box.appendChild(ul);
  const h2 = document.createElement('h3'); h2.textContent = '🎯 小測驗'; box.appendChild(h2);
  r.quiz.forEach((q, qi) => {
    const wrap = document.createElement('div'); wrap.className = 'q';
    const qt = document.createElement('div'); qt.className = 'qt'; qt.textContent = `${qi + 1}. ${q.q}`; wrap.appendChild(qt);
    const exp = document.createElement('div'); exp.className = 'exp'; exp.hidden = true; exp.textContent = q.explain;
    q.options.forEach((o, oi) => {
      const b = document.createElement('button'); b.className = 'opt'; b.textContent = o;
      b.onclick = () => {
        wrap.querySelectorAll('.opt').forEach((x, i) => { x.disabled = true; if (i === q.answer) x.classList.add('right'); });
        if (oi !== q.answer) b.classList.add('wrong');
        exp.textContent = (oi === q.answer ? '🎉 答對了！' : '再看一次～') + q.explain; exp.hidden = false;
      };
      wrap.appendChild(b);
    });
    wrap.appendChild(exp); box.appendChild(wrap);
  });
}

if ('speechSynthesis' in window) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); }
