/**
 * Presupuesto 2027 mensual (hoja Ppto2027_Mensual) y flujo de caja 2027
 * (hoja FlujoCaja2027). Lógica copiada de Finantia Admon 1.0 sin cambios de fórmula.
 */
import { FIXED } from './parametros.js';
import { BLOCKS } from './presupuesto.js';

/**
 * Resumen mensual: ingreso neto, otros ingresos, costos y resultado por mes.
 * Ingresos con la estacionalidad de cada unidad; nómina y cátedra con S.NOM; el resto con S.COS.
 * @param {object} datos  base2026.json (usa seas y units)
 * @param {object} r      resultado de compute()
 */
export function mensual(datos, r) {
  const S = datos.seas, U = datos.units, T = r.tot, mon = [];
  for (let m = 0; m < 12; m++) {
    let IB = 0, DS = 0; r.units.forEach((x, i) => { IB += x.IB * S[U[i]][m]; DS += x.DS * S[U[i]][m]; });
    const NET = IB - DS, OI = T.OI * S.COS[m];
    const CO = (T.N + T.C) * S.NOM[m] + (T.V + T.VI + T.FX + T.F + T.DA) * S.COS[m];
    mon.push({ IB, DS, NET, OI, CO, RN: NET + OI - CO });
  }
  let acc = 0; mon.forEach(x => { acc += x.RN; x.ACC = acc; });
  return mon;
}

/**
 * Estado de resultados mensual con la estructura del informe CEIPA (bloques).
 * @param {object} datos  base2026.json
 * @param {object} g      resultado de pyg() del escenario
 */
export function mensualPyG(datos, g) {
  const S = datos.seas, U = datos.units, mm = []; let acc = 0;
  for (let m = 0; m < 12; m++) {
    const o = { IB: 0, DS: 0 };
    g.units.forEach((x, i) => { o.IB += x.IB * S[U[i]][m]; o.DS += x.DS * S[U[i]][m]; });
    BLOCKS.forEach(b => { const n = g.tot['n_' + b] || 0; o[b] = n * S.NOM[m] + (g.tot[b] - n) * S.COS[m]; });
    o.NET = o.IB - o.DS; o.CD = o.PRESTACION + o.ADM_ACADEMICA + o.UNIDADES + o.VENTAS; o.MB = o.NET - o.CD;
    o.GO = o.TECNOLOGIA + o.CORPORATIVO + o.ADMINISTRATIVOS + o.DIRECCION; o.RO = o.MB - o.GO;
    o.RN = o.RO + o.OTROS_INGRESOS - o.BANCARIOS - o.DA - o.OTROS_GASTOS; o.EBITDA = o.RN + o.DA; acc += o.RN; o.ACC = acc;
    mm.push(o);
  }
  return mm;
}

/**
 * Flujo de caja mensual 2027 por método directo (supuestos en FIXED.cash).
 * @param {object} datos base2026.json (usa seas)
 * @param {object} p     parámetros del escenario
 * @param {object} r     resultado de compute()
 * @param {object} g     resultado de pyg() (para gastos bancarios)
 * @param {object[]} mon resultado de mensual()
 * @param {object} b26   resultado de base2026()
 */
export function flujoCaja(datos, p, r, g, mon, b26) {
  const S = datos.seas, K = FIXED.cash, T = r.tot, gr = T.NET / b26.NET - 1, BANC = g.tot.BANCARIOS, OTH = T.TC - T.N - T.C - BANC;
  const NOMm = S.NOM.map(w => (T.N + T.C) * w), OTHm = S.COS.map(w => OTH * w), NOMY = T.N + T.C;
  const NETm = mon.map(x => x.NET), rd = 1 - K.ra - K.rb - K.rc;
  const at = i => (i < 0 ? NETm[12 + i] / (1 + gr) : i > 11 ? NETm[i - 12] * (1 + gr) : NETm[i]);
  const cf = []; let saldo = K.si;
  for (let m = 0; m < 12; m++) {
    const REC = K.ra * at(m + 1) + K.rb * at(m) + K.rc * at(m - 1) + rd * at(m - 2), OIN = mon[m].OI;
    const NOM = NOMm[m] * (1 - K.pp - K.pc - K.pi), PRI = (m === 5 || m === 11) ? K.pp * NOMY / 2 : 0, CES = m === 1 ? K.pc * NOMY / (1 + p.ipc) : 0, INT = m === 0 ? K.pi * NOMY / (1 + p.ipc) : 0;
    const PROV = K.pq * OTHm[m] + (1 - K.pq) * (m ? OTHm[m - 1] : OTHm[11] / (1 + p.ipc)), BAN = BANC * S.COS[m], CAP = FIXED.capex * T.NET / 12;
    const TE = REC + OIN, TS = NOM + PRI + CES + INT + PROV + BAN + CAP, FN = TE - TS, SI = saldo; saldo += FN;
    cf.push({ NETC: NETm[m], REC, OIN, TE, NOM, PRI, CES, INT, PROV, BAN, CAP, TS, FN, SI, SF: saldo });
  }
  const saldoMinimo = Math.min(...cf.map(x => x.SF));
  return { meses: cf, saldoFinal: saldo, saldoMinimo, mesMinimo: cf.findIndex(x => x.SF === saldoMinimo), mesesBajoMinimo: cf.filter(x => x.SF < K.sm).length };
}
