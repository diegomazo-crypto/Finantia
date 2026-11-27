/**
 * Proyección 2026E, 2027 y 2028–2031 por comportamiento de costo, flujo de caja
 * libre (FCF) y métricas (NPV, NPV con valor terminal, TIR, payback).
 *
 * project() se copió de Finantia Admon 1.0 sin cambios de fórmula. Equivale a la
 * hoja Proyeccion_2027_2031 del Excel v21 (que incluye la política de fundadores,
 * Supuestos 5B).
 */
import { FIXED } from './parametros.js';
import { sum, base2026 } from './presupuesto.js';

/* Proyección 2026E, 2027 y 2028–2031 por comportamiento de costo + FCF y métricas */
/* % de descuento del pregrado por mezcla de grupos (antiguos, fundadores, nuevos desde 2028); devuelve 2027..2031 */
export function fundMix(c, path) { const out = [c.rA * (1 - c.F) + c.rN * c.F]; let S = 0, prev = 0, P = 0; const F = c.F + c.e / 2;
  for (let k = 0; k < 4; k++) { P = k === 0 ? c.e / 2 : P + c.e; S += c.e / 2 * (prev + path[k]); prev = path[k]; out.push(Math.max(0, 1 - F - P) * c.rA + F * c.rN + S); } return out; }
export function fundDelta(p, units, tot) { if (!units || !tot || !tot.IB) return [0, 0, 0, 0];
  const lr = p.lr || {}, mS = fundMix(FIXED.fund.S, lr.fS || FIXED.fundDef.fS), mB = fundMix(FIXED.fund.B, lr.fB || FIXED.fundDef.fB);
  const wS = units[0].IB / tot.IB, wB = units[6].IB * FIXED.volShare[6] / tot.IB;
  return [0, 1, 2, 3].map(k => (mS[k + 1] - mS[k]) * wS + (mB[k + 1] - mB[k]) * wB); }
export function project(p, H, y27, units) { /* y27 ya incorpora las metas */
  const fd = fundDelta(p, units, y27);
  const shareN = sum(H.NS) / sum(H.N);
  const y26 = base2026(H);
  const rows = [y26, Object.assign({}, y27)];
  rows[1].PD = y27.IB ? y27.DS / y27.IB : 0;
  for (let k = 0; k < 4; k++) {
    const pr = rows[rows.length - 1];
    const ipc = p.lr.ipc[k], sm = p.lr.sm[k], g = p.lr.g[k], dd = p.lr.dd[k];
    const IB = pr.IB * (1 + ipc) * (1 + g);
    const PD = Math.max(0, pr.PD + dd + fd[k]);
    const DS = IB * PD, NET = IB - DS;
    const r = {
      IB, PD, DS, NET, OI: pr.OI * (1 + ipc),
      N: pr.N * (1 + shareN * sm + (1 - shareN) * ipc), C: pr.C * (1 + ipc) * (1 + g), V: pr.V * (1 + ipc) * (1 + g),
      VI: pr.NET ? pr.VI * NET / pr.NET : 0, FX: FIXED.cintanaUSD[k + 1] * p.trm[k + 1], F: pr.F * (1 + ipc), DA: pr.DA
    };
    r.TC = r.N + r.C + r.V + r.VI + r.FX + r.F; r.EBITDA = r.NET + r.OI - r.TC; r.RN = r.EBITDA - r.DA;
    rows.push(r);
  }
  y26.PD = y26.IB ? y26.DS / y26.IB : 0;
  let npv = -FIXED.inv, cum = -FIXED.inv;
  rows.forEach((r, i) => {
    if (i === 0) { r.FCF = -FIXED.inv; r.DFCF = r.FCF; return; }
    r.TAX = FIXED.tax * Math.max(0, r.RN);
    r.CAPEX = FIXED.capex * r.NET;
    r.KT = FIXED.kt * (r.NET - rows[i - 1].NET);
    r.FCF = r.EBITDA - r.TAX - r.CAPEX - r.KT;
    r.DF = 1 / Math.pow(1 + FIXED.rate, i);
    r.DFCF = r.FCF * r.DF;
    npv += r.DFCF; cum += r.FCF; r.CUM = cum;
  });
  const last = rows[5];
  const tv = last.FCF * (1 + FIXED.gT) / (FIXED.rate - FIXED.gT) * last.DF;
  const acc = k => sum(rows.slice(1).map(r => r[k]));
  return { rows, npv, npvTV: npv + tv, ebitdaAcc: acc('EBITDA'), rnAcc: acc('RN') };
}

/**
 * TIR de una serie de flujos (año 0 primero). Devuelve null cuando la serie no
 * cambia de signo, como el Excel ("N/A – sin inversión inicial").
 * @param {number[]} flujos
 */
export function irr(flujos) {
  const pos = flujos.some(v => v > 0), neg = flujos.some(v => v < 0);
  if (!pos || !neg) return null;
  const npvAt = r => flujos.reduce((s, v, t) => s + v / Math.pow(1 + r, t), 0);
  let lo = -0.99, hi = 10, flo = npvAt(lo), fhi = npvAt(hi);
  if (flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const m = (lo + hi) / 2, fm = npvAt(m);
    if (Math.abs(fm) < 1e-6) return m;
    if (fm * flo < 0) { hi = m; fhi = fm; } else { lo = m; flo = fm; }
  }
  return (lo + hi) / 2;
}

/**
 * Payback en años (con interpolación lineal dentro del año). Devuelve null si no
 * hay inversión inicial (flujo del año 0 ≥ 0) o si no se recupera en el horizonte.
 * @param {number[]} flujos  año 0 primero
 */
export function payback(flujos) {
  if (!(flujos[0] < 0)) return null;
  let acc = flujos[0];
  for (let t = 1; t < flujos.length; t++) {
    const prev = acc; acc += flujos[t];
    if (acc >= 0) return t - 1 + (flujos[t] ? -prev / flujos[t] : 0);
  }
  return null;
}

/**
 * Métricas clave del escenario a partir del resultado de project().
 * Con FIXED.inv = 0 (presupuesto operativo) TIR y payback no aplican y salen null.
 */
export function metricas(pj) {
  const fcf = pj.rows.map(r => r.FCF), dfcf = pj.rows.map(r => r.DFCF);
  return {
    npv: pj.npv,
    npvTV: pj.npvTV,
    tv: pj.npvTV - pj.npv,
    irr: irr(fcf),
    paybackSimple: payback(fcf),
    paybackDescontado: payback(dfcf),
    ebitdaAcc: pj.ebitdaAcc,
    rnAcc: pj.rnAcc
  };
}
