(() => {
  "use strict";

  const CFG = window.PERMISOB_CONFIG || {};
  const STORAGE_KEY = "permisob_state_v11";
  let topics = [];
  let questions = [];
  let topicChanges = [];
  let study = {topics:{}};
  let materials = {books:[],pdfs:[]};
  let simulatorFilter = "all";
  let byCode = new Map();
  let availableSimulators = new Set();
  let state = loadLocalState();
  let currentSlide = 0;
  let quiz = null;
  let remotePushTimer = null;
  let remoteWriteInProgress = false;

  document.addEventListener("DOMContentLoaded", init);

  async function init(){
    bindNavigation();
    bindActions();
    await Promise.all([loadTopics(), loadQuestions(), loadStudy(), loadMaterials()]);
    validateTopicCoverage();
    renderAll();
    route(location.hash.replace("#","") || "home", false);
    if (CFG.apiBase) syncFromRemote({silent:true});
  }

  async function loadTopics(){
    try {
      const r = await fetch(CFG.topicsUrl || "data/topics.json", {cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      topics = d.topics || d.temas || d || [];
    } catch(e){
      topics = [{id:17,title:"Repaso final",icon:"🏁",description:"Práctica de todo el banco",all:true}];
      console.error("No se pudieron cargar los temas", e);
    }
  }


  async function loadStudy(){
    try{
      const r=await fetch(CFG.studyUrl || "data/study.json",{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      study=await r.json();
    }catch(e){ study={topics:{}}; console.error("No se pudo cargar el temario",e); }
  }

  async function loadMaterials(){
    try{const r=await fetch('data/materials.json',{cache:'no-store'});if(r.ok)materials=await r.json();}
    catch(e){console.warn('Materiales no disponibles',e);}
  }

  async function loadQuestions(){
    try {
      const r = await fetch(CFG.questionsUrl || "data/questions.json", {cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      questions = d.preguntas || d.questions || [];
      byCode = new Map(questions.map(q => [String(q.preguntaCodigo), q]));
      availableSimulators = new Set(questions.map(q => Number(q.simulacro)));
      await migrateQuestionIds();
      const changesResponse = await fetch('data/topic_changes_v13_3.json', {cache:"no-store"});
      if(!changesResponse.ok) throw new Error('No se pudo cargar la revisión de temas v13.3');
      topicChanges = await changesResponse.json();
      migrateTopicPractice(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      state.diagnostics.bank = `OK · ${questions.length} preguntas`;
    } catch(e){
      state.diagnostics.bank = `Error · ${e.message}`;
      console.error("No se pudo cargar el banco", e);
    }
  }

  async function migrateQuestionIds(){
    try{
      if(state.questionIdsMigratedV13)return;
      const r=await fetch('data/legacy_ids.json');if(!r.ok)return;
      const changes=await r.json(),mapping=new Map(changes.filter(x=>!byCode.has(String(x.anterior))).map(x=>[String(x.anterior),String(x.nuevo)]));
      const fix=id=>mapping.get(String(id))||String(id);
      state.mistakes=(state.mistakes||[]).map(x=>({...x,preguntaCodigo:fix(x.preguntaCodigo)}));
      for(const t of Object.values(state.topicPractice||{}))t.seen=[...new Set((t.seen||[]).map(fix))];
      if(state.perQuestion){for(const [key,val] of Object.entries(state.perQuestion)){const newKey=fix(key);if(key!==newKey){const old=state.perQuestion[newKey]||{};state.perQuestion[newKey]={correct:(old.correct||0)+(val.correct||0),wrong:(old.wrong||0)+(val.wrong||0),lastDate:val.lastDate||old.lastDate};delete state.perQuestion[key];}}}
      state.questionIdsMigratedV13=true;saveState({sync:false});
    }catch(e){console.warn('No se pudo migrar el historial de preguntas',e);}
  }
  // Solo se trasladan los identificadores vistos: no se inventan intentos ni XP.
  // Los registros originales permanecen para conservar historial y contadores.
  function migrateTopicPractice(s){
    if(s.topicAssignmentsMigratedV133 || !questions.length || !topicChanges.length) return;
    s.topicPractice ||= {};
    for(const change of topicChanges){
      const code=String(change.preguntaCodigo);
      const source=s.topicPractice[String(change.anterior)];
      if(!(source?.seen||[]).some(id=>String(id)===code)) continue;
      const key=String(change.nuevo);
      const target=s.topicPractice[key] ||= {cycle:1,seen:[],correct:0,wrong:0};
      target.seen=[...new Set([...(target.seen||[]).map(String),code])];
    }
    s.topicAssignmentsMigratedV133=true;
  }
  function validateTopicCoverage(){
    const ids=new Set(topics.map(t=>Number(t.id)));
    const unique=new Set(questions.map(q=>String(q.preguntaCodigo)));
    const missing=questions.filter(q=>q.study_topic==null||!ids.has(Number(q.study_topic))).length;
    const counts=new Map();
    for(const q of questions) counts.set(Number(q.study_topic),(counts.get(Number(q.study_topic))||0)+1);
    for(const t of topics) t.question_count=counts.get(Number(t.id))||0;
    const ok=questions.length===2610&&unique.size===2610&&ids.size===18&&!missing;
    state.diagnostics.bank=`${ok?"OK":"Error"} · ${questions.length} preguntas · ${ids.size} temas · ${missing} sin clasificar · v13.3`;
    if(!ok) console.error('El banco no cumple la cobertura completa v13.3');
  }
  function freshState(){
    return {
      version:13, perQuestion:{}, questionIdsMigratedV13:false, xp:0, streak:0, bestStreak:0, lastActive:null, lastActivityDate:null, activityDates:[], dailyXp:0, dailyDate:todayKey(), level:1,
      currentTopic:0, topics:{}, topicPractice:{}, simulators:{}, mistakes:[], history:[], lastSync:null,
      diagnostics:{local:"OK",remote:"No configurado",merge:"Pendiente",bank:"Cargando…"}
    };
  }
  function loadLocalState(){
    try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch(e){ return freshState(); }
  }
  function normalizeState(s){
    const out = Object.assign(freshState(), s || {});
    out.topics ||= {}; out.topicPractice ||= {}; out.simulators ||= {}; out.mistakes ||= []; out.history ||= []; out.perQuestion ||= {}; out.diagnostics ||= {};
    if(out.dailyDate !== todayKey()){ out.dailyXp=0; out.dailyDate=todayKey(); }
    out.activityDates = Array.isArray(out.activityDates) ? [...new Set(out.activityDates)] : [];
    if(!out.lastActivityDate && out.lastActive){ out.lastActivityDate=String(out.lastActive).slice(0,10); }
    if(!out.activityDates.length && out.lastActivityDate) out.activityDates=[out.lastActivityDate];
    const calculated=streakFromDates(out.activityDates);
    out.streak = calculated || ((out.version||0)<12 ? Number(out.streak)||0 : 0);
    out.bestStreak = Math.max(Number(out.bestStreak)||0, Number(out.streak)||0);
    out.version = 13;
    return out;
  }
  function saveState({sync=true}={}){
    state.lastActive = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if(sync && CFG.apiBase) scheduleRemotePush();
  }
  function scheduleRemotePush(){
    clearTimeout(remotePushTimer);
    remotePushTimer=setTimeout(()=>pushRemoteState({silent:true}),700);
  }
  function remoteStatePayload(){
    const copy=JSON.parse(JSON.stringify(state));
    delete copy.diagnostics;
    return copy;
  }
  async function pushRemoteState({silent=false}={}){
    if(!CFG.apiBase || remoteWriteInProgress) return false;
    remoteWriteInProgress=true;
    try{
      const userHash=await sha256(CFG.userKey||"aeol_local"), base=CFG.apiBase.replace(/\/$/,"");
      const res=await fetch(`${base}/api/state`,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({user:userHash,state:remoteStatePayload()})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok || data.ok===false) throw new Error(data.error||`HTTP ${res.status}`);
      state.lastSync=new Date().toISOString();
      state.diagnostics={...state.diagnostics,local:"OK",remote:"OK · guardado en Turso",merge:state.diagnostics?.merge||"OK"};
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      renderHeader(); renderDiagnostics();
      return true;
    }catch(err){
      state.diagnostics.remote=`Error · ${err.message}`;
      state.diagnostics.merge="Se conserva el estado local";
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
      renderDiagnostics();
      if(!silent) showError(`No se pudo guardar en Turso, pero tu progreso local sigue intacto. ${err.message}`);
      return false;
    }finally{remoteWriteInProgress=false;}
  }
  function todayKey(d=new Date()){
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  function dateKeyOffset(days){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+days);return todayKey(d);}
  function streakFromDates(dates){
    const active=new Set(dates||[]);
    let offset=active.has(todayKey())?0:(active.has(dateKeyOffset(-1))?-1:null);
    if(offset===null)return 0;
    let count=0;while(active.has(dateKeyOffset(offset))){count++;offset--;}return count;
  }
  function registerActivity(xp=0, reason="actividad"){
    const today=todayKey(), yesterday=dateKeyOffset(-1);
    if(state.dailyDate!==today){state.dailyDate=today;state.dailyXp=0;}
    if(xp>0){state.xp=(state.xp||0)+xp;state.dailyXp=(state.dailyXp||0)+xp;}
    if(state.lastActivityDate!==today){
      state.lastActivityDate=today;
      state.activityDates=[...new Set([...(state.activityDates||[]),today])].sort().slice(-120);
    }
    state.streak=streakFromDates(state.activityDates);
    state.bestStreak=Math.max(state.bestStreak||0,state.streak||0);
    state.lastActive=new Date().toISOString();
    state.level=Math.max(1,Math.floor((state.xp||0)/250)+1);
    return {xp,reason};
  }
  function addXp(n,reason="actividad"){return registerActivity(Math.max(0,Number(n)||0),reason);}
  function levelInfo(){
    const xp=state.xp||0, level=Math.max(1,Math.floor(xp/250)+1), inLevel=xp%250;
    const labels=["Arrancando","Cogiendo ritmo","Conductor atento","Buen criterio","Modo examen","Casi listo","A por el aprobado","Dominando el teórico"];
    return {level,inLevel,next:250,label:labels[Math.min(labels.length-1,level-1)]};
  }

  function bindNavigation(){
    document.querySelectorAll("[data-route]").forEach(el=>el.addEventListener("click",()=>route(el.dataset.route)));
    window.addEventListener("hashchange",()=>route(location.hash.replace("#","")||"home",false));
  }
  function route(name,push=true){
    const valid=["home","topics","simulators","mistakes","progress","materials"];
    if(!valid.includes(name)) name="home";
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    $(`view-${name}`)?.classList.add("active");
    document.querySelectorAll("[data-route]").forEach(x=>x.classList.toggle("active",x.dataset.route===name));
    if(push && location.hash !== `#${name}`) history.pushState(null,"",`#${name}`);
    if(name==="progress") renderProgress();
    if(name==="materials") renderMaterials();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function bindActions(){
    $("continueButton").onclick=()=>openLesson(Number(state.currentTopic)||0);
    $("zeroMistakesButton").onclick=()=>startMistakesQuiz("Entrenador 0 fallos");
    $("mistakesTrainButton").onclick=()=>startMistakesQuiz("Practicar falladas");
    $("syncButton").onclick=()=>syncFromRemote({silent:false});
    $("syncButton2").onclick=()=>syncFromRemote({silent:false});
    document.querySelectorAll('.filter-pill[data-filter]').forEach(b=>b.addEventListener('click',()=>{simulatorFilter=b.dataset.filter;document.querySelectorAll('.filter-pill[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderSimulators();}));
    $("exportProgress").onclick=exportProgress;
    $("importProgress").addEventListener('change',importProgress);
    $("modalClose").onclick=closeModal;
    $("modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop") closeModal();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape") closeModal();});
  }

  function renderAll(){ renderHeader(); renderWeek(); renderPath(); renderTopics(); renderSimulators(); renderMistakes(); renderProgress(); renderMaterials(); renderHomeGoals(); }
  function renderHeader(){
    const info=levelInfo();
    $("xpTop").textContent=state.xp||0; $("streakTop").textContent=state.streak||0; $("streakCard").textContent=`${state.streak||0} días`;
    if($("bestStreakTop")) $("bestStreakTop").textContent=state.bestStreak||0;
    const goal=CFG.dailyGoalXp||100, d=Math.min(state.dailyXp||0,goal);
    $("dailyText").textContent=`${state.dailyXp||0} / ${goal} XP`; $("dailyBar").style.width=`${Math.min(100,(d/goal)*100)}%`;
    $("levelNumber").textContent=info.level; $("levelLabel").textContent=info.label;
    $("mistakesBadge").textContent=state.mistakes.length;
    $("syncMini").textContent=state.lastSync?"Sincronizado":"Guardado local";
  }
  function renderWeek(){
    const wrap=$("weekDots"); wrap.innerHTML=""; const letters=["L","M","X","J","V","S","D"];
    const now=new Date(), monday=new Date(now); monday.setHours(12,0,0,0); monday.setDate(now.getDate()-((now.getDay()+6)%7));
    const active=new Set(state.activityDates||[]);
    letters.forEach((l,i)=>{const dt=new Date(monday);dt.setDate(monday.getDate()+i);const key=todayKey(dt),done=active.has(key);const d=document.createElement("div");d.className="week-day"+(done?" done":"");d.innerHTML=`<i>${done?"✓":""}</i><span>${l}</span>`;wrap.appendChild(d);});
  }
  function topicState(i){
    const base=state.topics[i] || {};
    const t=topics.find(x=>String(x.id)===String(i));
    if(!t) return {...base,progress:0,completed:false};
    const total=getTopicQuestions(t).length;
    const seen=getPracticeSeen(i).length;
    const progress=total?Math.round((Math.min(seen,total)/total)*100):0;
    return {...base,progress,completed:total>0&&seen>=total,answered:Math.min(seen,total),total,pending:Math.max(0,total-seen)};
  }
  function renderPath(){
    const wrap=$("learningPath"); wrap.innerHTML="";
    topics.slice(0,7).forEach(t=>{const s=topicState(t.id), done=s.completed||s.progress>=100, current=(Number(t.id)===Number(state.currentTopic)&&!done);const n=document.createElement("div");n.className=`path-node ${done?"done":current?"current":""}`;n.innerHTML=`<button class="node-bubble">${done?"✓":t.icon||"📘"}</button><div class="node-content"><small>${t.unassigned?"EXTRA":`TEMA ${t.id}`}</small><h3>${esc(t.title)}</h3><p>${esc(t.description||"")}</p><div class="node-progress"><i style="width:${Math.min(100,s.progress||0)}%"></i></div></div>`;n.querySelectorAll("button,.node-content").forEach(x=>x.onclick=()=>openLesson(t.id));wrap.appendChild(n);});
  }
  function renderTopics(){
    const wrap=$("topicsGrid"); wrap.innerHTML="";
    topics.forEach((t,i)=>{
      const s=topicState(t.id), count=getTopicQuestions(t).length;
      const c=document.createElement("article");c.className="topic-card";
      c.innerHTML=`<div class="topic-head"><span class="topic-icon">${t.icon||"📘"}</span><span class="topic-number">${t.unassigned?"EXTRA":`TEMA ${t.id}`}</span></div><h3>${esc(t.title)}</h3><p>${esc(t.description||"")}</p><small class="bank-count"><b>${count}</b> preguntas del banco · ${s.answered||0} hechas · ${s.pending??count} pendientes</small><div class="node-progress"><i style="width:${Math.min(100,s.progress||0)}%"></i></div><div class="topic-actions"><button class="lesson">Clase visual</button><button class="practice">Practicar</button></div>`;
      c.querySelector(".lesson").onclick=e=>{e.stopPropagation();openLesson(t.id)};
      c.querySelector(".practice").onclick=e=>{e.stopPropagation();openTopicPracticeMenu(t)};
      c.onclick=()=>openTopicPracticeMenu(t);wrap.appendChild(c);
    });
  }
  function renderSimulators(){
    const wrap=$("simGrid");wrap.innerHTML="";
    const sims=[...new Set(questions.map(q=>Number(q.simulacro)))].sort((a,b)=>a-b);
    sims.forEach(i=>{
      const s=state.simulators[i]||{},done=Boolean(s.done),approved=done&&s.errors<=3;
      if(simulatorFilter==='pending'&&done)return;
      if(simulatorFilter==='done'&&!done)return;
      if(simulatorFilter==='approved'&&!approved)return;
      const c=document.createElement('article');c.className=`sim-card ${approved?'approved':done?'failed':''}`;
      c.innerHTML=`<div class="sim-top"><strong>Simulacro ${String(i).padStart(2,'0')}</strong><small>30 preguntas</small></div><div class="sim-score">${done?`${30-(s.errors||0)}/30`:'—'}</div><div class="sim-status">${done?(approved?`✅ Aprobado · ${s.errors} fallos`:`❌ ${s.errors} fallos`):'Pendiente'}</div><div class="sim-substatus">${done?'Volver a intentar':'Empezar ahora'}</div>`;
      c.onclick=()=>startSimulator(i);wrap.appendChild(c);
    });
    if(!wrap.children.length)wrap.innerHTML='<p class="no-tests">No hay simulacros con ese filtro.</p>';
  }
  function renderMistakes(){
    $("mistakeCountBig").textContent=state.mistakes.length; $("mistakesBadge").textContent=state.mistakes.length; const list=$("mistakesList");
    if(!state.mistakes.length){list.className="empty-state";list.innerHTML='<span>🎯</span><h3>Aquí aparecerán tus fallos</h3><p>Cuando falles una pregunta, quedará guardada para repasarla.</p>';return;}
    list.className="panel";list.innerHTML=state.mistakes.slice(0,30).map((m,i)=>{const q=byCode.get(String(m.preguntaCodigo));return `<div class="mistake-row"><span>#${i+1}</span><div><b>${esc(q?.pregunta||m.question||`Pregunta ${m.preguntaCodigo}`)}</b><small>${q?`Simulacro ${q.simulacro} · Pregunta ${q.numero_pregunta}`:""}</small></div><button data-code="${esc(m.preguntaCodigo)}">Practicar</button></div>`;}).join("");
    list.querySelectorAll("button[data-code]").forEach(b=>b.onclick=()=>{const q=byCode.get(String(b.dataset.code));if(q) startQuiz([q],{title:"Repaso de fallo",mode:"practice",topicId:null});});
  }
  function renderProgress(){
    $("xpMetric").textContent=state.xp||0; $("streakMetric").textContent=`${state.streak||0} días`; const sims=Object.entries(state.simulators).filter(([id,x])=>isActiveSimulator(id)&&x.done); $("testsMetric").textContent=sims.length;
    if($("bestStreakMetric")) $("bestStreakMetric").textContent=`${state.bestStreak||0} días`;
    if($("todayXpMetric")) $("todayXpMetric").textContent=`${state.dailyXp||0} XP`;
    if($("levelMetric")) $("levelMetric").textContent=`Nivel ${levelInfo().level}`;
    const hist=(state.history||[]).filter(h=>h.type!=='exam'||isActiveSimulator(historySimulatorId(h))), total=hist.reduce((a,x)=>a+(x.total||0),0), right=hist.reduce((a,x)=>a+(x.correct||0),0); $("accuracyMetric").textContent=total?`${Math.round((right/total)*100)}%`:"—";
    $("topicProgressList").innerHTML=topics.map((t,i)=>{const s=topicState(t.id),p=Math.min(100,s.progress||0);return `<div class="topic-progress-row"><div><span>${t.unassigned?"Extra":`Tema ${t.id}`} · ${esc(t.title)} <small>${s.answered||0}/${s.total||0}</small></span><b>${p}%</b></div><div class="mini-track"><i style="width:${p}%"></i></div></div>`;}).join("");
    renderExamAnalytics();
    renderDiagnostics();
  }
  function isActiveSimulator(id){
    return id !== null && id !== undefined && availableSimulators.has(Number(id));
  }
  function historySimulatorId(h){
    if(h.simulator !== null && h.simulator !== undefined) return Number(h.simulator);
    const m=String(h.title||'').match(/^Simulacro\s+0*(\d+)\b/i);
    return m ? Number(m[1]) : NaN;
  }
  function examHistory(){
    return (state.history||[]).filter(h=>h&&h.type==='exam'&&Number(h.total)===30&&Number.isFinite(Number(h.errors))&&isActiveSimulator(historySimulatorId(h)));
  }
  function mean(arr){return arr.length?arr.reduce((s,x)=>s+Number(x.errors),0)/arr.length:null;}
  function numberText(n){return n===null||!Number.isFinite(n)?'—':n.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1});}
  function examSummary(){
    const h=examHistory(),recent=h.slice(-5),previous=h.slice(-10,-5),g=mean(h),r=mean(recent),prev=mean(previous);
    return {h,recent,g,r,prev,passes:h.filter(x=>x.errors<=3).length,ideal:h.filter(x=>x.errors<=1).length,ready:recent.length>=5&&recent.every(x=>x.errors<=1)};
  }
  function renderHomeGoals(){
    const s=examSummary();
    $('homeMean').textContent=numberText(s.g);$('homeLast').textContent=numberText(s.r);
    const label=$('homeReadyLabel'),advice=$('homeReadyAdvice');
    if(!s.h.length){label.textContent='Sin datos todavía';advice.textContent='Haz tu primer test de 30 preguntas para medir tu nivel.';return;}
    if(s.ready){label.textContent='¡Objetivo 0–1 conseguido!';advice.textContent='Tus últimos 5 simulacros tienen 0 o 1 fallo. Sigue repasando las preguntas difíciles.';}
    else if(s.r!==null&&s.r<=3){label.textContent='En zona de aprobado';advice.textContent='Ya rondas el aprobado. El próximo objetivo es que los fallos bajen hasta 0–1.';}
    else{label.textContent='Seguimos mejorando';advice.textContent='Prioriza tus preguntas falladas y repite simulacros hasta reducir la media.';}
  }
  function renderExamAnalytics(){
    const s=examSummary(),h=s.h;
    $('avgErrorsMetric').textContent=numberText(s.g);
    $('avgRecentMetric').textContent=numberText(s.r);
    $('passRateMetric').textContent=h.length?`${Math.round(s.passes/h.length*100)}%`:'—';
    $('idealRateMetric').textContent=h.length?`${Math.round(s.ideal/h.length*100)}%`:'—';
    const change=s.prev!==null&&s.r!==null?s.prev-s.r:null;
    const delta=change===null?'':change>0.15?` En los últimos 5 estás bajando ${numberText(change)} fallos de media frente a los 5 anteriores.`:change<-.15?` En los últimos 5 la media ha subido ${numberText(-change)} fallos: conviene repasar.`:' La media de los últimos 5 es muy parecida a los 5 anteriores.';
    $('readinessMessage').textContent=!h.length?'Aquí veremos tu nivel real después de completar simulacros de 30 preguntas.':s.ready?'¡Estás cumpliendo la meta exigente! Cinco tests seguidos con 0 o 1 fallo. Mantén el ritmo antes del examen.':s.r<=1?'Tu media reciente ya está entre 0 y 1. Busca cinco simulacros seguidos con ese resultado.'+delta:s.r<=3?'Tu media reciente ya entra en el aprobado (máximo 3), pero queremos una reserva de seguridad: 0–1.'+delta:'Tu media reciente todavía está por encima del aprobado. Practica tus errores y busca bajar hasta 3, luego a 1.'+delta;
    const last5Pass=s.recent.filter(x=>x.errors<=3).length,last5Ideal=s.recent.filter(x=>x.errors<=1).length;
    $('milestoneList').innerHTML=`<div class="milestone"><span>Primera meta · ≤3 fallos</span><b>${s.recent.length?`${last5Pass}/${s.recent.length} recientes`:'Pendiente'}</b></div><div class="milestone"><span>Meta ideal · 0–1 fallos</span><b>${s.recent.length?`${last5Ideal}/${s.recent.length} recientes`:'Pendiente'}</b></div><div class="milestone"><span>Constancia · últimos 5 todos 0–1</span><b>${s.ready?'✅ Conseguido':'En progreso'}</b></div>`;
    const recent=h.slice(-12);
    $('errorsTrend').innerHTML=recent.length?`<div class="error-chart">${recent.map((x,i)=>{const n=Number(x.errors),pct=Math.max(3,Math.min(100,n/12*100));return `<div class="error-column" title="${esc(x.title||'Simulacro')} · ${n} fallos"><b>${n}</b><div class="error-track"><i style="height:${pct}%;background:${n<=1?'#58cc02':n<=3?'#ffc800':'#ff4b4b'}"></i></div><small>${i+1}</small></div>`;}).join('')}</div><div class="chart-legend">🟢 0–1 ideal · 🟡 2–3 aprobado · 🔴 4+ repasar</div>`:'<p class="empty-analytics">Aún no hay simulacros terminados.</p>';
    $('attemptHistory').innerHTML=h.length?`<div class="history-list">${h.slice(-12).reverse().map(x=>`<div class="attempt-row"><div><b>${esc(x.title||'Simulacro')}</b><small>${x.date?new Date(x.date).toLocaleDateString('es-ES'):'Fecha no guardada'}</small></div><span class="attempt-count ${x.errors<=1?'ideal':x.errors<=3?'pass':'fail'}">${x.errors} fallo${x.errors===1?'':'s'}</span></div>`).join('')}</div>`:'<p class="empty-analytics">Tus tests aparecerán aquí cuando los termines.</p>';
    const topicStats=new Map();for(const [code,v] of Object.entries(state.perQuestion||{})){const q=byCode.get(String(code));if(!q||q.study_topic==null)continue;const key=Number(q.study_topic),e=topicStats.get(key)||{right:0,wrong:0};e.right+=Number(v.correct)||0;e.wrong+=Number(v.wrong)||0;topicStats.set(key,e);}
    const weak=[...topicStats.entries()].filter(([k,v])=>v.wrong>0).map(([k,v])=>({...v,id:k,rate:Math.round(v.wrong/(v.wrong+v.right)*100)})).sort((a,b)=>b.wrong-a.wrong||b.rate-a.rate).slice(0,5);
    $('weakTopicList').innerHTML=weak.length?weak.map(v=>{const t=topics.find(t=>Number(t.id)===v.id);return `<button class="weak-topic" data-topic="${v.id}"><span>${t?.icon||'📘'} ${esc(t?.title||`Tema ${v.id}`)}</span><b>${v.wrong} fallos · ${v.rate}%</b></button>`;}).join(''):'<p class="empty-analytics">Cuando falles preguntas, aquí saldrán los temas que necesitas repasar.</p>';
    $('weakTopicList').querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>openLesson(Number(b.dataset.topic)));
  }
  function recordQuestion(q,correct){
    const key=String(q.preguntaCodigo),p=state.perQuestion[key]||{correct:0,wrong:0};
    if(correct)p.correct=(p.correct||0)+1;else p.wrong=(p.wrong||0)+1;
    p.lastDate=new Date().toISOString();state.perQuestion[key]=p;
  }
  function renderMaterials(){
    if(!$('libraryDocs'))return;
    $('libraryDocs').innerHTML=(materials.pdfs||[]).map((b,i)=>`<a class="library-doc" href="${esc(b.path)}" target="_blank" rel="noopener"><span>${i?'🚗':'📚'}</span><div><strong>${esc(b.title)}</strong><small>${b.pages} páginas · Consultar PDF</small></div><b>↗</b></a>`).join('');
    $('libraryGrid').innerHTML=Array.from({length:18},(_,i)=>{const n=i+1,b=(materials.books||[]).find(x=>x.id===n),image=b?.infografia?`<img loading="lazy" src="${esc(b.infografia)}" alt="Ficha visual del tema ${n}">`:'<div class="no-sheet">📖<span>Consultar el tema en el PDF</span></div>';return `<article class="library-item">${image}<div class="library-item-content"><b>Tema ${n}</b><div class="library-actions">${b?.infografia?`<button data-image="${esc(b.infografia)}">Ampliar ficha</button>`:''}<a href="materiales/Temas_PermisoB.pdf#page=${b?.temas_pdf_page||1}" target="_blank" rel="noopener">Leer tema ↗</a></div></div></article>`;}).join('');
    $('libraryGrid').querySelectorAll('button[data-image]').forEach(b=>b.onclick=()=>{showModal(`<div class="sheet-viewer"><h2 id="modalTitle">Ficha visual · Permiso B</h2><img src="${esc(b.dataset.image)}" alt="Ficha ampliada" /></div>`);});
  }
  function exportProgress(){
    const backup={format:'PermisoB_v13',createdAt:new Date().toISOString(),state:state};const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`mi_progreso_permisoB_${todayKey()}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importProgress(e){
    const f=e.target.files?.[0];if(!f)return;
    try{if(f.size>5000000)throw Error('El archivo es demasiado grande');const d=JSON.parse(await f.text()),payload=d.state||d;
      if(!payload||!Array.isArray(payload.history)||!Array.isArray(payload.mistakes)||typeof payload.topics!=='object')throw Error('No parece una copia válida de PermisoB');
      if(!confirm('¿Quieres fusionar esta copia con tu progreso actual? Se guardarán los resultados de ambas.'))return;
      state=normalizeState(mergeStates(state,normalizeState(payload)));saveState();renderAll();showError('Se ha importado y fusionado tu progreso.');
    }catch(err){showError(`No se pudo importar: ${err.message}`);}finally{e.target.value='';}
  }
  function renderDiagnostics(){
    const d=state.diagnostics||{}; $("syncDiagnostics").innerHTML=`<div class="diag-row"><span>Banco AEOL</span><b class="${String(d.bank).startsWith("OK")?"diag-ok":"diag-warn"}">${esc(d.bank||"—")}</b></div><div class="diag-row"><span>Local</span><b class="diag-ok">${esc(d.local||"OK")}</b></div><div class="diag-row"><span>Remoto/Turso</span><b class="${String(d.remote).startsWith("OK")?"diag-ok":"diag-warn"}">${esc(d.remote||"No configurado")}</b></div><div class="diag-row"><span>Fusión</span><b>${esc(d.merge||"Pendiente")}</b></div><div class="diag-row"><span>Último sync</span><b>${state.lastSync?new Date(state.lastSync).toLocaleString("es-ES"):"Nunca"}</b></div>`;
  }

  function getTopicQuestions(t){
    if(!questions.length) return [];
    return questions.filter(q=>Number(q.study_topic)===Number(t.id));
  }
  function normalize(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
  function shuffle(arr){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  function practiceRecord(topicId){
    const key=String(topicId);
    const r=state.topicPractice[key] || {cycle:1,seen:[],correct:0,wrong:0};
    r.seen=Array.isArray(r.seen)?r.seen.map(String):[];
    r.cycle=Math.max(1,Number(r.cycle)||1);r.correct=Number(r.correct)||0;r.wrong=Number(r.wrong)||0;
    state.topicPractice[key]=r;return r;
  }
  function getPracticeSeen(topicId){
    return [...new Set(practiceRecord(topicId).seen)].filter(code=>{
      const q=byCode.get(String(code));
      return q && Number(q.study_topic)===Number(topicId);
    });
  }
  function pendingTopicQuestions(t){
    const seen=new Set(getPracticeSeen(t.id).map(String));
    return getTopicQuestions(t).filter(q=>!seen.has(String(q.preguntaCodigo)));
  }
  function resetTopicCycle(topicId){
    const r=practiceRecord(topicId);r.cycle+=1;r.seen=[];r.correct=0;r.wrong=0;state.topicPractice[String(topicId)]=r;saveState();
  }
  function markTopicQuestionSeen(topicId,q,correct){
    if(topicId===null||topicId===undefined)return;
    const r=practiceRecord(topicId),code=String(q.preguntaCodigo);
    if(!r.seen.includes(code)){r.seen.push(code);if(correct)r.correct+=1;else r.wrong+=1;}
    state.topicPractice[String(topicId)]=r;
  }

  function openLesson(topicId){
    const t=topics.find(x=>Number(x.id)===Number(topicId))||topics[0]; if(!t) return;
    currentSlide=0;
    renderStudyLesson(t);
  }
  function studyTopic(t){ return study?.topics?.[String(t.id)] || {cards:[],manual_pages:[]}; }
  function renderStudyLesson(t){
    const st=studyTopic(t), cards=st.cards||[];
    const slides=[...cards,{title:"Practica para fijarlo",body:`Este tema tiene ${getTopicQuestions(t).length} preguntas exactas del banco revisado. Haz 5, 10, 30, las que quieras o todas las pendientes.`,memory:"APRENDER → PREGUNTAR → FALLAR → ENTENDER → REPETIR"}];
    showModal(renderStudySlide(t,slides,st));
    bindStudyControls(t,slides,st);
  }
  function renderStudySlide(t,slides,st){
    const s=slides[currentSlide]||slides[0];
    const progress=Math.round(((currentSlide+1)/slides.length)*100);
    return `<div class="study-lesson"><div class="study-top"><div><span class="section-kicker">APRENDE FÁCIL · TEMA ${t.id}</span><h2 id="modalTitle">${esc(t.title)}</h2></div><span class="study-count">${currentSlide+1}/${slides.length}</span></div><div class="study-progress"><i style="width:${progress}%"></i></div><div class="memory-card"><span class="memory-icon">${t.icon||"📘"}</span><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p><div class="memory-hook"><b>🧠 QUÉDATE CON ESTO</b><span>${esc(s.memory)}</span></div></div><div class="study-extra"><button class="btn ghost" id="openManualGallery">🖼️ Cuadros e imágenes del manual <small>${(st.manual_pages||[]).length} páginas</small></button><button class="btn ghost" id="openPracticeFromStudy">🎯 Ir a preguntas del tema</button><a class="btn ghost link-button" target="_blank" rel="noopener" href="materiales/Temas_PermisoB.pdf#page=${st.temas_page||1}">📚 Ver explicación del PDF ↗</a></div><div class="slide-controls"><button class="btn ghost" id="prevStudy" ${currentSlide===0?"disabled":""}>Anterior</button><button class="btn primary" id="nextStudy">${currentSlide===slides.length-1?"Elegir práctica":"Lo tengo →"}</button></div></div>`;
  }
  function bindStudyControls(t,slides,st){
    $("prevStudy")?.addEventListener("click",()=>{if(currentSlide>0){currentSlide--;$("modalContent").innerHTML=renderStudySlide(t,slides,st);bindStudyControls(t,slides,st);}});
    $("nextStudy")?.addEventListener("click",()=>{
      if(currentSlide<slides.length-1){markStudyCard(t.id,currentSlide);currentSlide++;$("modalContent").innerHTML=renderStudySlide(t,slides,st);bindStudyControls(t,slides,st);}
      else{markStudyCard(t.id,currentSlide);markLessonProgress(t.id);openTopicPracticeMenu(t);}
    });
    $("openPracticeFromStudy")?.addEventListener("click",()=>{markLessonProgress(t.id);openTopicPracticeMenu(t);});
    $("openManualGallery")?.addEventListener("click",()=>openManualGallery(t,st));
  }
  function openManualGallery(t,st){
    const pages=st.manual_pages||[];
    if(!pages.length) return showError("Este bloque no tiene una lámina específica en el manual original.");
    showModal(`<div class="manual-gallery"><span class="section-kicker">MANUAL ORIGINAL · TEMA ${t.id}</span><h2 id="modalTitle">${esc(t.title)}</h2><p>Estas láminas conservan los cuadros, señales e imágenes del PDF original. Úsalas como apoyo visual; las tarjetas anteriores son el resumen para memorizar.</p><div class="manual-page-list">${pages.map((src,i)=>`<figure><img src="${esc(src)}" loading="lazy" alt="Página ${st.manual_page_numbers?.[i]||i+1} del manual"><figcaption>Página ${st.manual_page_numbers?.[i]||i+1}</figcaption></figure>`).join("")}</div><div class="manual-actions"><button class="btn ghost" id="backToStudy">← Volver a tarjetas</button><button class="btn primary" id="manualPractice">Practicar tema</button></div></div>`);
    $("backToStudy").onclick=()=>{renderStudyLesson(t);};
    $("manualPractice").onclick=()=>{markLessonProgress(t.id);openTopicPracticeMenu(t);};
  }
  function markStudyCard(id,cardIndex){
    const s=state.topics[id]||{};s.studyCards=Array.isArray(s.studyCards)?s.studyCards:[];const key=String(cardIndex);
    if(!s.studyCards.includes(key)){s.studyCards.push(key);addXp(4,"tarjeta de teoría");}
    else registerActivity(1,"repaso de teoría");
    state.topics[id]=s;saveState();renderHeader();renderWeek();
  }
  function markLessonProgress(id){const s=state.topics[id]||{};if(!s.lessonDone){s.lessonDone=true;addXp(12,"tema estudiado");}else registerActivity(0,"repaso de tema");state.topics[id]=s;state.currentTopic=Math.max(Number(state.currentTopic)||0,Number(id));saveState();renderAll();}

  function openTopicPracticeMenu(t){
    const total=getTopicQuestions(t).length, pending=pendingTopicQuestions(t).length, r=practiceRecord(t.id), done=total-pending;
    const completed=pending===0&&total>0;
    showModal(`<div class="practice-menu"><span class="section-kicker">${t.unassigned?"PREGUNTAS EXTRA":`TEMA ${t.id}`}</span><h2 id="modalTitle">${esc(t.title)}</h2><div class="practice-stats"><div><b>${total}</b><span>Total</span></div><div><b>${done}</b><span>Hechas</span></div><div><b>${pending}</b><span>Pendientes</span></div><div><b>${r.cycle}</b><span>Vuelta</span></div></div>${completed?`<div class="cycle-complete">✅ Has hecho todas las preguntas de este tema en esta vuelta. Al empezar otra práctica iniciaremos una vuelta nueva sin repeticiones.</div>`:`<p class="practice-note">Solo saldrán preguntas pendientes de esta vuelta. Acertadas y falladas cuentan como hechas; los fallos siguen en “Falladas”.</p>`}<div class="practice-options"><button data-count="5">5 preguntas</button><button data-count="10">10 preguntas</button><button data-count="30">30 preguntas</button><button data-count="all" class="wide">Todas las ${completed?"preguntas":"pendientes"}</button></div><div class="custom-count"><label for="customQuestionCount">Cantidad personalizada</label><div><input id="customQuestionCount" type="number" min="1" max="${Math.max(1,total)}" placeholder="Ej. 20"><button id="customStart">Empezar</button></div></div>${state.mistakes.some(m=>getTopicQuestions(t).some(q=>String(q.preguntaCodigo)===String(m.preguntaCodigo)))?`<button class="btn ghost topic-mistakes" id="topicMistakesBtn">Practicar solo falladas de este tema</button>`:""}</div>`);
    document.querySelectorAll(".practice-options button[data-count]").forEach(b=>b.onclick=()=>startTopicQuiz(t,b.dataset.count));
    $("customStart").onclick=()=>{const n=Math.floor(Number($("customQuestionCount").value));if(!Number.isFinite(n)||n<1)return showError("Escribe una cantidad válida de preguntas.");startTopicQuiz(t,n);};
    $("topicMistakesBtn")?.addEventListener("click",()=>startTopicMistakesQuiz(t));
  }
  function startTopicQuiz(t,count=5){
    const all=getTopicQuestions(t);if(!all.length)return showError("No hay preguntas disponibles para este tema.");
    let pending=pendingTopicQuestions(t), r=practiceRecord(t.id);
    if(!pending.length){resetTopicCycle(t.id);pending=pendingTopicQuestions(t);r=practiceRecord(t.id);}
    const wanted=count==="all"?pending.length:Math.max(1,Math.floor(Number(count)||5));
    const take=Math.min(wanted,pending.length), selected=shuffle(pending).slice(0,take);
    const suffix=take<pending.length?`${take} preguntas`:`todas las pendientes (${take})`;
    startQuiz(selected,{title:`${t.title} · ${suffix}`,mode:"practice",topicId:t.id,topicTitle:t.title,cycle:r.cycle});
  }
  function startTopicMistakesQuiz(t){
    const allowed=new Set(getTopicQuestions(t).map(q=>String(q.preguntaCodigo)));
    const qs=state.mistakes.map(m=>byCode.get(String(m.preguntaCodigo))).filter(q=>q&&allowed.has(String(q.preguntaCodigo)));
    if(!qs.length)return showError("No tienes falladas pendientes en este tema.");
    startQuiz(shuffle(qs),{title:`${t.title} · solo falladas`,mode:"practice",topicId:null,reviewOnly:true});
  }
  function startSimulator(num){const qs=questions.filter(q=>Number(q.simulacro)===Number(num)).sort((a,b)=>Number(a.numero_pregunta)-Number(b.numero_pregunta));if(!qs.length)return showError(`No se han encontrado preguntas del simulacro ${num}.`);startQuiz(qs,{title:`Simulacro ${num}`,mode:"exam",simulator:num});}
  function startMistakesQuiz(title){const qs=state.mistakes.map(m=>byCode.get(String(m.preguntaCodigo))).filter(Boolean);if(!qs.length)return showError("Aún no tienes preguntas falladas. Haz algún test y tus errores aparecerán aquí.");startQuiz(shuffle(qs).slice(0,Math.min(30,qs.length)),{title,mode:"practice",mistakes:true});}

  function startQuiz(qs,meta){
    quiz={questions:qs,index:0,answers:[],meta,answered:false};
    showModal(quizHtml()); bindQuiz();
  }
  function quizHtml(){
    const q=quiz.questions[quiz.index], total=quiz.questions.length, pos=quiz.index+1, choices=["A","B","C","D"].filter(k=>String(q[k]||"").trim());
    const image=q.image?`<div class="question-image-wrap"><img src="${esc(q.image)}" alt="Imagen de la pregunta" class="question-image" loading="eager" onerror="this.parentElement.style.display='none'"></div>`:"";
    return `<div class="quiz-shell"><div class="quiz-header"><div><span class="section-kicker">${quiz.meta.mode==="exam"?"MODO EXAMEN":"PRÁCTICA AEOL"}</span><h2 id="modalTitle">${esc(quiz.meta.title)}</h2></div><b>${pos} / ${total}</b></div><div class="quiz-progress"><i style="width:${(pos/total)*100}%"></i></div>${image}<div class="question-meta"><span>Simulacro ${q.simulacro}</span><span>Pregunta ${q.numero_pregunta}</span>${q.study_topic!=null?`<span>Tema ${esc(q.study_topic)}</span>`:""}</div><h3 class="question-text">${esc(q.pregunta)}</h3><div class="answer-list">${choices.map(k=>`<button class="answer-option" data-answer="${k}"><span>${k}</span><b>${esc(q[k])}</b></button>`).join("")}</div><div id="feedbackArea"></div><div class="quiz-footer"><button class="btn ghost" id="quizQuit">Salir</button><button class="btn primary" id="quizCheck" disabled>${quiz.meta.mode==="exam"?"Guardar y seguir":"Comprobar"}</button></div></div>`;
  }
  function bindQuiz(){
    let selected=null;
    document.querySelectorAll(".answer-option").forEach(b=>b.onclick=()=>{if(quiz.answered)return;selected=b.dataset.answer;document.querySelectorAll(".answer-option").forEach(x=>x.classList.toggle("selected",x===b));$("quizCheck").disabled=false;});
    $("quizQuit").onclick=()=>{if(confirm("¿Salir de esta práctica? Las preguntas que ya hayas respondido sí quedan guardadas.")) closeModal();};
    $("quizCheck").onclick=()=>handleAnswer(selected);
  }
  function handleAnswer(selected){
    if(!selected||quiz.answered)return; const q=quiz.questions[quiz.index], correct=String(selected)===String(q.correcta);quiz.answers.push({preguntaCodigo:q.preguntaCodigo,selected,correct,correctAnswer:q.correcta});quiz.answered=true;
    if(quiz.meta.mode==="exam") return nextQuestion();
    document.querySelectorAll(".answer-option").forEach(b=>{const k=b.dataset.answer;b.disabled=true;if(k===String(q.correcta))b.classList.add("correct");if(k===selected&&!correct)b.classList.add("wrong");});
    recordQuestion(q,correct);
    const wasMistake=state.mistakes.some(m=>String(m.preguntaCodigo)===String(q.preguntaCodigo));
    if(correct) removeMistake(q.preguntaCodigo); else addMistake(q);
    if(quiz.meta.topicId!=null) markTopicQuestionSeen(quiz.meta.topicId,q,correct);
    const earned=correct ? (wasMistake?5:3) : 1;
    addXp(earned, correct?(wasMistake?"fallo corregido":"pregunta correcta"):"pregunta intentada");
    const page=study?.topics?.[String(q.study_topic)]?.temas_page;
    const sourceLink=page?`<a class="feedback-manual" href="materiales/Temas_PermisoB.pdf#page=${page}" target="_blank" rel="noopener">📚 Ver apuntes de este tema ↗</a>`:'';
    const exp=q.explicacion||`El origen no incluye explicación detallada de esta pregunta. La respuesta correcta es ${q.correcta}. Consulta el tema para entender la regla.`;
    const f=$("feedbackArea");f.innerHTML=`<div class="answer-feedback ${correct?"ok":"bad"}"><strong>${correct?"✅ Correcto":"❌ Incorrecto"} <small>+${earned} XP</small></strong><p>${esc(exp)}</p>${!correct?`<small>Respuesta correcta: <b>${esc(q.correcta)}. ${esc(q[q.correcta]||"")}</b></small>`:""}${sourceLink}</div>`;
    $("quizCheck").textContent=quiz.index===quiz.questions.length-1?"Ver resultado":"Continuar";$("quizCheck").disabled=false;$("quizCheck").onclick=nextQuestion;
    saveState(); renderHeader(); renderMistakes();
  }
  function nextQuestion(){
    if(quiz.index < quiz.questions.length-1){quiz.index++;quiz.answered=false;$("modalContent").innerHTML=quizHtml();bindQuiz();}
    else finishQuiz();
  }
  function finishQuiz(){
    const total=quiz.questions.length, correct=quiz.answers.filter(a=>a.correct).length, errors=total-correct, pct=Math.round((correct/total)*100);
    if(quiz.meta.mode==="exam"){
      quiz.questions.forEach((q,i)=>{const a=quiz.answers[i];recordQuestion(q,!!a?.correct);if(a?.correct)removeMistake(q.preguntaCodigo);else addMistake(q);});
      state.simulators[quiz.meta.simulator]={done:true,errors,correct,total,date:new Date().toISOString()};
      addXp(10 + correct*2 + (errors<=3?20:0), errors<=3?"simulacro aprobado":"simulacro completado");
    }else{
      if(quiz.meta.topicId!=null){const s=state.topics[quiz.meta.topicId]||{};const ts=topicState(quiz.meta.topicId);s.completed=ts.completed;state.topics[quiz.meta.topicId]=s;state.currentTopic=Math.max(Number(state.currentTopic)||0,Number(quiz.meta.topicId));}
      addXp(5,"tanda de práctica completada");
    }
    state.history.push({date:new Date().toISOString(),type:quiz.meta.mode,title:quiz.meta.title,simulator:quiz.meta.simulator??null,total,correct,errors}); if(state.history.length>500)state.history=state.history.slice(-500);
    saveState(); renderAll();
    const approved=errors<=3;
    const review=quiz.meta.mode==="exam"&&errors?`<button class="btn ghost" id="reviewErrors">Revisar mis fallos</button>`:"";
    let topicNext="";
    if(quiz.meta.topicId!=null){const t=topics.find(x=>String(x.id)===String(quiz.meta.topicId));if(t){const left=pendingTopicQuestions(t).length;topicNext=`<button class="btn primary" id="continueTopic">${left?`Seguir con el tema · ${left} pendientes`:"Tema completado · nueva vuelta"}</button>`;}}
    $("modalContent").innerHTML=`<div class="result-card"><div class="result-emoji">${approved?"🎉":"📚"}</div><span class="section-kicker">RESULTADO</span><h2 id="modalTitle">${esc(quiz.meta.title)}</h2><div class="result-score">${correct}<small>/ ${total}</small></div><p>${quiz.meta.mode==="exam"?(errors<=3?`✅ Aprobado con ${errors} fallo${errors===1?"":"s"}.`:`❌ ${errors} fallos. En el examen necesitas 3 o menos.`):`${pct}% de acierto · ${errors} fallo${errors===1?"":"s"}.`}</p><div class="result-actions">${review}${topicNext}<button class="btn ghost" id="resultClose">Cerrar</button></div></div>`;
    $("resultClose").onclick=closeModal;
    $("continueTopic")?.addEventListener("click",()=>{const t=topics.find(x=>String(x.id)===String(quiz.meta.topicId));if(t)openTopicPracticeMenu(t);});
    const wrongQuestions=quiz.questions.filter((q,i)=>!quiz.answers[i]?.correct);
    $("reviewErrors")?.addEventListener("click",()=>startQuiz(shuffle(wrongQuestions),{title:'Mis fallos de este simulacro',mode:'practice'}));
  }
  function addMistake(q){if(!state.mistakes.some(m=>String(m.preguntaCodigo)===String(q.preguntaCodigo)))state.mistakes.push({preguntaCodigo:q.preguntaCodigo,question:q.pregunta,addedAt:new Date().toISOString()});}
  function removeMistake(code){state.mistakes=state.mistakes.filter(m=>String(m.preguntaCodigo)!==String(code));}

  function showError(msg){showModal(`<div class="result-card"><div class="result-emoji">ℹ️</div><h2 id="modalTitle">Información</h2><p>${esc(msg)}</p><button class="btn primary" id="resultClose">Cerrar</button></div>`);$("resultClose").onclick=closeModal;}
  function showModal(html){$("modalContent").innerHTML=html;$("modalBackdrop").hidden=false;document.body.style.overflow="hidden";}
  function closeModal(){$("modalBackdrop").hidden=true;document.body.style.overflow="";quiz=null;}

  async function syncFromRemote({silent=false}={}){
    state.diagnostics.local="OK";state.diagnostics.remote=CFG.apiBase?"Conectando…":"No configurado";state.diagnostics.merge="Pendiente";renderDiagnostics();
    if(!CFG.apiBase){saveState();if(!silent)showError("La web funciona completa en local. Si quieres sincronización entre dispositivos, configura apiBase en config.js con tu Worker/Turso.");return;}
    try{
      const userHash=await sha256(CFG.userKey||"aeol_local"), base=CFG.apiBase.replace(/\/$/,"");
      const res=await fetch(`${base}/api/state?user=${encodeURIComponent(userHash)}`,{headers:{Accept:"application/json"}});if(!res.ok)throw new Error(`HTTP ${res.status}`);
      const p=await res.json(), remote=p.state||p.state_json||p.data||p, parsed=typeof remote==="string"?JSON.parse(remote):remote;
      state=normalizeState(mergeStates(state,normalizeState(parsed)));state.lastSync=new Date().toISOString();state.diagnostics={...state.diagnostics,local:"OK",remote:"OK · estado recuperado",merge:"OK · local + remoto"};saveState({sync:false});await pushRemoteState({silent:true});renderAll();if(!silent)showError("Sincronización completada: se ha fusionado el progreso remoto con el local y se ha guardado en Turso.");
    }catch(err){state.diagnostics.remote=`Error · ${err.message}`;state.diagnostics.merge="Se conserva el estado local";saveState();renderDiagnostics();if(!silent)showError(`No se pudo sincronizar, pero tu progreso local sigue intacto. ${err.message}`);}
  }
  function mergeStates(local,remote){
    migrateTopicPractice(local); migrateTopicPractice(remote);
    const out=normalizeState({...remote,...local});
    out.xp=Math.max(local.xp||0,remote.xp||0);out.streak=Math.max(local.streak||0,remote.streak||0);out.bestStreak=Math.max(local.bestStreak||0,remote.bestStreak||0,out.streak);out.dailyXp=Math.max(local.dailyXp||0,remote.dailyXp||0);out.currentTopic=Math.max(local.currentTopic||0,remote.currentTopic||0);
    out.lastActivityDate=[local.lastActivityDate,remote.lastActivityDate].filter(Boolean).sort().pop()||null;
    out.activityDates=[...new Set([...(remote.activityDates||[]),...(local.activityDates||[])])].sort().slice(-120);
    out.streak=streakFromDates(out.activityDates);out.bestStreak=Math.max(out.bestStreak||0,out.streak||0);
    out.topics={...(remote.topics||{}),...(local.topics||{})};out.simulators={...(remote.simulators||{}),...(local.simulators||{}) };
    const hmap=new Map();for(const h of [...(remote.history||[]),...(local.history||[])]){const k=`${h.date}|${h.type}|${h.title}|${h.total}|${h.correct}`;if(!hmap.has(k))hmap.set(k,h);}
    out.history=[...hmap.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-500);
    out.perQuestion={...(remote.perQuestion||{})};for(const [code,v] of Object.entries(local.perQuestion||{})){const previous=out.perQuestion[code];if(!previous||String(v.lastDate||'')>=String(previous.lastDate||''))out.perQuestion[code]=v;}
    out.topicPractice={};
    const pkeys=new Set([...Object.keys(remote.topicPractice||{}),...Object.keys(local.topicPractice||{})]);
    pkeys.forEach(k=>{const a=remote.topicPractice?.[k]||{},b=local.topicPractice?.[k]||{};const cycle=Math.max(Number(a.cycle)||1,Number(b.cycle)||1);let seen=[];if((Number(a.cycle)||1)===(Number(b.cycle)||1)){seen=[...(a.seen||[]),...(b.seen||[])];}else{const src=(Number(a.cycle)||1)>(Number(b.cycle)||1)?a:b;seen=[...(src.seen||[])];}out.topicPractice[k]={cycle,seen:[...new Set(seen.map(String))],correct:Math.max(Number(a.correct)||0,Number(b.correct)||0),wrong:Math.max(Number(a.wrong)||0,Number(b.wrong)||0)};});
    const seenMistakes=new Set();out.mistakes=[...(remote.mistakes||[]),...(local.mistakes||[])].filter(m=>{const k=String(m.preguntaCodigo||m.id||m.question||"");if(seenMistakes.has(k))return false;seenMistakes.add(k);return true;});
    return out;
  }
  async function sha256(str){const data=new TextEncoder().encode(str);const buf=await crypto.subtle.digest("SHA-256",data);return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");}
  function esc(s){return String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
  function $(id){return document.getElementById(id);}
})();
