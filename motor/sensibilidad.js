/**
 * Sensibilidad (hoja Sensibilidad), tornado y punto de equilibrio (hoja
 * Tornado_Equilibrio). Lógica copiada de Finantia Admon 1.0 sin cambios de fórmula.
 *
 * Todas las funciones reciben `run(p, o)`: el cálculo del presupuesto con las
 * entradas del usuario ya fijadas (ver crearModelo en index.js).
 */
import { FIXED } from './parametros.js';
import { descOf, sum } from './presupuesto.js';

const clone = o => JSON.parse(JSON.stringify(o));

/** Ejes por defecto de las dos tablas de sensibilidad. */
export const EJES = {
  dVol: [-0.10, -0.05, -0.025, 0, 0.025, 0.05, 0.10],
  dDesc: [-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03],
  sm: p => [0.06, 0.08, p.sm, 0.11, 0.13, 0.15, 0.18].sort((a, b) => a - b).filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 1e-9)
};

/** Tabla 1: resultado neto 2027 por Δ volumen (filas) × Δ descuento (columnas). */
export function tablaVolumenDescuento(run, p, filas = EJES.dVol, cols = EJES.dDesc) {
  return filas.map(a => cols.map(b => run(p, { dVol: a, dDesc: b }).tot.RN));
}

/** Tabla 2: resultado neto 2027 por Δ volumen (filas) × incremento SMMLV (columnas). */
export function tablaVolumenSMMLV(run, p, filas = EJES.dVol, cols = EJES.sm(p)) {
  return filas.map(a => cols.map(b => run(p, { dVol: a, smOverride: b }).tot.RN));
}

const desSh = d => q => { q.des = q.des.map((v, i) => (FIXED.des26[i] > 0 ? Math.min(0.95, Math.max(0, v + d)) : v)); };
const dscSh = (p, H, d) => q => { q.descU = descOf(p, H).map(v => (v > 0 ? Math.min(0.95, Math.max(0, v + d)) : v)); };

/**
 * Tornado: cambio en el resultado neto 2027 al mover cada supuesto por sí solo.
 * @param {Function} run
 * @param {object} p  parámetros del escenario
 * @param {object} H  base 2026E
 * @param {number} esic0  participación ESIC usada (COP)
 * @returns {{l: string, r: string, a: number, b: number, w: number}[]} ordenado de mayor a menor efecto
 */
export function tornado(run, p, H, esic0) {
  const base = run(p), RN0 = base.tot.RN, Nb = base.units.map(x => x.N);
  const withP = f => { const q = clone(p); f(q); return q; };
  const rnP = (f, o) => run(withP(f), o).tot.RN;
  const nomF = k => ({ planUnits: Nb.map(v => v * k) });
  return [
    ['Cumplimiento de la meta de nuevos', '−10 pp / +10 pp', () => rnP(q => (q.cump = p.cump - 0.1)), () => rnP(q => (q.cump = p.cump + 0.1))],
    ['Descuentos y becas (todas las unidades)', '+2 pp / −2 pp', () => rnP(dscSh(p, H, 0.02)), () => rnP(dscSh(p, H, -0.02))],
    ['Nómina de planta', '+3% / −3%', () => run(p, nomF(1.03)).tot.RN, () => run(p, nomF(0.97)).tot.RN],
    ['Incremento de matrículas', '−1 pp / +1 pp', () => rnP(q => (q.price = p.price - 0.01)), () => rnP(q => (q.price = p.price + 0.01))],
    ['Deserción de antiguos', '+2 pp / −2 pp', () => rnP(desSh(0.02)), () => rnP(desSh(-0.02))],
    ['IPC (costos y cátedra)', '+1 pp / −1 pp', () => rnP(q => (q.ipc = p.ipc + 0.01)), () => rnP(q => (q.ipc = p.ipc - 0.01))],
    ['Cumplimiento de la meta URE', '−10 pp / +10 pp', () => rnP(q => (q.cumpURE = p.cumpURE - 0.1)), () => rnP(q => (q.cumpURE = p.cumpURE + 0.1))],
    ['Ventas de pregrado ESIC (participación)', '−20% / +20%', () => run(p, { esic: esic0 * 0.8 }).tot.RN, () => run(p, { esic: esic0 * 1.2 }).tot.RN],
    ['TRM para el pago a CINTANA', '+10% / −10%', () => rnP(q => (q.trm = p.trm.map((v, i) => (i ? v : v * 1.1)))), () => rnP(q => (q.trm = p.trm.map((v, i) => (i ? v : v * 0.9))))]
  ].map(([l, r, lo, hi]) => { const a = lo() - RN0, b = hi() - RN0; return { l, r, a, b, w: Math.max(Math.abs(a), Math.abs(b)) }; }).sort((x, y) => y.w - x.w);
}

function solve(f, lo, hi, tgt) {
  let flo = f(lo) - tgt; const fhi = f(hi) - tgt; if (flo * fhi > 0) return null;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2, fm = f(m) - tgt; if (fm * flo <= 0) { hi = m; } else { lo = m; flo = fm; } }
  return (lo + hi) / 2;
}

/**
 * Punto de equilibrio / metas inversas: valor que debe tomar cada palanca, por sí
 * sola, para que el resultado neto 2027 llegue al objetivo `tgt` (COP).
 * Devuelve null en una palanca cuando el objetivo queda fuera de rango.
 */
export function equilibrio(run, p, H, tgt = 0) {
  const base = run(p), Nb = base.units.map(x => x.N);
  const withP = f => { const q = clone(p); f(q); return q; };
  const rnP = f => run(withP(f)).tot.RN;
  const wDes = q => { let s = 0, w = 0; q.des.forEach((v, i) => { if (FIXED.des26[i] > 0) { s += v * H.IB[i]; w += H.IB[i]; } }); return s / w; };
  const cump = solve(c => rnP(q => (q.cump = c)), 0, 2, tgt);
  const dDesc = solve(d => rnP(dscSh(p, H, d)), -0.3, 0.5, tgt);
  const nomina = solve(k => run(p, { planUnits: Nb.map(v => v * k) }).tot.RN, 0.5, 1.5, tgt);
  const price = solve(v => rnP(q => (q.price = v)), -0.2, 0.5, tgt);
  const dDes = solve(d => rnP(desSh(d)), -0.15, 0.5, tgt);
  const N0 = sum(Nb);
  return {
    cumplimiento: { actual: p.cump, objetivo: cump },
    descuento: { actual: base.tot.DS / base.tot.IB, delta: dDesc, objetivo: dDesc == null ? null : (r => r.DS / r.IB)(run(withP(dscSh(p, H, dDesc))).tot) },
    nomina: { actual: N0, factor: nomina, objetivo: nomina == null ? null : N0 * nomina },
    matricula: { actual: p.price, objetivo: price },
    desercion: { actual: wDes(p), delta: dDes, objetivo: dDes == null ? null : wDes(withP(desSh(dDes))) }
  };
}
