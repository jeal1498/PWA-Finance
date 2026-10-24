// Migración de las finanzas anteriores (ingresos, pagos, metas y topes) al modelo de la v2.7:
// "movimientos" (pagos) y "metas", cada uno con su historial de abonos.
// Se hace una sola vez por dispositivo. Los stores anteriores no se tocan (siguen en el respaldo).
//
// Lo que se veía en cada hoja del mes (pagos repetidos, cargas/servicios/gastos del Vehículo y el resto
// del tope de combustible) se vuelve un movimiento normal, con lo abonado por lo generado como abono sin fecha.
// Las metas conservan lo ahorrado ("Ya ahorrado" + lo apartado por mes) como abono sin fecha.
import * as db from './db.js';
import { monthKey, addMonths, monthPlan, goalsPlan } from './finance.js';

const FLAG = 'finanzas-2';
const r2 = (n) => Math.round(n * 100) / 100;
const localToday = () => new Date().toLocaleDateString('en-CA');
const abonos = (monto) => (monto > 0 ? [{ fecha: null, monto }] : []);

// Pura: convierte el estado anterior en { movimientos, metas }.
export function convertFinance(state, today = localToday()) {
  const now = Date.now();
  const months = [...state.bills.map((b) => b.date), ...state.income.map((x) => x.date)].filter(Boolean).map(monthKey).sort();
  const movimientos = [];
  if (months.length) {
    let last = months.at(-1) > monthKey(today) ? months.at(-1) : monthKey(today);
    // Los pagos que se repiten ya no existen como tal: se dejan escritos 3 meses hacia adelante.
    if (state.bills.some((b) => b.repeat)) last = [last, addMonths(monthKey(today), 3)].sort().at(-1);
    for (let key = months[0]; key <= last; key = addMonths(key, 1)) {
      const plan = monthPlan(state, key, today);
      for (const x of plan.items) {
        const abo = r2(plan.paid.get(x.id) || 0);
        movimientos.push({
          id: x.bill && !x.bill.repeat ? x.bill.id : `mig-${x.id}`,
          fecha: x.date,
          cat: x.category || '📦 Otro',
          conc: x.concept || 'Pago',
          imp: r2(x.amount),
          abo,
          pagos: abonos(abo),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }
  const metas = goalsPlan(state, today).goals.map(({ g, amount, collected }) => ({
    id: g.id,
    fecha: g.date || today,
    cat: g.category || '📦 Otro',
    conc: g.concept || 'Meta',
    imp: r2(amount),
    abo: r2(collected),
    pagos: abonos(r2(collected)),
    createdAt: g.createdAt || now,
    updatedAt: now,
  }));
  return { movimientos, metas };
}

// Corre la migración si falta (la marca va en el ajuste "finance", que también viaja en el respaldo).
// Es segura de repetir: no pisa registros que ya existan con el mismo id.
export async function migrateFinance(today = localToday()) {
  const finance = (await db.getSetting('finance')) || {};
  if (String(finance.migrated || '').split(',').includes(FLAG)) return false;
  const [income, bills, goals, budgets, fuel, maintenance, expenses, spending, movs, metas] = await Promise.all(
    ['income', 'bills', 'goals', 'budgets', 'fuel', 'maintenance', 'expenses', 'spending', 'movimientos', 'metas'].map((s) => db.all(s)),
  );
  // La vista estilo MonAi (retirada hace tiempo) guardaba "spending": cuenta como pagos.
  const asBills = spending.map((x) => ({ id: x.id, concept: x.concept || x.category, amount: x.amount, category: x.category, date: x.date, createdAt: x.createdAt }));
  const state = { income, bills: [...bills, ...asBills], goals, budgets, fuel, maintenance, expenses, finance };
  const out = convertFinance(state, today);
  const have = new Set([...movs, ...metas].map((x) => x.id));
  await db.putMany('movimientos', out.movimientos.filter((x) => !have.has(x.id)));
  await db.putMany('metas', out.metas.filter((x) => !have.has(x.id)));
  await db.setSetting('finance', { ...finance, migrated: [...String(finance.migrated || '').split(',').filter(Boolean), FLAG].join(','), migratedAt: today });
  return true;
}
