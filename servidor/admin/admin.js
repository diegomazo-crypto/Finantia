/**
 * Módulo de Administración (solo Superusuario): usuarios, accesos por módulo y rol,
 * configuración de aprobaciones y consulta de la bitácora.
 * Todas las funciones reciben el actor (ver permisos.cargarActor) y dejan registro.
 */
import { exigir, ROLES } from './permisos.js';
import { registrar } from './bitacora.js';
import { falla, DATOS_INVALIDOS, NO_ENCONTRADO, ESTADO_INVALIDO } from '../errores.js';

const M = 'ADMINISTRACION';
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizarCorreo(correo, dominios) {
  const c = String(correo || '').trim().toLowerCase();
  if (!CORREO.test(c)) falla(DATOS_INVALIDOS, `Correo inválido: ${correo}`);
  if (dominios && dominios.length && !dominios.some(d => c.endsWith('@' + d.toLowerCase()))) falla(DATOS_INVALIDOS, `El correo debe ser institucional (${dominios.join(', ')})`);
  return c;
}

/** Dominios de correo admitidos; se configuran con FINANTIA_DOMINIOS="ceipa.edu.co,otro.edu". Vacío = cualquiera. */
export const dominiosConfigurados = () => (process.env.FINANTIA_DOMINIOS || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * Crea el primer Superusuario. Solo funciona si todavía no hay ninguno; se corre una vez
 * al instalar (herramientas/inicializar.js), con el correo que se indique en ese momento.
 */
export async function inicializarSuperusuario(db, { correo, nombre }, dominios = dominiosConfigurados()) {
  return db.tx(async t => {
    const hay = (await t.query('SELECT 1 FROM usuario WHERE es_superusuario LIMIT 1')).rows.length;
    if (hay) falla(ESTADO_INVALIDO, 'Ya existe un Superusuario');
    const c = normalizarCorreo(correo, dominios);
    const u = (await t.query('INSERT INTO usuario (correo, nombre, es_superusuario) VALUES ($1, $2, true) RETURNING id', [c, nombre])).rows[0];
    await registrar(t, { usuarioId: u.id, modulo: M, accion: 'INICIALIZAR', entidad: 'usuario', entidadId: u.id, despues: { correo: c, nombre, es_superusuario: true } });
    return Number(u.id);
  });
}

export async function crearUsuario(db, actor, { correo, nombre }, dominios = dominiosConfigurados()) {
  exigir(actor, M, 'editar');
  const c = normalizarCorreo(correo, dominios);
  if (!nombre || !String(nombre).trim()) falla(DATOS_INVALIDOS, 'Falta el nombre');
  return db.tx(async t => {
    if ((await t.query('SELECT 1 FROM usuario WHERE correo = $1', [c])).rows.length) falla(ESTADO_INVALIDO, `Ya existe un usuario con el correo ${c}`);
    const u = (await t.query('INSERT INTO usuario (correo, nombre, creado_por) VALUES ($1, $2, $3) RETURNING id', [c, String(nombre).trim(), actor.id])).rows[0];
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'CREAR_USUARIO', entidad: 'usuario', entidadId: u.id, despues: { correo: c, nombre } });
    return Number(u.id);
  });
}

async function leerUsuario(t, id) {
  const u = (await t.query('SELECT id, correo, nombre, activo, es_superusuario FROM usuario WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!u) falla(NO_ENCONTRADO, `No existe el usuario ${id}`);
  return u;
}
const superusuariosActivos = async t => Number((await t.query('SELECT count(*)::int AS n FROM usuario WHERE es_superusuario AND activo')).rows[0].n);

/** Activa o desactiva a un usuario. No se puede desactivar al último Superusuario activo ni a uno mismo. */
export async function cambiarActivo(db, actor, usuarioId, activo) {
  exigir(actor, M, 'editar');
  return db.tx(async t => {
    const u = await leerUsuario(t, usuarioId);
    if (!activo && Number(u.id) === actor.id) falla(ESTADO_INVALIDO, 'No puede desactivarse a sí mismo');
    if (!activo && u.es_superusuario && u.activo && (await superusuariosActivos(t)) <= 1) falla(ESTADO_INVALIDO, 'Debe quedar al menos un Superusuario activo');
    await t.query('UPDATE usuario SET activo = $2 WHERE id = $1', [usuarioId, !!activo]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: activo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO', entidad: 'usuario', entidadId: usuarioId, antes: { activo: u.activo }, despues: { activo: !!activo } });
  });
}

/** Da o quita la condición de Superusuario. Debe quedar al menos uno activo. */
export async function cambiarSuperusuario(db, actor, usuarioId, valor) {
  exigir(actor, M, 'editar');
  return db.tx(async t => {
    const u = await leerUsuario(t, usuarioId);
    if (!valor && u.es_superusuario && u.activo && (await superusuariosActivos(t)) <= 1) falla(ESTADO_INVALIDO, 'Debe quedar al menos un Superusuario activo');
    await t.query('UPDATE usuario SET es_superusuario = $2 WHERE id = $1', [usuarioId, !!valor]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'CAMBIAR_SUPERUSUARIO', entidad: 'usuario', entidadId: usuarioId, antes: { es_superusuario: u.es_superusuario }, despues: { es_superusuario: !!valor } });
  });
}

/** Asigna (o cambia) el rol de un usuario en un módulo. */
export async function asignarAcceso(db, actor, usuarioId, modulo, rol, { detalleSensible = false } = {}) {
  exigir(actor, M, 'editar');
  if (!ROLES.includes(rol)) falla(DATOS_INVALIDOS, `Rol desconocido: ${rol}`);
  if (modulo === M) falla(DATOS_INVALIDOS, 'El módulo de Administración es solo para el Superusuario');
  return db.tx(async t => {
    const mod = (await t.query('SELECT codigo, activo FROM modulo WHERE codigo = $1', [modulo])).rows[0];
    if (!mod) falla(NO_ENCONTRADO, `No existe el módulo ${modulo}`);
    if (!mod.activo) falla(ESTADO_INVALIDO, `El módulo ${modulo} está en pausa`);
    await leerUsuario(t, usuarioId);
    const antes = (await t.query('SELECT rol, detalle_sensible FROM acceso WHERE usuario_id = $1 AND modulo = $2', [usuarioId, modulo])).rows[0] || null;
    await t.query(`INSERT INTO acceso (usuario_id, modulo, rol, detalle_sensible, asignado_por) VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (usuario_id, modulo) DO UPDATE SET rol = EXCLUDED.rol, detalle_sensible = EXCLUDED.detalle_sensible, asignado_en = now(), asignado_por = EXCLUDED.asignado_por`,
      [usuarioId, modulo, rol, !!detalleSensible, actor.id]);
    if (antes && antes.rol === 'APROBACION' && rol !== 'APROBACION') await t.query('DELETE FROM aprobador_orden WHERE modulo = $1 AND usuario_id = $2', [modulo, usuarioId]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'ASIGNAR_ACCESO', entidad: 'acceso', entidadId: `${usuarioId}/${modulo}`, antes, despues: { rol, detalle_sensible: !!detalleSensible } });
  });
}

export async function quitarAcceso(db, actor, usuarioId, modulo) {
  exigir(actor, M, 'editar');
  return db.tx(async t => {
    const antes = (await t.query('DELETE FROM acceso WHERE usuario_id = $1 AND modulo = $2 RETURNING rol, detalle_sensible', [usuarioId, modulo])).rows[0];
    if (!antes) falla(NO_ENCONTRADO, 'Ese usuario no tiene acceso a ese módulo');
    await t.query('DELETE FROM aprobador_orden WHERE modulo = $1 AND usuario_id = $2', [modulo, usuarioId]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'QUITAR_ACCESO', entidad: 'acceso', entidadId: `${usuarioId}/${modulo}`, antes });
  });
}

/**
 * Cuántas aprobaciones necesita una versión del módulo y, opcionalmente, en qué orden.
 * Con `enOrden`, `aprobadores` es la lista de usuarios (con rol Aprobación) en el orden en que aprueban,
 * y su largo debe ser igual a las aprobaciones requeridas.
 */
export async function configurarAprobacion(db, actor, modulo, { aprobacionesRequeridas = 1, enOrden = false, aprobadores = [] } = {}) {
  exigir(actor, M, 'editar');
  const n = Number(aprobacionesRequeridas);
  if (!Number.isInteger(n) || n < 1 || n > 5) falla(DATOS_INVALIDOS, 'Las aprobaciones requeridas van de 1 a 5');
  if (enOrden && aprobadores.length !== n) falla(DATOS_INVALIDOS, `Con orden fijo se necesitan exactamente ${n} aprobadores`);
  if (new Set(aprobadores).size !== aprobadores.length) falla(DATOS_INVALIDOS, 'Un aprobador aparece dos veces');
  return db.tx(async t => {
    const antes = (await t.query('SELECT aprobaciones_requeridas, en_orden FROM config_aprobacion WHERE modulo = $1 FOR UPDATE', [modulo])).rows[0];
    if (!antes) falla(NO_ENCONTRADO, `El módulo ${modulo} no tiene aprobaciones`);
    antes.aprobadores = (await t.query('SELECT usuario_id FROM aprobador_orden WHERE modulo = $1 ORDER BY posicion', [modulo])).rows.map(r => Number(r.usuario_id));
    if (enOrden) for (const id of aprobadores) {
      const ok = (await t.query(`SELECT 1 FROM acceso a JOIN usuario u ON u.id = a.usuario_id WHERE a.usuario_id = $1 AND a.modulo = $2 AND a.rol = 'APROBACION' AND u.activo`, [id, modulo])).rows.length;
      if (!ok) falla(DATOS_INVALIDOS, `El usuario ${id} no tiene el rol Aprobación activo en ${modulo}`);
    }
    if (!enOrden) {
      const disponibles = Number((await t.query(`SELECT count(*)::int AS n FROM acceso a JOIN usuario u ON u.id = a.usuario_id WHERE a.modulo = $1 AND a.rol = 'APROBACION' AND u.activo`, [modulo])).rows[0].n);
      if (disponibles < n) falla(DATOS_INVALIDOS, `Solo hay ${disponibles} usuarios con rol Aprobación en ${modulo}; se piden ${n}`);
    }
    await t.query('UPDATE config_aprobacion SET aprobaciones_requeridas = $2, en_orden = $3, actualizado_en = now(), actualizado_por = $4 WHERE modulo = $1', [modulo, n, !!enOrden, actor.id]);
    await t.query('DELETE FROM aprobador_orden WHERE modulo = $1', [modulo]);
    if (enOrden) for (let k = 0; k < aprobadores.length; k++) await t.query('INSERT INTO aprobador_orden (modulo, posicion, usuario_id) VALUES ($1, $2, $3)', [modulo, k + 1, aprobadores[k]]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'CONFIGURAR_APROBACION', entidad: 'config_aprobacion', entidadId: modulo, antes, despues: { aprobaciones_requeridas: n, en_orden: !!enOrden, aprobadores: enOrden ? aprobadores : [] } });
  });
}

/** Usuarios con sus accesos por módulo. */
export async function listarUsuarios(db, actor) {
  exigir(actor, M, 'ver');
  const us = (await db.query('SELECT id, correo, nombre, activo, es_superusuario, ultimo_ingreso FROM usuario ORDER BY nombre')).rows;
  const ac = (await db.query('SELECT usuario_id, modulo, rol, detalle_sensible FROM acceso')).rows;
  return us.map(u => ({ ...u, id: Number(u.id), accesos: ac.filter(a => Number(a.usuario_id) === Number(u.id)).map(({ modulo, rol, detalle_sensible }) => ({ modulo, rol, detalle_sensible })) }));
}

/** Bitácora con filtros por módulo, usuario y fechas, la más reciente primero. */
export async function consultarBitacora(db, actor, { modulo = null, usuarioId = null, desde = null, hasta = null, limite = 200 } = {}) {
  exigir(actor, M, 'ver');
  return (await db.query(
    `SELECT b.id, b.fecha, b.usuario_id, u.correo, b.modulo, b.accion, b.entidad, b.entidad_id, b.antes, b.despues, b.detalle
       FROM bitacora b LEFT JOIN usuario u ON u.id = b.usuario_id
      WHERE ($1::text IS NULL OR b.modulo = $1) AND ($2::bigint IS NULL OR b.usuario_id = $2)
        AND ($3::timestamptz IS NULL OR b.fecha >= $3) AND ($4::timestamptz IS NULL OR b.fecha < $4)
      ORDER BY b.id DESC LIMIT $5`, [modulo, usuarioId, desde, hasta, Math.min(Number(limite) || 200, 1000)])).rows;
}
