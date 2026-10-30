// Собирает schedule.ics (подписной календарь) из data.js + core.js.
// Запуск: node tools/build-ics.js
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const ctx = { console, Date, Math, JSON, String, Number, Object, Array, Set };
vm.createContext(ctx);
for (const f of ["data.js", "core.js"]) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
const { DATA, planDay, sleepPlan, iso, parseISO, addDays, fmt, bOf, dayNum, WD_FULL } = ctx;

const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
const dt = (d, min) => `${ymd(d)}T${pad(Math.floor(min / 60))}${pad(min % 60)}00`;
const escTxt = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
function fold(line) { // строки не длиннее 75 байт
  const out = []; let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const ev = [];
function event({ uid, d, st, en, allDay, summary, location, desc, alarms = [] }) {
  const L = ["BEGIN:VEVENT", `UID:${uid}@semestr-knitu`, `DTSTAMP:${stamp}`];
  if (allDay) { L.push(`DTSTART;VALUE=DATE:${ymd(d)}`, `DTEND;VALUE=DATE:${ymd(addDays(d, 1))}`, "TRANSP:TRANSPARENT"); }
  else L.push(`DTSTART;TZID=Europe/Moscow:${dt(d, st)}`, `DTEND;TZID=Europe/Moscow:${dt(d, en)}`);
  L.push(`SUMMARY:${escTxt(summary)}`);
  if (location) L.push(`LOCATION:${escTxt(location)}`);
  if (desc) L.push(`DESCRIPTION:${escTxt(desc)}`);
  alarms.forEach(([trig, text]) => L.push("BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${trig}`, `DESCRIPTION:${escTxt(text)}`, "END:VALARM"));
  L.push("END:VEVENT");
  ev.push(...L);
}

const short = { "Основы программирования": "Программирование", "Линейная и векторная алгебра": "Линал",
  "Математический анализ": "Матан", "Основы российской государственности": "ОРГ",
  "Основы информационной безопасности": "Основы ИБ", "Физкультура (элективные курсы)": "Физкультура",
  "Иностранный язык": "Английский" };

const start = addDays(new Date(), -14); start.setHours(0, 0, 0, 0);
const end = parseISO(DATA.semester.to);
for (let d = new Date(start); dayNum(d) <= dayNum(end); d = addDays(d, 1)) {
  const p = planDay(d), key = iso(d);
  p.info.ex.forEach((e, i) => event({ uid: `${key}-ex${i}`, d, allDay: true, summary: "⚑ " + e.title, desc: e.text }));
  p.bl.forEach(b => {
    const B = DATA.buildings[bOf(b.r)];
    const pairs = b.pFrom === b.pTo ? `${b.pFrom} пара` : `${b.pFrom}–${b.pTo} пары`;
    event({ uid: `${key}-p${b.pFrom}`, d, st: b.st, en: b.en,
      summary: `${short[b.s] || b.s} (${b.t}) · ${b.r}`, location: `${b.r}, ${B.addr}, Казань`,
      desc: [b.s, pairs, b.tch, ...b.notes].join("\n") });
  });
  if (p.dep != null) {
    const f = p.bl[0], to = bOf(f.r);
    event({ uid: `${key}-dep`, d, st: p.dep, en: p.dep + 10,
      summary: `🚗 Выезд → корпус ${to} (пара в ${fmt(f.st)})`, location: DATA.yandex.home,
      desc: `Первая пара: ${f.s}, ${f.r} в ${fmt(f.st)}.\nВ приложении — точное время по пробкам Яндекса.`,
      alarms: [["-PT10M", `Через 10 минут выезд в корпус ${to}`], ["PT0M", `Пора выезжать в корпус ${to}`]] });
  }
  const sp = sleepPlan(addDays(d, 1));
  if (sp) {
    const onPrev = sp.bed < 0, bd = onPrev ? d : addDays(d, 1), bt = onPrev ? sp.bed + 1440 : sp.bed;
    if (bt + 15 <= 1440) event({ uid: `${key}-sleep`, d: bd, st: bt, en: bt + 15,
      summary: `😴 Спать — завтра ${sp.what}`, desc: `Подъём в ${fmt(sp.wake)}. ${DATA.sleep.hours} ч сна, ${DATA.sleep.prep} мин на сборы.`,
      alarms: [[`-PT${DATA.sleep.remindBefore}M`, `Через ${DATA.sleep.remindBefore} минут пора спать: завтра ${sp.what}`]] });
  }
  if (d.getDay() === 0) event({ uid: `${key}-week`, d, st: 19 * 60, en: 19 * 60 + 10, summary: "📋 Итоги недели — загляни в приложение",
    desc: "Сколько пар и тренировок было, что сдано и что ждёт на следующей неделе.", alarms: [["PT0M", "Итоги недели готовы"]] });
  if (p.gym) {
    if (p.gym.st != null) event({ uid: `${key}-gym`, d, st: p.gym.st, en: p.gym.en, summary: "🏋️ Зал", location: DATA.gym.name,
      desc: p.gym.note || "", alarms: [["-PT30M", "Через 30 минут зал — собирайтесь"]] });
    else event({ uid: `${key}-gym`, d, allDay: true, summary: "🏋️ День зала", desc: p.gym.note || "" });
  }
}

const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//semestr-knitu//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  "X-WR-CALNAME:Семестр КНИТУ", "X-WR-TIMEZONE:Europe/Moscow", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H",
  "BEGIN:VTIMEZONE", "TZID:Europe/Moscow", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0300", "TZOFFSETTO:+0300",
  "TZNAME:MSK", "END:STANDARD", "END:VTIMEZONE", ...ev, "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
fs.writeFileSync(path.join(root, "schedule.ics"), out);
console.log("schedule.ics:", ev.filter(l => l === "BEGIN:VEVENT").length, "событий");
