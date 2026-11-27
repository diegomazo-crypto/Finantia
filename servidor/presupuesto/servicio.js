/**
 * Módulo Presupuesto: ejercicios, versiones y su ciclo de aprobación.
 *
 *   BORRADOR ──enviar──▶ EN_REVISION ──aprobar (N veces)──▶ APROBADA ──(otra aprobada)──▶ REEMPLAZADA
 *       ▲                     │
 *       └──────devolver───────┘
 *
 * Los supuestos solo se editan en BORRADOR, por quien tenga Administración. Aprueba quien
 * tenga el rol Aprobación; cuántas aprobaciones y en qué orden lo define el módulo de
 * Administración. Quien envió la versión no puede aprobarla. Cada paso queda en la bitácora.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crearModelo, DEFAULTS, ESCS, lineasMensuales } from '../../motor/index.js';
import { exigir } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, DATOS_INVALIDOS, NO_ENCONTRADO, ESTADO_INVALIDO, NO_AUTORIZADO } from '../errores.js';

const M = 'PRESUPUESTO';
export const MOTOR_VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version;
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- datos base ---------- */

/** Revisa que la base tenga la forma que espera el motor. */
export function validarDatosBase(d) {
  const err = m => falla(DATOS_INVALIDOS, 'Datos base inválidos: ' + m);
  if (!d || typeof d !== 'object') err('no es un objeto');
  if (!Array.isArray(d.units) || d.units.length !== 7) err('se esperan 7 unidades');
  for (const k of ['IB', 'DS', 'OI', 'N', 'NS', 'C', 'F', 'V', 'VN', 'VI', 'DA', 'FX', 'X'])
    if (!Array.isArray(d.H?.[k]) || d.H[k].length !== 7 || d.H[k].some(v => !Number.isFinite(v))) err(`H.${k} debe tener 7 cifras`);
  if (!Array.isArray(d.L) || !d.L.length) err('faltan las líneas (L)');
  if (!Array.isArray(d.LP) || d.LP.length !== d.L.length) err('LP debe tener una fila por línea');
  if (!Array.isArray(d.LN) || d.LN.length !== d.L.length) err('LN debe tener un nombre por línea');
  d.L.forEach((l, i) => { if (!Array.isArray(l[3]) || l[3].length !== 7) err(`línea ${i} sin 7 unidades`); });
  for (const u of [...d.units, 'NOM', 'COS']) {
    const s = d.seas?.[u];
    if (!Array.isArray(s) || s.length !== 12) err(`estacionalidad ${u} debe tener 12 meses`);
    if (Math.abs(s.reduce((a, b) => a + b, 0) - 1) > 1e-6) err(`estacionalidad ${u} no suma 100%`);
  }
}

export async function cargarDatosBase(db, actor, { anioBase, descripcion, contenido }) {
  exigir(actor, M, 'editar');
  validarDatosBase(contenido);
  const texto = JSON.stringify(contenido), huella = createHash('sha256').update(texto).digest('hex');
  return db.tx(async t => {
    const r = (await t.query('INSERT INTO datos_base (anio_base, descripcion, contenido, huella, cargado_por) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [anioBase, descripcion, texto, huella, actor.id])).rows[0];
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'CARGAR_DATOS_BASE', entidad: 'datos_base', entidadId: r.id, despues: { anioBase, descripcion, huella } });
    return Number(r.id);
  });
}

/* ---------- supuestos ---------- */

const NUM = v => typeof v === 'number' && Number.isFinite(v);
/** Revisa un cambio de supuestos contra la forma de DEFAULTS: solo claves conocidas y números. */
export function validarSupuestos(s) {
  const err = m => falla(DATOS_INVALIDOS, 'Supuesto inválido: ' + m);
  const forma = (v, ref, ruta) => {
    if (ruta.endsWith('.descU')) {
      if (v !== null && (!Array.isArray(v) || v.length !== 7 || v.some(x => !NUM(x) || x < 0 || x > 1))) err(`${ruta} debe ser null o 7 porcentajes`);
      return;
    }
    if (Array.isArray(ref)) {
      if (!Array.isArray(v) || v.length !== ref.length || v.some(x => !NUM(x))) err(`${ruta} debe ser una lista de ${ref.length} números`); return;
    }
    if (typeof ref === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) err(`${ruta} debe ser un objeto`);
      for (const k of Object.keys(v)) {
        if (ruta.endsWith('.grp') || ruta.endsWith('.tope')) { if (!NUM(v[k])) err(`${ruta}.${k}`); continue; }
        if (!(k in ref) && !(ruta.endsWith('.lr') && (k === 'fS' || k === 'fB'))) err(`clave desconocida ${ruta}.${k}`);
        if (ruta.endsWith('.lr') && (k === 'fS' || k === 'fB')) { forma(v[k], [0, 0, 0, 0], `${ruta}.${k}`); continue; }
        forma(v[k], ref[k], `${ruta}.${k}`);
      }
      return;
    }
    if (!NUM(v)) err(`${ruta} debe ser un número`);
  };
  for (const k of Object.keys(s)) {
    if (k === 'params') {
      for (const e of Object.keys(s.params)) {
        if (!ESCS.includes(e)) err(`escenario desconocido ${e}`);
        forma(s.params[e], { ...DEFAULTS[e], tope: {} }, `params.${e}`);
      }
    } else if (k === 'metas') {
      for (const [mk, mv] of Object.entries(s.metas)) {
        if (mk === 'ure') { if (!NUM(mv) || mv < 0) err('metas.ure'); continue; }
        if (!Array.isArray(mv) || mv.some(x => !NUM(x) || x < 0)) err(`metas.${mk}`);
      }
    } else if (k === 'esicVentas' || k === 'esicPct') { if (!NUM(s[k]) || s[k] < 0) err(k); }
    else err(`clave desconocida ${k}`);
  }
}

/** Mezcla profunda: los objetos se combinan, las listas y los números se reemplazan. */
function mezclar(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return clone(b);
  const o = a && typeof a === 'object' && !Array.isArray(a) ? clone(a) : {};
  for (const [k, v] of Object.entries(b)) o[k] = mezclar(o[k], v);
  return o;
}

/* ---------- cálculo ---------- */

function resumenEscenario(x) {
  const t = x.presupuesto.tot;
  return {
    tot: t,
    unidades: x.presupuesto.units.map(u => ({ IB: u.IB, DS: u.DS, NET: u.NET, OI: u.OI, N: u.N, C: u.C, TC: u.TC, EBITDA: u.EBITDA, RN: u.RN })),
    eerr: x.pyg.tot,
    eerrUnidades: x.pyg.units,
    proyeccion: x.proyeccion.rows,
    metricas: x.metricas,
    mensual: x.mensualPyG,
    caja: { saldoFinal: x.caja.saldoFinal, saldoMinimo: x.caja.saldoMinimo, mesMinimo: x.caja.mesMinimo, mesesBajoMinimo: x.caja.mesesBajoMinimo, meses: x.caja.meses }
  };
}

async function modeloDe(t, version) {
  const base = (await t.query('SELECT contenido FROM datos_base WHERE id = $1', [version.datos_base_id])).rows[0];
  const datos = typeof base.contenido === 'string' ? JSON.parse(base.contenido) : base.contenido;
  return { datos, modelo: crearModelo(datos, version.supuestos || {}) };
}

/** Recalcula y guarda el resultado de los tres escenarios de una versión. */
async function recalcular(t, version) {
  const { modelo } = await modeloDe(t, version);
  for (const e of ESCS) {
    const r = resumenEscenario(modelo.escenario(e));
    await t.query(`INSERT INTO resultado (version_id, escenario, resumen, motor_version) VALUES ($1, $2, $3, $4)
                   ON CONFLICT (version_id, escenario) DO UPDATE SET resumen = EXCLUDED.resumen, motor_version = EXCLUDED.motor_version, calculado_en = now()`,
      [version.id, e, JSON.stringify(r), MOTOR_VERSION]);
  }
}

/* ---------- ejercicios y versiones ---------- */

export async function crearEjercicio(db, actor, anio) {
  exigir(actor, M, 'editar');
  if (!Number.isInteger(anio) || anio < 2026 || anio > 2100) falla(DATOS_INVALIDOS, `Año inválido: ${anio}`);
  return db.tx(async t => {
    if ((await t.query('SELECT 1 FROM ejercicio WHERE anio = $1', [anio])).rows.length) falla(ESTADO_INVALIDO, `El ejercicio ${anio} ya existe`);
    await t.query('INSERT INTO ejercicio (anio, creado_por) VALUES ($1, $2)', [anio, actor.id]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'CREAR_EJERCICIO', entidad: 'ejercicio', entidadId: anio });
  });
}

async function leerVersion(t, id, bloquear = false) {
  const v = (await t.query(`SELECT * FROM version WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!v) falla(NO_ENCONTRADO, `No existe la versión ${id}`);
  v.id = Number(v.id); v.datos_base_id = Number(v.datos_base_id);
  if (typeof v.supuestos === 'string') v.supuestos = JSON.parse(v.supuestos);
  return v;
}

/**
 * Crea una versión en borrador. Parte de unos datos base (datosBaseId) con los supuestos
 * del Excel v21, o copia otra versión (copiaDe) con sus datos base y supuestos.
 */
export async function crearVersion(db, actor, { ejercicio, nombre, datosBaseId = null, copiaDe = null, supuestos = {} }) {
  exigir(actor, M, 'editar');
  validarSupuestos(supuestos);
  return db.tx(async t => {
    const ej = (await t.query('SELECT estado FROM ejercicio WHERE anio = $1', [ejercicio])).rows[0];
    if (!ej) falla(NO_ENCONTRADO, `No existe el ejercicio ${ejercicio}`);
    if (ej.estado !== 'ABIERTO') falla(ESTADO_INVALIDO, `El ejercicio ${ejercicio} está cerrado`);
    let base = datosBaseId, sup = supuestos;
    if (copiaDe) { const o = await leerVersion(t, copiaDe); base = o.datos_base_id; sup = mezclar(o.supuestos, supuestos); }
    if (!base) falla(DATOS_INVALIDOS, 'Indique los datos base o la versión de la que se copia');
    if (!(await t.query('SELECT 1 FROM datos_base WHERE id = $1', [base])).rows.length) falla(NO_ENCONTRADO, `No existen los datos base ${base}`);
    const numero = Number((await t.query('SELECT COALESCE(max(numero), 0) + 1 AS n FROM version WHERE ejercicio = $1', [ejercicio])).rows[0].n);
    const r = (await t.query(`INSERT INTO version (ejercicio, numero, nombre, datos_base_id, supuestos, copia_de, creada_por) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ejercicio, numero, nombre, base, JSON.stringify(sup), copiaDe, actor.id])).rows[0];
    const v = await leerVersion(t, r.id);
    await recalcular(t, v);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'CREAR_VERSION', entidad: 'version', entidadId: v.id, despues: { ejercicio, numero, nombre, datosBaseId: base, copiaDe } });
    return v.id;
  });
}

/** Cambia supuestos de una versión en borrador; guarda el valor anterior en la bitácora y recalcula. */
export async function editarSupuestos(db, actor, versionId, cambios) {
  exigir(actor, M, 'editar');
  validarSupuestos(cambios);
  return db.tx(async t => {
    const v = await leerVersion(t, versionId, true);
    if (v.estado !== 'BORRADOR') falla(ESTADO_INVALIDO, `La versión está ${v.estado}; solo se editan borradores`);
    const nuevo = mezclar(v.supuestos, cambios);
    await t.query('UPDATE version SET supuestos = $2 WHERE id = $1', [v.id, JSON.stringify(nuevo)]);
    const antes = {};
    const tomar = (src, ch, dst) => { for (const k of Object.keys(ch)) { if (ch[k] && typeof ch[k] === 'object' && !Array.isArray(ch[k])) { dst[k] = {}; tomar(src?.[k], ch[k], dst[k]); } else dst[k] = src?.[k] ?? null; } };
    tomar(v.supuestos, cambios, antes);
    await recalcular(t, { ...v, supuestos: nuevo });
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'EDITAR_SUPUESTOS', entidad: 'version', entidadId: v.id, antes, despues: cambios });
  });
}

export async function enviarARevision(db, actor, versionId) {
  exigir(actor, M, 'editar');
  return db.tx(async t => {
    const v = await leerVersion(t, versionId, true);
    if (v.estado !== 'BORRADOR') falla(ESTADO_INVALIDO, `Solo se envía un borrador (está ${v.estado})`);
    await t.query(`UPDATE version SET estado = 'EN_REVISION', enviada_en = now(), enviada_por = $2 WHERE id = $1`, [v.id, actor.id]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'ENVIAR_REVISION', entidad: 'version', entidadId: v.id, antes: { estado: v.estado }, despues: { estado: 'EN_REVISION', ronda: v.ronda } });
  });
}

/**
 * Registra una aprobación. Cuando se completan las requeridas, la versión queda APROBADA,
 * la aprobada anterior del ejercicio pasa a REEMPLAZADA y se generan las líneas presupuestales
 * del escenario oficial (por defecto el Moderado).
 * @returns {{estado: string, aprobaciones: number, requeridas: number}}
 */
export async function aprobar(db, actor, versionId, { observaciones = null, escenarioOficial = null } = {}) {
  exigir(actor, M, 'aprobar');
  if (escenarioOficial && !ESCS.includes(escenarioOficial)) falla(DATOS_INVALIDOS, `Escenario desconocido: ${escenarioOficial}`);
  return db.tx(async t => {
    const v = await leerVersion(t, versionId, true);
    if (v.estado !== 'EN_REVISION') falla(ESTADO_INVALIDO, `Solo se aprueba una versión en revisión (está ${v.estado})`);
    if (Number(v.enviada_por) === actor.id) falla(NO_AUTORIZADO, 'Quien envió la versión no puede aprobarla');
    const cfg = (await t.query('SELECT aprobaciones_requeridas, en_orden FROM config_aprobacion WHERE modulo = $1', [M])).rows[0];
    const previas = (await t.query(`SELECT usuario_id FROM decision_aprobacion WHERE version_id = $1 AND ronda = $2 AND decision = 'APROBAR' ORDER BY id`, [v.id, v.ronda])).rows.map(r => Number(r.usuario_id));
    if (previas.includes(actor.id)) falla(ESTADO_INVALIDO, 'Ya aprobó esta versión');
    if (cfg.en_orden) {
      const turno = (await t.query('SELECT usuario_id FROM aprobador_orden WHERE modulo = $1 AND posicion = $2', [M, previas.length + 1])).rows[0];
      if (!turno || Number(turno.usuario_id) !== actor.id) falla(NO_AUTORIZADO, 'No es su turno de aprobar');
    }
    await t.query(`INSERT INTO decision_aprobacion (version_id, ronda, usuario_id, decision, observaciones) VALUES ($1, $2, $3, 'APROBAR', $4)`, [v.id, v.ronda, actor.id, observaciones]);
    const n = previas.length + 1, req = Number(cfg.aprobaciones_requeridas);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'APROBAR', entidad: 'version', entidadId: v.id, despues: { aprobacion: n, requeridas: req, ronda: v.ronda }, detalle: observaciones });
    if (n < req) return { estado: 'EN_REVISION', aprobaciones: n, requeridas: req };

    const oficial = escenarioOficial || 'Moderado';
    const anterior = (await t.query(`SELECT id FROM version WHERE ejercicio = $1 AND estado = 'APROBADA' FOR UPDATE`, [v.ejercicio])).rows[0];
    if (anterior) {
      await t.query(`UPDATE version SET estado = 'REEMPLAZADA', reemplazada_en = now(), reemplazada_por = $2 WHERE id = $1`, [anterior.id, v.id]);
      await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'REEMPLAZAR', entidad: 'version', entidadId: anterior.id, antes: { estado: 'APROBADA' }, despues: { estado: 'REEMPLAZADA', reemplazada_por: v.id } });
    }
    await t.query(`UPDATE version SET estado = 'APROBADA', aprobada_en = now(), escenario_oficial = $2 WHERE id = $1`, [v.id, oficial]);
    const { datos, modelo } = await modeloDe(t, v);
    const lineas = lineasMensuales(datos, modelo.escenario(oficial).pyg);
    for (let k = 0; k < lineas.length; k += 500) {
      const lote = lineas.slice(k, k + 500), vals = [], params = [];
      lote.forEach((l, j) => { const b = j * 7; vals.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`); params.push(v.id, l.linea, l.codigo, l.bloque, l.unidad, l.mes, Math.round(l.valor * 100) / 100); });
      await t.query(`INSERT INTO linea_presupuestal (version_id, linea, codigo, bloque, unidad, mes, valor) VALUES ${vals.join(', ')}`, params);
    }
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'VERSION_APROBADA', entidad: 'version', entidadId: v.id, antes: { estado: 'EN_REVISION' }, despues: { estado: 'APROBADA', escenario_oficial: oficial, lineas: lineas.length } });
    return { estado: 'APROBADA', aprobaciones: n, requeridas: req };
  });
}

/** Devuelve la versión a borrador con observaciones (obligatorias). Las aprobaciones de la ronda se descartan. */
export async function devolver(db, actor, versionId, observaciones) {
  exigir(actor, M, 'aprobar');
  if (!observaciones || !String(observaciones).trim()) falla(DATOS_INVALIDOS, 'Para devolver una versión escriba las observaciones');
  return db.tx(async t => {
    const v = await leerVersion(t, versionId, true);
    if (v.estado !== 'EN_REVISION') falla(ESTADO_INVALIDO, `Solo se devuelve una versión en revisión (está ${v.estado})`);
    await t.query(`INSERT INTO decision_aprobacion (version_id, ronda, usuario_id, decision, observaciones) VALUES ($1, $2, $3, 'DEVOLVER', $4)`, [v.id, v.ronda, actor.id, observaciones]);
    await t.query(`UPDATE version SET estado = 'BORRADOR', ronda = ronda + 1, enviada_en = NULL, enviada_por = NULL WHERE id = $1`, [v.id]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'DEVOLVER', entidad: 'version', entidadId: v.id, antes: { estado: 'EN_REVISION', ronda: v.ronda }, despues: { estado: 'BORRADOR', ronda: v.ronda + 1 }, detalle: observaciones });
  });
}

/* ---------- consultas ---------- */

export async function listarVersiones(db, actor, ejercicio) {
  exigir(actor, M, 'ver');
  return (await db.query('SELECT id, numero, nombre, estado, escenario_oficial, ronda, creada_en, enviada_en, aprobada_en, reemplazada_por FROM version WHERE ejercicio = $1 ORDER BY numero', [ejercicio])).rows
    .map(r => ({ ...r, id: Number(r.id) }));
}

/** Versión con sus supuestos, el resultado de los tres escenarios y el historial de decisiones. */
export async function obtenerVersion(db, actor, versionId) {
  exigir(actor, M, 'ver');
  const v = await leerVersion(db, versionId);
  const res = {};
  for (const r of (await db.query('SELECT escenario, resumen, motor_version, calculado_en FROM resultado WHERE version_id = $1', [v.id])).rows)
    res[r.escenario] = { ...(typeof r.resumen === 'string' ? JSON.parse(r.resumen) : r.resumen), motorVersion: r.motor_version, calculadoEn: r.calculado_en };
  const decisiones = (await db.query(`SELECT d.ronda, d.decision, d.observaciones, d.fecha, u.nombre FROM decision_aprobacion d JOIN usuario u ON u.id = d.usuario_id WHERE d.version_id = $1 ORDER BY d.id`, [v.id])).rows;
  return { ...v, resultados: res, decisiones };
}

/** Líneas presupuestales de una versión aprobada (o reemplazada), con filtros opcionales. */
export async function lineasPresupuestales(db, actor, versionId, { unidad = null, mes = null } = {}) {
  exigir(actor, M, 'ver');
  return (await db.query(`SELECT linea, codigo, bloque, unidad, mes, valor FROM linea_presupuestal WHERE version_id = $1 AND ($2::text IS NULL OR unidad = $2) AND ($3::int IS NULL OR mes = $3) ORDER BY linea, unidad, mes`,
    [versionId, unidad, mes])).rows.map(r => ({ ...r, valor: Number(r.valor) }));
}

export async function listarEjercicios(db, actor) {
  exigir(actor, M, 'ver');
  return (await db.query(`SELECT e.anio, e.estado, e.creado_en,
      (SELECT count(*)::int FROM version v WHERE v.ejercicio = e.anio) AS versiones,
      (SELECT v.id FROM version v WHERE v.ejercicio = e.anio AND v.estado = 'APROBADA') AS aprobada
    FROM ejercicio e ORDER BY e.anio DESC`)).rows.map(r => ({ ...r, aprobada: r.aprobada == null ? null : Number(r.aprobada) }));
}

export async function listarDatosBase(db, actor) {
  exigir(actor, M, 'ver');
  return (await db.query('SELECT id, anio_base, descripcion, huella, cargado_en FROM datos_base ORDER BY id DESC')).rows.map(r => ({ ...r, id: Number(r.id) }));
}

const cacheBase = new Map();
/** Lo que las pantallas necesitan de los datos base: nombres de unidades y líneas y el estado de resultados 2026E. */
export async function contextoBase(db, actor, datosBaseId) {
  exigir(actor, M, 'ver');
  if (!cacheBase.has(datosBaseId)) {
    const r = (await db.query('SELECT contenido FROM datos_base WHERE id = $1', [datosBaseId])).rows[0];
    if (!r) falla(NO_ENCONTRADO, `No existen los datos base ${datosBaseId}`);
    const datos = typeof r.contenido === 'string' ? JSON.parse(r.contenido) : r.contenido;
    const m = crearModelo(datos), g = m.pyg2026();
    cacheBase.set(datosBaseId, { units: datos.units, names: datos.names, base2026: m.base2026, eerr2026: g.tot, eerr2026Unidades: g.units });
  }
  return cacheBase.get(datosBaseId);
}

/** Cambios de supuestos y pasos de aprobación de una versión, el más reciente primero. */
export async function historialVersion(db, actor, versionId) {
  exigir(actor, M, 'ver');
  return (await db.query(`SELECT b.fecha, u.nombre, b.accion, b.antes, b.despues, b.detalle FROM bitacora b LEFT JOIN usuario u ON u.id = b.usuario_id
    WHERE b.modulo = 'PRESUPUESTO' AND b.entidad = 'version' AND b.entidad_id = $1 ORDER BY b.id DESC LIMIT 200`, [String(versionId)])).rows;
}
