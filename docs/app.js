(() => {
  "use strict";

  const CFG = window.PERMISOB_CONFIG || {};
  const STORAGE_KEY = "permisob_state_v9";
  let topics = [];
  let questions = [];
  let byCode = new Map();
  let state = loadLocalState();
  let currentSlide = 0;
  let quiz = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init(){
    bindNavigation();
    bindActions();
    await Promise.all([loadTopics(), loadQuestions()]);
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
      version:9, xp:0, streak:0, lastActive:null, dailyXp:0, dailyDate:todayKey(),
      currentTopic:0, topics:{}, simulators:{}, mistakes:[], history:[], lastSync:null,
      diagnostics:{local:"OK",remote:"No configurado",merge:"Pendiente",bank:"Cargando…"}
    };
  }
  function loadLocalState(){
    try { return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")); }
    catch(e){ return freshState(); }
  }
  function normalizeState(s){
    const out = Object.assign(freshState(), s || {});
    out.topics ||= {}; out.simulators ||= {}; out.mistakes ||= []; out.history ||= []; out.diagnostics ||= {};
    if(out.dailyDate !== todayKey()){ out.dailyXp=0; out.dailyDate=todayKey(); }
    return out;
  }
  function saveState(){
    state.lastActive = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  function topicState(i){ return state.topics[i] || {progress:0,completed:false}; }
  function renderPath(){
    const wrap=$("learningPath"); wrap.innerHTML="";
    topics.slice(0,7).forEach(t=>{const s=topicState(t.id), done=s.completed||s.progress>=100, current=(Number(t.id)===Number(state.currentTopic)&&!done);const n=document.createElement("div");n.className=`path-node ${done?"done":current?"current":""}`;n.innerHTML=`<button class="node-bubble">${done?"✓":t.icon||"📘"}</button><div class="node-content"><small>TEMA ${Number(t.id)+1}</small><h3>${esc(t.title)}</h3><p>${esc(t.description||"")}</p><div class="node-progress"><i style="width:${Math.min(100,s.progress||0)}%"></i></div></div>`;n.querySelectorAll("button,.node-content").forEach(x=>x.onclick=()=>openLesson(t.id));wrap.appendChild(n);});
  }
  function renderTopics(){
    const wrap=$("topicsGrid"); wrap.innerHTML="";
    topics.slice(0,18).forEach((t,i)=>{const s=topicState(t.id),count=getTopicQuestions(t).length;const c=document.createElement("article");c.className="topic-card";c.innerHTML=`<div class="topic-head"><span class="topic-icon">${t.icon||"📘"}</span><span class="topic-number">TEMA ${i+1}</span></div><h3>${esc(t.title)}</h3><p>${esc(t.description||"")}</p><small class="bank-count">${count} preguntas disponibles</small><div class="node-progress"><i style="width:${Math.min(100,s.progress||0)}%"></i></div><div class="topic-actions"><button class="lesson">Clase visual</button><button class="micro">5 preguntas</button></div>`;c.querySelector(".lesson").onclick=e=>{e.stopPropagation();openLesson(t.id)};c.querySelector(".micro").onclick=e=>{e.stopPropagation();startTopicQuiz(t,5)};c.onclick=()=>openLesson(t.id);wrap.appendChild(c);});
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
    $("topicProgressList").innerHTML=topics.slice(0,18).map((t,i)=>{const p=Math.min(100,topicState(t.id).progress||0);return `<div class="topic-progress-row"><div><span>${i+1}. ${esc(t.title)}</span><b>${p}%</b></div><div class="mini-track"><i style="width:${p}%"></i></div></div>`;}).join("");
    renderDiagnostics();
  }
  function renderDiagnostics(){
    const d=state.diagnostics||{}; $("syncDiagnostics").innerHTML=`<div class="diag-row"><span>Banco AEOL</span><b class="${String(d.bank).startsWith("OK")?"diag-ok":"diag-warn"}">${esc(d.bank||"—")}</b></div><div class="diag-row"><span>Local</span><b class="diag-ok">${esc(d.local||"OK")}</b></div><div class="diag-row"><span>Remoto/Turso</span><b class="${String(d.remote).startsWith("OK")?"diag-ok":"diag-warn"}">${esc(d.remote||"No configurado")}</b></div><div class="diag-row"><span>Fusión</span><b>${esc(d.merge||"Pendiente")}</b></div><div class="diag-row"><span>Último sync</span><b>${state.lastSync?new Date(state.lastSync).toLocaleString("es-ES"):"Nunca"}</b></div>`;
  }

  function getTopicQuestions(t){
    if(!questions.length) return [];
    if(t.all) return questions.slice();
    let out=[];
    if(Array.isArray(t.aeol_temas) && t.aeol_temas.length){const set=new Set(t.aeol_temas.map(Number));out=questions.filter(q=>set.has(Number(q.tema)));}
    if(Array.isArray(t.keywords) && t.keywords.length){const ks=t.keywords.map(normalize);const kw=questions.filter(q=>{const text=normalize(`${q.pregunta||""} ${q.explicacion||""} ${q.A||""} ${q.B||""} ${q.C||""} ${q.D||""}`);return ks.some(k=>text.includes(k));});const seen=new Set(out.map(x=>x.preguntaCodigo));kw.forEach(q=>{if(!seen.has(q.preguntaCodigo)){out.push(q);seen.add(q.preguntaCodigo);}});}
    return out.length?out:questions.slice();
  }
  function normalize(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
  function shuffle(arr){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

  function openLesson(topicId){
    const t=topics.find(x=>Number(x.id)===Number(topicId))||topics[0]; if(!t) return;
    currentSlide=0; const slides=makeSlides(t); showModal(renderSlideModal(t,slides)); bindSlideControls(t,slides);
  }
  function makeSlides(t){
    const specific={
      1:[["🚦","Jerarquía de señales","Si dos órdenes chocan, no tienen el mismo peso.","Agentes → balizamiento → semáforos → señales verticales → marcas viales."],["👀","Mira antes de memorizar","Forma, color y posición te dan pistas rápidas.","No confundas una prohibición con una obligación."],["🎯","Hazlo automático","Identifica primero qué señal manda y luego aplica la norma.","No mezcles reglas de otra señal cercana."]],
      2:[["🛣️","Primero, qué vía es","Urbana, convencional, autopista o autovía cambian los límites.","Antes del número, identifica la vía."],["🚗","Luego, qué vehículo es","El límite puede cambiar según el vehículo y las circunstancias.","No arrastres el límite del turismo a todos los vehículos."],["⚠️","Atento a las excepciones","Señalización específica, obras o condiciones pueden modificar la regla general.","La señal concreta manda sobre el límite genérico."]],
      5:[["🍺","Alcohol: pregunta de precisión","Fíjate en si pregunta tasa, riesgo, síntomas o sanción.","Una cifra solo sirve si sabes a qué conductor y medición pertenece."],["💊","Drogas y medicamentos","No confundas presencia, influencia y medicamentos prescritos.","Lee exactamente qué conducta pregunta el test."],["🎯","Descarta absolutos falsos","Siempre, nunca y únicamente requieren una regla muy clara.","Si una opción suena demasiado absoluta, vuelve al supuesto."]]
    };
    const base=specific[Number(t.id)]||[[t.icon||"📘",t.title,"Entiende primero la idea principal antes de memorizar cifras.","Una idea por pantalla."],["🧩","Ponlo en contexto",t.description||"Relaciona la norma con vehículo, vía y situación.","Busca qué dato cambia la respuesta."],["⚠️","Detecta la trampa","Fíjate en palabras como siempre, nunca, únicamente, como mínimo o permitido.","Los absolutos necesitan una regla muy clara."],["🧠","Explícatelo en una frase","Si puedes justificar una opción con una regla sencilla, estás respondiendo con criterio.","Evita responder solo porque te suena."]];
    return [...base,["🎯","Ahora compruébalo",`Tienes ${getTopicQuestions(t).length} preguntas del banco relacionadas con este bloque.`,"Haz 5 ahora y guarda automáticamente tus fallos."]];
  }
  function renderSlideModal(t,slides){const s=slides[currentSlide];return `<span class="section-kicker">CLASE VISUAL · TEMA ${Number(t.id)+1}</span><h2 id="modalTitle">${esc(t.title)}</h2><div class="lesson-slide"><div class="big">${s[0]}</div><h2>${esc(s[1])}</h2><p>${esc(s[2])}</p><div class="lesson-tip">💡 ${esc(s[3])}</div></div><div class="slide-dots">${slides.map((_,i)=>`<i class="${i===currentSlide?"active":""}"></i>`).join("")}</div><div class="slide-controls"><button class="btn ghost" id="prevSlide" ${currentSlide===0?"disabled":""}>Anterior</button><button class="btn primary" id="nextSlide">${currentSlide===slides.length-1?"Ahora compruébalo con 5":"Siguiente"}</button></div>`;}
  function bindSlideControls(t,slides){
    $("prevSlide")?.addEventListener("click",()=>{if(currentSlide>0){currentSlide--;$("modalContent").innerHTML=renderSlideModal(t,slides);bindSlideControls(t,slides);}});
    $("nextSlide")?.addEventListener("click",()=>{if(currentSlide<slides.length-1){currentSlide++;$("modalContent").innerHTML=renderSlideModal(t,slides);bindSlideControls(t,slides);}else{markLessonProgress(t.id);startTopicQuiz(t,5);}});
  }
  function markLessonProgress(id){const s=state.topics[id]||{};s.progress=Math.max(s.progress||0,35);state.topics[id]=s;state.currentTopic=Math.max(Number(state.currentTopic)||0,Number(id));addXp(5);saveState();renderAll();}

  function startTopicQuiz(t,count=5){const pool=getTopicQuestions(t);if(!pool.length)return showError("No hay preguntas disponibles para este tema.");startQuiz(shuffle(pool).slice(0,Math.min(count,pool.length)),{title:`${t.title} · ${count} preguntas`,mode:"practice",topicId:t.id});}
  function startSimulator(num){const qs=questions.filter(q=>Number(q.simulacro)===Number(num)).sort((a,b)=>Number(a.numero_pregunta)-Number(b.numero_pregunta));if(!qs.length)return showError(`No se han encontrado preguntas del simulacro ${num}.`);startQuiz(qs,{title:`Simulacro ${num}`,mode:"exam",simulator:num});}
  function startMistakesQuiz(title){const qs=state.mistakes.map(m=>byCode.get(String(m.preguntaCodigo))).filter(Boolean);if(!qs.length)return showError("Aún no tienes preguntas falladas. Haz algún test y tus errores aparecerán aquí.");startQuiz(shuffle(qs).slice(0,Math.min(30,qs.length)),{title,mode:"practice",mistakes:true});}

  function startQuiz(qs,meta){
    quiz={questions:qs,index:0,answers:[],meta,answered:false};
    showModal(quizHtml()); bindQuiz();
  }
  function quizHtml(){
    const q=quiz.questions[quiz.index], total=quiz.questions.length, pos=quiz.index+1, choices=["A","B","C","D"].filter(k=>String(q[k]||"").trim());
    const image=q.image?`<div class="question-image-wrap"><img src="${esc(q.image)}" alt="Imagen de la pregunta" class="question-image" loading="eager" onerror="this.parentElement.style.display='none'"></div>`:"";
    return `<div class="quiz-shell"><div class="quiz-header"><div><span class="section-kicker">${quiz.meta.mode==="exam"?"MODO EXAMEN":"PRÁCTICA AEOL"}</span><h2 id="modalTitle">${esc(quiz.meta.title)}</h2></div><b>${pos} / ${total}</b></div><div class="quiz-progress"><i style="width:${(pos/total)*100}%"></i></div>${image}<div class="question-meta"><span>Simulacro ${q.simulacro}</span><span>Pregunta ${q.numero_pregunta}</span>${q.tema!=null?`<span>Tema ${esc(q.tema)}</span>`:""}</div><h3 class="question-text">${esc(q.pregunta)}</h3><div class="answer-list">${choices.map(k=>`<button class="answer-option" data-answer="${k}"><span>${k}</span><b>${esc(q[k])}</b></button>`).join("")}</div><div id="feedbackArea"></div><div class="quiz-footer"><button class="btn ghost" id="quizQuit">Salir</button><button class="btn primary" id="quizCheck" disabled>${quiz.meta.mode==="exam"?"Guardar y seguir":"Comprobar"}</button></div></div>`;
  }
  function bindQuiz(){
    let selected=null;
    document.querySelectorAll(".answer-option").forEach(b=>b.onclick=()=>{if(quiz.answered)return;selected=b.dataset.answer;document.querySelectorAll(".answer-option").forEach(x=>x.classList.toggle("selected",x===b));$("quizCheck").disabled=false;});
    $("quizQuit").onclick=()=>{if(confirm("¿Salir de este test? El intento actual no se guardará.")) closeModal();};
    $("quizCheck").onclick=()=>handleAnswer(selected);
  }
  function handleAnswer(selected){
    if(!selected||quiz.answered)return; const q=quiz.questions[quiz.index], correct=String(selected)===String(q.correcta);quiz.answers.push({preguntaCodigo:q.preguntaCodigo,selected,correct,correctAnswer:q.correcta});quiz.answered=true;
    if(quiz.meta.mode==="exam") return nextQuestion();
    document.querySelectorAll(".answer-option").forEach(b=>{const k=b.dataset.answer;b.disabled=true;if(k===String(q.correcta))b.classList.add("correct");if(k===selected&&!correct)b.classList.add("wrong");});
    if(correct) removeMistake(q.preguntaCodigo); else addMistake(q);
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
      if(quiz.meta.topicId!=null){const s=state.topics[quiz.meta.topicId]||{};s.progress=Math.min(100,Math.max(s.progress||35,35+Math.round(pct*.65)));s.completed=s.progress>=90;state.topics[quiz.meta.topicId]=s;state.currentTopic=Math.max(Number(state.currentTopic)||0,Number(quiz.meta.topicId));}
      addXp(Math.max(3,correct*2));
    }
    state.history.push({date:new Date().toISOString(),type:quiz.meta.mode,title:quiz.meta.title,total,correct,errors}); if(state.history.length>100)state.history=state.history.slice(-100);
    saveState(); renderAll();
    const approved=quiz.meta.mode!=="exam"||errors<=3;
    const review=quiz.meta.mode==="exam"&&errors?`<button class="btn ghost" id="reviewErrors">Revisar mis fallos</button>`:"";
    $("modalContent").innerHTML=`<div class="result-card"><div class="result-emoji">${approved?"🎉":"📚"}</div><span class="section-kicker">RESULTADO</span><h2 id="modalTitle">${esc(quiz.meta.title)}</h2><div class="result-score">${correct}<small>/ ${total}</small></div><p>${quiz.meta.mode==="exam"?(errors<=3?`✅ Aprobado con ${errors} fallo${errors===1?"":"s"}.`:`❌ ${errors} fallos. En el examen necesitas 3 o menos.`):`${pct}% de acierto · ${errors} fallo${errors===1?"":"s"}.`}</p><div class="result-actions">${review}<button class="btn primary" id="resultClose">Continuar</button></div></div>`;
    $("resultClose").onclick=closeModal;
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
      state=normalizeState(mergeStates(state,normalizeState(parsed)));state.lastSync=new Date().toISOString();state.diagnostics={...state.diagnostics,local:"OK",remote:"OK · estado recuperado",merge:"OK · local + remoto"};saveState();renderAll();if(!silent)showError("Sincronización completada: se ha fusionado el progreso remoto con el local.");
    }catch(err){state.diagnostics.remote=`Error · ${err.message}`;state.diagnostics.merge="Se conserva el estado local";saveState();renderDiagnostics();if(!silent)showError(`No se pudo sincronizar, pero tu progreso local sigue intacto. ${err.message}`);}
  }
  function mergeStates(local,remote){const out=normalizeState({...remote,...local});out.xp=Math.max(local.xp||0,remote.xp||0);out.streak=Math.max(local.streak||0,remote.streak||0);out.dailyXp=Math.max(local.dailyXp||0,remote.dailyXp||0);out.currentTopic=Math.max(local.currentTopic||0,remote.currentTopic||0);out.topics={...(remote.topics||{}),...(local.topics||{})};out.simulators={...(remote.simulators||{}),...(local.simulators||{})};const seen=new Set();out.mistakes=[...(remote.mistakes||[]),...(local.mistakes||[])].filter(m=>{const k=String(m.preguntaCodigo||m.id||m.question||"");if(seen.has(k))return false;seen.add(k);return true;});return out;}
  async function sha256(str){const data=new TextEncoder().encode(str);const buf=await crypto.subtle.digest("SHA-256",data);return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");}
  function esc(s){return String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
  function $(id){return document.getElementById(id);}
})();
