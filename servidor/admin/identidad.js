/**
 * Ingreso con Microsoft 365 (Entra ID). Esta función recibe los datos de un token
 * YA verificado por la capa web (firma, emisor, audiencia y vencimiento): el `oid`
 * del usuario, su correo y su nombre. Finantia solo deja entrar a quien el
 * Superusuario haya registrado en el módulo de Administración.
 */
import { cargarActor } from './permisos.js';
import { registrar } from './bitacora.js';
import { falla, NO_AUTORIZADO } from '../errores.js';

/**
 * @param {object} claims  {oid, correo, nombre} del token verificado
 * @param {object} [op]    registrar: true deja el ingreso en la bitácora y actualiza la fecha de último ingreso
 *                         (se usa una vez al iniciar sesión; en cada petición basta identificar)
 */
export async function ingresar(db, { oid, correo, nombre }, { registrar: reg = true } = {}) {
  if (!oid) falla(NO_AUTORIZADO, 'Token sin identificador de usuario');
  const c = String(correo || '').trim().toLowerCase();
  const id = await db.tx(async t => {
    let u = (await t.query('SELECT id, correo, activo, entra_oid FROM usuario WHERE entra_oid = $1', [oid])).rows[0];
    if (!u) {
      u = (await t.query('SELECT id, correo, activo, entra_oid FROM usuario WHERE correo = $1 FOR UPDATE', [c])).rows[0];
      if (!u) falla(NO_AUTORIZADO, 'Este usuario no está registrado en Finantia');
      if (u.entra_oid && u.entra_oid !== oid) falla(NO_AUTORIZADO, 'El correo ya está vinculado a otra cuenta de Microsoft 365');
      await t.query('UPDATE usuario SET entra_oid = $2 WHERE id = $1', [u.id, oid]);
    }
    if (!u.activo) falla(NO_AUTORIZADO, 'Usuario desactivado');
    if (!reg) return Number(u.id);
    await t.query('UPDATE usuario SET ultimo_ingreso = now(), nombre = COALESCE(NULLIF($2, \'\'), nombre) WHERE id = $1', [u.id, nombre || '']);
    await registrar(t, { usuarioId: u.id, modulo: 'ADMINISTRACION', accion: 'INGRESO', entidad: 'usuario', entidadId: u.id });
    return Number(u.id);
  });
  return cargarActor(db, id);
}
