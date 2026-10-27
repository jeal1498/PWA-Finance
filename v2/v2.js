import * as db from '../js/db.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value) => '$' + (Number(value) || 0).toLocaleString('es-MX', {minimumFractionDigits: 0, maximumFractionDigits: 2});
const todayISO = () => { const d = new Date(); return dateISO(d); };
const dateISO = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const parseLocal = (iso) => { if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null; const p = iso.split('-').map(Number); return new Date(p[0],p[1]-1,p[2]); };
const daysBetween = (from, to) => Math.round((parseLocal(to) - parseLocal(from)) / 86400000);
const escapeHTML = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const category = (s) => { const text = String(s || '📦 Otro'); const i = text.indexOf(' '); return i >= 0 ? text.slice(i+1) : text; };
const abonos = (item) => Array.isArray(item.pagos) ? item.pagos : [];
const abonado = (item) => abonos(item).length ? abonos(item).reduce((sum, p) => sum + (Number(p.monto) || 0), 0) : (Number(item.abo) || 0);
const pendiente = (item) => Math.max(0, (Number(item.imp) || 0) - abonado(item));
const abonosEnMes = (item, month) => abonos(item).reduce((sum, p) => sum + (p.fecha && p.fecha.slice(0,7) === month ? (Number(p.monto) || 0) : 0), 0);
let records = [];
let currentFilter = 'pending';
let activeScreen = 'resumen';
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDate = todayISO();

function buildRows(today) {
  return records.map(item => {
    const due = parseLocal(item.fecha);
    const pending = pendiente(item);
    const delta = due ? daysBetween(today, item.fecha) : null;
    return {...item, pending, paid: Math.max(0, Number(item.imp) - pending), delta, due};
  }).filter(item => item.due).sort((a,b) => a.delta - b.delta || String(a.conc).localeCompare(String(b.conc),'es'));
}
function statusOf(item) {
  if (item.pending <= 0) return 'Liquidado';
  if (item.delta < 0) return Math.abs(item.delta) + (Math.abs(item.delta) === 1 ? ' día vencido' : ' días vencidos');
  if (item.delta === 0) return 'Vence hoy';
  if (item.delta === 1) return 'Vence mañana';
  return 'Vence en ' + item.delta + ' días';
}
function renderPayment(item, compact = false) {
  const urgency = item.pending <= 0 ? 'settled' : item.delta < 0 ? 'urgent' : item.delta <= 3 ? 'soon' : '';
  const daily = item.pending / Math.max(1, item.delta);
  return '<article class="v2-payment ' + urgency + '">' +
    '<div class="v2-payment-top"><div class="v2-payment-name">' + escapeHTML(item.conc || 'Sin concepto') +
    '<span class="v2-payment-category">' + escapeHTML(category(item.cat)) + '</span></div>' +
    '<div class="v2-payment-amount"><strong>' + money(item.pending) + '</strong><small>' + (item.pending <= 0 ? 'liquidado' : 'pendiente') + '</small></div></div>' +
    '<div class="v2-payment-bottom"><span class="v2-status ' + (urgency === 'soon' ? 'soon' : '') + (urgency === 'settled' ? ' settled-text' : '') + '">' + statusOf(item) + '</span>' +
    (item.pending > 0 ? '<span>Meta diaria: <b>' + money(daily) + '</b></span>' : '<span>Total: <b>' + money(item.imp) + '</b></span>') +
    '</div></article>';
}
function setText(selector, value) { const el = $(selector); if (el) el.textContent = value; }
function renderSummary(rows, today) {
  const relevant = rows.filter(item => item.pending > 0);
  const next30 = relevant.filter(item => item.delta >= 0 && item.delta <= 30);
  const urgent = relevant.filter(item => item.delta <= 0);
  const target = relevant.reduce((sum,item) => sum + item.pending / Math.max(1,item.delta),0);
  const paidToday = records.reduce((sum,item) => sum + abonos(item).reduce((s,p) => s + (p.fecha === today ? Number(p.monto)||0 : 0),0),0);
  setText('#daily-target',money(target));
  setText('#daily-caption',relevant.length ? relevant.length + (relevant.length === 1 ? ' pago pendiente incluido' : ' pagos pendientes incluidos') : 'No hay pagos pendientes con fecha registrada.');
  setText('#paid-label','Abonado hoy: ' + money(paidToday));
  setText('#remaining-label','Meta pendiente: ' + money(Math.max(0,target-paidToday)));
  setText('#today-paid',money(paidToday));
  setText('#urgent-total',money(urgent.reduce((s,x)=>s+x.pending,0)));
  setText('#urgent-count',urgent.length + (urgent.length === 1 ? ' compromiso' : ' compromisos'));
  setText('#pending-total',money(next30.reduce((s,x)=>s+x.pending,0)));
  setText('#pending-count',next30.length + (next30.length === 1 ? ' compromiso' : ' compromisos'));
  $('#daily-progress').style.width = (target > 0 ? Math.min(100,paidToday/target*100) : 0) + '%';
  const priority = relevant.filter(item => item.delta <= 0).slice(0,4);
  $('#priority-payments').innerHTML = priority.length ? priority.map(item=>renderPayment(item,true)).join('') : '<p class="v2-empty">No tienes pagos vencidos ni con vencimiento hoy. Puedes revisar los próximos en la sección Pagos.</p>';
}
function renderPayments(rows) {
  let list = rows;
  if (currentFilter === 'pending') list = rows.filter(x=>x.pending>0);
  if (currentFilter === 'urgent') list = rows.filter(x=>x.pending>0 && x.delta<=0);
  if (currentFilter === 'future') list = rows.filter(x=>x.pending>0 && x.delta>0);
  if (currentFilter === 'paid') list = rows.filter(x=>x.pending<=0);
  setText('#payments-summary',list.length + (list.length===1?' pago':' pagos') + ' · saldo pendiente ' + money(list.reduce((s,x)=>s+x.pending,0)));
  $('#payments').innerHTML = list.length ? list.map(item=>renderPayment(item)).join('') : '<p class="v2-empty">No hay pagos para mostrar en este filtro.</p>';
}
function renderCalendar(rows) {
  const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
  setText('#calendar-month',calendarMonth.toLocaleDateString('es-MX',{month:'long',year:'numeric'}));
  const first = new Date(year,month,1);
  const offset = (first.getDay()+6)%7;
  const count = new Date(year,month+1,0).getDate();
  const cells = [];
  ['L','M','Mi','J','V','S','D'].forEach(day=>cells.push('<div class="v2-calendar-weekday">'+day+'</div>'));
  for(let i=0;i<offset;i++) cells.push('<div class="v2-calendar-empty" aria-hidden="true"></div>');
  const today=todayISO();
  for(let day=1;day<=count;day++){
    const date=dateISO(new Date(year,month,day));
    const items=rows.filter(x=>x.fecha===date && x.pending>0);
    const classes=['v2-calendar-day'];
    if(date===today) classes.push('is-today');
    if(date===selectedDate) classes.push('is-selected');
    if(items.some(x=>x.delta<0)) classes.push('has-overdue');
    else if(items.length && date===today) classes.push('has-today');
    else if(items.length) classes.push('has-future');
    cells.push('<button type="button" class="'+classes.join(' ')+'" data-date="'+date+'" aria-label="'+date+', '+items.length+' pagos"><span>'+day+'</span>'+(items.length?'<i>'+items.length+'</i>':'')+'</button>');
  }
  $('#calendar-grid').innerHTML=cells.join('');
  renderCalendarDay(rows,selectedDate);
}
function renderCalendarDay(rows,date) {
  const dt=parseLocal(date);
  setText('#selected-date-title',dt?dt.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long'}):'Pagos del día');
  const items=rows.filter(x=>x.fecha===date);
  $('#calendar-payments').innerHTML=items.length?items.map(item=>renderPayment(item)).join(''):'<p class="v2-empty">No hay pagos con vencimiento en esta fecha.</p>';
}
function renderAnalysis(rows,today) {
  const month=today.slice(0,7);
  setText('#analysis-total',money(records.reduce((s,x)=>s+(Number(x.imp)||0),0)));
  setText('#analysis-pending',money(rows.reduce((s,x)=>s+x.pending,0)));
  setText('#analysis-month-paid',money(records.reduce((s,x)=>s+abonosEnMes(x,month),0)));
  setText('#analysis-settled',rows.filter(x=>x.pending<=0).length);
  setText('#analysis-overdue',rows.filter(x=>x.pending>0&&x.delta<0).length);
  setText('#analysis-upcoming',rows.filter(x=>x.pending>0&&x.delta>=0&&x.delta<=30).length);
  const groups=new Map();
  rows.filter(x=>x.pending>0).forEach(x=>{const key=category(x.cat);groups.set(key,(groups.get(key)||0)+x.pending);});
  const sorted=[...groups.entries()].sort((a,b)=>b[1]-a[1]);
  const max=sorted.length?sorted[0][1]:0;
  $('#category-breakdown').innerHTML=sorted.length?sorted.map(([name,value])=>'<div class="v2-breakdown-row"><div><span>'+escapeHTML(name)+'</span><strong>'+money(value)+'</strong></div><div class="v2-breakdown-track"><i style="width:'+(max?value/max*100:0)+'%"></i></div></div>').join(''):'<p class="v2-empty">No hay saldos pendientes por categoría.</p>';
}
function render() {
  const today=todayISO(), rows=buildRows(today);
  renderSummary(rows,today);
  renderPayments(rows);
  renderCalendar(rows);
  renderAnalysis(rows,today);
  setText('#last-updated','Actualizado '+new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}));
}
function navigate(screen) {
  activeScreen=screen;
  $$('.v2-screen').forEach(el=>{const active=el.dataset.screen===screen;el.hidden=!active;el.classList.toggle('is-active',active);});
  $$('[data-screen-link]').forEach(el=>{const active=el.dataset.screenLink===screen;el.classList.toggle('is-current',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  window.scrollTo({top:0,behavior:'auto'});
}
async function load() {
  try { records=await db.all('movimientos'); render(); }
  catch(error) { console.error(error); $('#priority-payments').innerHTML='<p class="v2-empty v2-error">No se pudieron leer los pagos. Comprueba que la versión original haya abierto al menos una vez y vuelve a intentarlo.</p>'; }
}
$$('[data-screen-link]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.screenLink)));
$$('[data-go]').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.go)));
$('#filter').addEventListener('change',event=>{currentFilter=event.target.value;renderPayments(buildRows(todayISO()));});
$('#refresh').addEventListener('click',load);
$('#settings-refresh').addEventListener('click',load);
$('#month-prev').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);renderCalendar(buildRows(todayISO()));});
$('#month-next').addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);renderCalendar(buildRows(todayISO()));});
$('#calendar-grid').addEventListener('click',event=>{const button=event.target.closest('[data-date]');if(!button)return;selectedDate=button.dataset.date;renderCalendar(buildRows(todayISO()));});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
load();
