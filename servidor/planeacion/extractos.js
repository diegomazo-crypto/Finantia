/**
 * Lectura de extractos bancarios (Excel o CSV) de cualquier banco: busca la fila de encabezado con
 * la fecha y el valor (una columna con signo, o débitos y créditos por separado) y, si la trae, el saldo.
 * Devuelve solo totales del mes; los movimientos y sus descripciones no se guardan.
 */
import { falla, DATOS_INVALIDOS } from '../errores.js';
import { columnas, numero, MESES_LARGOS } from '../ejecucion/lectura.js';

const COL_EXT = {
  fecha: ['fecha', 'fecha_transaccion', 'fecha_movimiento', 'fecha_operacion', 'fecha_de_transaccion', 'fecha_valor', 'dia'],
  valor: ['valor', 'monto', 'importe', 'valor_transaccion', 'valor_movimiento', 'valor_total'],
  ent: ['credito', 'creditos', 'abono', 'abonos', 'consignacion', 'consignaciones', 'entradas', 'ingresos', 'deposito', 'depositos', 'valor_credito'],
  sal: ['debito', 'debitos', 'cargo', 'cargos', 'retiro', 'retiros', 'salidas', 'egresos', 'valor_debito', 'cheques'],
  saldo: ['saldo', 'saldo_final', 'nuevo_saldo', 'saldo_disponible', 'saldo_total', 'saldo_contable']
};

/** Fecha de una celda: número de serie de Excel, d/m/a, a/m/d o a-m-d. Devuelve {anio, mes, dia} o null. */
export function fechaDe(v, anioPorDefecto = null) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5);
    return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
  }
  const s = String(v ?? '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return { anio: +m[1], mes: +m[2], dia: +m[3] };
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(s);
  if (m) return { anio: m[3].length === 2 ? 2000 + +m[3] : +m[3], mes: +m[2], dia: +m[1] };
  m = /^(\d{1,2})[-/.](\d{1,2})$/.exec(s); /* "31/10" sin año (Bancolombia) */
  if (m && anioPorDefecto) return { anio: anioPorDefecto, mes: +m[2], dia: +m[1] };
  return null;
}

/**
 * @param {Array<Array<string|number>>} celdas
 * @param {{anio:number, mes:number}} periodo  mes que se está subiendo (para validar y completar fechas sin año)
 * @returns {{movimientos, entradas, salidas, saldoInicial: number|null, saldoFinal: number|null}}
 */
export function leerExtracto(celdas, { anio, mes }) {
  const h = celdas.slice(0, 40).findIndex(f => { const c = columnas(f, COL_EXT); return c.fecha != null && (c.valor != null || c.ent != null || c.sal != null); });
  if (h < 0) {
    const vistas = (celdas.find(f => f.some(x => String(x).trim())) || []).map(x => String(x).trim()).filter(Boolean).slice(0, 12).join(', ');
    falla(DATOS_INVALIDOS, `No se reconoce el extracto. Columnas encontradas: ${vistas || '(ninguna)'}. Se espera Fecha con Valor, o Débitos y Créditos, y de preferencia Saldo. Si el banco solo da PDF, registre los saldos a mano.`);
  }
  const col = columnas(celdas[h], COL_EXT), cel = (f, k) => (col[k] == null ? '' : f[col[k]] ?? '');
  const filas = [];
  for (let i = h + 1; i < celdas.length; i++) {
    const f = celdas[i], fecha = fechaDe(cel(f, 'fecha'), anio);
    if (!fecha) continue; /* totales, títulos, filas vacías */
    const n = k => { if (col[k] == null) return 0; const x = numero(cel(f, k)); if (!Number.isFinite(x)) falla(DATOS_INVALIDOS, `Fila ${i + 1}: valor inválido ("${cel(f, k)}")`); return x; };
    const v = col.valor != null ? n('valor') : Math.abs(n('ent')) - Math.abs(n('sal'));
    const saldo = col.saldo != null && String(cel(f, 'saldo')).trim() !== '' ? n('saldo') : null;
    filas.push({ fecha, v, saldo });
  }
  if (!filas.length) falla(DATOS_INVALIDOS, 'El extracto no trae movimientos con fecha');
  const delMes = filas.filter(x => x.fecha.anio === anio && x.fecha.mes === mes).length;
  if (delMes < filas.length / 2) {
    const c = {}; filas.forEach(x => { const k = `${x.fecha.mes}/${x.fecha.anio}`; c[k] = (c[k] || 0) + 1; });
    const [k] = Object.entries(c).sort((a, b) => b[1] - a[1])[0], [mm, aa] = k.split('/').map(Number);
    falla(DATOS_INVALIDOS, `El extracto es de ${MESES_LARGOS[mm - 1]} de ${aa}, pero se está subiendo como ${MESES_LARGOS[mes - 1]} de ${anio}. Elija el mes correcto.`);
  }
  const clave = x => x.fecha.anio * 1e4 + x.fecha.mes * 100 + x.fecha.dia;
  const desc = clave(filas[0]) > clave(filas[filas.length - 1]); /* muchos bancos listan del más reciente al más antiguo */
  const orden = desc ? [...filas].reverse() : filas;
  const entradas = filas.reduce((s, x) => s + (x.v > 0 ? x.v : 0), 0), salidas = filas.reduce((s, x) => s + (x.v < 0 ? -x.v : 0), 0);
  const conSaldo = orden.filter(x => x.saldo != null);
  let saldoInicial = null, saldoFinal = null;
  if (conSaldo.length) {
    const primero = conSaldo[0], ultimo = conSaldo[conSaldo.length - 1];
    saldoFinal = ultimo.saldo;
    saldoInicial = primero.saldo - primero.v;
    /* si el saldo no cuadra con los movimientos, el archivo no trae saldo por fila (p. ej. solo al cierre) */
    if (Math.abs(saldoInicial + entradas - salidas - saldoFinal) > Math.max(1, Math.abs(saldoFinal) * 1e-6)) saldoInicial = saldoFinal - entradas + salidas;
  }
  return { movimientos: filas.length, entradas, salidas, saldoInicial, saldoFinal };
}
