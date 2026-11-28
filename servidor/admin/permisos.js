/**
 * Permisos de Finantia 2.0. Regla general: cada usuario tiene, por módulo, un solo rol.
 *
 *   Visualización   ver
 *   Administración  ver y editar (supuestos, cargas, enviar a revisión)
 *   Aprobación      ver y aprobar o devolver
 *   Superusuario    administra Finantia (módulo de Administración) y puede ver y editar
 *                   en todos los módulos; para aprobar necesita además el rol Aprobación
 *                   en ese módulo, así la aprobación siempre es una asignación explícita.
 *
 * Un usuario inactivo no puede nada. Un módulo en pausa (Auditoría contable) no admite
 * ninguna acción salvo para el Superusuario.
 */
import { falla, NO_AUTORIZADO } from '../errores.js';

export const ROLES = ['VISUALIZACION', 'ADMINISTRACION', 'APROBACION'];
export const ACCIONES_POR_ROL = {
  VISUALIZACION: ['ver'],
  ADMINISTRACION: ['ver', 'editar'],
  APROBACION: ['ver', 'aprobar']
};

/** Carga el usuario con sus accesos y el estado de los módulos. */
export async function cargarActor(db, usuarioId) {
  const u = (await db.query('SELECT id, correo, nombre, activo, es_superusuario FROM usuario WHERE id = $1', [usuarioId])).rows[0];
  if (!u) falla(NO_AUTORIZADO, 'Usuario no registrado en Finantia');
  const accesos = {};
  for (const a of (await db.query('SELECT modulo, rol, detalle_sensible, preguntas FROM acceso WHERE usuario_id = $1', [usuarioId])).rows) accesos[a.modulo] = a;
  const modulosActivos = new Set((await db.query('SELECT codigo FROM modulo WHERE activo')).rows.map(r => r.codigo));
  return { ...u, id: Number(u.id), accesos, modulosActivos };
}

/** ¿Puede el actor hacer `accion` ('ver' | 'editar' | 'aprobar') en `modulo`? */
export function puede(actor, modulo, accion) {
  if (!actor || !actor.activo) return false;
  if (modulo === 'ADMINISTRACION') return actor.es_superusuario;
  if (!actor.modulosActivos.has(modulo) && !actor.es_superusuario) return false;
  const a = actor.accesos[modulo];
  if (accion === 'aprobar') return !!a && a.rol === 'APROBACION';
  if (actor.es_superusuario) return true;
  return !!a && ACCIONES_POR_ROL[a.rol].includes(accion);
}

/** ¿Ve el detalle sensible (nómina por cargo) del módulo? */
export function veDetalleSensible(actor, modulo) {
  if (!actor || !actor.activo) return false;
  return actor.es_superusuario || !!(actor.accesos[modulo] && actor.accesos[modulo].detalle_sensible);
}

/**
 * ¿Puede usar la pestaña Preguntas (el asistente) del módulo? Además de ver el módulo, necesita el
 * permiso de Preguntas que se asigna en Administración; el Superusuario lo tiene siempre.
 */
export function puedePreguntar(actor, modulo) {
  if (!puede(actor, modulo, 'ver')) return false;
  return actor.es_superusuario || !!actor.accesos[modulo]?.preguntas;
}

export function exigir(actor, modulo, accion) {
  if (!puede(actor, modulo, accion)) falla(NO_AUTORIZADO, `Sin permiso para ${accion} en ${modulo}`);
}
