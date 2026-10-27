import * as db from '../js/db.js';

const $ = (selector) => document.querySelector(selector);
const money = (value) => '$' + (Number(value) || 0).toLocaleString('es-MX', {minimumFractionDigits: 0, maximumFractionDigits: 2});
const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const parseLocal = (iso) => { if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return null; const p = iso.split('-').map(Number); return new Date(p[0],p[1]-1,p[2]); };
const daysBetween = (from, to) => Math.round((parseLocal(to) - parseLocal(from)) / 86400000);
const escapeHTML = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const category = (s) => { const text = String(s || ''); const i = text.indexOf(' '); return i >= 0 ? text.slice(i+1) : text; };
const abonos = (item) => Array.isArray(item.pagos) ? item.pagos : [];
const abonado = (item) => abonos(item).length ? abonos(item).reduce((sum, p) => sum + (Number(p.monto) || 0), 0) : (Number(item.abo) || 0);
const pendiente = (item) => Math.max(0, (Number(item.imp) || 0) - abonado(item));
const abonosHoy = (item, today) => abonos(item).reduce((sum, p) => sum + (p.fecha === today ? (Number(p.monto) || 0) : 0), 0);

let records = [];
let currentFilter = 'all';

function buildRows(today) {
  return records.map((item) => {
    const due = parseLocal(item.fecha);
    const pending = pendiente(item);
    const paidToday = abonosHoy(item, today);
    const delta = due ? daysBetween(today, item.fecha) : null;
    return Object.assign({}, item, {pending:pending, paidToday:paidToday, delta:delta, due:due});
  }).filter((item) => item.due && (item.pending > 0 || item.paidToday > 0))
    .sort((a,b) => a.delta - b.delta || a.pending - b.pending);
}

function renderPayment(item) {
  const urgency = item.delta < 0 ? 'urgent' : item.delta <= 3 ? 'soon' : '';
  const status = item.delta < 0 ? Math.abs(item.delta) + (Math.abs(item.delta) === 1 ? ' día atrasado' : ' días atrasado') : item.delta === 0 ? 'Vence hoy' : item.delta === 1 ? 'Vence mañana' : 'Vence en ' + item.delta + ' días';
  const target = item.pending + item.paidToday;
  const days = Math.max(1, item.delta);
  const daily = target / days;
  return '<article class="v2-payment ' + urgency + '">' +
    '<div class="v2-payment-top"><div class="v2-payment-name">' + escapeHTML(item.conc || 'Sin concepto') +
    '<span class="v2-payment-category">' + escapeHTML(category(item.cat)) + '</span></div>' +
    '<div class="v2-payment-amount"><strong>' + money(item.pending) + '</strong><small>pendiente</small></div></div>' +
    '<div class="v2-payment-bottom"><span class="v2-status ' + (urgency === 'soon' ? 'soon' : '') + '">' + status + '</span><span>Meta diaria: <b>' + money(daily) + '</b></span></div>' +
    '</article>';
}

function render() {
  const today = todayISO();
  const allRows = buildRows(today);
  const rows = allRows.filter((item) => item.pending > 0 && item.delta <= 30);
  const eligible = rows.filter((item) => item.delta >= 0);
  const urgent = rows.filter((item) => item.delta <= 0);
  const dailyTarget = allRows.reduce((total, item) => {
    const startOfDayPending = item.pending + item.paidToday;
    return total + startOfDayPending / Math.max(1, item.delta);
  }, 0);
  const paidToday = allRows.reduce((total, item) => total + item.paidToday, 0);
  const remainingToday = Math.max(0, dailyTarget - paidToday);
  const pendingTotal = eligible.reduce((total, item) => total + item.pending, 0);
  const urgentTotal = urgent.reduce((total, item) => total + item.pending, 0);
  const shown = rows.filter((item) => currentFilter === 'urgent' ? item.delta <= 0 : currentFilter === 'future' ? item.delta > 0 : true);
  $('#daily-target').textContent = money(dailyTarget);
  $('#daily-caption').textContent = allRows.length ? allRows.length + (allRows.length === 1 ? ' compromiso pendiente incluido en la meta' : ' compromisos pendientes incluidos en la meta') : 'No hay compromisos pendientes con fecha de vencimiento registrada.';
  $('#paid-label').textContent = 'Abonado hoy: ' + money(paidToday);
  $('#remaining-label').textContent = 'Meta pendiente: ' + money(remainingToday);
  $('#today-paid').textContent = money(paidToday);
  $('#urgent-total').textContent = money(urgentTotal);
  $('#urgent-count').textContent = urgent.length + (urgent.length === 1 ? ' compromiso' : ' compromisos');
  $('#pending-total').textContent = money(pendingTotal);
  $('#pending-count').textContent = eligible.length + (eligible.length === 1 ? ' compromiso' : ' compromisos');
  $('#daily-progress').style.width = (dailyTarget > 0 ? Math.min(100, paidToday / dailyTarget * 100) : 0) + '%';
  $('#payments').innerHTML = shown.length ? shown.map(renderPayment).join('') : '<p class="v2-empty">No hay pagos pendientes en este filtro. Si esperabas ver alguno, revisa que tenga fecha de vencimiento y saldo pendiente.</p>';
  $('#last-updated').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-MX', {hour:'2-digit',minute:'2-digit'});
}

async function load() {
  $('#payments').innerHTML = '<p class="v2-empty">Actualizando tus pagos…</p>';
  try {
    records = await db.all('movimientos');
    render();
  } catch (error) {
    console.error(error);
    $('#payments').innerHTML = '<p class="v2-empty v2-error">No se pudieron leer los pagos. Vuelve a intentarlo.</p>';
    $('#daily-caption').textContent = 'Error al leer el almacenamiento local.';
  }
}

$('#filter').addEventListener('change', (event) => { currentFilter = event.target.value; render(); });
$('#refresh').addEventListener('click', load);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
load();
