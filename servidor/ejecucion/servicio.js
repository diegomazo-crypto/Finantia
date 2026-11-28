/**
 * Ejecución presupuestal · seguimiento mensual del presupuesto.
 *
 * Base de comparación de cada año:
 *  - la versión aprobada del ejercicio en Finantia (sus líneas presupuestales por línea, unidad y mes);
 *  - o, si el año no se presupuestó en Finantia (2026, para probar), el informe comparativo del
 *    equipo que se sube aquí (presupuesto a la fecha y anual por línea y unidad, mensualizado con la
 *    estacionalidad de los datos base).
 * Cada mes se sube el balance de prueba; se clasifica en líneas y unidades con el reparto del
 * auxiliar contable (motor/ejecucion.js) cada vez que se consulta, así una mejora del reparto
 * se aplica también a los meses ya cargados.
 *
 * Permisos (módulo EJECUCION): ver el tablero con 'ver'; subir y borrar con 'editar'. El detalle por
 * centro de costos y cuenta, y lo que quedó sin clasificar, solo con el detalle sensible
 * (un centro de costos con una sola cuenta de sueldos deja ver un salario).
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { exigir, veDetalleSensible } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, DATOS_INVALIDOS, NO_ENCONTRADO, NO_AUTORIZADO } from '../errores.js';
import { leerXlsx, esZip } from '../presupuesto/xlsx.js';
import { leerCsv } from '../presupuesto/nomina.js';
import { leerBalance, leerComparativo, esHojaComparativo, MESES_LARGOS } from './lectura.js';
import { mapaDesdeBase, clasificarBalance, participacion, mensualizar, completarConSaldoAnterior } from '../../motor/ejecucion.js';

const M = 'EJECUCION';
export const TAMANO_MAXIMO = 25 * 1024 * 1024; /* el informe mensual completo pesa unos 7 MB */
const inflar = (d, max) => inflateRawSync(d, { maxOutputLength: max });
const json = x => (typeof x === 'string' ? JSON.parse(x) : x);

export async function celdasDe(nombre, bytes, op = {}) {
  if (/\.xlsx$/i.test(nombre) || esZip(bytes)) return leerXlsx(bytes, inflar, op);
  if (!/\.(csv|txt)$/i.test(nombre)) falla(DATOS_INVALIDOS, 'Suba el archivo como Excel (.xlsx) o CSV');
  let t = new TextDecoder().decode(bytes);
  if (t.includes('\uFFFD')) t = new TextDecoder('windows-1252').decode(bytes); /* CSV exportado en ANSI (Contai, Excel "CSV delimitado por comas") */
  return leerCsv(t);
}
const anioValido = a => { if (!Number.isInteger(a) || a < 2000 || a > 2100) falla(DATOS_INVALIDOS, 'Año inválido'); return a; };
const nombreArchivo = n => String(n || '').normalize('NFC').replace(/[\\/\x00-\x1f"<>|:*?]/g, '_').trim().slice(0, 180) || 'archivo';

/** Datos base de referencia: los de la versión aprobada del año o, si no hay, los últimos cargados. */
async function datosBase(db, id = null) {
  const r = (await db.query(id ? 'SELECT id, contenido FROM datos_base WHERE id = $1' : 'SELECT id, contenido FROM datos_base ORDER BY id DESC LIMIT 1', id ? [id] : [])).rows[0];
  if (!r) falla(NO_ENCONTRADO, 'Todavía no hay datos base cargados');
  return { id: Number(r.id), datos: json(r.contenido) };
}

/** Base de comparación del año: { origen, P (12 × línea × unidad), descripcion, datos } o null. */
export async function baseDelAnio(db, anio) {
  const v = (await db.query(`SELECT id, numero, nombre, datos_base_id, escenario_oficial, aprobada_en FROM version WHERE ejercicio = $1 AND estado = 'APROBADA'`, [anio])).rows[0];
  if (v) {
    const { datos } = await datosBase(db, Number(v.datos_base_id));
    const P = Array.from({ length: 12 }, () => datos.L.map(() => Array(7).fill(0)));
    const U = datos.units;
    for (const r of (await db.query('SELECT linea, unidad, mes, valor FROM linea_presupuestal WHERE version_id = $1', [v.id])).rows)
      P[r.mes - 1][r.linea][U.indexOf(r.unidad)] += Number(r.valor);
    return { origen: 'version', descripcion: `Versión aprobada V${v.numero} · ${v.nombre} (escenario ${v.escenario_oficial || 'Moderado'})`, P, datos, anual: null };
  }
  const b = (await db.query(`SELECT b.nombre, b.contenido, b.cargado_en, u.nombre AS por FROM ejecucion_base b JOIN usuario u ON u.id = b.cargado_por WHERE b.anio = $1`, [anio])).rows[0];
  if (!b) return null;
  const c = json(b.contenido), { datos } = await datosBase(db, c.datosBaseId ?? null).catch(() => datosBase(db));
  return {
    origen: 'informe', descripcion: `Informe comparativo "${b.nombre}" (presupuesto a ${['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][c.hasta - 1]} y a diciembre), cargado por ${b.por}`,
    P: mensualizar(datos, c.anual, { aLaFecha: c.aLaFecha, hasta: c.hasta }), datos, anual: c.anual, cargadoEn: b.cargado_en
  };
}

const mapas = new Map();
let base0;
/** Base 2026 de la instalación (datos/base2026.json), que trae el reparto del auxiliar. */
const baseInstalada = () => { if (base0 === undefined) { try { base0 = JSON.parse(readFileSync(new URL('../../datos/base2026.json', import.meta.url))); } catch { base0 = null; } } return base0; };
/**
 * Reparto cuenta y centro de costos → línea y unidad: el de los datos base o, si se cargaron sin el
 * auxiliar (sitio de pruebas), el de la base 2026 de la instalación cuando las líneas coinciden.
 */
const mapaDe = datos => {
  if (!mapas.has(datos)) {
    if (mapas.size > 4) mapas.clear();
    const f = baseInstalada(), igual = f && f.LN?.length === datos.LN?.length && f.LN.every((n, i) => n === datos.LN[i]);
    mapas.set(datos, mapaDesdeBase(datos) || (igual ? mapaDesdeBase(f) : null));
  }
  return mapas.get(datos);
};

/** Clasifica los meses cargados del año. */
async function realDelAnio(db, anio, base, datos) {
  const filas = (await db.query(`SELECT m.mes, m.nombre, m.forma, m.con_cc, m.filas, m.cargado_en, u.nombre AS por FROM ejecucion_mes m JOIN usuario u ON u.id = m.cargado_por WHERE m.anio = $1 ORDER BY m.mes`, [anio])).rows;
  const mapa = mapaDe(datos);
  if (!mapa) falla(NO_ENCONTRADO, 'No hay reparto de cuentas y centros de costos para estos datos base (ni en los datos ni en datos/base2026.json), que se necesita para clasificar el balance');
  const anual = base ? base.P.reduce((acc, Pm) => acc.map((f, li) => f.map((x, u) => x + Pm[li][u])), datos.L.map(() => Array(7).fill(0))) : datos.L.map(l => l[3]);
  const part = participacion(anual, datos);
  const R = Array(12).fill(null), meses = [], detalle = Array(12).fill(null), sin = Array(12).fill(null);
  const saldos = [];
  for (const r of filas) {
    const crudo = json(r.filas), f = crudo.map(([cuenta, cc, movimiento, nombre, nombreCC]) => ({ cuenta, cc, movimiento, nombre, nombreCC }));
    const x = clasificarBalance(f, datos, mapa, part);
    R[r.mes - 1] = x.real; detalle[r.mes - 1] = x.detalle; sin[r.mes - 1] = x.sinClasificar;
    if (r.mes > 1 && crudo.some(c => c[5] != null))
      saldos.push({ mes: r.mes, previo: clasificarBalance(crudo.map(([cuenta, cc, , nombre, nombreCC, ant]) => ({ cuenta, cc, movimiento: ant || 0, nombre, nombreCC })), datos, mapa, part).real });
    meses.push({ mes: r.mes, nombre: r.nombre, forma: r.forma, conCC: r.con_cc !== false, cargadoEn: r.cargado_en, cargadoPor: r.por, filas: f.length,
      total: x.total, sinClasificar: x.totalSinClasificar, nSinClasificar: x.sinClasificar.length, aparte: x.aparte });
  }
  /* Meses sin balance antes de uno que trae saldo anterior: se estiman con ese saldo (acumulado desde enero) */
  const estimados = completarConSaldoAnterior(R, saldos, base?.P);
  return { R, meses, detalle, sin, mapa, estimados };
}

/** Años con algo para mostrar: ejercicios con versión aprobada, bases cargadas y meses cargados. */
export async function anios(db, actor) {
  exigir(actor, M, 'ver');
  const r = await db.query(`SELECT ejercicio AS a FROM version WHERE estado = 'APROBADA' UNION SELECT anio FROM ejecucion_base UNION SELECT anio FROM ejecucion_mes UNION SELECT anio FROM ejercicio ORDER BY 1 DESC`);
  return r.rows.map(x => Number(x.a));
}

/** Todo lo que necesita el tablero: base mensual, real mensual y meses cargados (sin detalle sensible). */
export async function tablero(db, actor, anio) {
  exigir(actor, M, 'ver'); anioValido(anio);
  const base = await baseDelAnio(db, anio);
  const datos = base?.datos || (await datosBase(db)).datos;
  const { R, meses, estimados } = await realDelAnio(db, anio, base, datos);
  const sensible = veDetalleSensible(actor, M);
  return {
    anio, base: base ? { origen: base.origen, descripcion: base.descripcion } : null, estimados,
    lineas: { L: datos.L.map(([b, c]) => [b, c]), LN: datos.LN, units: datos.units, names: datos.names },
    P: base?.P || null, R, meses: sensible ? meses : meses.map(({ nSinClasificar, ...x }) => x), sensible
  };
}

/** Detalle de una línea por centro de costos y cuenta, acumulado a `hasta` (solo con el detalle sensible). */
export async function detalleLinea(db, actor, anio, { linea, hasta = 12, unidad = null }) {
  exigir(actor, M, 'ver');
  if (!veDetalleSensible(actor, M)) falla(NO_AUTORIZADO, 'El detalle por centro de costos y cuenta requiere el detalle sensible del módulo Ejecución');
  const base = await baseDelAnio(db, anio), datos = base?.datos || (await datosBase(db)).datos;
  if (!Number.isInteger(linea) || linea < 0 || linea >= datos.L.length) falla(DATOS_INVALIDOS, 'Línea inválida');
  const { detalle, mapa } = await realDelAnio(db, anio, base, datos);
  const acc = new Map();
  for (let m = 0; m < Math.min(12, hasta); m++) for (const d of detalle[m] || []) {
    if (d.li !== linea || (unidad != null && d.u !== unidad)) continue;
    const k = `${d.cc}|${d.cuenta}`, a = acc.get(k) || { cc: d.cc, cuenta: d.cuenta, valor: 0, meses: Array(12).fill(0) };
    a.valor += d.valor; a.meses[m] += d.valor; acc.set(k, a);
  }
  return [...acc.values()].filter(a => Math.abs(a.valor) >= 1).map(a => ({ ...a, nombreCC: mapa.nombresCC.get(a.cc) || '', nombreCuenta: mapa.nombresCuenta.get(a.cuenta) || '' }))
    .sort((x, y) => Math.abs(y.valor) - Math.abs(x.valor));
}

/** Lo que quedó sin clasificar, acumulado a `hasta` (solo con el detalle sensible). */
export async function sinClasificar(db, actor, anio, { hasta = 12 } = {}) {
  exigir(actor, M, 'ver');
  if (!veDetalleSensible(actor, M)) falla(NO_AUTORIZADO, 'Requiere el detalle sensible del módulo Ejecución');
  const base = await baseDelAnio(db, anio), datos = base?.datos || (await datosBase(db)).datos;
  const { sin } = await realDelAnio(db, anio, base, datos);
  const acc = new Map();
  for (let m = 0; m < Math.min(12, hasta); m++) for (const s of sin[m] || []) {
    const k = `${s.cc}|${s.cuenta}`, a = acc.get(k) || { ...s, valor: 0 };
    a.valor += s.valor; acc.set(k, a);
  }
  return [...acc.values()].sort((x, y) => Math.abs(y.valor) - Math.abs(x.valor));
}

/** Sube el balance de prueba de un mes (reemplaza el anterior del mismo mes). */
export async function subirMes(db, actor, anio, mes, { nombre, contenido }) {
  exigir(actor, M, 'editar'); anioValido(anio);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) falla(DATOS_INVALIDOS, 'Mes inválido');
  if (!contenido?.length) falla(DATOS_INVALIDOS, 'El archivo está vacío');
  const n = nombreArchivo(nombre);
  const { filas, forma, conCC, fecha } = leerBalance(await celdasDe(n, contenido, { hojas: ['Balance de prueba', 'Balance', 'BP', 'Datos'], grande: true }));
  if (fecha && (fecha.mes !== mes || fecha.anio !== anio))
    falla(DATOS_INVALIDOS, `El archivo dice que es el balance de ${MESES_LARGOS[fecha.mes - 1]} de ${fecha.anio}, pero se está subiendo como ${MESES_LARGOS[mes - 1]} de ${anio}. Elija el mes correcto.`);
  const deResultados = filas.filter(f => /^[4-7]/.test(f.cuenta) && (f.movimiento || f.anterior));
  if (!deResultados.length) falla(DATOS_INVALIDOS, 'El balance no trae movimiento en cuentas de resultados (clases 4 a 7)');
  const huella = createHash('sha256').update(contenido).digest('hex');
  return db.tx(async t => {
    const antes = (await t.query('SELECT nombre, huella FROM ejecucion_mes WHERE anio = $1 AND mes = $2', [anio, mes])).rows[0] || null;
    const r2 = x => (x == null ? null : Math.round(x * 100) / 100);
    await t.query(`INSERT INTO ejecucion_mes (anio, mes, nombre, huella, forma, con_cc, filas, cargado_por) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (anio, mes) DO UPDATE SET nombre = EXCLUDED.nombre, huella = EXCLUDED.huella, forma = EXCLUDED.forma, con_cc = EXCLUDED.con_cc, filas = EXCLUDED.filas, cargado_por = EXCLUDED.cargado_por, cargado_en = now()`,
      [anio, mes, n, huella, forma, conCC, JSON.stringify(deResultados.map(f => [f.cuenta, f.cc, r2(f.movimiento), f.nombre || '', f.nombreCC || '', r2(f.anterior)])), actor.id]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'SUBIR_BALANCE', entidad: 'ejecucion_mes', entidadId: `${anio}-${mes}`, antes, despues: { anio, mes, nombre: n, huella, forma, conCC, filas: deResultados.length } });
    return { anio, mes, filas: deResultados.length, forma, conCC };
  });
}

export async function borrarMes(db, actor, anio, mes) {
  exigir(actor, M, 'editar');
  return db.tx(async t => {
    const r = (await t.query('DELETE FROM ejecucion_mes WHERE anio = $1 AND mes = $2 RETURNING nombre, huella', [anio, mes])).rows[0];
    if (!r) falla(NO_ENCONTRADO, `No hay balance cargado para ${mes}/${anio}`);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'BORRAR_BALANCE', entidad: 'ejecucion_mes', entidadId: `${anio}-${mes}`, antes: { anio, mes, ...r } });
  });
}

/** Sube el informe comparativo como base de comparación de un año sin versión aprobada en Finantia. */
export async function subirBase(db, actor, anio, { nombre, contenido }) {
  exigir(actor, M, 'editar'); anioValido(anio);
  if ((await db.query(`SELECT 1 FROM version WHERE ejercicio = $1 AND estado = 'APROBADA'`, [anio])).rows.length)
    falla(DATOS_INVALIDOS, `El ${anio} ya tiene una versión aprobada en Finantia: esa es la base de comparación`);
  if (!contenido?.length) falla(DATOS_INVALIDOS, 'El archivo está vacío');
  const n = nombreArchivo(nombre);
  const { id: datosBaseId, datos } = await datosBase(db);
  const c = leerComparativo(await celdasDe(n, contenido, { elegir: esHojaComparativo }), datos);
  const huella = createHash('sha256').update(contenido).digest('hex');
  return db.tx(async t => {
    await t.query(`INSERT INTO ejecucion_base (anio, nombre, huella, contenido, cargado_por) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (anio) DO UPDATE SET nombre = EXCLUDED.nombre, huella = EXCLUDED.huella, contenido = EXCLUDED.contenido, cargado_por = EXCLUDED.cargado_por, cargado_en = now()`,
      [anio, n, huella, JSON.stringify({ anual: c.anual, aLaFecha: c.aLaFecha, real: c.real, hasta: c.hasta, datosBaseId }), actor.id]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'SUBIR_BASE_EJECUCION', entidad: 'ejecucion_base', entidadId: anio, despues: { anio, nombre: n, huella, hasta: c.hasta, lineas: c.lineas } });
    return { anio, hasta: c.hasta, lineas: c.lineas, faltan: c.faltan };
  });
}

export async function borrarBase(db, actor, anio) {
  exigir(actor, M, 'editar');
  const r = (await db.query('DELETE FROM ejecucion_base WHERE anio = $1 RETURNING nombre, huella', [anio])).rows[0];
  if (!r) falla(NO_ENCONTRADO, `No hay informe base cargado para ${anio}`);
  await registrar(db, { usuarioId: actor.id, modulo: M, accion: 'BORRAR_BASE_EJECUCION', entidad: 'ejecucion_base', entidadId: anio, antes: r });
}
