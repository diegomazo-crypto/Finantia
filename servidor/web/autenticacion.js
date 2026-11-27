/**
 * Identidad de quien hace cada petición.
 *
 * - Modo "entra" (producción): el navegador inicia sesión con Microsoft 365 (MSAL) y envía
 *   el token de identidad en `Authorization: Bearer`. Aquí se verifica la firma con las
 *   llaves públicas del inquilino de CEIPA, el emisor, la audiencia y el vencimiento.
 * - Modo "desarrollo": sin Microsoft 365; el navegador elige un usuario registrado y lo envía
 *   en `X-Finantia-Correo`. Solo se activa con FINANTIA_MODO_DESARROLLO=1 y nunca con
 *   NODE_ENV=production.
 * - Modo "pruebas": el de desarrollo, pero para un servidor de pruebas en internet. Se activa con
 *   FINANTIA_MODO_PRUEBAS=1 y exige FINANTIA_CLAVE_PRUEBAS (12 caracteres o más): todo el sitio,
 *   pantallas incluidas, queda detrás de esa clave (autenticación básica HTTP). Sí se permite
 *   con NODE_ENV=production.
 */
import { timingSafeEqual, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ingresar } from '../admin/identidad.js';
import { cargarActor } from '../admin/permisos.js';
import { registrar as registrarBitacora } from '../admin/bitacora.js';
import { falla, NO_AUTORIZADO, SIN_SESION } from '../errores.js';

export function configurarAutenticacion(env = process.env) {
  if (env.FINANTIA_MODO_PRUEBAS === '1') {
    const clave = String(env.FINANTIA_CLAVE_PRUEBAS || '');
    if (clave.length < 12) throw new Error('El modo de pruebas exige FINANTIA_CLAVE_PRUEBAS de 12 caracteres o más');
    return { modo: 'desarrollo', pruebas: true, clave };
  }
  const dev = env.FINANTIA_MODO_DESARROLLO === '1';
  if (dev && env.NODE_ENV === 'production') throw new Error('El modo de desarrollo no se permite con NODE_ENV=production');
  if (dev) return { modo: 'desarrollo' };
  const tenant = env.ENTRA_TENANT_ID, clientId = env.ENTRA_CLIENT_ID;
  if (!tenant || !clientId) throw new Error('Faltan ENTRA_TENANT_ID y ENTRA_CLIENT_ID (o FINANTIA_MODO_DESARROLLO=1 para pruebas locales)');
  const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`));
  return {
    modo: 'entra', tenant, clientId,
    async verificar(token) {
      const { payload } = await jwtVerify(token, jwks, { issuer: `https://login.microsoftonline.com/${tenant}/v2.0`, audience: clientId });
      return { oid: payload.oid, correo: payload.preferred_username || payload.email || payload.upn, nombre: payload.name };
    }
  };
}

/** Devuelve el actor de la petición o lanza NO_AUTORIZADO. `registrar` deja constancia del inicio de sesión. */
export async function identificar(db, auth, req, { registrar = false } = {}) {
  if (auth.modo === 'desarrollo') {
    const correo = String(req.headers['x-finantia-correo'] || '').trim().toLowerCase();
    if (!correo) falla(SIN_SESION, 'Sin sesión');
    const u = (await db.query('SELECT id, activo FROM usuario WHERE correo = $1', [correo])).rows[0];
    if (!u) falla(NO_AUTORIZADO, 'Este usuario no está registrado en Finantia');
    if (!u.activo) falla(NO_AUTORIZADO, 'Usuario desactivado');
    if (registrar) await db.query('UPDATE usuario SET ultimo_ingreso = now() WHERE id = $1', [u.id]);
    if (registrar) await registrarBitacora(db, { usuarioId: u.id, modulo: 'ADMINISTRACION', accion: 'INGRESO', entidad: 'usuario', entidadId: u.id, detalle: 'modo de desarrollo' });
    return cargarActor(db, u.id);
  }
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) falla(SIN_SESION, 'Sin sesión');
  let claims;
  try { claims = await auth.verificar(h.slice(7)); } catch { falla(SIN_SESION, 'Sesión inválida o vencida'); }
  return ingresar(db, claims, { registrar });
}


const resumen = t => createHash('sha256').update(String(t)).digest();

/** Modo de pruebas: ¿la petición trae la clave del sitio? (autenticación básica; el usuario puede ser cualquiera). */
export function claveCorrecta(auth, req) {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Basic ')) return false;
  let txt;
  try { txt = Buffer.from(h.slice(6), 'base64').toString('utf8'); } catch { return false; }
  const i = txt.indexOf(':');
  return i >= 0 && timingSafeEqual(resumen(txt.slice(i + 1)), resumen(auth.clave));
}
