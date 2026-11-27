/**
 * Plan de nómina por persona (hoja Nomina2027 del Excel v21 y Finantia Admon 1.0).
 *
 * Cada persona del plan del equipo financiero trae su salario mensual 2026 (de la base de datos
 * de nómina; vacío si no está), su salario mensual 2027, el factor prestacional, la bolsa (costo
 * sin salario: comisiones, escalafón, metas), la fila del modelo (línea presupuestal) y la unidad.
 *
 *  - Clase (Nomina2027, columna I): sin salario 2027 → Bolsa si tiene bolsa, si no Vacante;
 *    sin salario 2026 → Nuevo; con ambos → Continúa.
 *  - Costo anual 2027 (columna M): salario 2026 hasta el mes del incremento (abril) y salario 2027
 *    desde ese mes, por el factor prestacional. Piso legal desde el 1 de enero: quien gane menos del
 *    SMMLV 2027 recibe su salario 2027 desde enero, y el salario integral (≥ 13 SMMLV 2026) se lleva
 *    al menos a 13 SMMLV 2027 todo el año. Bolsas: su valor.
 *  - Por proceso (filas 6–56): continúan y nuevos suman el peso de la persona (quien está en dos
 *    procesos pesa 0,5 en cada uno); las vacantes se cuentan. El total de personas es editable.
 *  - Cargos a costear (Finantia Admon 1.0): el costo de quienes tienen salario se escala por
 *    (personas − vacantes excluidas − nuevos excluidos) ÷ (continúan + nuevos). Con el modo del
 *    Excel (solo nuevos) el factor es 1; con vacantes, cada vacante cuesta el promedio del proceso.
 *  - Línea y unidad (Nomina_Asignacion): fila del modelo − 5 = línea presupuestal; la unidad fija
 *    va a su columna y REPARTO se reparte con la participación 2026 de la línea (datos.REP).
 */
export const SMMLV_2026 = 1750905;
export const UNIDADES = ['PRE', 'POS', 'MAE', 'PLUS', 'EXT', 'URE', 'BAQ'];
export const MODOS = [
  ['plan', 'Solo cargos nuevos (plan del equipo, como el Excel)'],
  ['cont', 'Sin vacantes ni cargos nuevos'],
  ['vac', 'Solo vacantes (sin cargos nuevos)'],
  ['ambos', 'Vacantes y cargos nuevos']
];
const FILA0 = 5; /* Nomina_Asignacion: la línea 0 del modelo está en la fila 5 */

const vacio = x => x == null || x === '';

export function clase(p) {
  if (!(p.s27 > 0)) return p.bolsa > 0 ? 'Bolsa' : 'Vacante';
  return vacio(p.s26) ? 'Nuevo' : 'Continúa';
}

/** Costo anual 2027 de una persona. op = { sm26, sm27, mes } */
export function costoAnual(p, { sm26 = SMMLV_2026, sm27, mes = 4 }) {
  if (!(p.s27 > 0)) return p.bolsa > 0 ? p.bolsa : 0;
  const g = vacio(p.s26) ? null : p.s26, h = p.s27;
  const integral = g != null && g >= 13 * sm26;
  const h2 = integral ? Math.max(h, 13 * sm27) : h;
  const antes = g == null || g < sm27 ? h2 : Math.max(Math.min(g, h2), integral ? 13 * sm27 : 0);
  return (antes * (mes - 1) + h2 * (13 - mes)) * (p.factor ?? 1);
}

/** SMMLV 2027 del piso legal: SMMLV 2026 × (1 + incremento del mínimo del escenario Moderado). */
export const smmlv2027 = smModerado => SMMLV_2026 * (1 + smModerado);

/**
 * @param {object[]} personas  filas del plan (s26, s27, factor, bolsa, fila, unidad, peso, proceso, rubro, cargo…)
 * @param {object} op  { REP, nLineas, sm27, mes, modo = 'plan', personasPorProceso = {} }
 * @returns {{ personas, procesos, LP, total, totalPlan }}
 */
export function planNomina(personas, { REP, nLineas, sm27, mes = 4, modo = 'plan', personasPorProceso = {} }) {
  const exV = modo === 'plan' || modo === 'cont', exN = modo === 'cont' || modo === 'vac';
  const P = personas.map(p => ({ ...p, clase: clase(p), costo: costoAnual(p, { sm27, mes }) }));
  const porProc = new Map();
  for (const p of P) {
    const k = p.proceso;
    if (!porProc.has(k)) porProc.set(k, { proceso: k, rubro: p.rubro, cont: 0, nuevos: 0, vac: 0, bolsas: 0, costoPlan: 0 });
    const g = porProc.get(k), w = p.peso ?? 1;
    if (p.clase === 'Continúa') g.cont += w; else if (p.clase === 'Nuevo') g.nuevos += w;
    else if (p.clase === 'Vacante') g.vac += 1; else g.bolsas += 1;
    g.costoPlan += p.costo;
  }
  for (const g of porProc.values()) {
    g.tot = g.cont + g.nuevos + g.vac;
    g.personas = personasPorProceso[g.proceso] ?? g.tot;
    const base = g.cont + g.nuevos;
    g.factor = base ? (g.personas - (exV ? g.vac : 0) - (exN ? g.nuevos : 0)) / base : 1;
    g.costo = 0;
  }
  const LP = Array.from({ length: nLineas }, () => [0, 0, 0, 0, 0, 0, 0]);
  for (const p of P) {
    const g = porProc.get(p.proceso);
    p.costoAjustado = p.s27 > 0 ? p.costo * g.factor : p.costo;
    g.costo += p.costoAjustado;
    if (!p.costoAjustado) continue;
    const li = p.fila - FILA0;
    if (p.unidad === 'REPARTO') REP[li].forEach((s, j) => (LP[li][j] += p.costoAjustado * s));
    else LP[li][UNIDADES.indexOf(p.unidad)] += p.costoAjustado;
  }
  const procesos = [...porProc.values()];
  return {
    personas: P, procesos, LP,
    total: procesos.reduce((s, g) => s + g.costo, 0),
    totalPlan: procesos.reduce((s, g) => s + g.costoPlan, 0)
  };
}

/** Revisa que la fila y la unidad de cada persona existan en el modelo. Devuelve el primer error o null. */
export function revisarAsignacion(personas, nLineas) {
  for (const [i, p] of personas.entries()) {
    const li = p.fila - FILA0;
    if (!Number.isInteger(li) || li < 0 || li >= nLineas) return `Fila ${i + 2}: fila del modelo ${p.fila} fuera de rango (${FILA0}–${FILA0 + nLineas - 1})`;
    if (p.unidad !== 'REPARTO' && !UNIDADES.includes(p.unidad)) return `Fila ${i + 2}: unidad "${p.unidad}" desconocida (${UNIDADES.join(', ')} o REPARTO)`;
  }
  return null;
}
