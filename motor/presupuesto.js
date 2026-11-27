/**
 * Presupuesto 2027: cálculo por unidad de negocio (compute), estado de resultados
 * con la estructura del informe CEIPA (pyg) y base 2026E (base2026).
 *
 * Lógica copiada de Finantia Admon 1.0 sin cambios de fórmula; solo se convirtió
 * en módulo. Las pruebas en pruebas/ verifican que cuadra con el Excel v21.
 */
import { FIXED, DEFAULTS, SEGS, GMAX } from './parametros.js';

export const sum = a => a.reduce((x, y) => x + y, 0);
export function nomK() { const m = FIXED.nomInc.mes; return { k: (13 - m) / 12, arr: 12 / ((m - 1) / (1 + FIXED.nomInc.inc26) + 13 - m) }; }
export function dOldOf(p) { return p.des.map((d, i) => (1 - d) / (1 - FIXED.des26[i]) - 1); }
export function descOf(p, H) { return H.IB.map((v, i) => { const b = v ? H.DS[i] / v : 0; return p.descU ? p.descU[i] : (b === 0 ? 0 : Math.max(0, b + FIXED.dMix[i] + p.dpp)); }); }
export function maeIB(p, MQ) {
  const M = FIXED.mae, q = (MQ && MQ[2]) || FIXED.metas[2].meta, ret = 1 + dOldOf(p)[2];
  const coh27 = sum(q) * p.cump * M.pago, c26 = M.c26 * ret * (M.v2 + M.v3), c25 = M.c25 * ret * M.v4;
  return { coh27, c26, c25, amort: M.amort, tot: coh27 + c26 + c25 + M.amort };
}
export function metaW(m, q) { return sum(q.map((v, k) => v * m.w[k])); }
export function effNew(p, MQ) {
  return p.dNew.map((d, i) => {
    if (i === 5 && FIXED.ure) { const meta = (MQ && MQ.ure != null) ? MQ.ure : FIXED.ure.meta; return meta * p.cumpURE / (FIXED.ure.ib26 * (1 + p.price)) - 1; }
    const m = FIXED.metas[i]; if (!m) return d;
    const q = (MQ && MQ[i]) || m.meta;
    return metaW(m, q) * p.cump / metaW(m, m.real) - 1;
  });
}

/* ---------- tamaño de grupo y cátedra (hoja Docencia2027) ---------- */
export const TOPE = p => Object.assign({}, GMAX, Object.fromEntries(Object.entries((p && p.tope) || {}).filter(([, v]) => v)));
export const GRP = (() => { const o = {}; SEGS.forEach(([m, t, J, E]) => { const k = m + '_' + t; o[k] = o[k] || { J: 0, E: 0 }; o[k].J += J; o[k].E += E; }); Object.keys(o).forEach(k => (o[k] = o[k].E / o[k].J)); return o; })();
/* factor sobre la cátedra: los grupos con profesor de planta se mantienen y la cátedra absorbe el cambio en el número de grupos */
export function grpFactor(p, sede, vert) {
  const g = p.grp || {}; let a = 0, b = 0;
  SEGS.forEach(([m, t, J, E, pt, cv, cn]) => { if ((sede === 'baq') !== (m === 'baq')) return; const c = vert ? cv : cn; if (!c) return; const k = m + '_' + t, S = Math.min(g[k] || GRP[k], TOPE(p)[m]), r = GRP[k] / S, P = J * pt;
    a += c * Math.max(0, (J * r - P) / Math.max(1e-9, J - P)); b += c; });
  return b ? a / b : 1;
}
/**
 * Presupuesto 2027 de un escenario por unidad.
 * @param {object} p  parámetros del escenario (ver DEFAULTS)
 * @param {object} H  base 2026E por código y unidad (datos/base2026.json → H)
 * @param {object} [opts] {metas, planUnits, esic, dVol, dDesc, smOverride}
 *   metas: nuevos por intake; planUnits: nómina plan por unidad (suma de LP);
 *   esic: participación ESIC en COP; dVol/dDesc/smOverride: choques de sensibilidad.
 * @returns {{units: object[], tot: object}}
 */
export function compute(p, H, opts = {}) {
  const dVol = opts.dVol || 0, dDesc = opts.dDesc || 0;
  const sm = opts.smOverride != null ? opts.smOverride : p.sm;
  const n = 7, ipc = p.ipc, price = p.price, cat = p.ipc, mentInc = p.ipc;
  const baseDesc = H.IB.map((v, i) => (v ? H.DS[i] / v : 0));
  const desc = descOf(p, H); const dOld = dOldOf(p);
  const dN = effNew(p, opts.metas);
  const vol = H.IB.map((_, i) => (i === 2 && FIXED.mae.coh && H.IB[2] ? maeIB(p, opts.metas).tot / (H.IB[2] * (1 + price)) : FIXED.volShare[i] * (FIXED.shareNew[i] * (1 + dN[i]) + (1 - FIXED.shareNew[i]) * (1 + dOld[i])) + 1 - FIXED.volShare[i]) * (1 + dVol));
  const volN = dN.map(d => (1 + d) * (1 + dVol));
  const V = FIXED.vertice;
  const dNm = effNew(DEFAULTS.Moderado, opts.metas), pm = DEFAULTS.Moderado;
  const volMod = i => FIXED.volShare[i] * (FIXED.shareNew[i] * (1 + dNm[i]) + (1 - FIXED.shareNew[i]) * (1 + dOldOf(pm)[i])) + 1 - FIXED.volShare[i];
  const Dc = FIXED.doc;
  const mentors = (p.vert ? Dc.teams_sab * V.hours * V.rate * (1 + mentInc) : 0) * vol[0] / volMod(0);
  const docSab = (p.vert ? Dc.catV_sab : Dc.catNV_sab) * (1 + cat) * vol[0] / volMod(0) * grpFactor(p, 'sab', p.vert) + mentors;
  const docBaq = Dc.cat_baq * (1 + cat) * vol[6] / volMod(6) * grpFactor(p, 'baq', 1);
  const cin27 = FIXED.cintanaUSD[0] * p.trm[0];
  const fxTot = sum(H.FX);
  const u = [];
  for (let i = 0; i < n; i++) {
    const d = Math.max(0, desc[i] + (desc[i] === 0 && baseDesc[i] === 0 ? 0 : dDesc));
    const IB = H.IB[i] * (1 + price) * vol[i];
    const DS = IB * d;
    const NET = IB - DS;
    const net26 = H.IB[i] - H.DS[i];
    const nf = net26 ? NET / net26 : 1;
    const esicV = opts.esic != null ? opts.esic : FIXED.esic.ventas * FIXED.esic.pct;
    const OI = H.OI[i] * (1 + ipc) + (i === 0 ? esicV : 0);
    const NK = nomK(); const N = opts.planUnits ? opts.planUnits[i] : NK.arr * (H.N[i] * (1 + NK.k * ipc) + H.NS[i] * NK.k * (sm - ipc));
    let C = H.C[i] * (1 + cat) * vol[i];
    if (i === 0) C = Math.max(0, H.C[0] - Dc.catSab26) * (1 + cat) * vol[0] + docSab;
    if (i === 6) C = Math.max(0, H.C[6] - Dc.catBaq26) * (1 + cat) * vol[6] + docBaq;
    C *= 1 + ((p.catAdj && p.catAdj[i]) || 0);
    const Vv = (H.V[i] * vol[i] + H.VN[i] * volN[i]) * (1 + ipc);
    const VI = H.VI[i] * nf;
    const FX = fxTot ? H.FX[i] / fxTot * cin27 : 0;
    const F = H.F[i] * (1 + ipc);
    const DA = H.DA[i];
    const TC = N + C + Vv + VI + FX + F;
    const EBITDA = NET + OI - TC;
    const RN = EBITDA - DA;
    u.push({ IB, DS, NET, OI, N, C, V: Vv, VI, FX, F, TC, EBITDA, DA, RN, desc: d, vol: vol[i], volN: volN[i], nf, cin27 });
  }
  const tot = {};
  ['IB', 'DS', 'NET', 'OI', 'N', 'C', 'V', 'VI', 'FX', 'F', 'TC', 'EBITDA', 'DA', 'RN'].forEach(k => (tot[k] = sum(u.map(x => x[k]))));
  tot.mentors = mentors;
  return { units: u, tot };
}

/* Estado de resultados con la estructura del informe CEIPA (bloques), por unidad. L = líneas de Base2026: [bloque, código, %≤2SM, [7 unidades]] */
export const BLOCKS = ['PRESTACION', 'ADM_ACADEMICA', 'UNIDADES', 'VENTAS', 'TECNOLOGIA', 'CORPORATIVO', 'ADMINISTRATIVOS', 'DIRECCION', 'OTROS_INGRESOS', 'BANCARIOS', 'DA', 'OTROS_GASTOS'];
export function pyg(p, H, L, r, opts = {}) {
  const sm = opts.smOverride != null ? opts.smOverride : p.sm, ipc = p.ipc, price = p.price;
  const fxTot = sum(H.FX);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = r ? r.units[i] : null, o = { IB: 0, DS: 0 }; BLOCKS.forEach(b => { o[b] = 0; o['n_' + b] = 0; }); const ln = new Array(L.length).fill(0);
    const LP = opts.LP, esicV = opts.esic != null ? opts.esic : FIXED.esic.ventas * FIXED.esic.pct;
    L.forEach(([blk, code, sh, v], li) => {
      const b = v[i]; const lp = (x && LP && code === 'N') ? LP[li][i] : null;
      if (!b && !lp && !(x && code === 'PI' && i === 0)) return;
      let y;
      if (!x) y = code === 'X' ? b : b;
      else if (code === 'IB') y = b * (1 + price) * x.vol;
      else if (code === 'DS') y = H.DS[i] ? b / H.DS[i] * x.DS : 0;
      else if (code === 'N') { const NK = nomK(); y = lp != null ? lp : b * NK.arr * (1 + NK.k * (sh * sm + (1 - sh) * ipc)); }
      else if (code === 'PI') y = i === 0 ? esicV : 0;
      else if (code === 'C') y = H.C[i] ? b / H.C[i] * x.C : 0;
      else if (code === 'F' || code === 'OI') y = b * (1 + ipc);
      else if (code === 'V') y = b * (1 + ipc) * x.vol;
      else if (code === 'VN') y = b * (1 + ipc) * x.volN;
      else if (code === 'VI') y = b * x.nf;
      else if (code === 'FX') y = fxTot ? b / fxTot * x.cin27 : 0;
      else if (code === 'DA') y = b;
      else y = 0;
      ln[li] = y;
      if (code === 'IB') o.IB += y; else if (code === 'DS') o.DS += y; else { o[blk] = (o[blk] || 0) + y; if (code === 'N' || code === 'C') o['n_' + blk] += y; }
    });
    Object.defineProperty(o, 'ln', { value: ln, enumerable: false });
    o.NET = o.IB - o.DS; o.CD = o.PRESTACION + o.ADM_ACADEMICA + o.UNIDADES + o.VENTAS; o.MB = o.NET - o.CD;
    o.GO = o.TECNOLOGIA + o.CORPORATIVO + o.ADMINISTRATIVOS + o.DIRECCION; o.RO = o.MB - o.GO;
    o.RN = o.RO + o.OTROS_INGRESOS - o.BANCARIOS - o.DA - o.OTROS_GASTOS; o.EBITDA = o.RN + o.DA;
    out.push(o);
  }
  const tot = {}; Object.keys(out[0]).forEach(k => (tot[k] = sum(out.map(o => o[k]))));
  Object.defineProperty(tot, 'ln', { value: L.map((_, li) => sum(out.map(o => o.ln[li]))), enumerable: false });
  return { units: out, tot };
}

export function base2026(H) {
  const t = k => sum(H[k]);
  const IB = t('IB'), DS = t('DS'), NET = IB - DS, OI = t('OI');
  const N = t('N'), C = t('C'), V = t('V') + t('VN'), VI = t('VI'), FX = t('FX'), F = t('F') + t('X'), DA = t('DA');
  const TC = N + C + V + VI + FX + F, EBITDA = NET + OI - TC;
  return { IB, DS, NET, OI, N, C, V, VI, FX, F, TC, EBITDA, DA, RN: EBITDA - DA };
}

