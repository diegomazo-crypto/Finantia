/**
 * Resumen de un extracto bancario en PDF: banco, cuenta, mes, moneda y los cuatro totales del mes
 * (saldo inicial, entradas, salidas, saldo final). No se leen ni se devuelven los movimientos.
 *
 * Formatos reconocidos (muestras de septiembre de 2026):
 *  - Bancolombia Colombia (cuenta corriente o de ahorros) y Bancolombia Panamá (USD o EUR).
 *  - Davivienda (corriente y ahorros).
 *  - Banco de Bogotá (extracto de cuenta corriente).
 *  - Fondos de inversión colectiva de Alianza Fiduciaria.
 * Los PDF escaneados (imagen, como el de Banco de Occidente impreso desde el correo) no tienen texto:
 * esos se registran a mano.
 */
import { falla, DATOS_INVALIDOS } from '../errores.js';

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const sinTildes = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const mesDe = s => { const i = MESES.indexOf(sinTildes(s).toUpperCase().replace('SETIEMBRE', 'SEPTIEMBRE')); return i < 0 ? null : i + 1; };

/** Número con formato 1,234.56 o 1.234,56 (con signo, $ y espacios). */
export function numeroPdf(t) {
  let s = String(t).replace(/[$\s]/g, '');
  const neg = /^-|-$|^\(.*\)$/.test(s); s = s.replace(/[-+()]/g, '');
  if (!/\d/.test(s)) return null;
  const c = s.lastIndexOf(','), p = s.lastIndexOf('.');
  if (c > p) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s); return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const NUM = '(-?\\$?\\s?-?[\\d.,]*\\d)';
function valor(lineas, etiqueta) {
  const re = new RegExp(etiqueta + '\\s*:?\\s*(?:USD|EUR|COP)?\\s*' + NUM, 'i');
  for (const l of lineas) { const m = sinTildes(l).match(re); if (m) return numeroPdf(m[1]); }
  return null;
}
const buscar = (lineas, re) => { for (const l of lineas) { const m = sinTildes(l).match(re); if (m) return m; } return null; };
const ultimos4 = s => { const d = String(s).replace(/-\d$/, '').replace(/\D/g, ''); return d.slice(-4); };

function bancolombia(L, texto) {
  const panama = /DESDE \d{2}\/\d{2}\/\d{4} HASTA/.test(texto);
  let anio, mes;
  if (panama) { const m = texto.match(/HASTA (\d{2})\/(\d{2})\/(\d{4})/); anio = +m[3]; mes = +m[2]; }
  else { const m = texto.match(/HASTA:\s*(\d{4})\/(\d{2})\/(\d{2})/); if (m) { anio = +m[1]; mes = +m[2]; } }
  const num = buscar(L, /N[UÚ]MERO\s+(\d{6,})/i);
  const moneda = (buscar(L, /SALDO ANTERIOR\s+(USD|EUR)/) || [])[1] || 'COP';
  const tipo = /CUENTA DE AHORROS/.test(texto) ? 'AHORROS' : 'CORRIENTE';
  return { banco: panama ? 'Bancolombia Panamá' : 'Bancolombia', tipo, numero: num && num[1], moneda, anio, mes,
    saldoInicial: valor(L, 'SALDO ANTERIOR'), entradas: valor(L, 'TOTAL ABONOS'), salidas: valor(L, 'TOTAL CARGOS'), saldoFinal: valor(L, 'SALDO ACTUAL') };
}

function davivienda(L, texto) {
  const m = texto.match(/INFORME DEL MES:\s*([A-Z]+)\s*\/\s*(\d{4})/);
  const num = buscar(L, /^(\d{4} \d{4} \d{4})$/);
  return { banco: 'Davivienda', tipo: /CUENTA DE AHORROS/.test(texto) ? 'AHORROS' : 'CORRIENTE', numero: num && num[1], moneda: 'COP',
    anio: m ? +m[2] : null, mes: m ? mesDe(m[1]) : null,
    saldoInicial: valor(L, 'Saldo Anterior'), entradas: valor(L, 'Mas:?\\s*Creditos'), salidas: valor(L, 'Menos:?\\s*Debitos'), saldoFinal: valor(L, 'Nuevo Saldo') };
}

function bogota(L, texto) {
  const m = texto.match(/FECHA EXTRACTO\s+([A-Za-z]+)\s*-\s*([A-Za-z]+)\s+(\d{4})/i);
  const num = buscar(L, /Cuenta\s*N\s*u\s*mero:\s*(\d+)/i);
  const sal = ['Cargos', 'IVA', '4x1000 GMF', 'Retencion', 'Intereses'].reduce((s, k) => s + Math.abs(valor(L, `Total (?:\\d+ )?${k}`) || 0), 0);
  return { banco: 'Banco de Bogotá', tipo: 'CORRIENTE', numero: num && num[1], moneda: 'COP',
    anio: m ? +m[3] : null, mes: m ? mesDe(m[2]) : null, desde: m ? mesDe(m[1]) : null,
    saldoInicial: valor(L, 'Saldo Inicial'), entradas: Math.abs(valor(L, 'Total (?:\\d+ )?Abonos') || 0), salidas: sal, saldoFinal: valor(L, 'Saldo Final') };
}

function alianza(L, texto) {
  const m = texto.match(/Hasta:\s*\d{1,2}\s+([A-Z]+)\s+(\d{4})/i);
  const enc = buscar(L, /(\d{8,}-\d)\s*$/);
  const fondo = (buscar(L, /^(Fondo [^:]+?)$/) || [])[1];
  const pri = k => { const x = buscar(L, new RegExp('^' + k + '\\s+' + NUM, 'i')); return x ? numeroPdf(x[1]) : 0; };
  const entradas = pri('Adiciones') + Math.max(0, pri('Rendimientos despues de gastos'));
  const salidas = pri('Retiros') + pri('Rentencion en la fuente') + pri('Retencion en la fuente') + pri('GMF') + pri('Costos Transaccionales') + pri('Penalidad') + Math.max(0, -pri('Rendimientos despues de gastos'));
  return { banco: 'Alianza Fiduciaria', tipo: 'FIDUCIA', numero: enc && enc[1], fondo, moneda: 'COP',
    anio: m ? +m[2] : null, mes: m ? mesDe(m[1]) : null,
    saldoInicial: pri('Saldo Inicial'), entradas, salidas, saldoFinal: pri('Saldo Final') };
}

/** Lee el resumen de las líneas de texto del PDF. */
export function leerResumenPdf(lineas) {
  const L = lineas.map(l => l.trim()).filter(Boolean), texto = sinTildes(L.join('\n'));
  if (!L.length) falla(DATOS_INVALIDOS, 'El PDF no tiene texto (parece escaneado o impreso como imagen): descargue el extracto original del portal del banco o registre los saldos a mano');
  let r;
  if (/INFORME DEL MES:/.test(texto) && /Saldo Anterior/i.test(texto)) r = davivienda(L, texto);
  else if (/SALDO ANTERIOR/.test(texto) && /TOTAL ABONOS/.test(texto)) r = bancolombia(L, texto);
  else if (/Extracto Cuenta Corriente/i.test(texto) && /Saldo Inicial:/i.test(texto)) r = bogota(L, texto);
  else if (/Numero de Encargo/i.test(texto) && /Saldo Final/i.test(texto)) r = alianza(L, texto);
  else falla(DATOS_INVALIDOS, 'No se reconoce el formato de este extracto en PDF (se leen Bancolombia, Bancolombia Panamá, Davivienda, Banco de Bogotá y los fondos de Alianza): registre los saldos a mano');
  if (!r.numero) falla(DATOS_INVALIDOS, `No se encontró el número de la cuenta en el extracto de ${r.banco}`);
  if (!r.anio || !r.mes) falla(DATOS_INVALIDOS, `No se encontró el mes del extracto de ${r.banco}`);
  if (r.desde && r.desde !== r.mes) falla(DATOS_INVALIDOS, 'El extracto cubre varios meses: descargue un extracto por mes');
  if ([r.saldoInicial, r.saldoFinal].some(v => v == null)) falla(DATOS_INVALIDOS, `No se encontraron los saldos del extracto de ${r.banco}`);
  r.entradas = Math.abs(r.entradas || 0); r.salidas = Math.abs(r.salidas || 0);
  const dif = r.saldoInicial + r.entradas - r.salidas - r.saldoFinal;
  if (Math.abs(dif) > 1) falla(DATOS_INVALIDOS, `Los totales del extracto de ${r.banco} no cuadran (saldo inicial + entradas − salidas difiere del saldo final en ${dif.toFixed(2)})`);
  const { desde, ...x } = r;
  return { ...x, terminacion: ultimos4(r.numero) };
}
