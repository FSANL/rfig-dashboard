'use strict';
// Datumhulpen in tijdzone Europe/Amsterdam. Een "dag" is altijd een
// kalenderdag in Amsterdam (zomer-/wintertijd inbegrepen; een dag kan 23 of 25 uur duren).

const TZ = 'Europe/Amsterdam';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function parts(ms) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}

/** Instant (ms, Date of ISO-string) -> 'YYYY-MM-DD' in Amsterdam. */
function amsDate(t) {
  const p = parts(toMs(t));
  return `${p.year}-${p.month}-${p.day}`;
}

function toMs(t) {
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  const ms = Date.parse(t);
  if (Number.isNaN(ms)) throw new Error(`Ongeldige datum/tijd: ${t}`);
  return ms;
}

/** Verschil Amsterdam-tijd t.o.v. UTC in minuten op instant ms. */
function offsetMinutes(ms) {
  const p = parts(ms);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** 'YYYY-MM-DD' -> instant (ms) van 00:00 Amsterdam-tijd op die dag. */
function startOfDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let t = guess - offsetMinutes(guess) * 60000;
  t = guess - offsetMinutes(t) * 60000; // corrigeren rond een overgang
  return t;
}

/** 'YYYY-MM-DD' + n dagen (kalenderdagen). */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Aantal kalenderdagen van a naar b (b - a). */
function diffDays(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Alle dagen van a t/m b (inclusief). Leeg als b < a. */
function daysBetween(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Amsterdam-dagen die het interval [startMs, endMs] raken (beide inclusief). */
function daysTouched(startMs, endMs) {
  const s = Math.min(toMs(startMs), toMs(endMs));
  const e = Math.max(toMs(startMs), toMs(endMs));
  return daysBetween(amsDate(s), amsDate(e));
}

function today(nowMs = Date.now()) { return amsDate(nowMs); }
function yesterday(nowMs = Date.now()) { return addDays(amsDate(nowMs), -1); }

module.exports = { TZ, amsDate, startOfDay, addDays, diffDays, daysBetween, daysTouched, today, yesterday, toMs, offsetMinutes };
