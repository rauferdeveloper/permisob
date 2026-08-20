const $ = (s, e = document) => e.querySelector(s);
const app = $('#app');
const LS = 'aeolB_v1';
const SYNC_LS = 'aeolB_syncKey';
const API_BASE = String(window.AEOL_CONFIG?.API_BASE || '').replace(/\/$/, '');

let QUESTIONS = [];
let TOPICS = [];
let state = { view: 'home', test: null, attemptId: null };
let syncMeta = { busy: false, lastOk: 0, error: '' };
let syncTimer = null;

function normalizeStore(x) {
  x = x && typeof x === 'object' ? x : {};
  return {
    history: Array.isArray(x.history) ? x.history : [],
    current: x.current || null,
    currentUpdatedAt: Number(x.currentUpdatedAt) || Number(x.current?.updatedAt) || Number(x.updatedAt) || Date.now(),
    updatedAt: Number(x.updatedAt) || Date.now(),
    historyClearedAt: Number(x.historyClearedAt) || 0
  };
}
function loadStore() { try { return normalizeStore(JSON.parse(localStorage.getItem(LS))); } catch { return normalizeStore(null); } }
function saveStore(s, opts = {}) { s.updatedAt = Date.now(); localStorage.setItem(LS, JSON.stringify(s)); if (!opts.noSync) scheduleSync(); }
let store = loadStore();
function getSyncKey() { return localStorage.getItem(SYNC_LS) || ''; }
function setSyncKey(v) { if (v) localStorage.setItem(SYNC_LS, v); else localStorage.removeItem(SYNC_LS); }

function esc(s = '') { return String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
function toast(t) { const x = $('#toast'); x.textContent = t; x.classList.add('show'); setTimeout(() => x.classList.remove('show'), 1800); }
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function status(wrong) { return wrong === 0 ? 'green' : wrong <= 3 ? 'yellow' : 'red'; }
function questionById(id) { return QUESTIONS.find(q => q.id === id); }
function syncConfigured() { return !!API_BASE; }
function recTime(r) { const t = Date.parse(r?.date || ''); return Number.isFinite(t) ? t : (Number(r?.id) || 0); }

function mergeStores(a, b) {
  a = normalizeStore(a); b = normalizeStore(b);
  const clearedAt = Math.max(a.historyClearedAt || 0, b.historyClearedAt || 0);
  const m = new Map();
  for (const r of [...a.history, ...b.history]) {
    if (recTime(r) <= clearedAt) continue;
    const k = String(r.id ?? `${r.date}|${r.mode}|${r.key}|${r.total}|${r.wrong}`);
    const old = m.get(k);
    if (!old || recTime(r) >= recTime(old)) m.set(k, r);
  }
  const cat = Number(a.currentUpdatedAt) || 0, cbt = Number(b.currentUpdatedAt) || 0;
  return {
    history: [...m.values()].sort((x, y) => recTime(x) - recTime(y)),
    current: cat >= cbt ? (a.current || null) : (b.current || null),
    currentUpdatedAt: Math.max(cat, cbt),
    historyClearedAt: clearedAt,
    updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0, Date.now())
  };
}
async function syncApi(path, opts = {}) {
  if (!API_BASE) throw new Error('Falta configurar API_BASE en config.js');
  const key = getSyncKey();
  const headers = { 'Content-Type': 'application/json', ...(opts.auth === false ? {} : { Authorization: `Bearer ${key}` }), ...(opts.headers || {}) };
  const r = await fetch(API_BASE + path, { ...opts, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || data.detail || `HTTP ${r.status}`);
  return data;
}
function scheduleSync() { if (!getSyncKey() || !syncConfigured()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(true), 900); }
async function syncNow(silent = false) {
  if (syncMeta.busy || !getSyncKey() || !syncConfigured()) return;
  syncMeta.busy = true; syncMeta.error = '';
  try {
    const remote = await syncApi('/api/state');
    store = mergeStores(store, remote.state); saveStore(store, { noSync: true });
    const pushed = await syncApi('/api/state', { method: 'PUT', body: JSON.stringify({ state: store }) });
    store = normalizeStore(pushed.state); saveStore(store, { noSync: true });
    syncMeta.lastOk = Date.now();
    if (!silent) toast('Progreso sincronizado');
    if (['home', 'stats', 'sync', 'attempt'].includes(state.view)) render();
  } catch (e) { syncMeta.error = e.message; if (!silent) toast('No se pudo sincronizar'); }
  finally { syncMeta.busy = false; }
}
function newSyncKey() { const a = new Uint8Array(32); crypto.getRandomValues(a); const b = btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return 'aeol_' + b; }
async function createSync() {
  if (!syncConfigured()) return toast('Configura API_BASE primero');
  const token = newSyncKey();
  try {
    syncMeta.busy = true;
    await syncApi('/api/register', { method: 'POST', auth: false, body: JSON.stringify({ token }) });
    setSyncKey(token);
    await syncApi('/api/state', { method: 'PUT', body: JSON.stringify({ state: store }) });
    syncMeta.lastOk = Date.now(); state.view = 'sync'; render();
    setTimeout(() => { const el = $('#newSyncKey'); if (el) el.textContent = token; }, 0);
  } catch (e) { syncMeta.error = e.message; toast('Error creando sincronizacion'); }
  finally { syncMeta.busy = false; }
}
async function linkSync() {
  const token = ($('#syncKeyInput')?.value || '').trim();
  if (!token) return toast('Pega tu clave de sincronizacion');
  if (!syncConfigured()) return toast('Configura API_BASE primero');
  const previous = getSyncKey(); setSyncKey(token);
  try {
    syncMeta.busy = true;
    const remote = await syncApi('/api/state');
    store = mergeStores(store, remote.state); saveStore(store, { noSync: true });
    const pushed = await syncApi('/api/state', { method: 'PUT', body: JSON.stringify({ state: store }) });
    store = normalizeStore(pushed.state); saveStore(store, { noSync: true });
    syncMeta.lastOk = Date.now(); state.view = 'sync'; render(); toast('Dispositivo vinculado');
  } catch (e) { setSyncKey(previous); syncMeta.error = e.message; toast('Clave no valida o error de conexion'); }
  finally { syncMeta.busy = false; }
}

function syncView() {
  const key = getSyncKey(), configured = syncConfigured();
  return `<div class="row"><button class="secondary" data-go="home">← Inicio</button></div>
  <article class="card sync-card"><span class="badge">Sincronizacion entre dispositivos</span><h1>${key ? 'Sincronizacion activa' : 'Conecta tu progreso'}</h1>
  <p class="muted">La web guarda una copia local y, al vincular una clave, sincroniza historial, fallos y test en curso.</p>
  ${!configured ? `<div class="warning-box"><b>Falta un paso:</b> configura <span class="mono">API_BASE</span> en <span class="mono">config.js</span>.</div>` : ''}
  ${key ? `<div class="sync-state"><span class="sync-dot ${syncMeta.error ? 'err' : 'on'}"></span><b>${syncMeta.error ? 'Con error' : 'Vinculado'}</b><span class="muted small">${syncMeta.lastOk ? 'Ultima sincronizacion: ' + new Date(syncMeta.lastOk).toLocaleString('es-ES') : 'Sincronizacion pendiente'}</span></div>
  <div class="sync-key">${esc(key)}</div><div class="sync-actions"><button class="primary" data-action="sync-now">Sincronizar ahora</button><button class="secondary" data-action="copy-key">Copiar clave</button><button class="danger" data-action="unlink-sync">Desvincular este dispositivo</button></div>` :
  `<div class="success-box"><b>Primera vez:</b> crea una clave para subir tu progreso actual.</div><div class="sync-actions"><button class="primary" data-action="create-sync">Crear sincronizacion</button></div>
  <hr class="sep"><h2>Ya tengo una clave</h2><div class="form-row"><label for="syncKeyInput"><b>Clave de sincronizacion</b></label><input id="syncKeyInput" autocomplete="off" placeholder="aeol_..."></div><button class="primary" data-action="link-sync">Vincular este dispositivo</button>`}
  <div id="newKeyBox" style="margin-top:14px"><span id="newSyncKey"></span></div></article>`;
}

function completedHistory() { return store.history.filter(x => x.completed); }
function stats() {
  const h = completedHistory();
  const answered = h.reduce((a, x) => a + Number(x.total || 0), 0);
  const correct = h.reduce((a, x) => a + Number(x.correct || 0), 0);
  const wrong = answered - correct;
  return { attempts: h.length, accuracy: answered ? correct / answered * 100 : 0, avg30: answered ? wrong / answered * 30 : 0, best: h.length ? Math.min(...h.map(x => x.wrong / x.total * 30)) : null };
}

// Banco de fallos: conserva el historial, pero considera pendiente una pregunta si su resultado más reciente conocido fue incorrecto.
function failureLedger() {
  const m = new Map();
  const history = [...completedHistory()].sort((a, b) => recTime(a) - recTime(b));
  for (const rec of history) {
    if (Array.isArray(rec.results) && rec.results.length) {
      for (const r of rec.results) {
        const qid = r.id;
        if (!qid) continue;
        const old = m.get(qid) || { id: qid, failCount: 0, seenCount: 0, lastCorrect: null, lastFailTitle: '', lastFailDate: '', lastAttemptId: '' };
        old.seenCount++;
        old.lastCorrect = !!r.correct;
        old.lastDate = rec.date;
        old.lastTitle = rec.title;
        old.lastAttemptId = rec.id;
        old.lastChoice = r.choice || '';
        if (!r.correct) { old.failCount++; old.lastFailTitle = rec.title; old.lastFailDate = rec.date; old.lastFailAttemptId = rec.id; }
        m.set(qid, old);
      }
    } else {
      for (const qid of (rec.wrongIds || [])) {
        const old = m.get(qid) || { id: qid, failCount: 0, seenCount: 0, lastCorrect: null, lastFailTitle: '', lastFailDate: '', lastAttemptId: '' };
        old.failCount++; old.seenCount++; old.lastCorrect = false; old.lastDate = rec.date; old.lastTitle = rec.title; old.lastAttemptId = rec.id; old.lastFailTitle = rec.title; old.lastFailDate = rec.date; old.lastFailAttemptId = rec.id;
        m.set(qid, old);
      }
    }
  }
  return m;
}
function pendingMistakes() { return [...failureLedger().values()].filter(x => x.lastCorrect === false && questionById(x.id)); }
function everMistakes() { return [...failureLedger().values()].filter(x => x.failCount > 0 && questionById(x.id)); }
function attemptWrongRows(rec) {
  if (!rec) return [];
  if (Array.isArray(rec.results) && rec.results.length) {
    return rec.results.filter(r => !r.correct).map(r => ({ q: questionById(r.id), choice: r.choice || '', correct: r.correctAnswer || questionById(r.id)?.correct || '' })).filter(x => x.q);
  }
  return (rec.wrongIds || []).map(id => ({ q: questionById(id), choice: '', correct: questionById(id)?.correct || '' })).filter(x => x.q);
}

function go(view) { state.view = view; state.test = null; state.attemptId = null; render(); }
function home() {
  const s = stats(), pending = pendingMistakes().length, ever = everMistakes().length;
  return `<section class="hero"><h1>Practica el permiso B</h1><p>2.640 preguntas AEOL: los mismos 18 temas del PDF, los 88 simulacros originales y un repaso inteligente de tus fallos.</p></section>
  <div class="kpis"><div class="kpi"><span>Intentos</span><strong>${s.attempts}</strong></div><div class="kpi"><span>Acierto global</span><strong>${s.accuracy.toFixed(1)}%</strong></div><div class="kpi"><span>Media fallos / 30</span><strong>${s.avg30.toFixed(2)}</strong></div><div class="kpi"><span>Falladas pendientes</span><strong>${pending}</strong></div></div>
  <div class="grid grid-3"><article class="card mode-card" data-action="topics"><span class="badge">Modo estudio</span><h2>Por temas</h2><p>Los 18 temas coinciden exactamente con el PDF. Elige 10, 20, 30, 50 o todas.</p></article>
  <article class="card mode-card" data-action="sims"><span class="badge">Modo examen</span><h2>88 simulacros</h2><p>Los 30 enunciados originales, en su orden y con resultado verde/amarillo/rojo.</p></article>
  <article class="card mode-card mistake-mode ${pending ? '' : 'disabled-card'}" data-action="mistakes"><span class="badge badge-warn">Repaso inteligente</span><h2>Falladas</h2><p>${pending ? `Tienes <b>${pending}</b> preguntas pendientes (${ever} falladas alguna vez). Practica solo esas.` : 'Cuando falles preguntas aparecerán aquí para repasarlas después.'}</p></article></div>
  ${store.current ? `<article class="card resume"><div class="row"><div><b>Hay un test en curso</b><div class="muted small">${esc(store.current.title)} · pregunta ${store.current.index + 1}/${store.current.ids.length}</div></div><span class="spacer"></span><button class="primary" data-action="resume">Continuar</button></div></article>` : ''}
  <p class="footer-note">${getSyncKey() ? 'Progreso local + sincronizacion remota activada.' : 'El progreso se guarda localmente. Pulsa Sincronizar para compartirlo entre móvil y PC.'}</p>`;
}
function topicsView() {
  return `<div class="row"><button class="secondary" data-go="home">← Inicio</button></div><h1 class="section-title">Practicar por temas</h1><p class="muted">Misma clasificación que el PDF: 18 temas y 2.640 preguntas en total.</p><input id="topicSearch" class="search" placeholder="Buscar tema…" />
  <div id="topicsList" class="topic-list">${TOPICS.map(t => `<button class="topic" data-topic="${t.id}"><span class="topic-code">${t.id}</span><b>${esc(t.name)}</b><span class="muted small">${esc(t.description)}</span><br><span class="badge">${t.count} preguntas</span></button>`).join('')}</div>`;
}
function simsView() {
  return `<div class="row"><button class="secondary" data-go="home">← Inicio</button></div><h1 class="section-title">88 simulacros originales</h1><p class="muted">Cada uno conserva sus 30 preguntas y su número original.</p><div class="sim-list">${Array.from({ length: 88 }, (_, i) => i + 1).map(n => {
    const attempts = completedHistory().filter(x => x.mode === 'sim' && Number(x.key) === n); const last = attempts.at(-1);
    return `<button class="sim" data-sim="${n}"><b>Simulacro ${n}</b><span class="badge">30 preguntas</span>${last ? `<div class="small muted" style="margin-top:7px">Último: ${last.wrong} fallos · ${last.accuracy.toFixed(0)}%</div>` : ''}</button>`;
  }).join('')}</div>`;
}
function topicSetup(id) {
  const t = TOPICS.find(x => x.id === id);
  return `<div class="row"><button class="secondary" data-action="topics">← Temas</button></div><article class="card"><span class="badge">${t.count} preguntas disponibles</span><h1>${t.id} · ${esc(t.name)}</h1><p class="muted">${esc(t.description)}</p><div class="controls"><label>Número de preguntas <select id="topicCount">${[10, 20, 30, 50].filter(n => n < t.count).map(n => `<option>${n}</option>`).join('')}<option value="all">Todas (${t.count})</option></select></label><button class="primary" data-start-topic="${id}">Empezar</button></div></article>`;
}
function mistakesView() {
  const pending = pendingMistakes().sort((a, b) => b.failCount - a.failCount || recTime({date:b.lastFailDate}) - recTime({date:a.lastFailDate}));
  const ever = everMistakes();
  const byTopic = TOPICS.map(t => ({ t, rows: pending.filter(x => questionById(x.id)?.topicId === t.id) })).filter(x => x.rows.length);
  return `<div class="row"><button class="secondary" data-go="home">← Inicio</button><span class="spacer"></span><button class="secondary" data-go="stats">Ver historial</button></div>
  <h1 class="section-title">Preguntas falladas</h1><p class="muted">Aquí aparecen las preguntas cuyo <b>último resultado conocido es un fallo</b>. Si luego las aciertas, dejan de estar pendientes, pero el historial anterior no se borra.</p>
  <div class="kpis kpis-3"><div class="kpi"><span>Pendientes</span><strong>${pending.length}</strong></div><div class="kpi"><span>Falladas alguna vez</span><strong>${ever.length}</strong></div><div class="kpi"><span>Temas con pendientes</span><strong>${byTopic.length}</strong></div></div>
  ${pending.length ? `<article class="card" style="margin-top:18px"><h2>Practicar solo las pendientes</h2><div class="controls"><label>Número <select id="mistakeCount">${[10,20,30,50].filter(n=>n<pending.length).map(n=>`<option>${n}</option>`).join('')}<option value="all">Todas (${pending.length})</option></select></label><button class="primary" data-action="start-mistakes">Empezar repaso</button></div></article>
  <h2 class="section-title">Pendientes por tema</h2><div class="topic-list">${byTopic.map(({t,rows})=>`<button class="topic" data-mistake-topic="${t.id}"><span class="topic-code">${t.id}</span><b>${esc(t.name)}</b><span class="badge badge-warn">${rows.length} pendientes</span></button>`).join('')}</div>
  <article class="card" style="margin-top:18px"><h2>Detalle de fallos pendientes</h2><div class="mistake-table-wrap"><table class="history mistake-table"><thead><tr><th>Original</th><th>Tema</th><th>Pregunta</th><th>Veces</th><th>Último fallo</th></tr></thead><tbody>${pending.map(x=>{const q=questionById(x.id);return `<tr><td><b>S${String(q.sim).padStart(2,'0')} · P${String(q.num).padStart(2,'0')}</b></td><td>${q.topicId}</td><td>${esc(q.question)}</td><td>${x.failCount}</td><td>${esc(x.lastFailTitle||'—')}</td></tr>`}).join('')}</tbody></table></div></article>` : `<div class="card empty" style="margin-top:18px">No tienes preguntas pendientes. Cuando falles alguna aparecerá aquí.</div>`}`;
}

function startTest(ids, meta) { state.test = { ...meta, ids, index: 0, answers: {}, startedAt: Date.now() }; persistCurrent(); renderTest(); }
function persistCurrent() { const now = Date.now(); if (state.test) state.test.updatedAt = now; store.current = state.test ? { ...state.test } : null; store.currentUpdatedAt = now; saveStore(store); }
function resume() { if (!store.current) return; state.test = store.current; state.view = 'test'; renderTest(); }
function renderTest() {
  const t = state.test; if (!t) return go('home'); state.view = 'test';
  const q = questionById(t.ids[t.index]); if (!q) return toast('Pregunta no encontrada');
  const ans = t.answers[q.id]; const pct = ((t.index + (ans ? 1 : 0)) / t.ids.length * 100);
  app.innerHTML = `<div class="test-shell"><div class="test-head"><div class="test-title"><h1>${esc(t.title)}</h1><p>${t.index + 1} de ${t.ids.length} · Simulacro ${q.sim}, pregunta ${q.num}</p></div><div class="row"><button class="secondary" data-action="quit">Salir</button><button class="danger" data-action="restart">Reiniciar</button></div></div>
  <div class="progress"><div style="width:${pct}%"></div></div><article class="card question-card"><div class="q-meta"><span class="badge">S${String(q.sim).padStart(2,'0')} · P${String(q.num).padStart(2,'0')}</span><span class="badge">${q.topicId}</span><span class="badge">${esc(q.topicName)}</span></div><h2 class="q-title">${esc(q.question)}</h2>
  ${q.image ? `<img class="q-image" src="${q.image}" alt="Imagen asociada a la pregunta ${q.num}" loading="eager">` : ''}
  <div class="options">${q.options.map(o => { let cls = 'option'; if (ans) { if (o.key === q.correct) cls += ' correct'; else if (o.key === ans.choice) cls += ' wrong'; } return `<button class="${cls}" data-choice="${o.key}" ${ans ? 'disabled' : ''}><span class="opt-key">${o.key}</span><span>${esc(o.text)}</span></button>`; }).join('')}</div>${ans ? feedback(q, ans) : ''}</article>
  ${ans ? `<div class="next-row"><span class="muted small">${ans.correct ? 'Correcta' : 'Fallada'} · La correcta queda marcada en verde.</span><button class="primary" data-action="next">${t.index === t.ids.length - 1 ? 'Ver resultado' : 'Siguiente →'}</button></div>` : ''}</div>`;
}
function feedback(q, a) { return `<div class="feedback ${a.correct ? 'ok' : 'bad'}"><b>${a.correct ? '✓ Correcto' : '✕ Incorrecto'}</b>${!a.correct ? ` · Correcta: ${q.correct}` : ''}${q.explanation ? `<div class="explain">${esc(q.explanation)}</div>` : ''}</div>`; }
function answer(choice) { const t = state.test, q = questionById(t.ids[t.index]); if (t.answers[q.id]) return; t.answers[q.id] = { choice, correct: choice === q.correct }; persistCurrent(); renderTest(); }
function next() { const t = state.test; if (t.index >= t.ids.length - 1) return finish(); t.index++; persistCurrent(); renderTest(); }
function finish() {
  const t = state.test;
  const rows = t.ids.map(id => ({ q: questionById(id), a: t.answers[id] })).filter(x => x.q);
  const correct = rows.filter(x => x.a?.correct).length, total = rows.length, wrong = total - correct, accuracy = total ? correct / total * 100 : 0;
  const rec = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, date: new Date().toISOString(), completed: true,
    mode: t.mode, key: String(t.key), title: t.title, total, correct, wrong, accuracy,
    wrongIds: rows.filter(x => !x.a?.correct).map(x => x.q.id),
    results: rows.map(x => ({ id: x.q.id, choice: x.a?.choice || '', correct: !!x.a?.correct, correctAnswer: x.q.correct, sim: x.q.sim, num: x.q.num, topicId: x.q.topicId }))
  };
  store.history.push(rec); store.current = null; store.currentUpdatedAt = Date.now(); saveStore(store); state.test = null; state.view = 'result';
  const st = status(wrong), wrongRows = rows.filter(x => !x.a?.correct);
  app.innerHTML = `<div class="test-shell"><article class="card result-hero"><div class="score-circle status-${st}">${wrong}<small style="font-size:13px"> fallos</small></div><h1>${esc(t.title)}</h1><p><b>${correct}/${total}</b> correctas · ${accuracy.toFixed(1)}% de acierto</p><p class="muted">${wrong === 0 ? 'Perfecto: 0 fallos.' : wrong <= 3 ? 'Buen rango: entre 1 y 3 fallos.' : 'Más de 3 fallos: conviene repasar este bloque.'}</p><div class="controls center-controls"><button class="primary" data-action="repeat-last" data-mode="${t.mode}" data-key="${esc(t.key)}">Repetir</button>${wrong ? `<button class="secondary" data-review-ids="${wrongRows.map(x=>x.q.id).join(',')}">Solo estas ${wrong} falladas</button>` : ''}<button class="secondary" data-go="home">Inicio</button></div></article>
  ${wrong ? `<h2 class="section-title">Preguntas falladas</h2><div class="mistakes">${wrongRows.map(x => `<div class="mistake"><div class="row"><b>S${String(x.q.sim).padStart(2,'0')} · P${String(x.q.num).padStart(2,'0')}</b><span class="badge">${x.q.topicId}</span></div><div>${esc(x.q.question)}</div><div class="small" style="margin-top:5px">Tu respuesta: ${x.a?.choice || '—'} · Correcta: <b>${x.q.correct}</b></div></div>`).join('')}</div>` : ''}</div>`;
}
function restart() { if (!state.test) return; if (!confirm('¿Reiniciar este test? Tus intentos anteriores seguirán guardados.')) return; state.test.index = 0; state.test.answers = {}; state.test.startedAt = Date.now(); persistCurrent(); renderTest(); toast('Test reiniciado'); }

function attemptView(id) {
  const rec = completedHistory().find(x => String(x.id) === String(id));
  if (!rec) return `<div class="row"><button class="secondary" data-go="stats">← Progreso</button></div><div class="card empty">Intento no encontrado.</div>`;
  const wrongRows = attemptWrongRows(rec);
  return `<div class="row"><button class="secondary" data-go="stats">← Progreso</button></div><article class="card attempt-head"><span class="badge status-${status(rec.wrong)}">${rec.wrong} fallos</span><h1>${esc(rec.title)}</h1><p class="muted">${new Date(rec.date).toLocaleString('es-ES')} · ${rec.correct}/${rec.total} correctas · ${Number(rec.accuracy).toFixed(1)}%</p>${wrongRows.length ? `<button class="primary" data-review-ids="${wrongRows.map(x=>x.q.id).join(',')}">Hacer solo estas ${wrongRows.length} falladas</button>` : ''}</article>
  <h2 class="section-title">Fallos de este intento</h2>${wrongRows.length ? `<div class="mistakes">${wrongRows.map(x=>`<div class="mistake"><div class="row"><b>Simulacro ${x.q.sim} · Pregunta ${x.q.num}</b><span class="badge">${x.q.topicId}</span><span class="badge">${esc(x.q.topicName)}</span></div><div class="mistake-question">${esc(x.q.question)}</div><div class="small">${x.choice ? `Tu respuesta: <b>${esc(x.choice)}</b> · ` : ''}Correcta: <b>${esc(x.correct)}</b></div></div>`).join('')}</div>` : '<div class="card empty">0 fallos en este intento.</div>'}`;
}
function statsView() {
  const s = stats(), h = [...completedHistory()].reverse(), pending = pendingMistakes();
  return `<div class="row"><button class="secondary" data-go="home">← Inicio</button><span class="spacer"></span>${pending.length ? `<button class="primary" data-action="mistakes">Repasar ${pending.length} falladas</button>` : ''}${h.length ? '<button class="danger" data-action="clear-history">Borrar historial</button>' : ''}</div>
  <h1 class="section-title">Tu progreso</h1><div class="kpis"><div class="kpi"><span>Tests completados</span><strong>${s.attempts}</strong></div><div class="kpi"><span>Acierto global</span><strong>${s.accuracy.toFixed(1)}%</strong></div><div class="kpi"><span>Media fallos / 30</span><strong>${s.avg30.toFixed(2)}</strong></div><div class="kpi"><span>Falladas pendientes</span><strong>${pending.length}</strong></div></div>
  <article class="card" style="margin-top:18px"><h2>Historial</h2>${h.length ? `<div class="history-wrap"><table class="history"><thead><tr><th>Fecha</th><th>Test</th><th>Acierto</th><th>Fallos</th><th></th></tr></thead><tbody>${h.map(x => `<tr><td>${new Date(x.date).toLocaleDateString('es-ES')}</td><td>${esc(x.title)}</td><td>${Number(x.accuracy).toFixed(1)}%</td><td><span class="badge status-${status(x.wrong)}">${x.wrong}</span></td><td><button class="mini-btn" data-attempt="${esc(x.id)}">${x.wrong ? 'Ver fallos' : 'Ver'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aún no has terminado ningún test.</div>'}</article>
  <p class="footer-note">Pulsa “Ver fallos” para saber exactamente qué pregunta original fallaste, en qué intento y cuál era la correcta. La media /30 normaliza todos los intentos.</p>`;
}

function render() {
  if (state.view === 'home') app.innerHTML = home();
  else if (state.view === 'topics') app.innerHTML = topicsView();
  else if (state.view === 'sims') app.innerHTML = simsView();
  else if (state.view === 'mistakes') app.innerHTML = mistakesView();
  else if (state.view === 'stats') app.innerHTML = statsView();
  else if (state.view === 'attempt') app.innerHTML = attemptView(state.attemptId);
  else if (state.view === 'sync') app.innerHTML = syncView();
}
function startSim(n) { const ids = QUESTIONS.filter(q => q.sim === n).sort((a, b) => a.num - b.num).map(q => q.id); startTest(ids, { mode: 'sim', key: String(n), title: `Simulacro ${n}` }); }
function startTopic(id, count) { const pool = QUESTIONS.filter(q => q.topicId === id); const ids = shuffle(pool).slice(0, count === 'all' ? pool.length : Number(count)).map(q => q.id); const t = TOPICS.find(x => x.id === id); startTest(ids, { mode: 'topic', key: id, title: `${t.id} · ${t.name}` }); }
function startMistakes(count = 'all', topicId = '') {
  let pool = pendingMistakes().map(x => questionById(x.id)).filter(Boolean);
  if (topicId) pool = pool.filter(q => q.topicId === topicId);
  if (!pool.length) return toast('No tienes preguntas falladas pendientes');
  const ids = shuffle(pool).slice(0, count === 'all' ? pool.length : Number(count)).map(q => q.id);
  const title = topicId ? `Falladas · ${topicId}` : 'Repaso de preguntas falladas';
  startTest(ids, { mode: 'mistakes', key: topicId || 'pending', title });
}
function reviewIds(ids) {
  ids = [...new Set(ids)].filter(id => questionById(id));
  if (!ids.length) return toast('No hay preguntas para repasar');
  startTest(shuffle(ids), { mode: 'mistakes', key: 'selection', title: 'Repaso de fallos seleccionados' });
}
function repeat(mode, key) {
  if (mode === 'sim') return startSim(Number(key));
  if (mode === 'topic') { const t = TOPICS.find(x => x.id === key); app.innerHTML = topicSetup(t.id); state.view = 'topicSetup'; return; }
  if (mode === 'mistakes') return startMistakes('all', key !== 'pending' && key !== 'selection' ? key : '');
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-go],[data-action],[data-topic],[data-sim],[data-choice],[data-start-topic],[data-mode],[data-attempt],[data-review-ids],[data-mistake-topic]');
  if (!el) return;
  if (el.dataset.go) return go(el.dataset.go);
  if (el.dataset.choice) return answer(el.dataset.choice);
  if (el.dataset.topic) { app.innerHTML = topicSetup(el.dataset.topic); state.view = 'topicSetup'; return; }
  if (el.dataset.sim) return startSim(Number(el.dataset.sim));
  if (el.dataset.startTopic) return startTopic(el.dataset.startTopic, $('#topicCount').value);
  if (el.dataset.attempt) { state.attemptId = el.dataset.attempt; state.view = 'attempt'; return render(); }
  if (el.dataset.reviewIds !== undefined) return reviewIds((el.dataset.reviewIds || '').split(',').filter(Boolean));
  if (el.dataset.mistakeTopic) return startMistakes('all', el.dataset.mistakeTopic);

  const a = el.dataset.action;
  if (a === 'topics') go('topics');
  else if (a === 'sims') go('sims');
  else if (a === 'mistakes') go('mistakes');
  else if (a === 'start-mistakes') startMistakes($('#mistakeCount')?.value || 'all');
  else if (a === 'resume') resume();
  else if (a === 'next') next();
  else if (a === 'restart') restart();
  else if (a === 'quit') { persistCurrent(); go('home'); }
  else if (a === 'repeat-last') repeat(el.dataset.mode, el.dataset.key);
  else if (a === 'clear-history') { if (confirm('¿Borrar todo el historial de resultados?')) { store.history = []; store.historyClearedAt = Date.now(); saveStore(store); go('stats'); } }
  else if (a === 'create-sync') createSync();
  else if (a === 'link-sync') linkSync();
  else if (a === 'sync-now') syncNow(false);
  else if (a === 'copy-key') navigator.clipboard?.writeText(getSyncKey()).then(() => toast('Clave copiada')).catch(() => toast('Copia la clave manualmente'));
  else if (a === 'unlink-sync') { if (confirm('¿Desvincular este dispositivo? El progreso local no se borra.')) { setSyncKey(''); go('sync'); } }
});

$('#statsBtn').addEventListener('click', () => go('stats'));
$('#syncBtn').addEventListener('click', () => go('sync'));
document.addEventListener('input', e => { if (e.target.id === 'topicSearch') { const v = e.target.value.toLowerCase(); document.querySelectorAll('.topic').forEach(x => x.style.display = x.textContent.toLowerCase().includes(v) ? 'block' : 'none'); } });

Promise.all([
  fetch('data/questions.json?v=3').then(r => r.json()),
  fetch('data/topics.json?v=3').then(r => r.json())
]).then(([q, t]) => {
  QUESTIONS = q; TOPICS = t; render();
  if (getSyncKey() && syncConfigured()) setTimeout(() => syncNow(true), 600);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=3').catch(() => {});
}).catch(err => { app.innerHTML = `<div class="card"><h2>No se pudo cargar el banco</h2><p>${esc(err.message)}</p></div>`; });
