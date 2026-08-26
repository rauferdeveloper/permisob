const $ = (s, e = document) => e.querySelector(s);
const app = $('#app');
function showBootError(title, msg) {
  if (!app) return;
  const safe = String(msg || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  app.innerHTML = `<div class="card"><h2>${title}</h2><p>${safe}</p><p class="small muted">Tu progreso sigue guardado. Recarga con Ctrl+Shift+R.</p></div>`;
}
window.addEventListener('error', e => showBootError('Error al iniciar la web', e.message || 'Error JavaScript'));
window.addEventListener('unhandledrejection', e => showBootError('Error al cargar', e.reason?.message || String(e.reason || 'Error no controlado')));
const LS = 'aeolB_v1';
const SYNC_LS = 'aeolB_syncKey';
const API_BASE = String(window.AEOL_CONFIG?.API_BASE || '').replace(/\/$/, '');

let QUESTIONS = [];
let TOPICS = [];
let state = { view: 'home', test: null, attemptId: null, lesson: null };
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
  return {
    attempts: h.length,
    answered,
    correct,
    wrong,
    accuracy: answered ? correct / answered * 100 : 0,
    avg30: answered ? wrong / answered * 30 : 0,
    best: h.length ? Math.min(...h.map(x => x.wrong / x.total * 30)) : null
  };
}
function levelFor30(v, hasData = true) {
  if (!hasData) return { cls: 'neutral', title: 'Sin datos todavía', detail: 'Haz tu primer test para calcular tu nivel.' };
  if (v === 0) return { cls: 'green', title: 'Objetivo final: 0 fallos', detail: 'Estás en 0,00 fallos equivalentes por examen de 30.' };
  if (v <= 3) return { cls: 'yellow', title: 'En rango de aprobado', detail: `Nivel actual: ${v.toFixed(2)} fallos / 30 · meta final: 0.` };
  return { cls: 'red', title: 'Todavía por encima de 3', detail: `Nivel actual: ${v.toFixed(2)} fallos / 30 · primero baja a 3 o menos y después a 0.` };
}
function levelStrip(s) {
  const l = levelFor30(s.avg30, s.answered > 0);
  const capped = Math.max(0, Math.min(30, s.avg30));
  const towardsZero = s.answered ? Math.max(0, Math.min(100, (30 - capped) / 30 * 100)) : 0;
  return `<article class="level-strip level-${l.cls}"><div><span class="level-eyebrow">Nivel actual</span><b>${esc(l.title)}</b><p>${esc(l.detail)}</p></div><div class="level-meter-wrap"><div class="level-meter-label"><span>30 fallos</span><strong>${s.answered ? s.avg30.toFixed(2) : '—'}</strong><span>0 fallos</span></div><div class="level-meter"><div style="width:${towardsZero}%"></div></div><div class="level-targets"><span>Objetivo aprobado: ≤ 3</span><span>Objetivo final: 0</span></div></div></article>`;
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



// v5 · Entrenador 0 Fallos: analiza el historial local/sincronizado sin usar IA ni enviar datos fuera.
function trainerAnalytics() {
  const h = completedHistory();
  const ledger = failureLedger();
  const byTopic = TOPICS.map(t => {
    let answered = 0, wrong = 0, correct = 0;
    const failedIds = new Set(), seenIds = new Set();
    for (const rec of h) {
      if (Array.isArray(rec.results) && rec.results.length) {
        for (const r of rec.results) {
          const q = questionById(r.id); if (!q || q.topicId !== t.id) continue;
          answered++; seenIds.add(q.id);
          if (r.correct) correct++; else { wrong++; failedIds.add(q.id); }
        }
      } else {
        for (const id of (rec.wrongIds || [])) {
          const q = questionById(id); if (!q || q.topicId !== t.id) continue;
          answered++; wrong++; failedIds.add(q.id); seenIds.add(q.id);
        }
      }
    }
    const pending = [...ledger.values()].filter(x => x.lastCorrect === false && questionById(x.id)?.topicId === t.id).length;
    const rate = answered ? wrong / answered * 100 : 0;
    return { t, answered, correct, wrong, rate, pending, failedUnique: failedIds.size, seenUnique: seenIds.size };
  }).filter(x => x.answered > 0 || x.pending > 0);
  byTopic.sort((a,b) => b.rate-a.rate || b.pending-a.pending || b.wrong-a.wrong);
  const recurrent = [...ledger.values()].filter(x => x.failCount > 0 && questionById(x.id)).sort((a,b) => b.failCount-a.failCount || (b.seenCount ? b.failCount/b.seenCount : 0)-(a.seenCount ? a.failCount/a.seenCount : 0));
  const recent = h.slice(-10);
  const recentAnswered = recent.reduce((a,x)=>a+Number(x.total||0),0), recentWrong = recent.reduce((a,x)=>a+Number(x.wrong||0),0);
  return { byTopic, recurrent, recentAnswered, recentWrong, recentEq30: recentAnswered ? recentWrong/recentAnswered*30 : 0 };
}
function trainerLevel(row) {
  if (!row.answered) return { cls:'neutral', label:'Sin datos' };
  if (row.rate <= 5) return { cls:'green', label:'Dominado' };
  if (row.rate <= 10) return { cls:'yellow', label:'Vigilar' };
  return { cls:'red', label:'Débil' };
}
function trainerView() {
  const a = trainerAnalytics(), pending = pendingMistakes(), s = stats();
  if (!s.answered) return `<div class="row"><button class="secondary" data-go="home">← Inicio</button></div><h1 class="section-title">Entrenador 0 Fallos</h1><div class="card empty">Todavía no hay datos suficientes. Haz algún test y aquí te diré automáticamente dónde fallas más y qué conviene entrenar primero.</div>`;
  const weak = a.byTopic[0], second = a.byTopic[1];
  const weakIds = weak ? [...failureLedger().values()].filter(x=>x.lastCorrect===false && questionById(x.id)?.topicId===weak.t.id).map(x=>x.id) : [];
  const priorityIds = weakIds.length ? weakIds : a.recurrent.slice(0,15).map(x=>x.id);
  const targetText = weak ? `${weak.t.id} · ${weak.t.name}` : 'Tus fallos pendientes';
  return `<div class="row"><button class="secondary" data-go="home">← Inicio</button><span class="spacer"></span><button class="secondary" data-go="stats">Historial</button></div>
  <section class="trainer-hero"><div><span class="badge">Análisis automático</span><h1>Entrenador 0 Fallos</h1><p>La web analiza tus respuestas guardadas y te marca qué debes reforzar primero. No usa IA ni envía preguntas a ningún servicio externo.</p></div><div class="trainer-score"><span>Últimos 10 intentos</span><strong>${a.recentAnswered ? a.recentEq30.toFixed(2) : '—'}</strong><small>fallos equivalentes / 30</small></div></section>
  <div class="trainer-grid"><article class="card trainer-priority"><span class="trainer-kicker">Prioridad nº 1</span><h2>${esc(targetText)}</h2>${weak ? `<p><b>${weak.wrong}</b> fallos en <b>${weak.answered}</b> respuestas (${weak.rate.toFixed(1)}% error) · ${weak.pending} pendientes.</p>` : ''}<p class="muted">${weak && weak.rate > 10 ? 'Aquí estás perdiendo más puntos. Conviene corregir este bloque antes de repartir el estudio.' : 'Vas bastante bien: céntrate ahora en limpiar las preguntas que todavía tienes pendientes.'}</p>${priorityIds.length ? `<button class="primary" data-trainer-ids="${priorityIds.slice(0,15).join(',')}">Entrenar prioridad (${Math.min(priorityIds.length,15)})</button>` : `<button class="secondary" data-action="mistakes">Ver falladas</button>`}</article>
  <article class="card"><span class="trainer-kicker">Pendientes ahora</span><div class="trainer-big">${pending.length}</div><p class="muted">Preguntas cuyo último resultado sigue siendo incorrecto.</p>${pending.length ? `<button class="secondary" data-action="mistakes">Ver pendientes</button>` : '<span class="badge status-green">Todo limpio</span>'}</article>
  <article class="card"><span class="trainer-kicker">Pregunta más rebelde</span>${a.recurrent.length ? (()=>{const x=a.recurrent[0],q=questionById(x.id);return `<h3>S${String(q.sim).padStart(2,'0')} · P${String(q.num).padStart(2,'0')}</h3><p>${esc(q.question)}</p><p class="small muted">La has fallado ${x.failCount} ${x.failCount===1?'vez':'veces'} de ${x.seenCount} registradas.</p><button class="secondary" data-trainer-ids="${q.id}">Practicarla</button>`})() : '<p class="muted">Todavía no has fallado ninguna pregunta.</p>'}</article></div>
  <h2 class="section-title">Dónde fallas más</h2><p class="muted">Ordenado por porcentaje de error sobre las respuestas que ya has hecho de cada tema. Con pocas respuestas, tómalo como una señal provisional.</p>
  <div class="trainer-topic-list">${a.byTopic.map((x,i)=>{const l=trainerLevel(x);const ids=[...failureLedger().values()].filter(r=>r.lastCorrect===false&&questionById(r.id)?.topicId===x.t.id).map(r=>r.id);return `<article class="card trainer-topic"><div class="trainer-rank">${i+1}</div><div class="trainer-topic-main"><div class="row"><b>${x.t.id} · ${esc(x.t.name)}</b><span class="badge status-${l.cls}">${l.label}</span></div><div class="trainer-bar"><div class="trainer-bar-fill ${l.cls}" style="width:${Math.min(100,x.rate)}%"></div></div><div class="small muted">${x.wrong} fallos / ${x.answered} respuestas · <b>${x.rate.toFixed(1)}%</b> error · ${x.pending} pendientes</div></div><div class="learn-actions">${ids.length?`<button class="mini-btn" data-trainer-ids="${ids.slice(0,30).join(',')}">Entrenar</button>`:''}<button class="mini-btn learn-btn" data-learn-topic="${x.t.id}">No me entra 😵‍💫</button></div></article>`}).join('')}</div>
  <h2 class="section-title">Preguntas que más se repiten</h2><div class="mistakes">${a.recurrent.slice(0,12).map((x,i)=>{const q=questionById(x.id),rate=x.seenCount?x.failCount/x.seenCount*100:0;return `<div class="mistake"><div class="row"><b>#${i+1} · S${String(q.sim).padStart(2,'0')} · P${String(q.num).padStart(2,'0')}</b><span class="badge">${q.topicId}</span><span class="spacer"></span><span class="badge badge-warn">${x.failCount} fallos</span></div><div class="mistake-question">${esc(q.question)}</div><div class="row"><span class="small muted">Error histórico: ${rate.toFixed(0)}% · último resultado: ${x.lastCorrect?'correcto':'fallo'}</span><span class="spacer"></span><button class="mini-btn" data-trainer-ids="${q.id}">Practicar</button></div></div>`}).join('') || '<div class="card empty">Sin preguntas repetidamente falladas.</div>'}</div>
  ${second ? `<p class="footer-note">Después de ${esc(weak.t.name)}, tu siguiente bloque a vigilar es ${esc(second.t.name)} (${second.rate.toFixed(1)}% de error).</p>` : ''}`;
}


// v6 · Modo Aprender: micro-sesiones para entender sin saturarse.
function coachForTopic(topicName = '') {
  const n = topicName.toLowerCase();
  const rules = [
    [['document','permiso','itv','puntos','seguro'], ['Separa siempre conductor, vehículo y trámite.', 'Busca primero qué documento, permiso o plazo te están preguntando.', 'Si aparecen masas o años, identifica antes el tipo de vehículo.']],
    [['señal','baliza','semáforo','marca vial'], ['Primero identifica la familia de la señal.', 'Después mira forma, color y a quién afecta.', 'Si hay varias señales, piensa antes en el orden de prioridad.']],
    [['alumbr','luz','niebla'], ['Piensa en tres cosas: dónde estás, cuánta visibilidad hay y si puedes deslumbrar.', 'Cruce = ver sin molestar; carretera = ver lejos cuando se puede.', 'Antiniebla trasera: reserva mentalmente la idea de condiciones realmente malas.']],
    [['veloc'], ['Primero identifica vía y vehículo; después busca máxima o mínima.', 'No mezcles turismo/moto con furgoneta, camión o remolque.', 'Si preguntan velocidad adecuada, manda la situación aunque el límite permita más.']],
    [['prioridad','interse','estrech'], ['Antes de pensar en la derecha, busca agente, semáforo o señal.', 'En un estrechamiento importa quién entró primero y, si llegan a la vez, el tipo de vehículo.', 'En glorieta, piensa quién ya circula dentro.']],
    [['adelant'], ['Primero pregunta: ¿está permitido aquí?', 'Después: ¿a quién adelanto y qué separación necesito?', 'Ojo con excepciones: algunas prohibiciones generales cambian según el usuario adelantado.']],
    [['parada','estacion','inmovil'], ['Distingue: detenerse por tráfico, parar voluntariamente y estacionar.', 'Busca lugar prohibido y si obstaculiza o crea peligro.', 'Menos de 2 minutos no basta por sí solo: importa también abandonar o no el vehículo.']],
    [['maniobra','giro','marcha atrás','incorpor'], ['Orden mental: observar → señalizar → colocarse → ejecutar.', 'La marcha atrás es excepcional, no una maniobra libre.', 'En incorporaciones, quien entra normalmente debe ceder.']],
    [['carga','remol','pasaj'], ['Identifica primero qué vehículo transporta la carga.', 'Luego mira si sobresale delante, detrás o lateralmente.', 'Separa límites de carga de requisitos de señalización.']],
    [['alcohol','droga','fatiga','sueño','distrac'], ['Piensa si la pregunta habla de percepción, reacción o conducción.', 'Alcohol/drogas y fatiga suelen empeorar antes tu capacidad de reaccionar que la mecánica del coche.', 'Busca palabras absolutas como siempre/nunca: suelen esconder la trampa.']],
    [['accidente','auxilio','v16','emerg'], ['Recuerda el orden PAS: Proteger, Avisar, Socorrer.', 'Primero evita crear otro accidente.', 'No hagas una maniobra médica si la pregunta no la justifica claramente.']],
    [['neum','freno','mecán','seguridad'], ['Separa seguridad activa (evitar accidente) de pasiva (reducir daños).', 'En neumáticos piensa agarre, presión, dibujo y estado.', 'Si hay avería, distingue síntoma, causa y actuación segura.']],
    [['peat','cicli','moto','ciclomotor','vulner'], ['Identifica exactamente el usuario: bicicleta, ciclomotor y motocicleta no son lo mismo.', 'Con usuarios vulnerables, piensa en visibilidad, separación y prioridad.', 'No apliques automáticamente una regla de turismo a un vehículo de dos ruedas.']],
    [['vía','autopista','autovía','travesía','carril'], ['Primero ubícate: dentro/fuera de poblado y tipo de vía.', 'Después identifica calzada, carril y arcén.', 'Muchas reglas cambian solo por el tipo de vía, aunque la situación parezca igual.']],
    [['adas'], ['El ADAS ayuda, pero el responsable sigue siendo el conductor.', 'Identifica qué detecta el sistema y qué acción realiza.', 'No atribuyas a un asistente funciones de conducción autónoma que no tiene.']],
  ];
  for (const [keys, tips] of rules) if (keys.some(k => n.includes(k))) return tips;
  return ['Lee primero qué dato concreto te pide el enunciado.', 'Descarta opciones que respondan a otra situación distinta.', 'Busca la excepción antes de aplicar una regla general de memoria.'];
}
function learnHint(q) {
  const tips = coachForTopic(q.topicName || '');
  const idx = (Number(q.num || 1) + Number(q.sim || 1)) % tips.length;
  return tips[idx];
}
function learnPool(topicId) {
  const pool = QUESTIONS.filter(q => q.topicId === topicId);
  const ledger = failureLedger();
  return [...pool].sort((a,b) => {
    const A=ledger.get(a.id), B=ledger.get(b.id);
    const ap=A ? (A.lastCorrect===false?100:0)+A.failCount*10 : 0;
    const bp=B ? (B.lastCorrect===false?100:0)+B.failCount*10 : 0;
    return bp-ap || Math.random()-.5;
  });
}
function startLearn(topicId) {
  const t = TOPICS.find(x => x.id === topicId); if (!t) return;
  const pool = learnPool(topicId);
  const ids = pool.slice(0, Math.min(5,pool.length)).map(q=>q.id);
  if (!ids.length) return toast('No hay preguntas en este tema');
  startTest(ids, { mode:'learn', key:topicId, title:`Aprender · ${t.id} · ${t.name}` });
}
function learnView() {
  const a = trainerAnalytics();
  const map = new Map(a.byTopic.map(x=>[x.t.id,x]));
  return `<div class="row"><button class="secondary" data-go="home">← Inicio</button></div>
  <section class="learn-hero"><div><span class="badge">5 minutos · sin saturarte</span><h1>Modo Aprender</h1><p>Una pista corta, una pregunta y una regla para recordar. Las sesiones son de solo 5 preguntas y priorizan lo que más te cuesta.</p></div></section>
  <h2 class="section-title">¿Qué quieres entender hoy?</h2><div class="learn-topic-list">${TOPICS.map(t=>{const x=map.get(t.id); const rate=x?.rate||0; const lvl=!x?'Nuevo':rate>10?'Me cuesta':rate>5?'Reforzar':'Bien'; const cls=!x?'neutral':rate>10?'red':rate>5?'yellow':'green'; return `<article class="card learn-topic"><div><span class="topic-code">${t.id}</span><h3>${esc(t.name)}</h3><p class="small muted">${x?`${x.wrong} fallos en ${x.answered} respuestas · ${rate.toFixed(1)}% error`:'Todavía sin datos de este tema.'}</p></div><span class="badge status-${cls}">${lvl}</span><button class="primary" data-learn-topic="${t.id}">Aprender 5</button></article>`}).join('')}</div>`;
}


// v7 · Clase visual: primero entender, después practicar.
function visualTrapForTopic(topicName='') {
  const n=topicName.toLowerCase();
  const rows=[
    [['document','permiso','itv','puntos','seguro'],'No mezcles lo que necesita el conductor con lo que pertenece al vehículo. Antes de responder, identifica de quién habla la pregunta.'],
    [['señal','baliza','semáforo','marca vial'],'No empieces por memorizar el dibujo. Primero identifica quién manda y la familia de señal; después interpreta el detalle.'],
    [['alumbr','luz','niebla'],'La trampa suele ser confundir ver mejor con no deslumbrar. Sitúate: vía, visibilidad y usuarios que tienes delante.'],
    [['veloc'],'No respondas una cifra hasta identificar vehículo y vía. Después decide si preguntan máxima, mínima o velocidad adecuada.'],
    [['prioridad','interse','estrech'],'La derecha no es siempre el primer paso. Antes busca agente, semáforo, señal y circunstancias especiales.'],
    [['adelant'],'Que adelantar esté permitido no significa que puedas hacerlo de cualquier forma. Separa lugar, usuario adelantado y separación.'],
    [['parada','estacion','inmovil'],'Detención, parada y estacionamiento parecen iguales pero no lo son. Pregúntate siempre por qué está parado y durante cuánto tiempo.'],
    [['maniobra','giro','marcha atrás','incorpor'],'No pienses solo en el movimiento final. En test suele importar observar, señalizar, colocarse y ceder antes de ejecutar.'],
    [['carga','remol','pasaj'],'Primero identifica el vehículo y la carga. Las reglas cambian según dónde sobresale y qué conjunto estás conduciendo.'],
    [['alcohol','droga','fatiga','sueño','distrac'],'Distingue efecto sobre ti de efecto sobre el vehículo. Casi siempre la pregunta busca percepción, atención o tiempo de reacción.'],
    [['accidente','auxilio','v16','emerg'],'No corras a socorrer sin proteger primero. El orden mental PAS evita muchas respuestas impulsivas.'],
    [['neum','freno','mecán','seguridad'],'No confundas evitar el accidente con reducir sus daños. Esa separación activa/pasiva resuelve muchas preguntas.'],
    [['peat','cicli','moto','ciclomotor','vulner'],'Identifica exactamente al usuario. Bicicleta, ciclomotor y motocicleta tienen reglas distintas aunque visualmente se parezcan.'],
    [['vía','autopista','autovía','travesía','carril'],'Antes de aplicar una norma, ubícate. Dentro/fuera de poblado y tipo de vía cambian muchas respuestas.'],
    [['adas'],'Un ADAS ayuda; no sustituye al conductor. Mira qué detecta y qué acción concreta puede realizar.']
  ];
  for(const [keys,text] of rows) if(keys.some(k=>n.includes(k))) return text;
  return 'La trampa suele estar en una palabra que cambia la situación. Identifica primero qué te están preguntando exactamente.';
}
function visualMemoryForTopic(topicName='') {
  const tips=coachForTopic(topicName);
  return `${tips[0]} ${tips[1] || ''}`.trim();
}
function representativeQuestion(topicId) {
  const ledger=failureLedger();
  const pool=QUESTIONS.filter(q=>q.topicId===topicId && q.image);
  return [...pool].sort((a,b)=>{
    const A=ledger.get(a.id), B=ledger.get(b.id);
    return ((B?.failCount||0)*10+(B?.lastCorrect===false?100:0))-((A?.failCount||0)*10+(A?.lastCorrect===false?100:0));
  })[0] || null;
}
function visualLessonSlides(topicId) {
  const t=TOPICS.find(x=>x.id===topicId); if(!t) return [];
  const tips=coachForTopic(t.name || '');
  const q=representativeQuestion(topicId);
  const slides=[
    {kicker:'1 · Entiende la idea',title:`${t.id} · ${t.name}`,body:t.description || 'Vamos a reducir este tema a las pocas decisiones que necesitas reconocer en un test.',callout:'En cristiano',big:tips[0]},
    {kicker:'2 · Tu orden mental',title:'No intentes recordarlo todo a la vez',body:'Cuando aparezca una pregunta de este tema, recorre siempre el mismo camino.',steps:tips.slice(0,3)},
    {kicker:'3 · La trampa que quiero evitar',title:'Aquí es donde más fácil es liarse',body:visualTrapForTopic(t.name),callout:'Haz esta pausa mental',big:'¿Qué detalle del enunciado cambia la regla?'},
  ];
  if(q) slides.push({kicker:'4 · Mira antes de responder',title:'Aprende a leer la imagen',body:'No busques todavía A, B o C. Mira la escena y decide primero qué elemento de este tema está intentando comprobar.',image:q.image,caption:`Ejemplo real: S${String(q.sim).padStart(2,'0')} · P${String(q.num).padStart(2,'0')} — ${q.question}`});
  slides.push({kicker:`${q?'5':'4'} · Qué debe saltarte en la cabeza`,title:'Una frase para llevarte',body:'No memorices una letra. Memoriza el disparador que te lleva a la regla.',callout:'RECUERDA',big:visualMemoryForTopic(t.name)});
  slides.push({kicker:`${q?'6':'5'} · Compruébalo`,title:'Ahora sí: 5 preguntas y fuera',body:'Haz una micro-sesión. Si fallas, vuelve a esta clase y mira qué paso mental te saltaste.',cta:true});
  return slides;
}
function classView(){
  const a=trainerAnalytics(); const map=new Map(a.byTopic.map(x=>[x.t.id,x]));
  return `<div class="row"><button class="secondary" data-go="home">← Inicio</button></div>
  <section class="class-hero"><div><span class="badge">Explicación visual · sin examen</span><h1>Clase visual</h1><p>Primero entiende el tema en 5-6 pantallas. Una idea cada vez, poco texto y una imagen real cuando ayuda. Después, si quieres, haces 5 preguntas.</p></div></section>
  <h2 class="section-title">Elige un tema</h2><div class="class-topic-list">${TOPICS.map(t=>{const x=map.get(t.id);return `<article class="card class-topic"><div><span class="topic-code">${t.id}</span><h3>${esc(t.name)}</h3><p class="small muted">${x?`${x.rate.toFixed(1)}% de error en tus respuestas`:'Todavía sin datos: puedes aprenderlo igualmente.'}</p></div><button class="primary" data-class-topic="${t.id}">Ver clase →</button></article>`}).join('')}</div>`;
}
function openClass(topicId){ state.lesson={topicId,index:0}; state.view='classSlide'; render(); }
function classSlideView(){
  const L=state.lesson; if(!L) return classView();
  const slides=visualLessonSlides(L.topicId); const i=Math.max(0,Math.min(L.index||0,slides.length-1)); L.index=i; const s=slides[i];
  const dots=slides.map((_,n)=>`<span class="class-dot ${n===i?'active':''}"></span>`).join('');
  return `<div class="row"><button class="secondary" data-action="class-list">← Temas</button><span class="spacer"></span><span class="badge">${i+1}/${slides.length}</span></div>
  <section class="class-stage"><div class="class-progress">${dots}</div><article class="class-slide">
  <span class="class-kicker">${esc(s.kicker)}</span><h1>${esc(s.title)}</h1><p class="class-body">${esc(s.body)}</p>
  ${s.steps?`<div class="class-steps">${s.steps.map((x,n)=>`<div><span>${n+1}</span><b>${esc(x)}</b></div>`).join('')}</div>`:''}
  ${s.callout?`<div class="class-callout"><small>${esc(s.callout)}</small><strong>${esc(s.big||'')}</strong></div>`:''}
  ${s.image?`<figure class="class-figure"><img src="${s.image}" alt="Ejemplo visual del tema" loading="eager"><figcaption>${esc(s.caption||'')}</figcaption></figure>`:''}
  ${s.cta?`<div class="class-finish"><span>¿Te suena ya la lógica?</span><button class="primary" data-action="class-practice">Ahora compruébalo con 5 →</button></div>`:''}
  </article><div class="class-nav"><button class="secondary" data-action="class-prev" ${i===0?'disabled':''}>← Anterior</button><button class="primary" data-action="class-next" ${i===slides.length-1?'disabled':''}>Siguiente →</button></div></section>`;
}

function go(view) { state.view = view; state.test = null; state.attemptId = null; render(); }
function home() {
  const s = stats(), pending = pendingMistakes().length, ever = everMistakes().length;
  return `<section class="hero"><h1>Practica el permiso B</h1><p>2.640 preguntas AEOL: los mismos 18 temas del PDF, los 88 simulacros originales y un repaso inteligente de tus fallos.</p></section>
  <div class="kpis"><div class="kpi"><span>Intentos</span><strong>${s.attempts}</strong></div><div class="kpi"><span>Acierto global</span><strong>${s.accuracy.toFixed(1)}%</strong></div><div class="kpi"><span>Fallos equivalentes / 30</span><strong>${s.avg30.toFixed(2)}</strong></div><div class="kpi"><span>Falladas pendientes</span><strong>${pending}</strong></div></div>
  ${levelStrip(s)}
  <div class="grid grid-3"><article class="card mode-card" data-action="topics"><span class="badge">Modo estudio</span><h2>Por temas</h2><p>Los 18 temas coinciden exactamente con el PDF. Elige 10, 20, 30, 50 o todas.</p></article>
  <article class="card mode-card" data-action="sims"><span class="badge">Modo examen</span><h2>88 simulacros</h2><p>Los 30 enunciados originales, en su orden y con resultado verde/amarillo/rojo.</p></article>
  <article class="card mode-card mistake-mode ${pending ? '' : 'disabled-card'}" data-action="mistakes"><span class="badge badge-warn">Repaso inteligente</span><h2>Falladas</h2><p>${pending ? `Tienes <b>${pending}</b> preguntas pendientes (${ever} falladas alguna vez). Practica solo esas.` : 'Cuando falles preguntas aparecerán aquí para repasarlas después.'}</p></article></div><article class="card class-home" data-action="class"><div><span class="badge">Primero entender</span><h2>🎞️ Clase visual</h2><p>Te explico un tema en 5-6 diapositivas: una idea por pantalla, trampas, regla mental e imagen cuando ayuda.</p></div><button class="primary">Ver una clase →</button></article><article class="card learn-home" data-action="learn"><div><span class="badge">Después practicar</span><h2>🧠 Modo Aprender</h2><p>Sesiones de 5 preguntas con pistas simples y reglas para recordar. Ideal para los temas que se atascan.</p></div><button class="primary">Elegir tema →</button></article><article class="card trainer-home" data-action="trainer"><div><span class="badge">Nuevo · análisis automático</span><h2>Entrenador 0 Fallos</h2><p>Te dice qué temas y preguntas te hacen perder más puntos y te prepara el siguiente repaso automáticamente.</p></div><button class="primary">Ver mi análisis →</button></article>
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
  ${t.mode === 'learn' ? `<div class="learn-hint"><span>👀 Antes de responder, fíjate en esto</span><b>${esc(learnHint(q))}</b></div>` : ''}
  <div class="options">${q.options.map(o => { let cls = 'option'; if (ans) { if (o.key === q.correct) cls += ' correct'; else if (o.key === ans.choice) cls += ' wrong'; } return `<button class="${cls}" data-choice="${o.key}" ${ans ? 'disabled' : ''}><span class="opt-key">${o.key}</span><span>${esc(o.text)}</span></button>`; }).join('')}</div>${ans ? feedback(q, ans) : ''}</article>
  ${ans ? `<div class="next-row"><span class="muted small">${ans.correct ? 'Correcta' : 'Fallada'} · La correcta queda marcada en verde.</span><button class="primary" data-action="next">${t.index === t.ids.length - 1 ? 'Ver resultado' : 'Siguiente →'}</button></div>` : ''}</div>`;
}
function feedback(q, a) {
  const base = `<div class="feedback ${a.correct ? 'ok' : 'bad'}"><b>${a.correct ? '✓ Bien visto' : '✕ Aquí estaba la trampa'}</b>${!a.correct ? ` · Correcta: ${q.correct}` : ''}${q.explanation ? `<div class="explain">${esc(q.explanation)}</div>` : ''}`;
  if (state.test?.mode !== 'learn') return base + `</div>`;
  const tips = coachForTopic(q.topicName || '');
  return base + `<div class="learn-rule"><span>🧠 Qué quiero que recuerdes</span><b>${esc(q.explanation || tips[0])}</b></div><div class="learn-mini">No memorices la letra. La próxima vez busca primero el detalle del enunciado que activa esta regla.</div></div>`;
}
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
  <h1 class="section-title">Tu progreso</h1><div class="kpis"><div class="kpi"><span>Tests completados</span><strong>${s.attempts}</strong></div><div class="kpi"><span>Acierto global</span><strong>${s.accuracy.toFixed(1)}%</strong></div><div class="kpi"><span>Fallos equivalentes / 30</span><strong>${s.avg30.toFixed(2)}</strong></div><div class="kpi"><span>Falladas pendientes</span><strong>${pending.length}</strong></div></div>${levelStrip(s)}
  <article class="card" style="margin-top:18px"><h2>Historial</h2>${h.length ? `<div class="history-wrap"><table class="history"><thead><tr><th>Fecha</th><th>Test</th><th>Acierto</th><th>Fallos</th><th></th></tr></thead><tbody>${h.map(x => `<tr><td>${new Date(x.date).toLocaleDateString('es-ES')}</td><td>${esc(x.title)}</td><td>${Number(x.accuracy).toFixed(1)}%</td><td><span class="badge status-${status(x.wrong)}">${x.wrong}</span></td><td><button class="mini-btn" data-attempt="${esc(x.id)}">${x.wrong ? 'Ver fallos' : 'Ver'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aún no has terminado ningún test.</div>'}</article>
  <p class="footer-note">Pulsa “Ver fallos” para saber exactamente qué pregunta original fallaste, en qué intento y cuál era la correcta. Los fallos equivalentes /30 normalizan sesiones de 10, 20, 30, 50 o más preguntas al formato de un examen de 30.</p>`;
}

function render() {
  if (state.view === 'home') app.innerHTML = home();
  else if (state.view === 'topics') app.innerHTML = topicsView();
  else if (state.view === 'sims') app.innerHTML = simsView();
  else if (state.view === 'mistakes') app.innerHTML = mistakesView();
  else if (state.view === 'stats') app.innerHTML = statsView();
  else if (state.view === 'trainer') app.innerHTML = trainerView();
  else if (state.view === 'learn') app.innerHTML = learnView();
  else if (state.view === 'class') app.innerHTML = classView();
  else if (state.view === 'classSlide') app.innerHTML = classSlideView();
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
  if (mode === 'learn') return startLearn(key);
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-go],[data-action],[data-topic],[data-sim],[data-choice],[data-start-topic],[data-mode],[data-attempt],[data-review-ids],[data-mistake-topic],[data-trainer-ids],[data-learn-topic],[data-class-topic]');
  if (!el) return;
  if (el.dataset.go) return go(el.dataset.go);
  if (el.dataset.choice) return answer(el.dataset.choice);
  if (el.dataset.topic) { app.innerHTML = topicSetup(el.dataset.topic); state.view = 'topicSetup'; return; }
  if (el.dataset.sim) return startSim(Number(el.dataset.sim));
  if (el.dataset.startTopic) return startTopic(el.dataset.startTopic, $('#topicCount').value);
  if (el.dataset.attempt) { state.attemptId = el.dataset.attempt; state.view = 'attempt'; return render(); }
  if (el.dataset.reviewIds !== undefined) return reviewIds((el.dataset.reviewIds || '').split(',').filter(Boolean));
  if (el.dataset.mistakeTopic) return startMistakes('all', el.dataset.mistakeTopic);
  if (el.dataset.trainerIds !== undefined) return reviewIds((el.dataset.trainerIds || '').split(',').filter(Boolean));
  if (el.dataset.learnTopic) return startLearn(el.dataset.learnTopic);
  if (el.dataset.classTopic) return openClass(el.dataset.classTopic);

  const a = el.dataset.action;
  if (a === 'topics') go('topics');
  else if (a === 'sims') go('sims');
  else if (a === 'mistakes') go('mistakes');
  else if (a === 'trainer') go('trainer');
  else if (a === 'learn') go('learn');
  else if (a === 'class') go('class');
  else if (a === 'class-list') go('class');
  else if (a === 'class-prev') { if(state.lesson && state.lesson.index>0){state.lesson.index--;render();} }
  else if (a === 'class-next') { if(state.lesson){const n=visualLessonSlides(state.lesson.topicId).length;if(state.lesson.index<n-1){state.lesson.index++;render();}} }
  else if (a === 'class-practice') { if(state.lesson) startLearn(state.lesson.topicId); }
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

async function boot() {
  try {
    const [qr, tr] = await Promise.all([
      fetch('data/questions.json?v=71', {cache:'no-store'}),
      fetch('data/topics.json?v=71', {cache:'no-store'})
    ]);
    if (!qr.ok) throw new Error(`questions.json: HTTP ${qr.status}`);
    if (!tr.ok) throw new Error(`topics.json: HTTP ${tr.status}`);
    const [q, t] = await Promise.all([qr.json(), tr.json()]);
    if (!Array.isArray(q) || !q.length) throw new Error('El banco de preguntas está vacío o no es válido');
    if (!Array.isArray(t) || !t.length) throw new Error('El listado de temas está vacío o no es válido');
    QUESTIONS = q; TOPICS = t;
    render();
    if (getSyncKey() && syncConfigured()) setTimeout(() => syncNow(true), 600);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js?v=71').catch(() => {});
  } catch (err) {
    console.error(err);
    showBootError('No se pudo cargar el banco', err?.message || err);
  }
}
boot();
