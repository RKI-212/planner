/* =====================================================================
   ИНТЕРФЕЙС
   ===================================================================== */
const state = { sel: new Date(), weekParity: null, showDone: false };
state.sel.setHours(0,0,0,0);
const today = () => { const t=new Date(); t.setHours(0,0,0,0); return t; };
const nowMin = () => { const n=new Date(); return n.getHours()*60+n.getMinutes(); };
const view = document.getElementById("view");
const hashNow = () => (location.hash||"#day").slice(1);

/* ---------- хранилище на устройстве ---------- */
const store = {
  get(k){ try{ return localStorage.getItem(k)||""; }catch(e){ return ""; } },
  set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
  json(k,def){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):def; }catch(e){ return def; } },
  put(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function dateTitle(d){ return `${WD_FULL[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
const shortDate = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

/* =====================================================================
   ЗАДАЧИ: лабы, домашка, прочее
   ===================================================================== */
const LAB_ST = ["Не начата","Сделана","Отчёт готов","Сдана"];
const HW_ST = ["Не сделано","Готово"];
const stNames = t => t.kind==="lab" ? LAB_ST : HW_ST;
function allTasks(){
  const over = store.json("taskStatus", {});
  const fromData = (DATA.tasks||[]).map(t => ({...t, src:"data", status: over[t.id]!=null ? over[t.id] : (t.status||0)}));
  const mine = store.json("tasks", []).map(t => ({...t, src:"me"}));
  return [...fromData, ...mine].map(t => {
    let dueDate=null;
    if (t.due==="next") dueDate = nextPairDate(t.subj, parseISO(t.created||iso(today())));
    else if (t.due) dueDate = parseISO(t.due);
    const max = stNames(t).length-1;
    return {...t, dueDate, done: t.status>=max, max};
  });
}
function setTaskStatus(id, status){
  const mine=store.json("tasks", []); const m=mine.find(t=>t.id===id);
  const doneMap=store.json("taskDone", {}), t=allTasks().find(x=>x.id===id);
  if (t && status>=t.max) doneMap[id]=iso(today()); else delete doneMap[id];
  store.put("taskDone", doneMap);
  if (m){ m.status=status; store.put("tasks", mine); return; }
  const over=store.json("taskStatus", {}); over[id]=status; store.put("taskStatus", over);
}
function deleteTask(id){ store.put("tasks", store.json("tasks", []).filter(t=>t.id!==id)); }
function taskRow(t, opts={}){
  const names=stNames(t), cls = t.done ? "done" : (t.dueDate && dayNum(t.dueDate)<dayNum(today()) ? "late" : "");
  const due = t.dueDate ? (t.due==="next" ? `к паре ${shortDate(t.dueDate)}` : `до ${shortDate(t.dueDate)}`) : "без срока";
  const kind = t.kind==="lab" ? "Лаба" : t.kind==="hw" ? "Домашка" : "Задача";
  return `<div class="task ${cls}">
    <button class="tstat s${t.status} ${t.kind}" data-task="${esc(t.id)}" data-next="${(t.status+1)%names.length}" aria-label="Сменить статус">${t.done?"✓":t.status>0?t.status:""}</button>
    <div class="tbody"><div class="tt1">${esc(t.title)}</div>
      <div class="tt2">${kind} · ${esc(t.subj)}${opts.noDue?"":" · "+due} · <b>${names[t.status]}</b></div></div>
    ${t.src==="me" && opts.del ? `<button class="tdel" data-del="${esc(t.id)}" aria-label="Удалить">×</button>`:""}
  </div>`;
}

/* =====================================================================
   ЗАЛ: дневник
   ===================================================================== */
const gymLog = () => store.json("gym", {});
// с какого дня ведётся дневник (раньше — не считаем пропуски)
const gymSince = () => { let s=store.get("gymSince"); if(!s){ s=iso(today()); store.set("gymSince", s); } return s; };
const saveGym = g => store.put("gym", g);
function gymDaysBack(n){ // запланированные дни зала за последние n дней (включая сегодня)
  const out=[]; for (let i=n-1;i>=0;i--){ const d=addDays(today(),-i); if (isGymDay(d)) out.push(d); } return out;
}
function gymStats(){
  const log=gymLog(), t=today(), ev=DATA.gym.every, isDone=x=>!!(log[iso(x)]&&log[iso(x)].done);
  let d=t; while(!isGymDay(d)) d=addDays(d,-1);
  if (dayNum(d)===dayNum(t) && !isDone(d)) d=addDays(d,-ev);
  let streak=0; for (let i=0;i<300 && isDone(d);i++){ streak++; d=addDays(d,-ev); }
  const since=gymSince(); const last30=gymDaysBack(30).filter(x=>iso(x)>=since || isDone(x)), done=last30.filter(isDone).length;
  let next=t; if (!isGymDay(t) || (log[iso(t)] && log[iso(t)].done!=null)){ next=addDays(t,1); while(!isGymDay(next)) next=addDays(next,1); }
  return { streak, done, total:last30.length, next };
}
function lastExercise(name, beforeISO){
  const log=gymLog(); const keys=Object.keys(log).filter(k=>k<beforeISO).sort().reverse();
  for (const k of keys){ const ex=(log[k].ex||[]).find(e=>e.n.toLowerCase()===name.toLowerCase()); if (ex) return {date:k, ...ex}; }
  return null;
}
function exerciseNames(){ const s=new Set(); Object.values(gymLog()).forEach(e=>(e.ex||[]).forEach(x=>s.add(x.n))); return [...s].sort(); }

/* =====================================================================
   ЖИВОЕ ВРЕМЯ ЧЕРЕЗ ЯНДЕКС
   ===================================================================== */
const LIVE = { loading:null, res:{}, last:0, err:"" };
const Y = DATA.yandex;
const addrOf = k => k==="home" ? Y.home : DATA.buildings[k].geo;
const mapUrl = (from,to) => "https://yandex.ru/maps/?rtext="+encodeURIComponent(addrOf(from))+"~"+encodeURIComponent(addrOf(to))+"&rtt=auto";
function loadYmaps(){
  if (LIVE.loading) return LIVE.loading;
  LIVE.loading = new Promise((ok,fail)=>{
    if (!Y.apiKey) return fail(new Error("нет ключа"));
    const sc=document.createElement("script");
    sc.src="https://api-maps.yandex.ru/2.1/?apikey="+encodeURIComponent(Y.apiKey)+"&lang=ru_RU";
    sc.onload=()=>window.ymaps ? ymaps.ready(()=>ok(window.ymaps)) : fail(new Error("API не загрузилось"));
    sc.onerror=()=>fail(new Error("нет связи с Яндексом"));
    document.head.appendChild(sc);
  });
  LIVE.loading.catch(()=>{ LIVE.loading=null; });
  return LIVE.loading;
}
function routeMin(from,to){
  return loadYmaps().then(ym=>new Promise((ok,fail)=>{
    const m=new ym.multiRouter.MultiRouteModel([addrOf(from),addrOf(to)],{routingMode:"auto"});
    const t=setTimeout(()=>fail(new Error("таймаут")),15000);
    m.events.add("requestsuccess",()=>{ clearTimeout(t);
      const r=m.getRoutes()[0]; if(!r) return fail(new Error("маршрут не найден"));
      const p=r.properties.get("durationInTraffic")||r.properties.get("duration");
      ok(Math.round(p.value/60)); });
    m.events.add("requestfail",()=>{ clearTimeout(t); fail(new Error("ключ API не принят")); });
  }));
}
const liveKey = it => it.from+">"+it.to;
function liveFresh(it){ const r=LIVE.res[liveKey(it)]; return r && (Date.now()-r.at) < (Y.refreshMin+10)*60000 ? r : null; }
function liveDep(it){ const r=liveFresh(it); return r && it.live==="dep" ? Math.floor(it.st - r.min - it.park - DATA.road.buffer) : null; }
function inLiveWindow(it){ const n=nowMin(); return n>=it.t-Y.windowBeforeMin && n<=it.end; }
function liveHtml(it, isToday){
  if (!isToday || !inLiveWindow(it)) return "";
  const r=liveFresh(it);
  if (!r) return "";   // Яндекс недоступен — молча считаем по обычному времени
  const at=new Date(r.at), upd=at.getHours()+":"+String(at.getMinutes()).padStart(2,"0");
  if (it.live==="dep"){
    const ld=liveDep(it), diff=it.t-ld;
    return `<div class="live${diff>0?" warn":""}">Яндекс сейчас: ${r.min} мин в пути → выезжайте в ${fmt(ld)}${diff>0?` (на ${diff} мин раньше)`:diff<0?` (можно на ${-diff} мин позже)`:""} · обновлено ${upd}</div>`;
  }
  return `<div class="live">Яндекс сейчас: ${r.min} мин в пути · обновлено ${upd}</div>`;
}
function refreshLive(force){
  if (!force && Date.now()-LIVE.last < 5*60000) return;
  if (navigator.onLine===false) return;
  const items=planDay(today()).items.filter(it=>it.from && inLiveWindow(it));
  if (!items.length) return;
  LIVE.last=Date.now();
  Promise.all(items.map(it=>routeMin(it.from,it.to).then(min=>{ LIVE.res[liveKey(it)]={min, at:Date.now()}; LIVE.err=""; })
    .catch(e=>{ LIVE.err=e.message||"ошибка"; })))
    .then(()=>{ if(hashNow()==="day" && dayNum(state.sel)===dayNum(today())) renderDay(); });
}

/* =====================================================================
   ДЕНЬ
   ===================================================================== */
function renderDay(){
  const d=state.sel, isToday = dayNum(d)===dayNum(today()), plan=planDay(d), mon=mondayOf(d), log=gymLog();
  let h = `<div class="strip"><button class="arr" data-shift="-7" aria-label="Предыдущая неделя">‹</button>`;
  for (let i=0;i<7;i++){
    const x=addDays(mon,i), pl=lessonsFor(x), has=pl.lessons.length>0, gym=isGymDay(x), g=log[iso(x)];
    const cls=["d", dayNum(x)===dayNum(d)?"sel":"", dayNum(x)===dayNum(today())?"today":"", (!has)?"off":""].join(" ");
    h += `<button class="${cls}" data-go="${iso(x)}"><div class="w">${WD[x.getDay()]}</div><div class="n">${x.getDate()}</div>
      <div class="dots">${has?'<i style="background:var(--accent)"></i>':""}${gym?`<i style="background:var(--gym)${g&&g.done?"":g&&g.done===false?";opacity:.3":""}"></i>`:""}${pl.ex.length?'<i style="background:var(--warn)"></i>':""}</div></button>`;
  }
  h += `<button class="arr" data-shift="7" aria-label="Следующая неделя">›</button></div>`;
  h += `<div class="dayhead"><h2>${dateTitle(d)}</h2>${isToday?`<span class="muted small">сегодня · ${parity(d)==="odd"?"нечёт.":"чёт."}</span>`:`<button class="todaybtn" data-go="${iso(today())}">Сегодня</button>`}</div>`;
  if (isToday) h += `<div id="statusBox"></div>`;

  const s=[];
  if (plan.dep!=null) s.push(`<div class="s"><span class="muted">Выезд</span><b>${fmt(plan.dep)}</b></div>`);
  if (plan.start!=null) s.push(`<div class="s"><span class="muted">Пары</span><b>${fmt(plan.start)}–${fmt(plan.end)}</b></div>`);
  if (plan.home!=null) s.push(`<div class="s"><span class="muted">Дома</span><b>~${fmt(plan.home)}</b></div>`);
  if (plan.gym) s.push(`<div class="s" style="border-color:var(--gym)"><span class="muted">Зал</span><b style="color:var(--gym)">${plan.gym.st!=null?fmt(plan.gym.st):"да"}</b></div>`);
  if (s.length) h += `<div class="summary">${s.join("")}</div>`;
  if (d.getDay()===0 || (d.getDay()===6 && isToday && nowMin()>=18*60)) h += summaryHtml(mondayOf(d), "Итоги недели");

  // дела, платежи, учёба, бюджет
  h += lifeDayHtml(d, plan);

  plan.info.ex.forEach(e=>{
    if (e.kind==="holiday"||e.kind==="note")
      h += `<div class="it"><div class="tm">!</div><div class="blk hol"><div class="t">${esc(e.title)}</div><div class="m">${esc(e.text||"")}</div></div></div>`;
  });
  if (plan.info.outside) h += `<div class="card empty"><div class="big">🗓</div><div>Вне семестра (расписание действует 1 сентября – 31 декабря).</div></div>`;
  else if (!plan.bl.length && !plan.info.holiday) h += `<div class="card empty"><div class="big">☕</div><div><b>Пар нет</b></div><div class="muted small">${d.getDay()===0?"Воскресенье":"Свободный день"}</div></div>`;

  h += `<div class="tl">`;
  const tItems=[...plan.items, ...lifeTimelineItems(d)].sort((x,y)=>x.t-y.t);
  tItems.forEach(it=>{
    const cls = it.kind==="lesson" ? it.cls : it.kind;
    const tm = it.t>=0 ? `${fmt(it.t)}${it.end>it.t && it.kind!=="road"?`<small>${fmt(it.end)}</small>`:""}` : "—";
    let extra="";
    if (it.from) extra = liveHtml(it, isToday) + `<a class="maplink" href="${mapUrl(it.from,it.to)}" target="_blank" rel="noopener">Маршрут в Яндекс Картах ↗</a>`;
    if (it.kind==="todo"){
      h += `<div class="it" data-t="${it.t}" data-e="${it.end}"><div class="tm">${fmt(it.t)}</div><div class="blk todoblk">${todoRow(it.todo,d)}</div></div>`; return;
    }
    if (it.kind==="lesson" && dayNum(d)<=dayNum(today())){
      const m=missedPairs(store.json("attend",{}), d);
      const ps=[]; for(let p=it.pFrom;p<=it.pTo;p++) ps.push(p);
      extra = `<div class="attbtns">${ps.map(p=>{ const x=m[p]; return `<button class="ab ${x&&x.miss?(x.exc?"exc":"miss"):""}" data-att="${iso(d)}|${p}">${ps.length>1?p+" пара: ":""}${x&&x.miss?(x.exc?"не был · уваж.":"не был"):"был"}</button>`; }).join("")}</div>`;
    }
    if (it.kind==="gym"){
      const g=log[iso(d)];
      extra = `<div class="gymbtns"><button class="gb ${g&&g.done?"on":""}" data-gym="1">✓ Был</button><button class="gb miss ${g&&g.done===false?"on":""}" data-gym="0">Пропустил</button><a class="gb link" href="#gym" data-gymgo="${iso(d)}">Упражнения${g&&g.ex&&g.ex.length?` (${g.ex.length})`:""} ›</a></div>`;
    }
    h += `<div class="it" data-t="${it.t}" data-e="${it.end}"><div class="tm">${tm}</div><div class="blk ${cls}">
      <div class="t">${esc(it.title)}${it.badge?`<span class="badge ${it.cls}">${it.badge}</span>`:""}</div>
      <div class="m">${esc(it.meta||"")}</div>
      ${(it.notes||[]).map(n=>`<div class="note">${esc(n)}</div>`).join(" ")}${extra}
    </div></div>`;
  });
  h += `</div>`;
  h += sleepCardHtml(d);
  h += `<div class="card"><div class="row between"><b>Заметки на этот день</b><span class="muted small">на этом устройстве</span></div>
    <textarea id="note" placeholder="Что взять с собой, перенос пары…">${esc(store.get("note:"+iso(d)))}</textarea></div>`;
  h += `<button class="fab" id="fab" aria-label="Добавить дело или расход">+</button>`;
  view.innerHTML = h;
  document.getElementById("fab").onclick=openQuickAdd;
  document.getElementById("note").addEventListener("input", e=>store.set("note:"+iso(d), e.target.value));
  bindSleep();
  if (isToday) updateLive();
}

function updateLive(){
  const box=document.getElementById("statusBox"); if(!box) return;
  const n=nowMin(), plan=planDay(today());
  document.querySelectorAll(".it[data-t]").forEach(el=>{
    const t=+el.dataset.t, e=+el.dataset.e;
    el.classList.toggle("past", t>=0 && e>0 && e<=n);
    el.classList.toggle("now", t>=0 && t<=n && n<e);
  });
  let msg="";
  const cur=plan.items.find(it=>it.t>=0 && it.t<=n && n<it.end);
  const next=plan.items.find(it=>it.t>n || (it.live==="dep" && liveDep(it)!=null && liveDep(it)>n));
  if (cur && cur.kind==="lesson") msg=`Сейчас: ${cur.title} — до ${fmt(cur.end)}`;
  else if (next && next.live==="dep"){ const ld=liveDep(next); const t=ld!=null?ld:next.t;
    msg = t<=n ? `Пора выезжать!` : `Выезд через ${dur(t-n)} — в ${fmt(t)}${ld!=null?" (по пробкам Яндекса)":""}`; }
  else if (cur && cur.kind==="gap") msg=`Окно до ${fmt(cur.end)}`;
  else if (cur && cur.kind==="gym") msg=`Зал до ${fmt(cur.end)}`;
  else if (next) msg=`Дальше: ${next.title} в ${fmt(next.t)}`;
  else if (plan.bl.length) msg="На сегодня пары закончились";
  box.innerHTML = msg ? `<div class="status">${esc(msg)}</div>` : "";
}

/* ---------- сон: калькулятор по фазам ---------- */
// Цикл сна ~90 мин: лёгкий сон → глубокий → снова лёгкий → быстрый (REM).
// Просыпаться легче всего в конце цикла (после REM), тяжелее всего — из глубокого сна.
const sleepCfg = () => ({ fall: DATA.sleep.fallAsleep, cyc: DATA.sleep.cycle, ...store.json("sleepCfg", {}) });
function phaseAt(min, cyc){ // min — минут от засыпания
  const p=((min%cyc)+cyc)%cyc/cyc, k=Math.floor(min/cyc);
  if (p<0.1 || p>0.9) return { name:"конец цикла, лёгкий сон", cls:"ok", txt:"проснётесь легко" };
  if (p>=0.7) return { name:"быстрый сон (REM)", cls:"mid", txt:"нормально, но может быть вяло" };
  if (p>=0.15 && p<0.55) return { name: k<3 ? "глубокий сон" : "средний сон", cls: k<3?"bad":"mid", txt: k<3 ? "проснуться будет тяжело" : "терпимо" };
  return { name:"лёгкий сон", cls:"mid", txt:"терпимо" };
}
const cyclesWord = n => n%10===1&&n%100!==11?"цикл":(n%10>=2&&n%10<=4&&(n%100<10||n%100>=20))?"цикла":"циклов";
function sleepCtx(d){
  const isToday=dayNum(d)===dayNum(today()), night = isToday && nowMin()<5*60;
  const tm = night ? d : addDays(d,1), sp=sleepPlan(tm); if (!sp) return null;
  const st=store.json("sleepUI",{ready:true, mode:"wake"});
  const prep = st.ready ? DATA.sleep.prepReady : DATA.sleep.prepNotReady;
  const deadline = sp.first - prep + 1440;                       // минуты от полуночи накануне
  let bed = st.bed!=null && st.bedFor===iso(tm) ? st.bed : 23*60+30;
  if (isToday && !(st.bed!=null && st.bedFor===iso(tm))){ const n=nowMin(); if (n>=20*60) bed=ceil5(n+15); else if (night) bed=ceil5(n+15)+1440; }
  return { tm, sp, st, prep, deadline, bed, night,
    label: night ? "Сегодня" : dayNum(tm)-dayNum(today())===1 ? "Завтра" : WD_FULL[tm.getDay()] };
}
function hypnogram(asleep, endAt, marks, cyc){
  const W=320, H=64, span=Math.max(endAt-asleep, cyc), X=m=>8+(m-asleep)/span*(W-16), Y=v=>6+v*(H-22);
  const pts=[]; for (let k=0; k*cyc<span+cyc; k++){ const b=asleep+k*cyc, deep=Math.max(.45, .95-k*.13);
    [[0,.15],[.12,.4],[.25,deep],[.45,deep],[.6,.35],[.78,.05],[.9,.08],[1,.15]].forEach(([f,v])=>{ const m=b+f*cyc; if (m<=asleep+span+2) pts.push(`${X(m).toFixed(1)},${Y(v).toFixed(1)}`); }); }
  let s=`<svg class="hyp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`;
  s+=`<text x="2" y="${Y(.05)+3}" class="hl">REM</text><text x="2" y="${Y(.9)}" class="hl">глуб.</text>`;
  marks.forEach(m=>{ if (m.at<asleep||m.at>asleep+span+1) return; const x=X(m.at).toFixed(1);
    s+=`<line x1="${x}" x2="${x}" y1="2" y2="${H-14}" class="mk ${m.cls}"/><text x="${x}" y="${H-2}" text-anchor="middle" class="ml ${m.cls}">${fmt(m.at%1440)}</text>`; });
  return s+`</svg>`;
}
function sleepCardHtml(d){
  const c=sleepCtx(d); if (!c) return "";
  const cfg=sleepCfg(), mode=c.st.mode||"wake", dl=c.deadline;
  let h=`<div class="card sleep"><div class="row between"><b>☾ Сон</b><span class="small muted">${c.label}: ${c.sp.what}</span></div>
    <div class="seg mini sl-seg"><button data-ready="1" class="${c.st.ready?"on":""}">Всё готово · ${DATA.sleep.prepReady} мин</button><button data-ready="0" class="${c.st.ready?"":"on"}">Не готово · ${DATA.sleep.prepNotReady} мин</button></div>
    <div class="small muted" style="margin:6px 0">Крайний подъём — <b style="color:var(--ink)">${fmt(dl%1440)}</b></div>
    <div class="seg mini sl-mode"><button data-mode="wake" class="${mode==="wake"?"on":""}">Ложусь в…</button><button data-mode="bed" class="${mode==="bed"?"on":""}">Когда лечь?</button></div>`;
  if (mode==="wake"){
    const asleep=c.bed+cfg.fall, total=dl-asleep;
    h+=`<div class="row sl-in"><label>Ложусь в <input type="time" id="slBed" value="${String(Math.floor((c.bed%1440)/60)).padStart(2,"0")}:${String(c.bed%60).padStart(2,"0")}"></label><span class="small muted">засыпаю ~${cfg.fall} мин</span></div>`;
    if (total<=30){ h+=`<div class="sl-warn">До крайнего подъёма меньше получаса сна. Лучше вообще не ложиться надолго — или будильник на ${fmt(dl%1440)}.</div></div>`; return h; }
    const opts=[]; for (let n=1; asleep+n*cfg.cyc<=dl; n++) opts.push({ n, at:asleep+n*cfg.cyc });
    const ph=phaseAt(dl-asleep, cfg.cyc);
    let best;
    if (ph.cls==="ok"){
      const n=Math.max(1,Math.round(total/cfg.cyc));
      best={ n, at:dl };
      h+=`<div class="sl-best ok"><b>Будильник на ${fmt(dl%1440)}</b><span>${dur(total)} сна · ≈${n} ${cyclesWord(n)} — крайний подъём попадает на конец цикла, проснётесь легко</span></div>`;
    } else {
      best=opts.filter(o=>o.n>=3).pop() || opts[opts.length-1];
      if (best) h+=`<div class="sl-best ok"><b>По фазам: ${fmt(best.at%1440)}</b><span>${best.n} ${cyclesWord(best.n)} · ${dur(best.n*cfg.cyc)} сна · конец цикла, проснётесь легче · на ${dl-best.at} мин раньше крайнего</span></div>`;
      h+=`<div class="sl-best ${ph.cls}"><b>Крайний: ${fmt(dl%1440)}</b><span>${dur(total)} сна · попадает на ${ph.name} — ${ph.txt}</span></div>`;
    }
    const early=opts.filter(o=>o.n>=3 && Math.abs(o.at-best.at)>5).slice(-2).reverse();
    if (early.length) h+=`<div class="small muted" style="margin-top:4px">Ещё концы циклов: ${early.map(o=>`${fmt(o.at%1440)} (${o.n} ${cyclesWord(o.n)})`).join(" · ")}</div>`;
    if (total<6*60) h+=`<div class="sl-warn">Меньше 6 часов сна — завтра будет тяжело.</div>`;
    h+=hypnogram(asleep, dl+5, [...(best && best.at!==dl?[{at:best.at,cls:"ok"}]:[]), {at:dl,cls:best&&best.at===dl?"ok":"dl"}], cfg.cyc);
  } else {
    const wake = dl;
    const nowF = dayNum(d)===dayNum(today()) ? (c.night ? nowMin()+1440 : nowMin()) : -1e9;
    const rows=[6,5,4].map(n=>{ const bed=wake-n*cfg.cyc-cfg.fall; return { n, bed, past: bed<nowF }; });
    h+=`<div class="small muted" style="margin:6px 0">Чтобы проснуться в конце цикла ровно в ${fmt(wake%1440)}:</div>`;
    rows.forEach(r=>{ const tag = r.n===6?"идеально":r.n===5?"нормально":"минимум";
      h+=`<div class="sl-row${r.past?" past":""}"><b>${fmt(((r.bed%1440)+1440)%1440)}</b><span>${r.n} ${cyclesWord(r.n)} · ${dur(r.n*cfg.cyc)} сна</span><em class="${r.past?"mid":r.n===4?"mid":"ok"}">${r.past?"уже поздно":tag}</em></div>`; });
    h+=`<div class="small muted" style="margin-top:4px">Время отбоя уже с учётом ~${cfg.fall} мин на засыпание.</div>`;
  }
  h+=`<details class="sl-cfg"><summary class="small">Настроить под себя</summary>
    <div class="row sl-in"><label>Засыпаю за <input type="number" id="slFall" min="0" max="60" step="5" value="${cfg.fall}"> мин</label>
    <label>Цикл <input type="number" id="slCyc" min="70" max="120" step="5" value="${cfg.cyc}"> мин</label></div>
    <div class="small muted">Цикл у большинства 80–110 мин. Если по будильнику «по фазам» всё равно просыпаетесь разбитым — попробуйте 100.</div></details>`;
  window._slFor=iso(c.tm);
  return h+`</div>`;
}
function bindSleep(){
  const card=document.querySelector(".sleep"); if(!card) return;
  const rerender=()=>{ const y=scrollY; const open=card.querySelector(".sl-cfg")&&card.querySelector(".sl-cfg").open; renderDay(); scrollTo(0,y); if(open){ const c=document.querySelector(".sl-cfg"); if(c) c.open=true; } };
  const save=patch=>{ const st=store.json("sleepUI",{ready:true}); Object.assign(st,patch); store.put("sleepUI",st); rerender(); };
  const inp=document.getElementById("slBed");
  if (inp) inp.addEventListener("change",()=>{ const [h,m]=inp.value.split(":").map(Number); let b=h*60+m; if (b<12*60) b+=1440; save({bed:b, bedFor:window._slFor}); });
  card.querySelectorAll(".sl-seg button").forEach(b=>b.onclick=()=>save({ready:b.dataset.ready==="1"}));
  card.querySelectorAll(".sl-mode button").forEach(b=>b.onclick=()=>save({mode:b.dataset.mode}));
  const cfgSave=()=>{ const f=+document.getElementById("slFall").value, cy=+document.getElementById("slCyc").value;
    store.put("sleepCfg",{ fall: isFinite(f)?Math.min(60,Math.max(0,f)):15, cyc: isFinite(cy)&&cy>=60?Math.min(130,cy):90 }); rerender(); };
  ["slFall","slCyc"].forEach(id=>{ const e=document.getElementById(id); if(e) e.addEventListener("change",cfgSave); });
}

/* ---------- итоги недели ---------- */
function weekSummary(mon){
  const days=[...Array(7)].map((_,i)=>addDays(mon,i)), t0=today(), log=gymLog();
  let pairs=0, pairsPast=0; const bySubj={};
  days.forEach(d=>{ const ls=lessonsFor(d).lessons; pairs+=ls.length; if (dayNum(d)<=dayNum(t0)) pairsPast+=ls.length; ls.forEach(l=>bySubj[l.s]=(bySubj[l.s]||0)+1); });
  const gymPlan=days.filter(isGymDay), gymDone=gymPlan.filter(d=>log[iso(d)]&&log[iso(d)].done).length;
  const exCount=gymPlan.reduce((s,d)=>s+((log[iso(d)]&&log[iso(d)].ex)||[]).length,0);
  const doneMap=store.json("taskDone",{}), tasks=allTasks();
  const doneThis=tasks.filter(t=>doneMap[t.id] && doneMap[t.id]>=iso(mon) && doneMap[t.id]<=iso(days[6]));
  const open=tasks.filter(t=>!t.done), nm=addDays(mon,7);
  const overdue=open.filter(t=>t.dueDate && dayNum(t.dueDate)<dayNum(t0));
  const nextWeek=open.filter(t=>t.dueDate && dayNum(t.dueDate)>=dayNum(nm) && dayNum(t.dueDate)<=dayNum(addDays(nm,6)));
  const nDays=[...Array(7)].map((_,i)=>addDays(nm,i));
  const nPairs=nDays.reduce((s,d)=>s+lessonsFor(d).lessons.length,0);
  const firstDay=nDays.find(d=>planDay(d).dep!=null), firstPlan=firstDay&&planDay(firstDay);
  const heavy=nDays.map(d=>({d,p:planDay(d)})).filter(x=>x.p.start!=null).sort((a,b)=>(b.p.end-b.p.start)-(a.p.end-a.p.start))[0];
  return { mon, pairs, pairsPast, gymPlan:gymPlan.length, gymDone, exCount, doneThis, overdue, nextWeek, nPairs, nm, firstDay, firstPlan, heavy, parityNext:parity(nm) };
}
function summaryHtml(mon, title){
  const s=weekSummary(mon), pct=s.gymPlan?Math.round(s.gymDone/s.gymPlan*100):0;
  return `<div class="card summ"><div class="row between"><b>${title}</b><span class="small muted">${shortDate(mon)} – ${shortDate(addDays(mon,6))}</span></div>
    <div class="sgrid">
      <div><b>${s.pairs}</b><span>пар за неделю</span></div>
      <div><b style="color:var(--gym)">${s.gymDone}/${s.gymPlan}</b><span>тренировок${s.exCount?` · ${s.exCount} упр.`:""}</span></div>
      <div><b style="color:var(--pz)">${s.doneThis.length}</b><span>задач закрыто</span></div>
    </div>
    <div class="bar"><i style="width:${pct}%;background:var(--gym)"></i></div>
    ${s.overdue.length?`<div class="small" style="color:var(--warn);margin-top:8px">⚠ Просрочено: ${s.overdue.map(t=>esc(t.title)).join(", ")}</div>`:""}
    <div class="sub">Следующая неделя · ${s.parityNext==="odd"?"нечётная":"чётная"}</div>
    <div class="small">${s.nPairs} пар${s.firstPlan?` · первый выезд: ${WD_FULL[s.firstDay.getDay()].toLowerCase()} в ${fmt(s.firstPlan.dep)}`:""}${s.heavy?` · самый длинный день: ${WD_FULL[s.heavy.d.getDay()].toLowerCase()} (${fmt(s.heavy.p.start)}–${fmt(s.heavy.p.end)})`:""}</div>
    ${s.nextWeek.length?`<div class="small" style="margin-top:4px">Сдать: ${s.nextWeek.map(t=>`${esc(t.title)} (${WD[t.dueDate.getDay()]})`).join(", ")}</div>`:`<div class="small muted" style="margin-top:4px">Сроков на следующей неделе нет.</div>`}
  </div>`;
}

/* =====================================================================
   НЕДЕЛЯ
   ===================================================================== */
function renderWeek(){
  const p = state.weekParity || parity(today());
  let h = `<div class="seg"><button data-par="odd" class="${p==="odd"?"on":""}">Нечётная</button><button data-par="even" class="${p==="even"?"on":""}">Чётная</button></div>`;
  let mon=mondayOf(today()); if (parity(mon)!==p) mon=addDays(mon,7);
  if (!state.weekParity || state.weekParity===parity(today())) h += summaryHtml(mondayOf(today()), "Эта неделя");
  h += `<p class="muted small" style="margin:0 2px 10px">Ближайшая: ${shortDate(mon)} – ${shortDate(addDays(mon,6))}. Нажмите на день, чтобы открыть его план.</p>`;
  for (let i=0;i<7;i++){
    const d=addDays(mon,i), dow=d.getDay(), raw=(DATA.schedule[p][dow]||[]), plan=planDay(d), tags=[];
    if (plan.dep!=null) tags.push(`<span class="tag road">выезд ${fmt(plan.dep)}</span>`);
    if (plan.gym) tags.push(`<span class="tag gym">зал${plan.gym.st!=null?" "+fmt(plan.gym.st):""}</span>`);
    h += `<div class="card wday" data-go="${iso(d)}"><h3><span>${WD_FULL[dow]} <span class="muted small" style="font-weight:500">${d.getDate()}.${String(d.getMonth()+1).padStart(2,"0")}</span></span><span class="row">${tags.join("")}</span></h3>`;
    if (!raw.length) h += `<div class="muted small">Пар нет</div>`;
    raw.forEach(l=>{
      const cls=DATA.types[l.t]||"pz";
      const lim = l.from&&l.from>DATA.semester.from ? ` · с ${shortDate(parseISO(l.from))}` : (l.to&&l.to<DATA.semester.to? ` · до ${shortDate(parseISO(l.to))}`:"");
      h += `<div class="wl"><span class="p">${l.p}</span><span class="tt">${l.start||DATA.pairs[l.p][0]}–${DATA.pairs[l.p][1]}</span><span>${esc(l.s)}<span class="badge ${cls}">${l.t}</span><br><span class="muted small">${esc(l.r)} · ${esc(l.tch)}${lim}</span></span></div>`;
    });
    plan.info.ex.forEach(e=>{ h += `<div class="small" style="color:var(--warn);margin-top:6px">⚑ ${esc(e.title)}</div>`; });
    h += `</div>`;
  }
  view.innerHTML = h;
}

/* =====================================================================
   УЧЁБА
   ===================================================================== */
function renderStudy(){
  const subs=allSubjects(), tasks=allTasks(), t0=today();
  let h=`<h2 class="sec first">Сессия</h2>`;
  const ses=(DATA.session||[]).map(x=>({...x, d:parseISO(x.date)})).filter(x=>dayNum(x.d)>=dayNum(t0)).sort((a,b)=>a.d-b.d);
  if (ses.length){
    const f=ses[0], days=dayNum(f.d)-dayNum(t0);
    h+=`<div class="card hero"><div class="big">${days}</div><div><div class="muted small">дн. до ближайшего</div><b>${esc(f.kind)}: ${esc(f.subj)}</b><div class="small muted">${shortDate(f.d)}${f.time?", "+f.time:""}${f.room?" · "+esc(f.room):""}</div></div></div>`;
    h+=`<div class="card">${ses.map(x=>`<div class="srow"><span>${shortDate(x.d)}</span><span><b>${esc(x.kind)}</b> · ${esc(x.subj)}</span></div>`).join("")}</div>`;
  } else {
    const end=parseISO(DATA.semester.to), days=dayNum(end)-dayNum(t0);
    h+=`<div class="card hero"><div class="big">${Math.max(0,days)}</div><div><div class="muted small">дн. до конца семестра</div><b>Расписания сессии пока нет</b><div class="small muted">Пришлите его в чат, когда появится — добавлю экзамены и зачёты с отсчётом.</div></div></div>`;
  }

  // лабы по предметам
  const labSubs=subs.filter(s=>Object.values(DATA.schedule).some(p=>Object.values(p).some(ls=>ls.some(l=>l.s===s&&l.t==="ЛР"))));
  h+=`<h2 class="sec">Лабораторные</h2><div class="card">`;
  labSubs.forEach(s=>{
    const ls=tasks.filter(t=>t.kind==="lab"&&t.subj===s), done=ls.filter(t=>t.done).length;
    const pct = ls.length? Math.round(done/ls.length*100):0;
    h+=`<div class="labrow"><div class="row between"><b>${esc(s)}</b><span class="small muted">${ls.length?`${done} из ${ls.length} сдано`:"лаб пока нет"}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  });
  h+=`<p class="muted small" style="margin:8px 0 0">Нажмите на кружок у лабы, чтобы сменить статус: не начата → сделана → отчёт готов → сдана.</p></div>`;

  // добавить
  h+=`<h2 class="sec">Добавить</h2><form class="card addf" id="addTask">
    <div class="seg mini" id="kindSeg"><button type="button" data-k="lab" class="on">Лаба</button><button type="button" data-k="hw">Домашка</button><button type="button" data-k="other">Другое</button></div>
    <select id="tSubj">${[...labSubs, ...subs.filter(s=>!labSubs.includes(s))].map(s=>`<option>${esc(s)}</option>`).join("")}</select>
    <input id="tTitle" placeholder="Например: ЛР №3 «Циклы»" autocomplete="off">
    <div class="row duerow"><label><input type="radio" name="due" value="next" checked> К следующей паре</label><label><input type="radio" name="due" value="date"> К дате</label><input type="date" id="tDate" min="${DATA.semester.from}" max="${DATA.semester.to}"></div>
    <button class="primary" type="submit">Добавить</button>
  </form>`;

  // списки
  const open=tasks.filter(t=>!t.done).sort((a,b)=>(a.dueDate?dayNum(a.dueDate):1e9)-(b.dueDate?dayNum(b.dueDate):1e9));
  const late=open.filter(t=>t.dueDate&&dayNum(t.dueDate)<dayNum(t0)), soon=open.filter(t=>!late.includes(t));
  const done=tasks.filter(t=>t.done);
  h+=`<h2 class="sec">Задачи</h2>`;
  if (!tasks.length) h+=`<div class="card muted small">Пока пусто. Добавьте лабу или домашку выше — или просто напишите в чат «по программированию 5 лаб» или «к пятнице домашка по матану».</div>`;
  if (late.length) h+=`<div class="card"><div class="sub warnc">Просрочено</div>${late.map(t=>taskRow(t,{del:true})).join("")}</div>`;
  if (soon.length) h+=`<div class="card"><div class="sub">Впереди</div>${soon.map(t=>taskRow(t,{del:true})).join("")}</div>`;
  if (done.length) h+=`<div class="card"><button class="sub link" id="toggleDone">${state.showDone?"Скрыть":"Показать"} готовое (${done.length})</button>${state.showDone?done.map(t=>taskRow(t,{del:true})).join(""):""}</div>`;

  // предметы
  h+=`<h2 class="sec">Предметы</h2>`+subjectsHtml();
  view.innerHTML=delaSegHtml()+h;

  let kind="lab";
  document.querySelectorAll("#kindSeg button").forEach(b=>b.onclick=()=>{ kind=b.dataset.k; document.querySelectorAll("#kindSeg button").forEach(x=>x.classList.toggle("on",x===b)); });
  document.getElementById("addTask").onsubmit=e=>{
    e.preventDefault();
    const title=document.getElementById("tTitle").value.trim(); if(!title){ document.getElementById("tTitle").focus(); return; }
    const dueMode=document.querySelector('input[name="due"]:checked').value, date=document.getElementById("tDate").value;
    const t={ id:uid(), kind, subj:document.getElementById("tSubj").value, title, status:0, created:iso(today()),
      due: dueMode==="next" ? "next" : (date||null) };
    const mine=store.json("tasks",[]); mine.push(t); store.put("tasks",mine); toast("Добавлено"); renderStudy();
  };
  const td=document.getElementById("toggleDone"); if(td) td.onclick=()=>{ state.showDone=!state.showDone; renderStudy(); };
}

function subjectsHtml(){
  const map={};
  ["odd","even"].forEach(p=>Object.entries(DATA.schedule[p]).forEach(([dow,ls])=>ls.forEach(l=>{
    (map[l.s]=map[l.s]||{rows:[],tch:new Set()}); map[l.s].rows.push({par:p, dow:+dow, ...l}); map[l.s].tch.add(l.tch);
  })));
  return Object.keys(map).sort((a,b)=>map[b].rows.length-map[a].rows.length).map(n=>{
    const m=map[n];
    m.rows.sort((a,b)=>(a.par===b.par?0:(a.par==="odd"?-1:1))||a.dow-b.dow||a.p-b.p);
    const nx=nextPairDate(n, addDays(today(),-1));
    return `<details class="card subj"><summary><span><b>${esc(n)}</b><br><span class="muted small">${[...m.tch].map(esc).join(", ")}${nx?` · ближайшая ${shortDate(nx)}`:""}</span></span><span class="chip" style="background:var(--accent-soft);color:var(--accent)">${m.rows.length} пар / 2 нед</span></summary><ul>
      ${m.rows.map(r=>`<li>${r.par==="odd"?"Нечёт.":"Чёт."} ${WD[r.dow]}, ${r.p} пара — <span class="badge ${DATA.types[r.t]}" style="margin:0">${r.t}</span> ${esc(r.r)}</li>`).join("")}</ul></details>`;
  }).join("");
}

/* =====================================================================
   ЗАЛ
   ===================================================================== */
function renderGym(){
  const st=gymStats(), log=gymLog(), t0=today();
  let sel = state.gymDate ? parseISO(state.gymDate) : (isGymDay(t0)?t0:null);
  if (!sel){ const back=gymDaysBack(3).filter(x=>dayNum(x)<=dayNum(t0)); sel=back[back.length-1]; }
  const key=iso(sel), e=log[key]||{}, pl=planDay(sel);
  let h=`<div class="gstats">
    <div class="gs"><b>${st.streak}</b><span>серия подряд</span></div>
    <div class="gs"><b>${st.done}<small>/${st.total}</small></b><span>${st.total<15?"с начала дневника":"за 30 дней"}</span></div>
    <div class="gs"><b>${shortDate(st.next).split(" ")[0]}<small> ${MONTHS[st.next.getMonth()].slice(0,3)}</small></b><span>следующий</span></div>
  </div>`;
  // сетка последних 28 дней
  h+=`<div class="card"><div class="row between"><b>Последние 4 недели</b><span class="small muted">через день</span></div><div class="ggrid">`;
  const start=addDays(mondayOf(t0),-21);
  ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].forEach(w=>h+=`<span class="gw">${w}</span>`);
  for (let i=0;i<28;i++){
    const d=addDays(start,i), g=log[iso(d)], gd=isGymDay(d), fut=dayNum(d)>dayNum(t0);
    let c="gc"; if (gd) c+= g&&g.done ? " ok" : g&&g.done===false ? " miss" : fut||dayNum(d)===dayNum(t0) ? " plan" : iso(d)<gymSince() ? " old" : " unk";
    if (dayNum(d)===dayNum(t0)) c+=" today"; if (dayNum(d)===dayNum(sel)) c+=" sel";
    h+=`<button class="${c}" ${gd?`data-gsel="${iso(d)}"`:""}>${d.getDate()}</button>`;
  }
  h+=`</div><div class="legend small"><span><i class="lg ok"></i>был</span><span><i class="lg miss"></i>пропуск</span><span><i class="lg unk"></i>не отмечено</span><span><i class="lg plan"></i>впереди</span></div></div>`;

  // тренировка
  h+=`<div class="card"><div class="row between"><b>${dateTitle(sel)}</b>${pl.gym&&pl.gym.st!=null?`<span class="small muted">${fmt(pl.gym.st)}–${fmt(pl.gym.en)}</span>`:""}</div>
    <div class="gymbtns"><button class="gb ${e.done?"on":""}" data-gym="1" data-gd="${key}">✓ Был</button><button class="gb miss ${e.done===false?"on":""}" data-gym="0" data-gd="${key}">Пропустил</button></div>
    <div class="exlist">${(e.ex||[]).map((x,i)=>{ const prev=lastExercise(x.n,key);
      return `<div class="ex"><div><b>${esc(x.n)}</b> <span class="muted">${esc(x.w||"")}${x.w&&x.r?" · ":""}${esc(x.r||"")}</span>${prev?`<div class="small muted">прошлый раз ${shortDate(parseISO(prev.date))}: ${esc(prev.w||"")}${prev.w&&prev.r?" · ":""}${esc(prev.r||"")}</div>`:""}</div><button class="tdel" data-exdel="${i}" aria-label="Удалить">×</button></div>`; }).join("")}</div>
    <form id="exForm" class="exform">
      <input id="exN" list="exNames" placeholder="Упражнение" autocomplete="off">
      <datalist id="exNames">${exerciseNames().map(n=>`<option value="${esc(n)}">`).join("")}</datalist>
      <div class="row"><input id="exW" placeholder="Вес, кг" inputmode="decimal"><input id="exR" placeholder="Подходы×повт., 4×8"></div>
      <div id="exHint" class="small muted"></div>
      <button class="primary" type="submit">Записать</button>
    </form>
    <textarea id="gNote" placeholder="Заметка к тренировке (самочувствие, что поменять)">${esc(e.note||"")}</textarea>
  </div>`;

  // история
  const hist=Object.keys(log).filter(k=>log[k].ex&&log[k].ex.length).sort().reverse().slice(0,8);
  if (hist.length) h+=`<h2 class="sec">История</h2>`+hist.map(k=>`<div class="card hist" data-gsel="${k}"><b>${dateTitle(parseISO(k))}</b><div class="small muted">${log[k].ex.map(x=>esc(x.n)+(x.w?" "+esc(x.w):"")).join(" · ")}</div></div>`).join("");

  h+=`<h2 class="sec">Резервная копия</h2><div class="card small">Дневник зала, задачи и заметки хранятся только в этом телефоне. Время от времени сохраняйте копию — например, в «Файлы».
    <div class="row" style="margin-top:8px;gap:8px"><button class="primary ghost" id="bkOut">Сохранить копию</button><label class="primary ghost filebtn">Восстановить<input type="file" id="bkIn" accept=".json,application/json" hidden></label></div></div>`;
  view.innerHTML=h;

  const exN=document.getElementById("exN"), hint=document.getElementById("exHint");
  exN.addEventListener("input",()=>{ const p=exN.value.trim()&&lastExercise(exN.value.trim(), key);
    hint.textContent = p ? `Прошлый раз (${shortDate(parseISO(p.date))}): ${p.w||""} ${p.r||""}` : ""; if(p&&!document.getElementById("exW").value) document.getElementById("exW").placeholder=p.w||"Вес, кг"; });
  document.getElementById("exForm").onsubmit=ev=>{ ev.preventDefault();
    const n=exN.value.trim(); if(!n){ exN.focus(); return; }
    const g=gymLog(); const en=g[key]||{}; en.ex=en.ex||[]; en.ex.push({n, w:document.getElementById("exW").value.trim(), r:document.getElementById("exR").value.trim()});
    if (en.done==null) en.done=true; g[key]=en; saveGym(g); state.gymDate=key; renderGym(); };
  document.getElementById("gNote").addEventListener("input",ev=>{ const g=gymLog(); g[key]=g[key]||{}; g[key].note=ev.target.value; saveGym(g); });
  document.getElementById("bkOut").onclick=exportBackup;
  document.getElementById("bkIn").onchange=importBackup;
}

function exportBackup(){
  const data={}; try{ for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); data[k]=localStorage.getItem(k); } }catch(e){}
  const blob=new Blob([JSON.stringify({app:"semestr",at:new Date().toISOString(),data},null,1)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="semestr-backup-"+iso(today())+".json";
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
}
function importBackup(ev){
  const f=ev.target.files[0]; if(!f) return;
  f.text().then(txt=>{ const j=JSON.parse(txt); if(j.app!=="semestr") throw new Error();
    Object.entries(j.data).forEach(([k,v])=>store.set(k,v)); toast("Копия восстановлена"); route(); })
   .catch(()=>toast("Не получилось прочитать файл"));
}

/* =====================================================================
   ПРОПУСКИ
   ===================================================================== */
function absStats(){
  const att=store.json("attend",{}), lim=store.json("absLimit",{}), t0=today(), subs={};
  allSubjects().forEach(s=>subs[s]={ s, held:0, miss:0, exc:0, list:[], limit: lim[s]!=null?lim[s]:null });
  for (let d=parseISO(DATA.semester.from); dayNum(d)<=dayNum(t0); d=addDays(d,1)){
    const m=missedPairs(att,d);
    lessonsFor(d).lessons.forEach(l=>{ const S=subs[l.s]; if(!S) return; S.held++;
      const x=m[l.p]; if (x&&x.miss){ if (x.exc) S.exc++; else S.miss++; S.list.push({ d:new Date(d), p:l.p, t:l.t, exc:!!x.exc }); } });
  }
  return Object.values(subs);
}
function renderAbs(){
  const st=absStats(), held=st.reduce((s,x)=>s+x.held,0), miss=st.reduce((s,x)=>s+x.miss,0), exc=st.reduce((s,x)=>s+x.exc,0);
  const pct = held? Math.round((held-miss-exc)/held*100):100;
  let h=`<div class="gstats">
    <div class="gs"><b style="color:var(--accent)">${pct}%</b><span>посещаемость</span></div>
    <div class="gs"><b style="color:var(--gym)">${miss}</b><span>пропущено пар</span></div>
    <div class="gs"><b style="color:var(--pz)">${exc}</b><span>по уважительной</span></div></div>
  <div class="card small muted">Отмечайте «не был» прямо на паре в плане дня. Повторное нажатие делает пропуск уважительным (справка), третье — снимает отметку. Пропуски по уважительной в лимит не идут.</div>`;
  const risky=st.filter(x=>x.limit!=null && x.miss>=x.limit-1 && x.limit>0);
  if (risky.length) h+=`<div class="card warnbox">${risky.map(x=>`⚠ <b>${esc(x.s)}</b>: пропущено ${x.miss} из ${x.limit} допустимых${x.miss>=x.limit?" — лимит исчерпан!":" — остался последний"}`).join("<br>")}</div>`;
  st.sort((a,b)=>(b.miss+b.exc)-(a.miss+a.exc)||b.held-a.held).forEach(x=>{
    const p = x.held? Math.round((x.held-x.miss-x.exc)/x.held*100):100;
    const limPct = x.limit? Math.min(100, Math.round(x.miss/x.limit*100)) : 0;
    h+=`<div class="card subjabs"><div class="row between"><b>${esc(x.s)}</b><span class="chip" style="background:var(--accent-soft);color:var(--accent)">${p}%</span></div>
      <div class="small muted">Прошло пар: ${x.held} (${x.held*2} ак. ч) · пропущено: <b style="color:var(--gym)">${x.miss}</b>${x.exc?` · уважит.: ${x.exc}`:""}</div>
      <div class="row limrow"><label class="small">Лимит пропусков <input type="number" min="0" max="50" data-lim="${esc(x.s)}" value="${x.limit!=null?x.limit:""}" placeholder="нет"></label>
      ${x.limit?`<div class="bar" style="flex:1"><i style="width:${limPct}%;background:${limPct>=100?"var(--gym)":limPct>=70?"var(--warn)":"var(--pz)"}"></i></div>`:""}</div>
      ${x.list.length?`<details><summary class="small link">Даты пропусков (${x.list.length})</summary><div class="small">${x.list.slice().reverse().map(e=>`<div class="absrow"><span>${shortDate(e.d)}, ${e.p} пара · ${e.t}</span>${e.exc?'<em>уважит.</em>':""}</div>`).join("")}</div></details>`:""}
    </div>`;
  });
  view.innerHTML=h;
  view.querySelectorAll("[data-lim]").forEach(inp=>inp.addEventListener("change",()=>{ const l=store.json("absLimit",{}); const v=inp.value.trim();
    if (v==="") delete l[inp.dataset.lim]; else l[inp.dataset.lim]=Math.max(0,+v); store.put("absLimit",l); renderAbs(); }));
}

/* =====================================================================
   БЕНЗИН: заправки с фото чеков
   ===================================================================== */
const MONTHS_NOM = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const PHOTOS = {
  db:null,
  open(){ if (this.db) return Promise.resolve(this.db);
    return new Promise((ok,fail)=>{ try{ const r=indexedDB.open("semestr",1);
      r.onupgradeneeded=()=>r.result.createObjectStore("photos");
      r.onsuccess=()=>{ this.db=r.result; ok(this.db); }; r.onerror=()=>fail(r.error); }catch(e){ fail(e); } }); },
  put(id,blob){ return this.open().then(db=>new Promise((ok,fail)=>{ const tx=db.transaction("photos","readwrite"); tx.objectStore("photos").put(blob,id); tx.oncomplete=ok; tx.onerror=()=>fail(tx.error); })); },
  get(id){ return this.open().then(db=>new Promise((ok,fail)=>{ const q=db.transaction("photos").objectStore("photos").get(id); q.onsuccess=()=>ok(q.result); q.onerror=()=>fail(q.error); })); },
  del(id){ return this.open().then(db=>new Promise(ok=>{ const tx=db.transaction("photos","readwrite"); tx.objectStore("photos").delete(id); tx.oncomplete=ok; tx.onerror=ok; })).catch(()=>{}); }
};
function shrinkImage(file, max, q){
  return new Promise((ok,fail)=>{ const url=URL.createObjectURL(file), img=new Image();
    img.onload=()=>{ const k=Math.min(1, max/Math.max(img.width,img.height)), c=document.createElement("canvas");
      c.width=Math.round(img.width*k); c.height=Math.round(img.height*k); c.getContext("2d").drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url); c.toBlob(b=>b?ok({blob:b, thumb:max<=400?c.toDataURL("image/jpeg",q):null}):fail(new Error("canvas")),"image/jpeg",q); };
    img.onerror=()=>{ URL.revokeObjectURL(url); fail(new Error("img")); }; img.src=url; });
}
const fuelDraft = { liters:null };
// миграция: фото, прикреплённые к заправкам раньше, переносим в «Чеки»
(function(){ const f=store.json("fuel",[]), r=store.json("receipts",[]); let ch=false;
  f.forEach(x=>{ if (x.thumb){ if(!r.find(y=>y.id===x.id)) r.push({ id:x.id, date:x.date, at:x.at||"", thumb:x.thumb }); delete x.thumb; ch=true; } });
  if (ch){ store.put("fuel",f); store.put("receipts",r); } })();

function renderFuel(){
  const sub=state.fuelSub||"fills";
  let h=`<div class="seg fuelseg"><button data-fsub="fills" class="${sub==="fills"?"on":""}">Заправки</button><button data-fsub="checks" class="${sub==="checks"?"on":""}">Чеки${store.json("receipts",[]).length?` · ${store.json("receipts",[]).length}`:""}</button></div><div id="fuelBody"></div>`;
  view.innerHTML=h;
  view.querySelectorAll("[data-fsub]").forEach(b=>b.onclick=()=>{ state.fuelSub=b.dataset.fsub; renderFuel(); });
  sub==="fills" ? renderFills() : renderChecks();
}

function renderFills(){
  const body=document.getElementById("fuelBody");
  const fills=store.json("fuel",[]).filter(f=>f.l!=null).sort((a,b)=>(b.date+(b.at||"")).localeCompare(a.date+(a.at||"")));
  const lastL = fuelDraft.liters || (fills[0] && Math.round(fills[0].l)) || 30;
  const LIM=DATA.fuel.monthLimit, usedIn = ym => fills.filter(x=>x.date.startsWith(ym)).reduce((s,x)=>s+x.l,0);
  const ym0=iso(today()).slice(0,7), used0=usedIn(ym0), left0=Math.max(0,LIM-used0), pct=Math.min(100,Math.round(used0/LIM*100));
  const col = pct>=100?"var(--gym)":pct>=80?"var(--warn)":"var(--pz)";
  let h=`<div class="card limcard"><div class="row between"><b>${MONTHS_NOM[today().getMonth()]}</b><span class="small muted">лимит ${LIM} л</span></div>
    <div class="limnum"><b style="color:${col}">${left0}</b><span>л осталось · заправлено ${used0} л</span></div>
    <div class="bar"><i style="width:${pct}%;background:${col}"></i></div></div>
  <form class="card fuelf" id="fillF"><b>Новая заправка</b>
    <div class="wheelwrap"><div class="wheel" id="wheel">${[...Array(40)].map((_,i)=>`<div class="wi" data-v="${i+1}">${i+1}</div>`).join("")}</div><div class="wband"></div><span class="wunit">л</span></div>
    <div id="limHint" class="small"></div>
    <input type="date" id="fD" value="${iso(today())}">
    <button class="primary" type="submit">Сохранить</button></form>`;
  if (!fills.length) h+=`<div class="card muted small">Пока заправок нет — выберите литры на рулетке и сохраните.</div>`;
  let curM="";
  fills.forEach(f=>{
    const m=f.date.slice(0,7);
    if (m!==curM){ curM=m; const sum=usedIn(m), d=parseISO(m+"-01");
      h+=`<h2 class="sec">${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()} <span class="small" style="font-weight:600;color:${sum>LIM?"var(--gym)":"var(--muted)"}">· ${sum} из ${LIM} л</span></h2>`; }
    h+=`<div class="card fillrow"><div class="fthumb none">⛽</div><div style="flex:1"><b>${f.l} л</b><div class="small muted">${dateTitle(parseISO(f.date))}</div></div>
      <button class="tdel" data-fdel="${f.id}" aria-label="Удалить">×</button></div>`;
  });
  body.innerHTML=h;
  const wh=document.getElementById("wheel"), IH=44;
  const hint=()=>{ const ym=(document.getElementById("fD").value||iso(today())).slice(0,7), left=LIM-usedIn(ym), v=fuelDraft.liters||lastL, el=document.getElementById("limHint");
    el.className="small"; if (left-v<0){ el.className="small limwarn"; el.textContent=`Превысит лимит месяца на ${v-left} л (осталось ${Math.max(0,left)} л)`; }
    else el.textContent=`После заправки останется ${left-v} л из ${LIM}`;
    wh.querySelectorAll(".wi").forEach(e=>e.classList.toggle("over", +e.dataset.v>left)); };
  const setActive=()=>{ const v=Math.min(40,Math.max(1,Math.round(wh.scrollTop/IH)+1)); fuelDraft.liters=v;
    wh.querySelectorAll(".wi").forEach(e=>{ const d=Math.abs(+e.dataset.v-v); e.classList.remove("on","n1","n2"); if(d===0)e.classList.add("on"); else if(d===1)e.classList.add("n1"); else if(d===2)e.classList.add("n2"); }); hint(); };
  document.getElementById("fD").addEventListener("change",hint);
  requestAnimationFrame(()=>{ wh.scrollTop=(lastL-1)*IH; setActive(); });
  let raf=0; wh.addEventListener("scroll",()=>{ cancelAnimationFrame(raf); raf=requestAnimationFrame(setActive); },{passive:true});
  wh.addEventListener("click",e=>{ const it=e.target.closest(".wi"); if(it) wh.scrollTo({top:(+it.dataset.v-1)*IH, behavior:"smooth"}); });
  document.getElementById("fillF").onsubmit=e=>{ e.preventDefault();
    const rec={ id:uid(), date:document.getElementById("fD").value||iso(today()), at:new Date().toISOString(), l:fuelDraft.liters||lastL };
    const all=store.json("fuel",[]); all.push(rec); store.put("fuel",all); toast(`Заправка ${rec.l} л сохранена`); renderFuel(); };
}

/* ---------- чеки ---------- */
function renderChecks(){
  const body=document.getElementById("fuelBody");
  const list=store.json("receipts",[]).sort((a,b)=>(b.date+(b.at||"")).localeCompare(a.date+(a.at||"")));
  let h=`<label class="card addphoto"><span class="pi">📷</span><b>Добавить чеки</b><span class="small muted">Камера или галерея, можно несколько сразу</span>
    <input type="file" id="rcIn" accept="image/*" multiple hidden></label><div id="rcProg" class="small muted" style="margin:0 2px 8px"></div>`;
  if (!list.length) h+=`<div class="card muted small">Чеков пока нет.</div>`;
  let curM="";
  list.forEach((r,i)=>{
    const m=r.date.slice(0,7);
    if (m!==curM){ if(curM) h+=`</div>`; curM=m; const d=parseISO(m+"-01"); h+=`<h2 class="sec">${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}</h2><div class="rgrid">`; }
    h+=`<div class="rc"><button class="rcimg" data-rview="${r.id}"><img src="${r.thumb}" alt="Чек ${shortDate(parseISO(r.date))}"></button>
      <span class="rcd">${parseISO(r.date).getDate()} ${MONTHS[parseISO(r.date).getMonth()].slice(0,3)}</span>
      <button class="rcdel" data-rdel="${r.id}" aria-label="Удалить чек">×</button></div>`;
  });
  if (curM) h+=`</div>`;
  h+=`<p class="small muted" style="margin:10px 2px">Фото хранятся только на этом телефоне.</p>`;
  body.innerHTML=h;
  document.getElementById("rcIn").onchange=async e=>{
    const files=[...e.target.files]; if(!files.length) return; const prog=document.getElementById("rcProg"); let ok=0;
    for (const [i,f] of files.entries()){
      prog.textContent=`Загружаю ${i+1} из ${files.length}…`;
      try{ const big=await shrinkImage(f,1600,.8), th=await shrinkImage(f,320,.7), id=uid();
        await PHOTOS.put(id,big.blob);
        const d=f.lastModified? new Date(f.lastModified) : new Date();
        const r=store.json("receipts",[]); r.push({ id, date:iso(d), at:new Date().toISOString(), thumb:th.thumb }); store.put("receipts",r); ok++;
      }catch(err){}
    }
    toast(ok===files.length ? (ok>1?`Добавлено чеков: ${ok}`:"Чек добавлен") : `Добавлено ${ok} из ${files.length}`); renderFuel();
  };
}
function deleteReceipt(id){
  const all=store.json("receipts",[]), rec=all.find(x=>x.id===id); if(!rec) return;
  store.put("receipts", all.filter(x=>x.id!==id));
  let undone=false;
  toast("Чек удалён", { label:"Вернуть", fn:()=>{ undone=true; const r=store.json("receipts",[]); r.push(rec); store.put("receipts",r); if(hashNow()==="fuel") renderFuel(); } });
  setTimeout(()=>{ if(!undone) PHOTOS.del(id); }, 5000);
  if (hashNow()==="fuel") renderFuel();
}
function showReceipt(id){
  const list=store.json("receipts",[]).sort((a,b)=>(b.date+(b.at||"")).localeCompare(a.date+(a.at||"")));
  let idx=list.findIndex(x=>x.id===id); if (idx<0) return;
  const ov=document.createElement("div"); ov.className="photoview"; let url=null;
  const close=()=>{ ov.classList.remove("show"); setTimeout(()=>{ ov.remove(); if(url) URL.revokeObjectURL(url); },250); };
  const show=()=>{ const r=list[idx];
    ov.innerHTML=`<img alt="Чек" src="${r.thumb}"><div class="pvbar"><button data-pv="prev" ${idx<=0?"disabled":""}>‹</button><span>${dateTitle(parseISO(r.date))}</span><button data-pv="next" ${idx>=list.length-1?"disabled":""}>›</button></div>
      <button class="pvclose" data-pv="close" aria-label="Закрыть">×</button><button class="pvdel" data-pv="del">Удалить чек</button>`;
    PHOTOS.get(r.id).then(b=>{ if(!b) return; if(url) URL.revokeObjectURL(url); url=URL.createObjectURL(b); const im=ov.querySelector("img"); if(im) im.src=url; }).catch(()=>{});
  };
  ov.addEventListener("click",e=>{ const b=e.target.closest("[data-pv]");
    if (!b){ if (e.target===ov) close(); return; }
    const a=b.dataset.pv;
    if (a==="close") close();
    else if (a==="prev" && idx>0){ idx--; show(); }
    else if (a==="next" && idx<list.length-1){ idx++; show(); }
    else if (a==="del"){ const id2=list[idx].id; close(); deleteReceipt(id2); } });
  let sx=null; ov.addEventListener("touchstart",e=>{ sx=e.touches[0].clientX; },{passive:true});
  ov.addEventListener("touchend",e=>{ if(sx==null) return; const dx=e.changedTouches[0].clientX-sx; sx=null;
    if (dx<-60 && idx<list.length-1){ idx++; show(); } else if (dx>60 && idx>0){ idx--; show(); } },{passive:true});
  show(); document.body.appendChild(ov); requestAnimationFrame(()=>ov.classList.add("show"));
}

/* =====================================================================
   ИНФО
   ===================================================================== */
function renderInfo(){
  const R=DATA.road, G=DATA.gym, base=location.href.replace(/[#?].*$/,"").replace(/index\.html$/,"");
  const ics=base+"schedule.ics", webcal=ics.replace(/^https?:/,"webcal:");
  let h=`<h2 class="sec first">Уведомления в Календаре айфона</h2><div class="card">
    <div class="small">Подпишитесь один раз — в Календаре появятся пары, зал и выезды с напоминаниями (за 10 минут и в момент выезда; зал — за 30 минут). Когда расписание меняется, календарь обновится сам.</div>
    <a class="primary block" href="${webcal}">Подписаться на календарь</a>
    <ol class="small steps"><li>Нажмите кнопку и подтвердите «Подписаться».</li><li>На экране настроек <b>выключите «Удалить уведомления»</b> — иначе напоминаний не будет.</li><li>Нажмите «Добавить». Календарь называется «Семестр КНИТУ».</li></ol>
    <div class="small muted">Если кнопка не сработала: Настройки → Календарь → Учётные записи → Добавить → Другое → Подписной календарь, адрес:<br><code>${esc(ics)}</code> <button class="copy" data-copy="${esc(ics)}">копировать</button></div>
  </div>
  <h2 class="sec">Дорога из общаги (ул. Рихарда Зорге, 13В)</h2><div class="card"><table class="k">
    <tr><th></th><th>Обычно</th><th>Час пик</th></tr>
    <tr><td>До корпуса</td><td>${R.drive} мин</td><td>${R.drivePeak} мин</td></tr>
    <tr><td>Парковка → аудитория</td><td colspan="2">Д, Л, М, Г — 8 мин · А, В — 10 мин</td></tr>
    <tr><td>Запас</td><td colspan="2">${R.buffer} мин</td></tr>
    <tr><td>Час пик</td><td colspan="2">будни 7:30–9:00 и 16:30–19:00</td></tr>
  </table><p class="muted small" style="margin:8px 0 0">За 3 часа до выезда и в дороге приложение спрашивает у Яндекс Карт реальное время с пробками (при открытии и каждые 20 минут, пока оно открыто).</p></div>
  <h2 class="sec">Корпуса</h2><div class="card"><table class="k">${Object.entries(DATA.buildings).map(([k,b])=>`<tr><td><b>${k}</b></td><td>${esc(b.addr)}</td></tr>`).join("")}</table></div>
  <h2 class="sec">Зал</h2><div class="card small"><b>${esc(G.name)}</b><br>Строго через день. Тренировка ${G.workout} мин + душ/хамам ${G.after} мин; после пар сначала общага и обед. В нечётную неделю — пн, ср, пт, вс; в чётную — вт, чт, сб.</div>
  <h2 class="sec">Особые даты</h2><div class="card"><table class="k">${DATA.exceptions.map(e=>`<tr><td style="white-space:nowrap">${shortDate(parseISO(e.date))}</td><td><b>${esc(e.title)}</b><br><span class="muted small">${esc(e.text||"")}</span></td></tr>`).join("")}</table></div>
  <h2 class="sec">Правки</h2><div class="card small">Перенесли пару, сменилась аудитория, появилась лаба — напишите Claude в чат. Приложение и календарь обновятся сами примерно через минуту (календарь айфон проверяет реже — до пары часов).</div>
  <p class="muted small" style="margin:12px 2px">1-я подгруппа по основам программирования, 2-я по основам ИБ. Английский — одна пара в неделю.</p>`;
  view.innerHTML=h;
}

/* =====================================================================
   ОБЩЕЕ
   ===================================================================== */
function toast(msg, action){ let t=document.getElementById("toast"); if(!t){ t=document.createElement("div"); t.id="toast"; document.body.appendChild(t); }
  t.textContent=msg; t.classList.toggle("act", !!action);
  if (action){ const b=document.createElement("button"); b.textContent=action.label; b.onclick=()=>{ action.fn(); t.classList.remove("show"); }; t.appendChild(b); }
  t.classList.add("show"); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("show"), action?5000:1800); }

function animateIn(){
  const els=view.querySelectorAll(":scope > *, .tl > .it");
  els.forEach((el,i)=>{ if(i>18) return; el.style.setProperty("--d", (i*35)+"ms"); el.classList.add("rise"); });
  setTimeout(()=>els.forEach(el=>el.classList.remove("rise")), 1400);
}

const VIEWS = { day:renderDay, week:renderWeek, dela:renderDela, abs:renderAbs, gym:renderGym, fuel:renderFuel, money:renderMoney, info:renderInfo };
function route(anim){
  let v=hashNow(); if (v==="subjects"||v==="study"){ v="dela"; state.delaSub="study"; } if (!VIEWS[v]) v="day";
  document.querySelectorAll("nav.tabs a, .infobtn").forEach(a=>a.classList.toggle("on", a.dataset.v===v));
  VIEWS[v]();
  const p=parity(today()); const c=document.getElementById("parityChip");
  c.className="chip "+p; c.textContent=parityName(p);
  window.scrollTo(0,0);
  if (anim!==false) animateIn();
}

view.addEventListener("click", e=>{
  const go=e.target.closest("[data-go]"), sh=e.target.closest("[data-shift]"), par=e.target.closest("[data-par]");
  const tk=e.target.closest("[data-task]"), del=e.target.closest("[data-del]"), gb=e.target.closest("[data-gym]");
  const gsel=e.target.closest("[data-gsel]"), gg=e.target.closest("[data-gymgo]"), exd=e.target.closest("[data-exdel]"), cp=e.target.closest("[data-copy]");
  const at=e.target.closest("[data-att]"), fdel=e.target.closest("[data-fdel]");
  if (at){ const [dd,p]=at.dataset.att.split("|"); const A=store.json("attend",{}); A[dd]=A[dd]||{}; const x=A[dd][p];
    if (!x) A[dd][p]={miss:true,exc:false}; else if (!x.exc) x.exc=true; else delete A[dd][p];
    if (!Object.keys(A[dd]).length) delete A[dd]; store.put("attend",A); const y=scrollY; renderDay(); scrollTo(0,y); return; }
  const td=e.target.closest("[data-todo]"), tdd=e.target.closest("[data-tododel]"), pay=e.target.closest("[data-pay]"), rgd=e.target.closest("[data-regdel]"),
    md=e.target.closest("[data-mdel]"), mm=e.target.closest("[data-mm]"), gh=e.target.closest("[data-gohash]"), ds=e.target.closest("[data-dsub]");
  const rerender=()=>{ const y=scrollY; route(false); scrollTo(0,y); };
  if (td){ const [id,dd]=td.dataset.todo.split("|"); const done=toggleTodo(id,dd); if(done) toast("Сделано ✓"); rerender(); return; }
  if (tdd){ const all=todosAll(), t=all.find(x=>x.id===tdd.dataset.tododel); saveTodos(all.filter(x=>x!==t));
    toast("Дело удалено",{label:"Вернуть",fn:()=>{ const a2=todosAll(); a2.push(t); saveTodos(a2); rerender(); }}); rerender(); return; }
  if (pay){ const [id,ym]=pay.dataset.pay.split("|"); payRegular(id,ym); rerender(); return; }
  if (rgd){ store.put("regular", store.json("regular",[]).filter(x=>x.id!==rgd.dataset.regdel)); toast("Платёж удалён"); rerender(); return; }
  if (md){ const all=moneyAll(), o=all.find(x=>x.id===md.dataset.mdel); store.put("money", all.filter(x=>x!==o));
    toast("Удалено",{label:"Вернуть",fn:()=>{ const a2=moneyAll(); a2.push(o); store.put("money",a2); rerender(); }}); rerender(); return; }
  if (mm){ const [y,m]=state.moneyYM.split("-").map(Number); const nd=new Date(y,m-1+(+mm.dataset.mm),1); state.moneyYM=ymOf(nd); renderMoney(); return; }
  if (gh){ location.hash=gh.dataset.gohash; return; }
  if (ds){ state.delaSub=ds.dataset.dsub; renderDela(); return; }
  const rv=e.target.closest("[data-rview]"), rd=e.target.closest("[data-rdel]");
  if (rd){ deleteReceipt(rd.dataset.rdel); return; }
  if (rv){ showReceipt(rv.dataset.rview); return; }
  if (fdel){ const id=fdel.dataset.fdel; store.put("fuel", store.json("fuel",[]).filter(x=>x.id!==id)); toast("Удалено"); renderFuel(); return; }
  if (tk){ setTaskStatus(tk.dataset.task, +tk.dataset.next); route(false); return; }
  if (del){ deleteTask(del.dataset.del); toast("Удалено"); route(false); return; }
  if (gb){ const key=gb.dataset.gd||iso(state.sel); const g=gymLog(); g[key]=g[key]||{}; const v=gb.dataset.gym==="1";
    g[key].done = g[key].done===v ? null : v; if (g[key].done===null) delete g[key].done; saveGym(g);
    if (v && g[key].done) toast("Отлично, серия: "+gymStats().streak); route(false); return; }
  if (gg){ state.gymDate=gg.dataset.gymgo; return; }
  if (gsel){ state.gymDate=gsel.dataset.gsel; renderGym(); return; }
  if (exd){ const key=state.gymDate||iso(today()); const g=gymLog(); if(g[key]&&g[key].ex){ g[key].ex.splice(+exd.dataset.exdel,1); saveGym(g); } renderGym(); return; }
  if (cp){ navigator.clipboard && navigator.clipboard.writeText(cp.dataset.copy).then(()=>toast("Скопировано")).catch(()=>{}); return; }
  if (sh){ state.sel=addDays(state.sel, +sh.dataset.shift); renderDay(); return; }
  if (par){ state.weekParity=par.dataset.par; renderWeek(); return; }
  if (go){ state.sel=parseISO(go.dataset.go); if (hashNow()!=="day"){ location.hash="day"; } else { renderDay(); animateIn(); } }
});
document.querySelector("nav.tabs").addEventListener("click", e=>{ const a=e.target.closest("a"); if(a && a.dataset.v==="gym") state.gymDate=null; });
let tx=null, ty=null;
view.addEventListener("touchstart", e=>{ if(hashNow()==="day" && !e.target.closest("textarea,.strip")){ tx=e.touches[0].clientX; ty=e.touches[0].clientY; } }, {passive:true});
view.addEventListener("touchend", e=>{ if(tx==null) return; const dx=e.changedTouches[0].clientX-tx, dy=e.changedTouches[0].clientY-ty; tx=null;
  if (Math.abs(dx)>70 && Math.abs(dx)>Math.abs(dy)*1.5){ state.sel=addDays(state.sel, dx<0?1:-1); renderDay(); } }, {passive:true});
window.addEventListener("hashchange", ()=>route());
setInterval(()=>{ if(hashNow()==="day") updateLive(); }, 30000);
setInterval(()=>refreshLive(true), DATA.yandex.refreshMin*60000);
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible"){ refreshLive(false); if(hashNow()==="day") updateLive(); } });

/* =====================================================================
   ЗАСТАВКА ПРИ ВХОДЕ
   ===================================================================== */
function splash(){
  const sp=document.getElementById("splash"); if(!sp) return Promise.resolve();
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) sp.classList.add("still");
  const imgs=[...sp.querySelectorAll("img")];
  const ready=Promise.race([Promise.all(imgs.map(i=>i.decode?i.decode().catch(()=>{}):Promise.resolve())), new Promise(r=>setTimeout(r,800))]);
  return ready.then(()=>new Promise(res=>{
    requestAnimationFrame(()=>sp.classList.add("go"));
    let closed=false;
    const done=()=>{ if(closed) return; closed=true; sp.classList.add("out"); res(); setTimeout(()=>sp.remove(), 900); };
    sp.addEventListener("click", done);
    setTimeout(done, reduce?400:3000);
  }));
}

route(false);
splash().then(()=>animateIn());
setTimeout(()=>refreshLive(true), 3600);
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('sw.js').catch(()=>{}); }
