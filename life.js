/* =====================================================================
   ЛИЧНЫЕ ДЕЛА и БЮДЖЕТ
   Загружается до app.js; функции вызываются уже после его загрузки.
   ===================================================================== */

/* ---------- личные дела ---------- */
const REPEAT_NAMES = { "":"не повторять", day:"каждый день", week:"каждую неделю", month:"каждый месяц" };
const todosAll = () => store.json("todos", []);
const saveTodos = t => store.put("todos", t);
function todoOn(t, d){ // приходится ли дело на день d
  if (!t.repeat) return t.date ? t.date===iso(d) : false;
  const start=parseISO(t.date||t.created); if (dayNum(d)<dayNum(start)) return false;
  if (t.until && iso(d)>t.until) return false;
  if (t.repeat==="day") return true;
  if (t.repeat==="week") return d.getDay()===start.getDay();
  if (t.repeat==="month"){ const last=new Date(d.getFullYear(), d.getMonth()+1, 0).getDate(); return d.getDate()===Math.min(start.getDate(), last); }
  return false;
}
const todoDone = (t, d) => t.repeat ? (t.doneDates||[]).includes(iso(d)) : !!t.done;
function todosForDay(d){ // { timed:[], untimed:[], overdue:[] }
  const all=todosAll(), isToday=dayNum(d)===dayNum(today());
  const on=all.filter(t=>todoOn(t,d)).map(t=>({t, done:todoDone(t,d)}));
  const overdue = isToday ? all.filter(t=>!t.repeat && !t.done && t.date && t.date<iso(d)).map(t=>({t, done:false, late:true})) : [];
  return { timed:on.filter(x=>x.t.time).sort((a,b)=>a.t.time.localeCompare(b.t.time)), untimed:on.filter(x=>!x.t.time), overdue };
}
function toggleTodo(id, dateISO){
  const all=todosAll(), t=all.find(x=>x.id===id); if(!t) return false;
  let nowDone;
  if (t.repeat){ t.doneDates=t.doneDates||[]; const i=t.doneDates.indexOf(dateISO); if (i>=0){ t.doneDates.splice(i,1); nowDone=false; } else { t.doneDates.push(dateISO); nowDone=true; } t.doneDates=t.doneDates.slice(-120); }
  else { t.done=!t.done; t.doneAt=t.done?iso(today()):null; nowDone=t.done; }
  saveTodos(all); return nowDone;
}
function todoRow(x, d, opts={}){
  const t=x.t, when=[t.time, opts.showDate&&t.date?shortDate(parseISO(t.date)):"", t.repeat?REPEAT_NAMES[t.repeat]:"", x.late?"просрочено":""].filter(Boolean).join(" · ");
  return `<div class="task todo ${x.done?"done":""} ${x.late?"late":""}">
    <button class="tstat ${x.done?"s1 hw":""}" data-todo="${t.id}|${iso(d)}" aria-label="Отметить">${x.done?"✓":""}</button>
    <div class="tbody"><div class="tt1">${esc(t.title)}</div>${when?`<div class="tt2">${esc(when)}</div>`:""}</div>
    ${opts.del?`<button class="tdel" data-tododel="${t.id}" aria-label="Удалить">×</button>`:""}</div>`;
}
function addTodoForm(id, compact){
  return `<form class="addf todoform" id="${id}">
    <input name="title" placeholder="Что сделать? Например: оплатить общагу" autocomplete="off">
    <div class="row g2"><input type="date" name="date" value="${iso(state.sel||today())}"><input type="time" name="time"></div>
    ${compact?"":`<select name="repeat">${Object.entries(REPEAT_NAMES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select>`}
    <button class="primary" type="submit">Добавить дело</button></form>`;
}
function bindTodoForm(id, after){
  const f=document.getElementById(id); if(!f) return;
  f.onsubmit=e=>{ e.preventDefault(); const title=f.title.value.trim(); if(!title){ f.title.focus(); return; }
    const all=todosAll(); all.push({ id:uid(), title, date:f.date.value||null, time:f.time.value||null, repeat:(f.repeat&&f.repeat.value)||null, created:iso(today()) });
    saveTodos(all); toast("Дело добавлено"); after&&after(); };
}
function renderPersonal(body){
  const all=todosAll(), t0=today();
  const one=all.filter(t=>!t.repeat), rep=all.filter(t=>t.repeat);
  const open=one.filter(t=>!t.done), done=one.filter(t=>t.done);
  const late=open.filter(t=>t.date && t.date<iso(t0)), tod=open.filter(t=>t.date===iso(t0));
  const soon=open.filter(t=>t.date && t.date>iso(t0)).sort((a,b)=>(a.date+(a.time||"")).localeCompare(b.date+(b.time||"")));
  const nodate=open.filter(t=>!t.date);
  const row=(t,o={})=>todoRow({t, done:todoDone(t,t0), late:o.late}, t.date&&!t.repeat?parseISO(t.date):t0, {del:true, showDate:o.showDate});
  let h=`<div class="card">${addTodoForm("todoAdd")}</div>`;
  if (!all.length) h+=`<div class="card muted small">Записывайте сюда всё, что не про учёбу: оплатить, позвонить, записаться, купить. С датой и временем дело появится в ленте дня; повторяющиеся (стирка по воскресеньям, оплата общаги каждый месяц) — будут появляться сами.</div>`;
  if (late.length) h+=`<div class="card"><div class="sub warnc">Просрочено</div>${late.map(t=>row(t,{late:true,showDate:true})).join("")}</div>`;
  if (tod.length) h+=`<div class="card"><div class="sub">Сегодня</div>${tod.map(t=>row(t)).join("")}</div>`;
  if (soon.length) h+=`<div class="card"><div class="sub">Впереди</div>${soon.map(t=>row(t,{showDate:true})).join("")}</div>`;
  if (nodate.length) h+=`<div class="card"><div class="sub">Без даты</div>${nodate.map(t=>row(t)).join("")}</div>`;
  if (rep.length) h+=`<div class="card"><div class="sub">Повторяющиеся</div>${rep.map(t=>todoRow({t, done:todoDone(t,t0)}, t0, {del:true})).join("")}</div>`;
  if (done.length) h+=`<div class="card"><button class="sub link" id="tglDoneTodo">${state.showDoneTodo?"Скрыть":"Показать"} сделанное (${done.length})</button>${state.showDoneTodo?done.map(t=>row(t,{showDate:true})).join(""):""}</div>`;
  body.innerHTML=h;
  bindTodoForm("todoAdd", ()=>renderDela());
  const tg=document.getElementById("tglDoneTodo"); if(tg) tg.onclick=()=>{ state.showDoneTodo=!state.showDoneTodo; renderDela(); };
}
const delaSegHtml = () => `<div class="seg"><button data-dsub="me" class="${(state.delaSub||"me")==="me"?"on":""}">Личное</button><button data-dsub="study" class="${state.delaSub==="study"?"on":""}">Учёба</button></div>`;
function renderDela(){
  if ((state.delaSub||"me")==="study"){ renderStudy(); return; }
  view.innerHTML=delaSegHtml()+`<div id="delaBody"></div>`;
  renderPersonal(document.getElementById("delaBody"));
}

/* ---------- бюджет ---------- */
const CAT_OUT = [["food","🍔","Еда вне дома"],["groc","🛒","Продукты"],["fuel","⛽","Бензин"],["car","🚗","Машина"],["dorm","🏠","Общага"],["phone","📱","Связь"],["subs","🔁","Подписки"],["fun","🎉","Развлечения"],["clothes","👕","Одежда"],["health","💊","Здоровье"],["study","📚","Учёба"],["gym","🏋️","Спорт"],["other","•","Другое"]];
const CAT_IN = [["stip","🎓","Стипендия"],["parents","👪","Родители"],["work","💼","Подработка"],["other_in","•","Другое"]];
const catInfo = id => [...CAT_OUT,...CAT_IN].find(c=>c[0]===id) || ["other","•","Другое"];
const moneyAll = () => store.json("money", []);
const rub = n => (Math.round(n)).toLocaleString("ru-RU")+" ₽";
const ymOf = d => iso(d).slice(0,7);
function regularDue(ym){ // регулярные платежи месяца с отметкой об оплате
  const paid=(store.json("regularPaid",{})[ym])||[];
  return store.json("regular",[]).map(r=>({ ...r, paid:paid.includes(r.id) }));
}
function monthMoney(ym){
  const ops=moneyAll().filter(o=>o.date.startsWith(ym));
  const inc=ops.filter(o=>o.kind==="in").reduce((s,o)=>s+o.amount,0), out=ops.filter(o=>o.kind==="out").reduce((s,o)=>s+o.amount,0);
  const byCat={}; ops.filter(o=>o.kind==="out").forEach(o=>byCat[o.cat]=(byCat[o.cat]||0)+o.amount);
  const reg=regularDue(ym), regLeft=reg.filter(r=>!r.paid).reduce((s,r)=>s+r.amount,0);
  return { ops, inc, out, byCat, reg, regLeft, left: inc-out };
}
function dailyAllowance(){
  const t0=today(), m=monthMoney(ymOf(t0)), last=new Date(t0.getFullYear(),t0.getMonth()+1,0).getDate();
  const daysLeft=last-t0.getDate()+1, spentToday=m.ops.filter(o=>o.kind==="out"&&o.date===iso(t0)).reduce((s,o)=>s+o.amount,0);
  const free=m.left - m.regLeft + spentToday;          // свободно на начало сегодняшнего дня
  return { per: free/daysLeft, spentToday, free, daysLeft, m };
}
function addMoney(op){ const all=moneyAll(); all.push({ id:uid(), ...op }); store.put("money", all); }
function moneyForm(id, kind){
  const cats = kind==="in" ? CAT_IN : CAT_OUT;
  return `<form class="addf moneyform" id="${id}" data-kind="${kind}">
    <div class="seg mini mkind"><button type="button" data-mk="out" class="${kind!=="in"?"on":""}">Расход</button><button type="button" data-mk="in" class="${kind==="in"?"on":""}">Доход</button></div>
    <div class="amt"><input name="amount" inputmode="decimal" placeholder="0" autocomplete="off"><span>₽</span></div>
    <div class="cats">${cats.map((c,i)=>`<button type="button" class="cat ${i===0?"on":""}" data-cat="${c[0]}">${c[1]} ${c[2]}</button>`).join("")}</div>
    <div class="row g2"><input type="date" name="date" value="${iso(today())}"><input name="note" placeholder="Комментарий"></div>
    <button class="primary" type="submit">Записать</button></form>`;
}
function bindMoneyForm(id, after){
  const f=document.getElementById(id); if(!f) return;
  f.querySelectorAll("[data-mk]").forEach(b=>b.onclick=()=>{ const k=b.dataset.mk; f.outerHTML=moneyForm(id,k); bindMoneyForm(id,after); });
  f.querySelectorAll(".cat").forEach(b=>b.onclick=()=>{ f.querySelectorAll(".cat").forEach(x=>x.classList.toggle("on",x===b)); });
  f.onsubmit=e=>{ e.preventDefault(); const a=parseFloat(String(f.amount.value).replace(",",".").replace(/\s/g,""));
    if (!(a>0)){ f.amount.focus(); return; }
    const cat=(f.querySelector(".cat.on")||{}).dataset?.cat || (f.dataset.kind==="in"?"other_in":"other");
    addMoney({ date:f.date.value||iso(today()), amount:a, kind:f.dataset.kind, cat, note:f.note.value.trim() });
    toast((f.dataset.kind==="in"?"Доход ":"Расход ")+rub(a)); after&&after(); };
}
function payRegular(id, ym){
  const r=store.json("regular",[]).find(x=>x.id===id); if(!r) return;
  const p=store.json("regularPaid",{}); p[ym]=p[ym]||[];
  if (p[ym].includes(id)){ p[ym]=p[ym].filter(x=>x!==id); const all=moneyAll().filter(o=>o.reg!==id+"|"+ym); store.put("money",all); }
  else { p[ym].push(id); addMoney({ date:iso(today()), amount:r.amount, kind:"out", cat:r.cat||"other", note:r.title, reg:id+"|"+ym }); }
  store.put("regularPaid", p);
}
function renderMoney(){
  const t0=today(); if(!state.moneyYM) state.moneyYM=ymOf(t0);
  const ym=state.moneyYM, d0=parseISO(ym+"-01"), m=monthMoney(ym), isCur=ym===ymOf(t0), lim=store.json("catLimits",{});
  let h=`<div class="row between monthsw"><button class="arr" data-mm="-1">‹</button><b>${MONTHS_NOM[d0.getMonth()]} ${d0.getFullYear()}</b><button class="arr" data-mm="1">›</button></div>`;
  if (isCur){ const a=dailyAllowance();
    h+=`<div class="card moneyhero"><div class="small muted">Можно тратить в день до конца месяца</div><b class="${a.per<0?"neg":""}">${rub(Math.max(0,a.per))}</b>
      <div class="small muted">Свободно ${rub(a.free)} на ${a.daysLeft} дн.${m.regLeft?` · уже вычтены неоплаченные платежи ${rub(m.regLeft)}`:""}${a.spentToday?` · сегодня потрачено ${rub(a.spentToday)}`:""}</div></div>`; }
  h+=`<div class="gstats"><div class="gs"><b style="color:var(--pz);font-size:19px">${rub(m.inc)}</b><span>доходы</span></div><div class="gs"><b style="color:var(--gym);font-size:19px">${rub(m.out)}</b><span>расходы</span></div><div class="gs"><b style="color:var(--accent);font-size:19px">${rub(m.left)}</b><span>остаток</span></div></div>`;
  h+=`<div class="card">${moneyForm("monAdd","out")}</div>`;
  // категории
  const cats=Object.entries(m.byCat).sort((a,b)=>b[1]-a[1]);
  h+=`<h2 class="sec">По категориям</h2><div class="card">`;
  if (!cats.length) h+=`<div class="small muted">Расходов в этом месяце пока нет.</div>`;
  cats.forEach(([c,v])=>{ const ci=catInfo(c), L=lim[c], pct=L?Math.min(100,v/L*100):(m.out?v/m.out*100:0);
    h+=`<div class="catrow"><div class="row between"><span>${ci[1]} ${ci[2]}</span><span><b>${rub(v)}</b>${L?` <span class="small muted">из ${rub(L)}</span>`:""}</span></div>
      <div class="bar"><i style="width:${pct}%;background:${L&&v>L?"var(--gym)":L&&v>L*.8?"var(--warn)":"var(--accent)"}"></i></div></div>`; });
  h+=`<details class="sl-cfg"><summary class="small">Лимиты по категориям</summary><div class="cfggrid">${CAT_OUT.map(c=>`<label>${c[1]} ${c[2]}<input type="number" min="0" step="100" data-clim="${c[0]}" value="${lim[c[0]]||""}" placeholder="—"></label>`).join("")}</div></details></div>`;
  // регулярные
  h+=`<h2 class="sec">Регулярные платежи</h2><div class="card">`;
  if (!m.reg.length) h+=`<div class="small muted">Общага, связь, подписки — добавьте один раз, и они будут появляться каждый месяц в ленте дня в нужное число.</div>`;
  m.reg.forEach(r=>{ const ci=catInfo(r.cat);
    h+=`<div class="task"><button class="tstat ${r.paid?"s1 hw":""}" data-pay="${r.id}|${ym}">${r.paid?"✓":""}</button><div class="tbody"><div class="tt1">${esc(r.title)} · ${rub(r.amount)}</div><div class="tt2">${ci[1]} ${ci[2]} · ${r.day} числа${r.paid?" · оплачено":""}</div></div><button class="tdel" data-regdel="${r.id}">×</button></div>`; });
  h+=`<form class="addf regform" id="regAdd"><div class="row g2"><input name="title" placeholder="Название"><input name="amount" inputmode="decimal" placeholder="Сумма ₽"></div>
    <div class="row g2"><input name="day" type="number" min="1" max="31" placeholder="Число месяца"><select name="cat">${CAT_OUT.map(c=>`<option value="${c[0]}" ${c[0]==="other"?"selected":""}>${c[1]} ${c[2]}</option>`).join("")}</select></div>
    <button class="primary ghost" type="submit">Добавить платёж</button></form></div>`;
  // операции
  const ops=m.ops.slice().sort((a,b)=>b.date.localeCompare(a.date)||(b.id>a.id?1:-1));
  if (ops.length){ h+=`<h2 class="sec">Операции</h2><div class="card">`; let cd="";
    ops.forEach(o=>{ if (o.date!==cd){ cd=o.date; h+=`<div class="sub">${dateTitle(parseISO(cd))}</div>`; } const ci=catInfo(o.cat);
      h+=`<div class="ex"><div>${ci[1]} ${ci[2]}${o.note?` <span class="muted">· ${esc(o.note)}</span>`:""}</div><div class="row"><b style="color:${o.kind==="in"?"var(--pz)":"var(--ink)"}">${o.kind==="in"?"+":"−"}${rub(o.amount)}</b><button class="tdel" data-mdel="${o.id}">×</button></div></div>`; });
    h+=`</div>`; }
  view.innerHTML=h;
  bindMoneyForm("monAdd", renderMoney);
  view.querySelectorAll("[data-clim]").forEach(inp=>inp.addEventListener("change",()=>{ const l=store.json("catLimits",{}); const v=+inp.value; if(v>0) l[inp.dataset.clim]=v; else delete l[inp.dataset.clim]; store.put("catLimits",l); const y=scrollY; renderMoney(); scrollTo(0,y); document.querySelector(".sl-cfg").open=true; }));
  const rf=document.getElementById("regAdd");
  rf.onsubmit=e=>{ e.preventDefault(); const a=parseFloat(String(rf.amount.value).replace(",",".")), d=Math.min(31,Math.max(1,parseInt(rf.day.value)||1));
    if (!rf.title.value.trim()){ rf.title.focus(); return; } if (!(a>0)){ rf.amount.focus(); return; }
    const r=store.json("regular",[]); r.push({ id:uid(), title:rf.title.value.trim(), amount:a, day:d, cat:rf.cat.value }); store.put("regular",r); toast("Платёж добавлен"); renderMoney(); };
}

/* ---------- лента дня: блок «Дела и деньги» ---------- */
function lifeDayHtml(d, plan){
  const isToday=dayNum(d)===dayNum(today()), td=todosForDay(d);
  // регулярные платежи этого дня (и просроченные в этом месяце — только сегодня)
  const ym=ymOf(d), lastD=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  const reg=regularDue(ym).map(r=>({...r, dd:Math.min(r.day,lastD)})).filter(r=>!r.paid && (r.dd===d.getDate() || (isToday && r.dd<d.getDate())));
  // учебные задачи
  const tasks=allTasks().filter(t=>!t.done);
  const dueToday=tasks.filter(t=>t.dueDate && dayNum(t.dueDate)===dayNum(d));
  const late = isToday ? tasks.filter(t=>t.dueDate && dayNum(t.dueDate)<dayNum(d)) : [];
  const labSubj=new Set(plan.info.lessons.filter(l=>l.t==="ЛР").map(l=>l.s));
  const labs=tasks.filter(t=>t.kind==="lab" && labSubj.has(t.subj) && !dueToday.includes(t));
  let h="";
  const personal=[...td.overdue, ...td.untimed];
  if (personal.length||reg.length||dueToday.length||late.length||labs.length){
    h+=`<div class="card tasks"><div class="row between"><b>Дела на день</b><a class="small link" href="#dela">все дела ›</a></div>`;
    if (personal.length) h+=personal.map(x=>todoRow(x,d)).join("");
    if (reg.length) h+=`<div class="sub">Оплатить</div>`+reg.map(r=>`<div class="task"><button class="tstat" data-pay="${r.id}|${ym}"></button><div class="tbody"><div class="tt1">${esc(r.title)} · ${rub(r.amount)}</div><div class="tt2">${r.dd<d.getDate()?`было ${r.dd} числа · `:""}нажмите, когда оплатите — запишется в расходы</div></div></div>`).join("");
    if (late.length||dueToday.length||labs.length){
      h+=`<div class="sub">Учёба</div>`;
      h+=late.map(t=>taskRow(t)).join("")+dueToday.map(t=>taskRow(t,{noDue:true})).join("");
      if (labs.length) h+=`<div class="small muted" style="margin-top:6px">Сегодня ЛР — несданные лабы:</div>`+labs.map(t=>taskRow(t)).join("");
    }
    h+=`</div>`;
  }
  if (isToday){ const a=dailyAllowance(); if (a.m.inc>0 || a.spentToday>0){
    const leftToday=a.per-a.spentToday;
    h+=`<div class="card moneyline" data-gohash="money"><span>💸 Сегодня потрачено <b>${rub(a.spentToday)}</b></span><span class="${leftToday<0?"neg":""}">${leftToday>=0?`можно ещё ${rub(leftToday)}`:`перерасход ${rub(-leftToday)}`}</span></div>`; } }
  return h;
}
function lifeTimelineItems(d){
  return todosForDay(d).timed.map(x=>({ t:toMin(x.t.time), end:toMin(x.t.time)+15, kind:"todo", todo:x, title:x.t.title }));
}

/* ---------- быстрое добавление ---------- */
function openQuickAdd(){
  const sh=document.createElement("div"); sh.className="sheet";
  sh.innerHTML=`<div class="sheetbox"><div class="grab"></div>
    <div class="seg mini qseg"><button data-q="todo" class="on">Дело</button><button data-q="money">Расход / доход</button></div>
    <div id="qbody"></div></div>`;
  document.body.appendChild(sh); requestAnimationFrame(()=>sh.classList.add("show"));
  const close=()=>{ sh.classList.remove("show"); setTimeout(()=>sh.remove(),250); };
  const after=()=>{ close(); if (hashNow()==="day") { const y=scrollY; renderDay(); scrollTo(0,y); } else route(false); };
  const show=q=>{ const b=sh.querySelector("#qbody");
    sh.querySelectorAll("[data-q]").forEach(x=>x.classList.toggle("on",x.dataset.q===q));
    if (q==="todo"){ b.innerHTML=addTodoForm("qTodo", false); bindTodoForm("qTodo", after); setTimeout(()=>b.querySelector("input").focus(),250); }
    else { b.innerHTML=moneyForm("qMoney","out"); bindMoneyForm("qMoney", after); setTimeout(()=>b.querySelector("[name=amount]").focus(),250); } };
  sh.addEventListener("click",e=>{ if(e.target===sh) close(); const q=e.target.closest("[data-q]"); if(q) show(q.dataset.q); });
  show("todo");
}
