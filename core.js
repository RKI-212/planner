/* =====================================================================
   ЛОГИКА
   ===================================================================== */
var WD = ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"];
var WD_FULL = ["Воскресенье","Понедельник","Вторник","Среда","Четверг","Пятница","Суббота"];
var MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];

var toMin = s => { var [h,m]=s.split(":").map(Number); return h*60+m; };
var fmt = m => { m=Math.round(m); var h=Math.floor(m/60), mm=m%60; return h+":"+String(mm).padStart(2,"0"); };
var floor5 = m => Math.floor(m/5)*5;
var ceil5 = m => Math.ceil(m/5)*5;
var dur = m => { var h=Math.floor(m/60), mm=m%60; return (h?h+" ч ":"")+(mm?mm+" мин":"").trim() || "0 мин"; };
var parseISO = s => { var [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
var iso = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
var dayNum = d => Math.round(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000);
var addDays = (d,n) => { var x=new Date(d); x.setDate(x.getDate()+n); return x; };
var mondayOf = d => addDays(d, -((d.getDay()+6)%7));
var esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function parity(d){
  var w = Math.floor((dayNum(mondayOf(d)) - dayNum(parseISO(DATA.oddAnchorMonday)))/7);
  return (((w%2)+2)%2)===0 ? "odd" : "even";
}
var parityName = p => p==="odd" ? "Нечётная неделя" : "Чётная неделя";
var bOf = room => DATA.buildings[room.trim()[0]] ? room.trim()[0] : "Д";
var isPeak = (min, dow) => DATA.road.peakDays.includes(dow) &&
  DATA.road.peaks.some(([a,b]) => min>=toMin(a) && min<toMin(b));
var inSemester = d => iso(d)>=DATA.semester.from && iso(d)<=DATA.semester.to;
var isGymDay = d => (((dayNum(d)-dayNum(parseISO(DATA.gym.anchor))) % DATA.gym.every)+DATA.gym.every) % DATA.gym.every === 0;

function lessonsFor(d){
  var key = iso(d), dow=d.getDay(), p=parity(d);
  var ex = DATA.exceptions.filter(e=>e.date===key);
  if (!inSemester(d)) return { lessons:[], ex, outside:true };
  if (ex.some(e=>e.kind==="holiday")) return { lessons:[], ex, holiday:true };
  let ls = (DATA.schedule[p][dow]||[]).filter(l => (!l.from||key>=l.from) && (!l.to||key<=l.to));
  var cancelled = ex.filter(e=>e.kind==="cancel").map(e=>e.p);
  ls = ls.filter(l=>!cancelled.includes(l.p));
  ex.filter(e=>e.kind==="add").forEach(e=>ls.push(e.lesson));
  ls = ls.map(l => ({...l, st: toMin(l.start||DATA.pairs[l.p][0]), en: toMin(l.end||DATA.pairs[l.p][1])}))
         .sort((a,b)=>a.st-b.st);
  return { lessons:ls, ex };
}

// склеиваем подряд идущие одинаковые пары
function blocks(ls){
  var out=[];
  ls.forEach(l=>{
    var last=out[out.length-1];
    if (last && last.s===l.s && last.t===l.t && last.r===l.r && l.p===last.pTo+1 && l.st-last.en<=10){
      last.en=l.en; last.pTo=l.p; if (l.note && !last.notes.includes(l.note)) last.notes.push(l.note);
    } else out.push({...l, pFrom:l.p, pTo:l.p, notes: l.note?[l.note]:[]});
  });
  return out;
}

function planDay(d){
  var dow=d.getDay(), info=lessonsFor(d), bl=blocks(info.lessons), R=DATA.road, items=[];
  var plan={ d, dow, parity:parity(d), info, bl, items, gym:null, dep:null, home:null, start:null, end:null };
  if (bl.length){
    var f=bl[0], fb=DATA.buildings[bOf(f.r)];
    let dep=f.st - R.drive - fb.park - R.buffer, drive=R.drive;
    if (isPeak(dep,dow) || isPeak(f.st-fb.park,dow)){ drive=R.drivePeak; dep=f.st - drive - fb.park - R.buffer; }
    dep=floor5(dep); plan.dep=dep; plan.start=f.st;
    items.push({ t:dep, end:f.st, kind:"road", from:"home", to:bOf(f.r), live:"dep", st:f.st, park:fb.park, title:"Выезд из общаги",
      meta:`Корпус ${bOf(f.r)} · ${DATA.groupsName[fb.group]} · ${drive} мин дорога${drive===R.drivePeak?" (час пик)":""} + ${fb.park} мин парковка + ${R.buffer} мин запас` });
    bl.forEach((b,i)=>{
      var cls = DATA.types[b.t]||"pz";
      var pairs = b.pFrom===b.pTo ? `${b.pFrom} пара` : `${b.pFrom}–${b.pTo} пары`;
      items.push({ t:b.st, end:b.en, kind:"lesson", cls, title:b.s, badge:b.t,
        meta:`${pairs} · ${fmt(b.st)}–${fmt(b.en)} · ${b.r} · ${b.tch}`, notes:b.notes });
      var n=bl[i+1];
      if (n){
        var gap=n.st-b.en;
        var g1=DATA.buildings[bOf(b.r)].group, g2=DATA.buildings[bOf(n.r)].group;
        if (g1!==g2 && gap<=40){
          items.push({ t:b.en, end:n.st, kind:"road", from:bOf(b.r), to:bOf(n.r), title:`Переезд: ${DATA.groupsName[g1]} → ${DATA.groupsName[g2]}`,
            meta:`~${R.betweenCampuses} мин + парковка. Между парами ${gap} мин.` });
        } else if (gap>10){
          var pb=DATA.buildings[bOf(b.r)], nb=DATA.buildings[bOf(n.r)];
          var leave=b.en+pb.park; var drv1=isPeak(leave,dow)?R.drivePeak:R.drive; var arrive=leave+drv1;
          let back=n.st-nb.park-R.drive-R.buffer; if (isPeak(back,dow)) back=n.st-nb.park-R.drivePeak-R.buffer; back=floor5(back);
          let meta = `Свободно ${dur(gap)}.`;
          if (back-arrive>=45) meta += ` Можно заехать в общагу: дома ~${fmt(arrive)}–${fmt(back)} (${dur(back-arrive)}), обратно выезд в ${fmt(back)}.`;
          else meta += " Удобнее остаться в вузе.";
          items.push({ t:b.en, end:n.st, kind:"gap", title:"Окно", meta });
        }
      }
    });
    var l=bl[bl.length-1], lb=DATA.buildings[bOf(l.r)];
    var leave=l.en+lb.park, drv=isPeak(leave,dow)?R.drivePeak:R.drive, home=leave+drv;
    plan.end=l.en; plan.home=home;
    items.push({ t:l.en, end:home, kind:"road", from:bOf(l.r), to:"home", title:`Домой — в общаге ~${fmt(home)}`,
      meta:`${lb.park} мин до машины + ${drv} мин дорога${drv===R.drivePeak?" (вечерний час пик)":""}` });
  }
  // зал
  if (isGymDay(d)){
    var G=DATA.gym, key=plan.parity+"-"+dow, ov=bl.length?G.overrides[key]:null, len=G.workout+G.after;
    let st, note;
    if (!bl.length){ st=null; note="Свободный день — в любое удобное время. Нужно ~"+dur(len+2*G.driveFromHome+G.park)+" вместе с дорогой."; }
    else if (ov && ov.start){ st=toMin(ov.start); note=ov.note; }
    else { st=ceil5(plan.home+G.meal+G.driveFromHome+G.park); note=(ov&&ov.note?ov.note+" ":"")+"Сначала общага и обед ("+G.meal+" мин)."; }
    plan.gym={ st, en: st!=null? st+len : null, note };
    items.push({ t: st!=null?st:-1, end: st!=null?st+len:-1, kind:"gym", title:"Зал · "+G.name,
      meta: (st!=null? `${fmt(st)}–${fmt(st+len)} · тренировка ${G.workout} мин + душ/хамам ${G.after} мин. `:"") + note });
  }
  items.sort((a,b)=>a.t-b.t);
  return plan;
}


// Ближайший день после from (не включая), когда есть пара предмета subj
function nextPairDate(subj, from){
  var d=addDays(from,1);
  for (var i=0;i<120;i++){
    if (!inSemester(d)) return null;
    if (lessonsFor(d).lessons.some(function(l){ return l.s===subj; })) return d;
    d=addDays(d,1);
  }
  return null;
}
function allSubjects(){
  var set={};
  ["odd","even"].forEach(function(p){ Object.values(DATA.schedule[p]).forEach(function(ls){ ls.forEach(function(l){ set[l.s]=1; }); }); });
  return Object.keys(set).sort();
}
