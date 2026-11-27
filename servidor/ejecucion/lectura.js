/**
 * Lectura de los archivos del módulo de Ejecución presupuestal (sin dependencias: sirve igual en
 * el servidor y en la demostración del navegador).
 *
 *  - Balance de prueba del mes (Excel o CSV): una fila por cuenta (y centro de costos, si lo trae)
 *    con el movimiento del mes (débitos − créditos), o débitos y créditos, o saldo anterior y final.
 *    Las cuentas de mayor (4, 41, 4105…) se descartan cuando el archivo trae sus subcuentas, para no
 *    sumar dos veces.
 *  - Informe financiero comparativo (el Excel mensual del equipo, hoja "Informe Finan comparativo"):
 *    presupuesto a la fecha, presupuesto anual y real por línea del informe y unidad. Sirve de base
 *    de comparación para un año que no se presupuestó en Finantia (2026, para probar el módulo).
 */
import { falla, DATOS_INVALIDOS } from '../errores.js';
import { signoBalance } from '../../motor/ejecucion.js';

const normal = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const texto = v => (v == null ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v)).trim();
export const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function numero(v) {
  if (typeof v === 'number') return v;
  if (v && v.sinValor) falla(DATOS_INVALIDOS, `La celda ${v.ref} tiene una fórmula sin valor calculado. Abra el archivo en Excel, guárdelo y vuelva a subirlo.`);
  let x = String(v ?? '').replace(/[$\s ]/g, '');
  if (!x || x === '-' || x === '.') return 0;
  const neg = /^\(.*\)$/.test(x); if (neg) x = x.slice(1, -1);
  if (x.includes('.') && x.includes(',')) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (x.includes(',')) x = /^-?\d{1,3}(,\d{3})+$/.test(x) ? x.replace(/,/g, '') : x.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, '');
  const n = Number(x);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/* ------------------------------------------------------------------ balance de prueba */
const COL_BAL = {
  cuenta: ['cuenta', 'codigo_cuenta', 'cuenta_contable', 'codigo', 'cod_cuenta', 'no_cuenta', 'numero_cuenta'],
  nombre: ['nombre_cuenta', 'nombre', 'descripcion', 'descripcion_cuenta', 'detalle'],
  cc: ['centro_de_costos', 'centro_costos', 'centro_de_costo', 'cc', 'ceco', 'cod_centro_de_costos', 'codigo_centro_de_costos', 'centro'],
  nombreCC: ['nombre_centro_de_costos', 'nombre_centro_costos', 'nombre_cc', 'nombre_ceco'],
  mov: ['movimiento', 'movimiento_del_mes', 'movimiento_mes', 'neto', 'valor'],
  deb: ['debitos', 'debito', 'debe', 'movimiento_debito', 'debitos_del_mes'],
  cre: ['creditos', 'credito', 'haber', 'movimiento_credito', 'creditos_del_mes'],
  sAnt: ['saldo_anterior', 'saldo_inicial'], sFin: ['saldo_final', 'saldo_actual', 'nuevo_saldo', 'saldo'],
  nit: ['nit', 'tercero', 'nit_tercero', 'identificacion']
};
const columnas = (fila, def) => { const enc = fila.map(normal), col = {}; for (const [k, a] of Object.entries(def)) { const i = enc.findIndex(x => a.includes(x)); if (i >= 0) col[k] = i; } return col; };

/**
 * @param {Array<Array<string|number>>} celdas  filas del archivo
 * @returns {{ filas: {cuenta, cc, nombre, nombreCC, movimiento}[], forma: string }}
 */
export function leerBalance(celdas) {
  const h = celdas.slice(0, 40).findIndex(f => { const c = columnas(f, COL_BAL); return c.cuenta != null && (c.mov != null || (c.deb != null && c.cre != null) || (c.sAnt != null && c.sFin != null)); });
  if (h < 0) {
    const vistas = (celdas.find(f => f.some(x => String(x).trim())) || []).map(x => String(x).trim()).filter(Boolean).slice(0, 20).join(', ');
    falla(DATOS_INVALIDOS, `No se reconoce el balance de prueba. Columnas encontradas: ${vistas || '(ninguna)'}. Se espera Cuenta (y Centro de costos si lo trae) con Movimiento, o Débitos y Créditos, o Saldo anterior y Saldo final.`);
  }
  const col = columnas(celdas[h], COL_BAL);
  const forma = col.mov != null ? 'movimiento' : col.deb != null && col.cre != null ? 'débitos − créditos' : 'saldo final − saldo anterior';
  const val = (f, k) => (col[k] == null ? '' : f[col[k]] ?? '');
  const crudas = [];
  for (let i = h + 1; i < celdas.length; i++) {
    const f = celdas[i], r = i + 1;
    let cuenta = texto(val(f, 'cuenta')).replace(/\.0+$/, '').replace(/[\s.]/g, '');
    if (!/^\d{1,12}$/.test(cuenta)) continue; /* totales, títulos */
    let cc = texto(val(f, 'cc')).replace(/\.0+$/, '');
    const m = /^(\d{2,})\b/.exec(cc); if (m) cc = m[1];
    const n = k => { const x = numero(val(f, k)); if (!Number.isFinite(x)) falla(DATOS_INVALIDOS, `Fila ${r}: valor inválido ("${val(f, k)}")`); return x; };
    const movimiento = col.mov != null ? n('mov') : col.deb != null ? n('deb') - n('cre') : n('sFin') - n('sAnt');
    const anterior = col.sAnt != null ? n('sAnt') : null;
    crudas.push({ cuenta, cc, nit: texto(val(f, 'nit')), anterior, nombre: texto(val(f, 'nombre')).slice(0, 120), nombreCC: texto(val(f, 'nombreCC')).slice(0, 120), movimiento });
  }
  /* Balance por tercero (NIT), como el de Contai: cada cuenta trae su fila de total sin NIT y luego una
     fila por tercero. Se usa el total; si una cuenta no lo trae, se suman sus terceros. Nunca se guarda el NIT. */
  const conTotal = new Set(crudas.filter(x => !x.nit).map(x => `${x.cc}|${x.cuenta}`));
  const unidas = new Map();
  for (const x of crudas) {
    const k = `${x.cc}|${x.cuenta}`;
    if (x.nit && conTotal.has(k)) continue;
    const u = unidas.get(k);
    if (u) { u.movimiento += x.movimiento; if (u.anterior != null) u.anterior += x.anterior; if (!u.nombre) u.nombre = x.nombre; }
    else unidas.set(k, { cuenta: x.cuenta, cc: x.cc, nombre: x.nombre, nombreCC: x.nombreCC, movimiento: x.movimiento, anterior: x.anterior });
  }
  const sinTerceros = [...unidas.values()];
  /* Sin las cuentas de mayor cuando el archivo trae sus subcuentas (por centro de costos) */
  const porCC = new Map();
  for (const x of sinTerceros) { let s = porCC.get(x.cc); if (!s) porCC.set(x.cc, (s = [])); s.push(x.cuenta); }
  const filas = sinTerceros.filter(x => !porCC.get(x.cc).some(c => c.length > x.cuenta.length && c.startsWith(x.cuenta)));
  if (!filas.length) falla(DATOS_INVALIDOS, 'El balance de prueba no trae cuentas');
  if (filas.length > 200000) falla(DATOS_INVALIDOS, 'El balance supera 200.000 filas');
  return { filas, forma, porTercero: col.nit != null, conCC: col.cc != null, fecha: fechaDelTitulo(celdas.slice(0, h)) };
}

/** Mes y año del corte en el título del archivo ("Balance de Prueba ... Sep-30-2026", "a 30 de septiembre de 2026", "2026-09-30"). */
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'], MESES_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function fechaDelTitulo(filas) {
  for (const f of filas) for (const c of f) {
    const t = normal(c).replace(/_/g, ' ');
    let m = /\b([a-z]{3})[a-z]*\s+(\d{1,2})\s+(20\d\d)\b/.exec(t) || /\b(\d{1,2})\s+(?:de\s+)?([a-z]{3})[a-z]*\s+(?:de\s+)?(20\d\d)\b/.exec(t);
    if (m) {
      const nom = /^\d/.test(m[1]) ? m[2] : m[1], anio = Number(m[3]);
      const mes = Math.max(MESES_CORTOS.indexOf(nom), MESES_EN.indexOf(nom)) + 1;
      if (mes) return { mes, anio };
    }
    m = /\b(20\d\d)\s+(\d{2})\s+(\d{2})\b/.exec(t);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { mes: Number(m[2]), anio: Number(m[1]) };
  }
  return null;
}

/* ------------------------------------------------------------------ informe comparativo */
const UNI_INFORME = [['pregrado'], ['posgrado', 'especializaciones'], ['maestrias'], ['plus'], ['extension'], ['isolution', 'ure'], ['barranquilla']];

/** Empareja las filas del informe (concepto + tipo) con las líneas de los datos base, en orden. */
export function emparejarLineas(filas, h, LN) {
  const cand = [];
  for (let i = h + 1; i < filas.length; i++) { const c = texto(filas[i][1]); if (c) cand.push({ i, c: normal(c), t: normal(filas[i][3]) }); }
  const out = Array(LN.length).fill(-1);
  let j = 0;
  LN.forEach((nombre, li) => {
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(nombre), base = normal(m ? m[1] : nombre), tipo = m ? normal(m[2]) : '';
    let k = -1;
    for (let q = j; q < Math.min(j + 8, cand.length) && k < 0; q++) if (cand[q].c === base && (!tipo || cand[q].t === tipo || cand[q].t.includes(tipo) || (tipo === 'nomina' && cand[q].t === 'nomina'))) k = q;
    for (let q = j; q < Math.min(j + 8, cand.length) && k < 0; q++) if (cand[q].c === base) k = q;
    if (k >= 0) { out[li] = cand[k].i; j = k + 1; }
  });
  return out;
}

/**
 * Hoja "Informe Finan comparativo": por unidad, real, presupuesto a la fecha y presupuesto anual (diciembre).
 * @returns {{ anual: number[][], aLaFecha: number[][], real: number[][], hasta: number, lineas: number, faltan: string[] }}
 */
export function leerComparativo(celdas, datos) {
  const h = celdas.slice(0, 20).findIndex(f => f.some(x => normal(x) === 'concepto') && f.some(x => /presupuest/.test(normal(x))));
  if (h < 0) falla(DATOS_INVALIDOS, 'No se encontró la hoja del informe comparativo (columnas CONCEPTO y PRESUPUESTO por unidad). Suba el Excel del informe mensual con la hoja "Informe Finan comparativo".');
  const enc = celdas[h].map(normal);
  const cols = UNI_INFORME.map(alias => {
    const r = enc.findIndex(x => alias.includes(x));
    if (r < 0) return null;
    const p = enc.findIndex((x, i) => i > r && alias.some(a => x.startsWith(a + '_presupuest')) && !/diciembre/.test(x));
    const a = enc.findIndex((x, i) => i > r && alias.some(a => x.startsWith(a + '_presupuest')) && /diciembre/.test(x));
    return { r, p, a };
  });
  const falt = UNI_INFORME.filter((_, u) => !cols[u] || cols[u].p < 0 || cols[u].a < 0).map(a => a[0]);
  if (falt.length) falla(DATOS_INVALIDOS, `Al informe comparativo le faltan columnas de: ${falt.join(', ')} (real, presupuesto y presupuesto diciembre).`);
  const tot = celdas[h].map(texto).find(x => /^total ceipa/i.test(x) && !/presupuest/i.test(x)) || '';
  const hasta = MESES_LARGOS.findIndex(m => normal(tot).includes(m)) + 1;
  if (!hasta) falla(DATOS_INVALIDOS, `No se pudo leer el mes del informe en "${tot}". El encabezado debe decir, por ejemplo, "TOTAL CEIPA Octubre 2026".`);
  const filaDe = emparejarLineas(celdas, h, datos.LN);
  const nL = datos.LN.length, z = () => Array.from({ length: nL }, () => Array(7).fill(0));
  const anual = z(), aLaFecha = z(), real = z(), faltan = [];
  filaDe.forEach((fi, li) => {
    if (fi < 0) { if (datos.L[li][3].some(x => x)) faltan.push(datos.LN[li]); return; }
    const f = celdas[fi], s = signoBalance(datos.L[li][1]);
    const n = c => { const x = numero(f[c]); return Number.isFinite(x) ? x * s : 0; };
    cols.forEach(({ r, p, a }, u) => { real[li][u] = n(r); aLaFecha[li][u] = n(p); anual[li][u] = n(a); });
  });
  return { anual, aLaFecha, real, hasta, lineas: filaDe.filter(x => x >= 0).length, faltan };
}

/** ¿La hoja parece el informe comparativo? (para elegirla dentro del libro) */
export const esHojaComparativo = nombre => nombre.includes('comparativ');
