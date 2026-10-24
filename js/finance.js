// Cálculos puros de finanzas, igual que las hojas del Excel del usuario:
// - Hoja del mes: lo generado en el mes abona los pagos del mes en orden de fecha.
//   Meta diaria = faltante / días que quedan del mes (contando hoy).
// - Budget familiar: lo apartado a mano cada mes abona las metas en orden de fecha.
//   Diaria = suma de cuotas de las metas a ≤120 días; mensual = diaria × 24.

export const CATEGORIES = ['🚗 Vehículo', '👤 Yo', '👩 Karen', '👧 Julieta', '👨‍👩‍👧‍👦 Familia', '💡 Servicios', '🏛️ Finanzas', '🏠 Casa', '🛒 Súper', '🍽️ Comida fuera', '📦 Otro'];
export const REPEATS = [
  { v: '', l: 'No se repite' },
  { v: 'week', l: 'Cada semana' },
  { v: '2week', l: 'Cada 2 semanas' },
  { v: 'month', l: 'Cada mes' },
];
export const BUDGET_KINDS = [
  { v: 'category', l: 'Todo lo de la categoría' },
  { v: 'fuel', l: 'Cargas de combustible' },
];
export const GOAL_WINDOW = 120; // días: solo las metas cercanas cuentan para la diaria
export const WORK_DAYS = 24; // días de trabajo al mes (mensual = diaria × 24, como el Excel)

const pad = (n) => String(n).padStart(2, '0');
const parse = (s) => new Date(s + 'T00:00');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const monthKey = (s) => s.slice(0, 7);
export const monthDays = (key) => new Date(+key.slice(0, 4), +key.slice(5, 7), 0).getDate();
export const addMonths = (key, n) => ymd(new Date(+key.slice(0, 4), +key.slice(5, 7) - 1 + n, 1)).slice(0, 7);
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const localToday = () => ymd(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };

// Fechas en que cae un pago dentro del mes `key` (considera repetición, "hasta" y omitidos).
export function occurrences(bill, key) {
  const start = bill.date;
  if (!start || monthKey(start) > key) return [];
  const first = `${key}-01`;
  const last = `${key}-${pad(monthDays(key))}`;
  const out = [];
  if (bill.repeat === 'month') {
    out.push(`${key}-${pad(Math.min(+start.slice(8), monthDays(key)))}`);
  } else if (bill.repeat === 'week' || bill.repeat === '2week') {
    const step = bill.repeat === 'week' ? 7 : 14;
    let d = start < first ? addDays(start, Math.ceil(daysBetween(start, first) / step) * step) : start;
    for (; d <= last; d = addDays(d, step)) out.push(d);
  } else if (monthKey(start) === key) {
    out.push(start);
  }
  const skip = bill.skip || [];
  return out.filter((d) => d >= start && (!bill.until || d <= bill.until) && !skip.includes(d));
}

export const VEHICLE_CAT = '🚗 Vehículo';

// Mes en que empezó el control de finanzas (primer ingreso o pago).
const financeStart = (state) => [...state.income, ...state.bills].map((x) => x.date).filter(Boolean).map(monthKey).sort()[0];

// Lo registrado en el módulo Vehículo es la única fuente: finanzas solo lo lee.
// Lo anterior al inicio de finanzas (historial del vehículo) no cuenta: se pagó con dinero que no está registrado.
export function vehicleItems(state) {
  const start = financeStart(state);
  if (!start) return [];
  return [
    ...state.fuel.map((x) => ({ store: 'fuel', item: x, amount: +x.total || 0, concept: x.fuelType === 'lp' ? 'Gas LP' : 'Gasolina' })),
    ...state.maintenance.map((x) => ({ store: 'maintenance', item: x, amount: +x.cost || 0, concept: x.type || 'Servicio' })),
    ...state.expenses.map((x) => ({ store: 'expenses', item: x, amount: +x.amount || 0, concept: x.category || 'Gasto' })),
  ].filter((v) => v.item.date && v.amount > 0 && monthKey(v.item.date) >= start);
}

// Pago de vehículo capturado en finanzas que ya existe en Vehículo (misma fecha y monto): no se cuenta doble.
const dupKey = (date, amount) => `${date}|${Math.round(amount * 100)}`;

// Qué movimientos cuentan contra un presupuesto.
const FUEL_RE = /combust|gasolin|\bgas\b|\blp\b/i;
function budgetCounts(g, x) {
  if (x.budget) return false;
  if (g.kind === 'fuel') return x.veh?.store === 'fuel' || (!!x.bill && x.category === VEHICLE_CAT && FUEL_RE.test(x.concept));
  return x.category === g.category;
}

// Pagos del mes como renglones: { id, date, category, concept, amount, bill | veh | budget }.
export function billsIn(state, key, today = localToday()) {
  const veh = vehicleItems(state).filter((v) => monthKey(v.item.date) === key);
  const vehKeys = new Set(veh.map((v) => dupKey(v.item.date, v.amount)));
  const out = [];
  for (const b of state.bills) {
    for (const date of occurrences(b, key)) {
      if (!b.repeat && b.category === VEHICLE_CAT && vehKeys.has(dupKey(date, +b.amount || 0))) continue;
      out.push({ id: `${b.id}@${date}`, date, category: b.category, concept: b.concept, amount: +b.amount || 0, bill: b });
    }
  }
  for (const v of veh) out.push({ id: `${v.store}:${v.item.id}`, date: v.item.date, category: VEHICLE_CAT, concept: v.concept, amount: v.amount, veh: v });
  // Tope mensual (p. ej. combustible): las cargas ya están en la lista; se reserva lo que falta, a fin de mes.
  // En meses pasados no se reserva nada.
  const end = `${key}-${pad(monthDays(key))}`;
  for (const g of state.budgets || []) {
    const limit = +g.amount || 0;
    const spent = out.filter((x) => budgetCounts(g, x)).reduce((s, x) => s + x.amount, 0);
    const left = key < monthKey(today) ? 0 : Math.max(0, limit - spent);
    out.push({ id: `budget:${g.id}@${key}`, date: end, category: g.category, concept: g.concept, amount: left, budget: g, spent, limit });
  }
  // Mismo día: primero lo que se registró antes (como el orden de filas del Excel).
  const created = (x) => (x.bill || x.veh?.item || x.budget).createdAt || x.veh?.item.updatedAt || 0;
  return out.sort((a, b) => a.date.localeCompare(b.date) || created(a) - created(b));
}

// Mes (hoja) al que cuenta un ingreso: el de su fecha, salvo que diga otro
// (como el 30/9 que el Excel suma en la hoja de octubre).
export const incomeMonth = (x) => x.month || monthKey(x.date);
const incomeIn = (state, key, pred = () => true) =>
  state.income.filter((x) => x.date && incomeMonth(x) === key && pred(x)).reduce((s, x) => s + (+x.amount || 0), 0);

// Abona `pool` a los renglones en orden (columna ABONADO del Excel).
function cascade(items, pool) {
  const paid = new Map();
  for (const x of items) {
    const pay = Math.max(0, Math.min(x.amount, pool));
    paid.set(x.id, pay);
    pool -= pay;
  }
  return paid;
}

// Hoja del mes: OBJETIVO, GENERADO, FALTANTE y abonado de cada pago.
export function monthPlan(state, key, today = localToday()) {
  const items = billsIn(state, key, today).filter((x) => x.amount > 0);
  const objetivo = items.reduce((s, x) => s + x.amount, 0);
  const generado = incomeIn(state, key);
  return { key, items, objetivo, generado, faltante: objetivo - generado, paid: cascade(items, generado) };
}

// Estado de un pago dado lo abonado (columnas TOTAL, DÍAS y CUOTA).
export function billStatus(b, paidAmt, today) {
  const pending = Math.max(0, b.amount - paidAmt);
  const days = daysBetween(today, b.date);
  let level = 'ok';
  if (pending <= 0) level = 'paid';
  else if (days < 0) level = 'overdue';
  else if (days <= 7) level = 'soon';
  return { pending, paid: paidAmt, days, level, cuota: pending <= 0 ? 0 : days > 0 ? pending / days : pending };
}

// META DIARIA del mes actual. Se calcula con lo generado antes de hoy, así "hoy llevas X de Y" tiene sentido.
export function todayPlan(state, today = localToday()) {
  const key = monthKey(today);
  const plan = monthPlan(state, key, today);
  const daysLeft = monthDays(key) - +today.slice(8) + 1;
  const before = incomeIn(state, key, (x) => x.date < today);
  const earnedToday = incomeIn(state, key, (x) => x.date === today);
  const meta = Math.max(0, plan.objetivo - before) / daysLeft;
  return { ...plan, daysLeft, meta, earnedToday, pending: Math.max(0, plan.faltante) };
}

// Budget familiar: lo apartado cada mes (settings.finance.savings = { 'YYYY-MM': monto }) abona las metas por fecha.
export function goalsPlan(state, today = localToday()) {
  const savings = state.finance?.savings || {};
  const generado = Object.values(savings).reduce((s, v) => s + (+v || 0), 0);
  let left = generado;
  const goals = [...state.goals].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')).map((g) => {
    const amount = +g.amount || 0;
    const have = Math.min(+g.saved || 0, amount);
    const add = Math.max(0, Math.min(amount - have, left));
    left -= add;
    const collected = have + add;
    const pending = amount - collected;
    const days = g.date ? daysBetween(today, g.date) : null;
    const cuota = pending > 0 && days > 0 && days <= GOAL_WINDOW ? pending / days : 0;
    return { g, amount, collected, pending, days, cuota };
  });
  const objetivo = goals.reduce((s, x) => s + x.amount, 0);
  const daily = goals.reduce((s, x) => s + x.cuota, 0);
  return { savings, generado, objetivo, faltante: objetivo - goals.reduce((s, x) => s + x.collected, 0), goals, daily, weekly: daily * 7, monthly: daily * WORK_DAYS, yearly: daily * WORK_DAYS * 12 };
}
