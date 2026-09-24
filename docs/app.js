(() => {
  "use strict";

  const CFG = window.PERMISOB_CONFIG || {};
  const STORAGE_KEY = "permisob_state_v11";
  let topics = [];
  let questions = [];
  let study = {topics:{}};
  let byCode = new Map();
  let state = loadLocalState();
  let currentSlide = 0;
  let quiz = null;
  let remotePushTimer = null;
  let remoteWriteInProgress = false;

  document.addEventListener("DOMContentLoaded", init);

  async function init(){
    bindNavigation();
    bindActions();
    await Promise.all([loadTopics(), loadQuestions(), loadStudy()]);
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

  async function loadQuestions(){
    try {
      const r = await fetch(CFG.questionsUrl || "data/questions.json", {cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      questions = d.preguntas || d.questions || [];
      byCode = new Map(questions.map(q => [String(q.preguntaCodigo), q]));
      state.diagnostics.bank = `OK · ${questions.length} preguntas`;
    } catch(e){
      state.diagnostics.bank = `Error · ${e.message}`;
      console.error("No se pudo cargar el banco", e);
    }
  }

  function freshState(){
    return {
      version:11, xp:0, streak:0, lastActive:null, dailyXp:0, dailyDate:todayKey(),
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
    out.topics ||= {}; out.topicPractice ||= {}; out.simulators ||= {}; out.mistakes ||= []; out.history ||= []; out.diagnostics ||= {};
    if(out.dailyDate !== todayKey()){ out.dailyXp=0; out.dailyDate=todayKey(); }
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
  function todayKey(){ return new Date().toISOString().slice(0,10); }

  function bindNavigation(){
    document.querySelectorAll("[data-route]").forEach(el=>el.addEventListener("click",()=>route(el.dataset.route)));
    window.addEventListener("hashchange",()=>route(location.hash.replace("#","")||"home",false));
  }
  function route(name,push=true){
    const valid=["home","topics","simulators","mistakes","progress"];
    if(!valid.includes(name)) name="home";
    document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
    $(`view-${name}`)?.classList.add("active");
    document.querySelectorAll("[data-route]").forEach(x=>x.classList.toggle("active",x.dataset.route===name));
    if(push && location.hash !== `#${name}`) history.pushState(null,"",`#${name}`);
    if(name==="progress") renderProgress();
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function bindActions(){
    $("continueButton").onclick=()=>openLesson(Number(state.currentTopic)||0);
    $("zeroMistakesButton").onclick=()=>startMistakesQuiz("Entrenador 0 fallos");
    $("mistakesTrainButton").onclick=()=>startMistakesQuiz("Practicar falladas");
    $("syncButton").onclick=()=>syncFromRemote({silent:false});
    $("syncButton2").onclick=()=>syncFromRemote({silent:false});
    $("modalClose").onclick=closeModal;
    $("modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop") closeModal();});
    document.addEventListener("keydown",e=>{if(e.key==="Escape") closeModal();});
  }

  function renderAll(){ renderHeader(); renderWeek(); renderPath(); renderTopics(); renderSimulators(); renderMistakes(); renderProgress(); }
  function renderHeader(){
    $("xpTop").textContent=state.xp||0; $("streakTop").textContent=state.streak||0; $("streakCard").textContent=`${state.streak||0} días`;
    const goal=CFG.dailyGoalXp||20, d=Math.min(state.dailyXp||0,goal);
    $("dailyText").textContent=`${d} / ${goal} XP`; $("dailyBar").style.width=`${Math.min(100,(d/goal)*100)}%`;
    const level=Math.max(1,Math.floor((state.xp||0)/100)+1); $("levelNumber").textContent=level;
    $("levelLabel").textContent=level<3?"Empezando":level<7?"Cogiendo ritmo":"A por el aprobado";
    $("mistakesBadge").textContent=state.mistakes.length;
    $("syncMini").textContent=state.lastSync?"Sincronizado":"Guardado local";
  }
  function renderWeek(){
    const wrap=$("weekDots"); wrap.innerHTML=""; const letters=["L","M","X","J","V","S","D"]; const day=(new Date().getDay()+6)%7;
    letters.forEach((l,i)=>{const d=document.createElement("div");d.className="week-day"+(i<=day&&(state.streak||0)>0?" done":"");d.innerHTML=`<i>${i<=day&&(state.streak||0)>0?"✓":""}</i><span>${l}</span>`;wrap.appendChild(d);});
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
    const wrap=$("simGrid"); wrap.innerHTML="";
    for(let i=1;i<=88;i++){const s=state.simulators[i]||{};const status=s.done?(s.errors<=3?"approved":"failed"):"";const c=document.createElement("article");c.className=`sim-card ${status}`;c.innerHTML=`<div class="sim-top"><strong>Simulacro ${String(i).padStart(2,"0")}</strong><small>30 preguntas</small></div><div class="sim-score">${s.done?`${30-(s.errors||0)}/30`:"—"}</div><div class="sim-status">${s.done?(s.errors<=3?`✅ Aprobado · ${s.errors} fallos`:`❌ ${s.errors} fallos`):"Pendiente"}</div>`;c.onclick=()=>startSimulator(i);wrap.appendChild(c);}
  }
  function renderMistakes(){
    $("mistakeCountBig").textContent=state.mistakes.length; $("mistakesBadge").textContent=state.mistakes.length; const list=$("mistakesList");
    if(!state.mistakes.length){list.className="empty-state";list.innerHTML='<span>🎯</span><h3>Aquí aparecerán tus fallos</h3><p>Cuando falles una pregunta, quedará guardada para repasarla.</p>';return;}
    list.className="panel";list.innerHTML=state.mistakes.slice(0,30).map((m,i)=>{const q=byCode.get(String(m.preguntaCodigo));return `<div class="mistake-row"><span>#${i+1}</span><div><b>${esc(q?.pregunta||m.question||`Pregunta ${m.preguntaCodigo}`)}</b><small>${q?`Simulacro ${q.simulacro} · Pregunta ${q.numero_pregunta}`:""}</small></div><button data-code="${esc(m.preguntaCodigo)}">Practicar</button></div>`;}).join("");
    list.querySelectorAll("button[data-code]").forEach(b=>b.onclick=()=>{const q=byCode.get(String(b.dataset.code));if(q) startQuiz([q],{title:"Repaso de fallo",mode:"practice",topicId:null});});
  }
  function renderProgress(){
    $("xpMetric").textContent=state.xp||0; $("streakMetric").textContent=`${state.streak||0} días`; const sims=Object.values(state.simulators).filter(x=>x.done); $("testsMetric").textContent=sims.length;
    const hist=state.history||[], total=hist.reduce((a,x)=>a+(x.total||0),0), right=hist.reduce((a,x)=>a+(x.correct||0),0); $("accuracyMetric").textContent=total?`${Math.round((right/total)*100)}%`:"—";
    $("topicProgressList").innerHTML=topics.map((t,i)=>{const s=topicState(t.id),p=Math.min(100,s.progress||0);return `<div class="topic-progress-row"><div><span>${t.unassigned?"Extra":`Tema ${t.id}`} · ${esc(t.title)} <small>${s.answered||0}/${s.total||0}</small></span><b>${p}%</b></div><div class="mini-track"><i style="width:${p}%"></i></div></div>`;}).join("");
    renderDiagnostics();
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
  function getPracticeSeen(topicId){return practiceRecord(topicId).seen;}
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
    return `<div class="study-lesson"><div class="study-top"><div><span class="section-kicker">APRENDE FÁCIL · TEMA ${t.id}</span><h2 id="modalTitle">${esc(t.title)}</h2></div><span class="study-count">${currentSlide+1}/${slides.length}</span></div><div class="study-progress"><i style="width:${progress}%"></i></div><div class="memory-card"><span class="memory-icon">${t.icon||"📘"}</span><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p><div class="memory-hook"><b>🧠 QUÉDATE CON ESTO</b><span>${esc(s.memory)}</span></div></div><div class="study-extra"><button class="btn ghost" id="openManualGallery">🖼️ Cuadros e imágenes del manual <small>${(st.manual_pages||[]).length} páginas</small></button><button class="btn ghost" id="openPracticeFromStudy">🎯 Ir a preguntas del tema</button></div><div class="slide-controls"><button class="btn ghost" id="prevStudy" ${currentSlide===0?"disabled":""}>Anterior</button><button class="btn primary" id="nextStudy">${currentSlide===slides.length-1?"Elegir práctica":"Lo tengo →"}</button></div></div>`;
  }
  function bindStudyControls(t,slides,st){
    $("prevStudy")?.addEventListener("click",()=>{if(currentSlide>0){currentSlide--;$("modalContent").innerHTML=renderStudySlide(t,slides,st);bindStudyControls(t,slides,st);}});
    $("nextStudy")?.addEventListener("click",()=>{if(currentSlide<slides.length-1){currentSlide++;$("modalContent").innerHTML=renderStudySlide(t,slides,st);bindStudyControls(t,slides,st);}else{markLessonProgress(t.id);openTopicPracticeMenu(t);}});
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
  function markLessonProgress(id){const s=state.topics[id]||{};if(!s.lessonDone){s.lessonDone=true;addXp(5);}state.topics[id]=s;state.currentTopic=Math.max(Number(state.currentTopic)||0,Number(id));saveState();renderAll();}

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
    if(correct) removeMistake(q.preguntaCodigo); else addMistake(q);
    if(quiz.meta.topicId!=null) markTopicQuestionSeen(quiz.meta.topicId,q,correct);
    const f=$("feedbackArea");f.innerHTML=`<div class="answer-feedback ${correct?"ok":"bad"}"><strong>${correct?"✅ Correcto":"❌ Incorrecto"}</strong><p>${esc(q.explicacion||`La respuesta correcta es ${q.correcta}.`)}</p>${!correct?`<small>Respuesta correcta: <b>${esc(q.correcta)}. ${esc(q[q.correcta]||"")}</b></small>`:""}</div>`;
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
      quiz.questions.forEach((q,i)=>{const a=quiz.answers[i];if(a?.correct)removeMistake(q.preguntaCodigo);else addMistake(q);});
      state.simulators[quiz.meta.simulator]={done:true,errors,correct,total,date:new Date().toISOString()};
      addXp(Math.max(5,correct));
    }else{
      if(quiz.meta.topicId!=null){const s=state.topics[quiz.meta.topicId]||{};const ts=topicState(quiz.meta.topicId);s.completed=ts.completed;state.topics[quiz.meta.topicId]=s;state.currentTopic=Math.max(Number(state.currentTopic)||0,Number(quiz.meta.topicId));}
      addXp(Math.max(3,correct*2));
    }
    state.history.push({date:new Date().toISOString(),type:quiz.meta.mode,title:quiz.meta.title,total,correct,errors}); if(state.history.length>100)state.history=state.history.slice(-100);
    saveState(); renderAll();
    const approved=quiz.meta.mode!=="exam"||errors<=3;
    const review=quiz.meta.mode==="exam"&&errors?`<button class="btn ghost" id="reviewErrors">Revisar mis fallos</button>`:"";
    let topicNext="";
    if(quiz.meta.topicId!=null){const t=topics.find(x=>String(x.id)===String(quiz.meta.topicId));if(t){const left=pendingTopicQuestions(t).length;topicNext=`<button class="btn primary" id="continueTopic">${left?`Seguir con el tema · ${left} pendientes`:"Tema completado · nueva vuelta"}</button>`;}}
    $("modalContent").innerHTML=`<div class="result-card"><div class="result-emoji">${approved?"🎉":"📚"}</div><span class="section-kicker">RESULTADO</span><h2 id="modalTitle">${esc(quiz.meta.title)}</h2><div class="result-score">${correct}<small>/ ${total}</small></div><p>${quiz.meta.mode==="exam"?(errors<=3?`✅ Aprobado con ${errors} fallo${errors===1?"":"s"}.`:`❌ ${errors} fallos. En el examen necesitas 3 o menos.`):`${pct}% de acierto · ${errors} fallo${errors===1?"":"s"}.`}</p><div class="result-actions">${review}${topicNext}<button class="btn ghost" id="resultClose">Cerrar</button></div></div>`;
    $("resultClose").onclick=closeModal;
    $("continueTopic")?.addEventListener("click",()=>{const t=topics.find(x=>String(x.id)===String(quiz.meta.topicId));if(t)openTopicPracticeMenu(t);});
    $("reviewErrors")?.addEventListener("click",()=>startMistakesQuiz("Repaso del simulacro"));
  }
  function addMistake(q){if(!state.mistakes.some(m=>String(m.preguntaCodigo)===String(q.preguntaCodigo)))state.mistakes.push({preguntaCodigo:q.preguntaCodigo,question:q.pregunta,addedAt:new Date().toISOString()});}
  function removeMistake(code){state.mistakes=state.mistakes.filter(m=>String(m.preguntaCodigo)!==String(code));}

  function showError(msg){showModal(`<div class="result-card"><div class="result-emoji">ℹ️</div><h2 id="modalTitle">Información</h2><p>${esc(msg)}</p><button class="btn primary" id="resultClose">Cerrar</button></div>`);$("resultClose").onclick=closeModal;}
  function showModal(html){$("modalContent").innerHTML=html;$("modalBackdrop").hidden=false;document.body.style.overflow="hidden";}
  function closeModal(){$("modalBackdrop").hidden=true;document.body.style.overflow="";quiz=null;}
  function addXp(n){const last=(state.lastActive||"").slice(0,10), today=todayKey();state.xp=(state.xp||0)+n;state.dailyXp=(state.dailyXp||0)+n;state.dailyDate=today;if(last!==today)state.streak=Math.max(1,(state.streak||0)+1);}

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
    const out=normalizeState({...remote,...local});
    out.xp=Math.max(local.xp||0,remote.xp||0);out.streak=Math.max(local.streak||0,remote.streak||0);out.dailyXp=Math.max(local.dailyXp||0,remote.dailyXp||0);out.currentTopic=Math.max(local.currentTopic||0,remote.currentTopic||0);
    out.topics={...(remote.topics||{}),...(local.topics||{})};out.simulators={...(remote.simulators||{}),...(local.simulators||{}) };
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
