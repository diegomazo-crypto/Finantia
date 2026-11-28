/**
 * Planeación financiera · estados proforma a 5 años, flujo de caja libre y métricas de valor.
 *
 * Parte de la proyección del presupuesto (motor/proyeccion.js: 2026E, 2027 y 2028–2031 por
 * escenario) y le agrega los supuestos de planeación, explícitos y editables:
 *   tasa de descuento, crecimiento a perpetuidad, capex (% del ingreso neto + inversiones puntuales),
 *   capital de trabajo (% del cambio en el ingreso neto), impuesto, inversión inicial (año 0)
 *   y la deuda (cuota fija anual: intereses y capital).
 *
 * Flujo de caja libre (FCL) = EBITDA − impuestos operativos − capex − Δ capital de trabajo.
 * VPN = −inversión inicial + Σ FCL / (1 + tasa)^t, t = 1…5 (2027–2031).
 * TIR y payback se miden contra la inversión inicial: sin ella no aplican.
 * El pago a CINTANA (FX en la proyección) va dentro de "Gastos fijos y otros": no se muestra aparte.
 */
import { irr, payback } from './proyeccion.js';

export const SUPUESTOS_PLANEACION = {
  tasa: 0.12, gT: 0.03, capexPct: 0.04, ktPct: 0, impuesto: 0, inversionInicial: 0,
  inversiones: [0, 0, 0, 0, 0], /* 2027–2031, además del capex recurrente */
  deuda: [],                    /* [{ nombre, saldo, tasa, anios }] cuota fija anual desde 2027 */
  cajaInicial: null, cajaMinima: 2000e6
};

/** Mezcla los supuestos guardados sobre los de por defecto y los valida. */
export function supuestosPlaneacion(s = {}) {
  const out = { ...SUPUESTOS_PLANEACION, ...s };
  const num = (v, lo, hi, nombre) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw new Error(`${nombre} fuera de rango`); return x; };
  out.tasa = num(out.tasa, 0.001, 1, 'Tasa de descuento');
  out.gT = num(out.gT, -0.5, 0.5, 'Crecimiento a perpetuidad');
  if (out.gT >= out.tasa) throw new Error('El crecimiento a perpetuidad debe ser menor que la tasa de descuento');
  out.capexPct = num(out.capexPct, 0, 1, 'Capex'); out.ktPct = num(out.ktPct, -1, 1, 'Capital de trabajo'); out.impuesto = num(out.impuesto, 0, 1, 'Impuesto');
  out.inversionInicial = num(out.inversionInicial, 0, 1e15, 'Inversión inicial');
  out.inversiones = Array.from({ length: 5 }, (_, k) => num(out.inversiones?.[k] ?? 0, 0, 1e15, 'Inversiones'));
  out.deuda = (out.deuda || []).map(d => ({ nombre: String(d.nombre || 'Crédito').slice(0, 80), saldo: num(d.saldo, 0, 1e15, 'Saldo de la deuda'), tasa: num(d.tasa, 0, 1, 'Tasa de la deuda'), anios: Math.round(num(d.anios, 1, 30, 'Plazo de la deuda')) }));
  out.cajaInicial = out.cajaInicial == null || out.cajaInicial === '' ? null : num(out.cajaInicial, -1e15, 1e15, 'Caja inicial');
  out.cajaMinima = num(out.cajaMinima, 0, 1e15, 'Caja mínima');
  return out;
}

/** Tabla de la deuda por año (5 años): intereses, capital y saldo final. Cuota fija anual. */
export function tablaDeuda(deuda) {
  const anios = Array.from({ length: 5 }, () => ({ intereses: 0, capital: 0, saldo: 0 }));
  for (const d of deuda) {
    let saldo = d.saldo;
    const cuota = d.tasa ? saldo * d.tasa / (1 - Math.pow(1 + d.tasa, -d.anios)) : saldo / d.anios;
    for (let k = 0; k < 5; k++) {
      if (k >= d.anios || saldo <= 0) { anios[k].saldo += Math.max(0, saldo); continue; }
      const i = saldo * d.tasa, c = k === d.anios - 1 ? saldo : Math.min(saldo, cuota - i); /* el último año cancela el saldo */
      saldo -= c; anios[k].intereses += i; anios[k].capital += c; anios[k].saldo += Math.max(0, saldo);
    }
  }
  return anios;
}

/**
 * Proforma de un escenario.
 * @param {object[]} filas  proyeccion.rows: [2026E, 2027, 2028, 2029, 2030, 2031] con IB, DS, NET, OI, N, C, V, VI, FX, F, EBITDA, DA
 * @param {object} sup  supuestosPlaneacion()
 * @param {number} [cajaInicial]  caja al inicio de 2027 (si sup.cajaInicial es null)
 */
export function proforma(filas, sup, cajaInicial = 0) {
  const deuda = tablaDeuda(sup.deuda);
  let caja = sup.cajaInicial ?? cajaInicial;
  const anios = filas.map((r, i) => {
    const costos = { N: r.N, CV: (r.C || 0) + (r.V || 0) + (r.VI || 0), FO: (r.F || 0) + (r.FX || 0) };
    const base = {
      anio: 2026 + i, IB: r.IB, DS: r.DS, NET: r.NET, OI: r.OI, ...costos, TC: costos.N + costos.CV + costos.FO,
      EBITDA: r.EBITDA, margen: r.NET ? r.EBITDA / r.NET : null, DA: r.DA, EBIT: r.EBITDA - r.DA
    };
    if (i === 0) return { ...base, referencia: true };
    const k = i - 1, dt = deuda[k];
    const INT = dt.intereses, UAI = base.EBIT - INT, IMP = sup.impuesto * Math.max(0, UAI), UN = UAI - IMP;
    const IMPOP = sup.impuesto * Math.max(0, base.EBIT); /* impuesto sobre la operación, sin el escudo de la deuda */
    const CAPEX = sup.capexPct * r.NET + sup.inversiones[k];
    const KT = sup.ktPct * (r.NET - filas[i - 1].NET);
    const FCL = r.EBITDA - IMPOP - CAPEX - KT;
    const SD = dt.intereses + dt.capital, ESC = IMPOP - IMP; /* escudo fiscal de los intereses */
    const FCA = FCL - SD + ESC; /* flujo después del servicio de la deuda */
    const cajaIni = caja; caja += FCA - (k === 0 ? sup.inversionInicial : 0);
    return { ...base, INT, UAI, IMP, UN, IMPOP, CAPEX, KT, FCL, INTd: dt.intereses, CAPd: dt.capital, SD, ESC, FCA, DEUDA: dt.saldo, cajaIni, cajaFin: caja, DF: 1 / Math.pow(1 + sup.tasa, i), DFCL: FCL / Math.pow(1 + sup.tasa, i) };
  });
  return { anios, metricas: metricasPlaneacion(anios, sup) };
}

export function metricasPlaneacion(anios, sup) {
  const p = anios.slice(1), flujos = [-sup.inversionInicial, ...p.map(a => a.FCL)];
  const desc = flujos.map((v, t) => v / Math.pow(1 + sup.tasa, t));
  const vpn = desc.reduce((s, v) => s + v, 0), ult = p[p.length - 1];
  const vt = ult.FCL * (1 + sup.gT) / (sup.tasa - sup.gT) / Math.pow(1 + sup.tasa, p.length);
  return {
    vpn, vt, vpnVT: vpn + vt, tir: irr(flujos), paybackSimple: payback(flujos), paybackDescontado: payback(desc),
    fclTotal: p.reduce((s, a) => s + a.FCL, 0), ebitdaTotal: p.reduce((s, a) => s + a.EBITDA, 0),
    margenPromedio: p.reduce((s, a) => s + (a.margen || 0), 0) / p.length,
    cajaMinima: Math.min(...p.map(a => a.cajaFin)), anioCajaMinima: p.reduce((m, a) => (a.cajaFin < m.cajaFin ? a : m), p[0]).anio,
    bajoMinimo: p.filter(a => a.cajaFin < sup.cajaMinima).map(a => a.anio), sinInversion: !(sup.inversionInicial > 0)
  };
}
