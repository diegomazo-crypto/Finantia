/**
 * Nómina por cargo de un ejercicio: costo por rubro del estado de resultados, proceso y cargo.
 *
 * Es información sensible (un cargo con una sola persona deja ver su salario), así que:
 *  - solo la suben y la ven quienes tienen en el módulo Presupuesto el permiso de detalle
 *    sensible (lo asigna el Superusuario en Administración);
 *  - se guarda cifrada con AES-256-GCM. La llave de 32 bytes vive solo en el servidor
 *    (variable FINANTIA_LLAVE_NOMINA, en base64), nunca en la base ni en el repositorio;
 *  - el archivo no puede traer nombres, documentos ni correos de las personas: va por cargo;
 *  - cada consulta queda en la bitácora; al retirar una carga se borra su contenido cifrado;
 *  - no se envía al asistente de Preguntas ni aparece en las versiones.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { exigir, veDetalleSensible } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, DATOS_INVALIDOS, NO_AUTORIZADO, NO_DISPONIBLE, NO_ENCONTRADO } from '../errores.js';
import { esZip, leerXlsx } from './xlsx.js';

const M = 'PRESUPUESTO';
export const TAMANO_MAXIMO = 2 * 1024 * 1024;
const MAX_FILAS = 3000;

/** Rubros del estado de resultados que llevan nómina, con su numeral en el EERR de CEIPA. */
export const RUBROS = {
  PRESTACION: '4.1', ADM_ACADEMICA: '4.2', UNIDADES: '4.3', VENTAS: '4.4',
  TECNOLOGIA: '6.1', CORPORATIVO: '6.2', ADMINISTRATIVOS: '6.3', DIRECCION: '6.4'
};
const POR_NUMERAL = Object.fromEntries(Object.entries(RUBROS).map(([k, n]) => [n, k]));

/* Columnas del archivo (encabezados sin tildes ni mayúsculas) */
const COLUMNAS = {
  rubro: ['rubro', 'rubro_eerr', 'area'],
  proceso: ['proceso', 'centro_de_costos', 'centro_costos'],
  cargo: ['cargo'],
  continuan: ['continuan', 'personas_que_continuan', 'cont'],
  nuevos: ['nuevos', 'cargos_nuevos'],
  vacantes: ['vacantes', 'vac'],
  salario2026: ['salario_2026', 'salario_mensual_2026'],
  salario2027: ['salario_2027', 'salario_mensual_2027'],
  costoAnual: ['costo_anual', 'costo_anual_2027', 'costo']
};
const OBLIGATORIAS = ['rubro', 'proceso', 'cargo', 'continuan', 'nuevos', 'vacantes', 'salario2027', 'costoAnual'];
const PROHIBIDAS = /^(nombres?|apellidos?|nombre_completo|cedula|documento|numero_de_documento|identificacion|id_empleado|codigo_empleado|empleado|correo|email|telefono)$/;

const normal = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Separa un CSV (coma, punto y coma o tabulador; comillas dobles). */
export function leerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].map(s => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(x => x.trim() !== ''));
}

/** Número en formato colombiano ($1.234.567,5) o con punto decimal (1234567.5). */
export function numero(s) {
  if (typeof s === 'number') return s; /* celda numérica de Excel */
  let x = String(s ?? '').replace(/[$\s ]/g, '');
  if (!x || x === '-') return 0;
  const neg = /^\(.*\)$/.test(x); if (neg) x = x.slice(1, -1);
  if (x.includes('.') && x.includes(',')) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (x.includes(',')) x = /^-?\d{1,3}(,\d{3})+$/.test(x) ? x.replace(/,/g, '') : x.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, ''); /* 1.500 o 28.762.034: miles */
  const n = Number(x);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

function rubroDe(v) {
  const s = String(v ?? '').trim();
  const num = s.match(/^(\d\.\d)\b/);
  if (num && POR_NUMERAL[num[1]]) return POR_NUMERAL[num[1]];
  const k = normal(s).toUpperCase();
  return RUBROS[k] ? k : null;
}

/**
 * Lee el archivo subido (Excel .xlsx o CSV) y devuelve sus filas de celdas.
 * `inflar` descomprime deflate sin encabezado (en el servidor, node:zlib; en la demostración, el navegador).
 */
export async function filasDelArchivo(nombre, bytes, inflar) {
  if (/\.xlsx$/i.test(nombre)) return leerXlsx(bytes, inflar);
  if (!/\.(csv|txt)$/i.test(nombre)) falla(DATOS_INVALIDOS, 'Suba la nómina como Excel (.xlsx) o CSV');
  if (esZip(bytes)) falla(DATOS_INVALIDOS, 'El archivo parece un Excel con otra extensión: guárdelo como .xlsx');
  const texto = new TextDecoder().decode(bytes);
  if (texto.includes('\uFFFD')) falla(DATOS_INVALIDOS, 'El archivo no está en UTF-8. En Excel use "CSV UTF-8 (delimitado por comas)", o suba el .xlsx.');
  return leerCsv(texto);
}

/** Convierte el archivo (texto CSV o filas ya leídas) en filas validadas. Lanza DATOS_INVALIDOS con el renglón que falla. */
export function interpretarNomina(entrada) {
  const filas = Array.isArray(entrada) ? entrada : leerCsv(entrada);
  if (filas.length < 2) falla(DATOS_INVALIDOS, 'El archivo no tiene filas de nómina');
  const enc = filas[0].map(normal);
  const prohibida = enc.find(h => PROHIBIDAS.test(h));
  if (prohibida) falla(DATOS_INVALIDOS, `El archivo trae la columna "${filas[0][enc.indexOf(prohibida)].trim()}". La nómina se carga por cargo: quite nombres, documentos y correos de las personas.`);
  const col = {};
  for (const [k, alias] of Object.entries(COLUMNAS)) { const i = enc.findIndex(h => alias.includes(h)); if (i >= 0) col[k] = i; }
  const faltan = OBLIGATORIAS.filter(k => col[k] == null);
  if (faltan.length) falla(DATOS_INVALIDOS, `Faltan columnas: ${faltan.map(k => COLUMNAS[k][0]).join(', ')}`);
  if (filas.length - 1 > MAX_FILAS) falla(DATOS_INVALIDOS, `El archivo supera ${MAX_FILAS} filas`);
  return filas.slice(1).map((f, i) => {
    const r = i + 2, val = k => (col[k] == null ? '' : f[col[k]] ?? '');
    const rubro = rubroDe(val('rubro'));
    if (!rubro) falla(DATOS_INVALIDOS, `Fila ${r}: rubro "${val('rubro')}" desconocido. Use el numeral del estado de resultados (4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4) o su código.`);
    const proceso = String(val('proceso')).trim().slice(0, 120), cargo = String(val('cargo')).trim().slice(0, 120);
    if (!proceso || !cargo) falla(DATOS_INVALIDOS, `Fila ${r}: falta el proceso o el cargo`);
    const n = {};
    for (const k of ['continuan', 'nuevos', 'vacantes', 'salario2026', 'salario2027', 'costoAnual']) {
      const x = numero(val(k));
      if (!Number.isFinite(x) || x < 0) falla(DATOS_INVALIDOS, `Fila ${r}: valor inválido en ${COLUMNAS[k][0]} ("${val(k)}")`);
      n[k] = x;
    }
    return { rubro, proceso, cargo, ...n };
  });
}

/**
 * @param {object} [op]
 * @param {Buffer} [op.llave]  32 bytes (por defecto, FINANTIA_LLAVE_NOMINA en base64)
 */
export function crearNomina({ llave = null, env = process.env } = {}) {
  let k = llave;
  if (!k && env.FINANTIA_LLAVE_NOMINA) k = Buffer.from(env.FINANTIA_LLAVE_NOMINA, 'base64');
  const activa = !!k && k.length === 32;
  const exigirLlave = () => { if (!activa) falla(NO_DISPONIBLE, 'La carga de nómina no está configurada en este servidor (falta FINANTIA_LLAVE_NOMINA, una llave de 32 bytes en base64).'); };
  const exigirSensible = (actor, accion) => {
    exigir(actor, M, accion);
    if (!veDetalleSensible(actor, M)) falla(NO_AUTORIZADO, 'Sin permiso para ver la nómina por cargo (requiere el detalle sensible del módulo Presupuesto)');
  };
  const aad = (anio, id) => Buffer.from(`finantia:nomina:${anio}:${id}`);

  async function subir(db, actor, anio, { nombre, contenido }) {
    exigirSensible(actor, 'editar');
    exigirLlave();
    const n = String(nombre || '').normalize('NFC').replace(/[\\/\x00-\x1f"<>|:*?]/g, '_').trim().slice(0, 180);
    if (!Buffer.isBuffer(contenido) || !contenido.length) falla(DATOS_INVALIDOS, 'El archivo está vacío');
    const filas = interpretarNomina(await filasDelArchivo(n, contenido, (d, max) => inflateRawSync(d, { maxOutputLength: max })));
    const personas = filas.reduce((s, f) => s + f.continuan + f.nuevos + f.vacantes, 0);
    const costo = filas.reduce((s, f) => s + f.costoAnual, 0);
    const huella = createHash('sha256').update(contenido).digest('hex');
    return db.tx(async t => {
      if (!(await t.query('SELECT 1 FROM ejercicio WHERE anio = $1', [anio])).rows.length) falla(NO_ENCONTRADO, `No existe el ejercicio ${anio}`);
      const anteriores = (await t.query('SELECT id FROM nomina_carga WHERE ejercicio = $1 AND retirado_en IS NULL FOR UPDATE', [anio])).rows.map(x => Number(x.id));
      if (anteriores.length) await t.query('UPDATE nomina_carga SET retirado_en = now(), retirado_por = $2, cifrado = NULL, iv = NULL, etiqueta = NULL WHERE id = ANY($1::bigint[])', [anteriores, actor.id]);
      const id = Number((await t.query(
        'INSERT INTO nomina_carga (ejercicio, nombre, filas, personas, costo_total, huella, subido_por) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [anio, n, filas.length, personas, costo, huella, actor.id])).rows[0].id);
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', k, iv);
      c.setAAD(aad(anio, id));
      const cifrado = Buffer.concat([c.update(JSON.stringify(filas), 'utf8'), c.final()]);
      await t.query('UPDATE nomina_carga SET cifrado = $2, iv = $3, etiqueta = $4 WHERE id = $1', [id, cifrado, iv, c.getAuthTag()]);
      await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'SUBIR_NOMINA', entidad: 'nomina', entidadId: id,
        despues: { ejercicio: anio, nombre: n, filas: filas.length, personas, costoTotal: costo, huella, reemplaza: anteriores } });
      return id;
    });
  }

  /** Carga vigente del ejercicio con sus filas descifradas (o null si no hay). */
  async function ver(db, actor, anio) {
    exigirSensible(actor, 'ver');
    const r = (await db.query(`SELECT n.id, n.nombre, n.filas, n.personas, n.costo_total, n.huella, n.subido_en, n.cifrado, n.iv, n.etiqueta, u.nombre AS subido_por
        FROM nomina_carga n JOIN usuario u ON u.id = n.subido_por WHERE n.ejercicio = $1 AND n.retirado_en IS NULL ORDER BY n.id DESC LIMIT 1`, [anio])).rows[0];
    if (!r) return { activa, carga: null, filas: [] };
    exigirLlave();
    let filas;
    try {
      const d = createDecipheriv('aes-256-gcm', k, Buffer.from(r.iv));
      d.setAAD(aad(anio, Number(r.id))); d.setAuthTag(Buffer.from(r.etiqueta));
      filas = JSON.parse(Buffer.concat([d.update(Buffer.from(r.cifrado)), d.final()]).toString('utf8'));
    } catch { falla(NO_DISPONIBLE, 'No se pudo descifrar la nómina: la llave del servidor cambió o el contenido fue alterado.'); }
    await registrar(db, { usuarioId: actor.id, modulo: M, accion: 'VER_NOMINA', entidad: 'nomina', entidadId: Number(r.id), detalle: `ejercicio ${anio}` });
    return { activa, carga: { id: Number(r.id), nombre: r.nombre, filas: r.filas, personas: Number(r.personas), costoTotal: Number(r.costo_total), huella: r.huella, subidoEn: r.subido_en, subidoPor: r.subido_por }, filas };
  }

  /** Retira la carga y borra su contenido cifrado (solo quedan los totales en la bitácora). */
  async function retirar(db, actor, id) {
    exigirSensible(actor, 'editar');
    return db.tx(async t => {
      const r = (await t.query('SELECT ejercicio, nombre FROM nomina_carga WHERE id = $1 AND retirado_en IS NULL FOR UPDATE', [id])).rows[0];
      if (!r) falla(NO_ENCONTRADO, 'La carga de nómina no existe o ya fue retirada');
      await t.query('UPDATE nomina_carga SET retirado_en = now(), retirado_por = $2, cifrado = NULL, iv = NULL, etiqueta = NULL WHERE id = $1', [id, actor.id]);
      await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'RETIRAR_NOMINA', entidad: 'nomina', entidadId: id, antes: { ejercicio: r.ejercicio, nombre: r.nombre } });
    });
  }

  return { activa, subir, ver, retirar };
}
