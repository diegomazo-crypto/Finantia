/**
 * Ingreso al sitio de pruebas (sin Microsoft 365).
 *
 * Cada persona entra con su correo y su clave personal, que el Superusuario genera en
 * Administración › Usuarios (se muestra una sola vez; se guarda solo su resumen scrypt). La clave
 * maestra FINANTIA_CLAVE_PRUEBAS sigue sirviendo, pero solo para cuentas de Superusuario (para
 * arrancar y para recuperar el acceso).
 *
 *  - Bloqueo: 5 intentos fallidos en 15 minutos desde una misma dirección, o contra un mismo correo,
 *    bloquean 15 minutos.
 *  - Sesión: cookie HttpOnly, SameSite=Strict (Secure detrás de HTTPS). Se cierra tras
 *    FINANTIA_INACTIVIDAD_MIN minutos sin actividad (30 por defecto) y a las 12 horas en todo caso.
 *  - Las sesiones viven en memoria: al reiniciar el servidor hay que volver a entrar.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { registrar as registrarBitacora } from '../admin/bitacora.js';
import { falla, NO_AUTORIZADO, SIN_SESION, DATOS_INVALIDOS, NO_ENCONTRADO } from '../errores.js';

const COOKIE = 'finantia_sesion';
const INTENTOS = 5, VENTANA = 15 * 60e3, BLOQUEO = 15 * 60e3, MAXIMA = 12 * 3600e3;

export function crearPruebas(clave, env = process.env) {
  return {
    clave, sesiones: new Map(), fallos: new Map(),
    inactividad: Math.max(1, Number(env.FINANTIA_INACTIVIDAD_MIN) || 30) * 60e3,
    ahora: () => Date.now()
  };
}

const resumen = t => createHash('sha256').update(String(t)).digest();
const iguales = (a, b) => timingSafeEqual(resumen(a), resumen(b));
export const resumirClave = (clave, sal = randomBytes(16).toString('hex')) => ({ sal, resumen: scryptSync(String(clave), sal, 32).toString('hex') });
const claveValida = (clave, { sal, resumen: r }) => timingSafeEqual(scryptSync(String(clave), sal, 32), Buffer.from(r, 'hex'));

/** Dirección de quien llama (Render y otros proxys ponen la original en X-Forwarded-For). */
export const direccion = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '?';

function bloqueado(p, k) {
  const f = p.fallos.get(k);
  return f && f.hasta && f.hasta > p.ahora() ? Math.ceil((f.hasta - p.ahora()) / 60e3) : 0;
}
function anotarFallo(p, k) {
  const t = p.ahora(), f = p.fallos.get(k) || { n: 0, desde: t, hasta: 0 };
  if (t - f.desde > VENTANA) { f.n = 0; f.desde = t; }
  if (++f.n >= INTENTOS) { f.hasta = t + BLOQUEO; f.n = 0; f.desde = t; }
  p.fallos.set(k, f);
  if (p.fallos.size > 10000) for (const [kk, v] of p.fallos) if (!v.hasta || v.hasta < t) p.fallos.delete(kk);
}

/** Valida correo y clave; devuelve { token, usuarioId } o lanza. */
export async function ingresarPruebas(db, p, req, { correo, clave }) {
  const ip = direccion(req), c = String(correo || '').trim().toLowerCase(), k = String(clave || '');
  const min = Math.max(bloqueado(p, 'ip:' + ip), c ? bloqueado(p, 'c:' + c) : 0);
  if (min) falla(NO_AUTORIZADO, `Demasiados intentos fallidos. Espere ${min} minuto${min === 1 ? '' : 's'} y vuelva a intentarlo.`);
  if (!k) falla(DATOS_INVALIDOS, 'Escriba su clave');
  let u = null;
  if (c) {
    u = (await db.query(`SELECT u.id, u.activo, u.es_superusuario, k.sal, k.resumen FROM usuario u LEFT JOIN clave_pruebas k ON k.usuario_id = u.id WHERE u.correo = $1`, [c])).rows[0] || null;
    const ok = u && u.activo && ((u.resumen && claveValida(k, u)) || (u.es_superusuario && iguales(k, p.clave)));
    if (!ok) u = null;
  } else if (iguales(k, p.clave)) {
    /* clave maestra sin correo: el primer Superusuario activo */
    u = (await db.query('SELECT id FROM usuario WHERE es_superusuario AND activo ORDER BY id LIMIT 1')).rows[0] || null;
  }
  if (!u) {
    anotarFallo(p, 'ip:' + ip); if (c) anotarFallo(p, 'c:' + c);
    console.warn(`Sitio de pruebas: ingreso fallido${c ? ' de ' + c : ''} desde ${ip}`);
    falla(NO_AUTORIZADO, 'Correo o clave incorrectos');
  }
  p.fallos.delete('ip:' + ip); if (c) p.fallos.delete('c:' + c);
  const token = randomBytes(32).toString('base64url'), t = p.ahora();
  p.sesiones.set(token, { usuarioId: Number(u.id), creada: t, ultimo: t });
  await registrarBitacora(db, { usuarioId: u.id, modulo: 'ADMINISTRACION', accion: 'INGRESO', entidad: 'usuario', entidadId: u.id, detalle: `sitio de pruebas desde ${ip}` });
  await db.query('UPDATE usuario SET ultimo_ingreso = now() WHERE id = $1', [u.id]);
  return { token, usuarioId: Number(u.id) };
}

export function leerCookie(req) {
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('='); if (i < 0) continue;
    if (parte.slice(0, i).trim() === COOKIE) return parte.slice(i + 1).trim();
  }
  return null;
}

/** Sesión vigente de la petición (y la renueva) o null. */
export function sesionDe(p, req) {
  const token = leerCookie(req); if (!token) return null;
  const s = p.sesiones.get(token), t = p.ahora();
  if (!s) return null;
  if (t - s.ultimo > p.inactividad || t - s.creada > MAXIMA) { p.sesiones.delete(token); return null; }
  s.ultimo = t;
  return { token, ...s };
}

export const cookieSesion = (req, token) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${esHttps(req) ? '; Secure' : ''}`;
export const cookieBorrar = req => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${esHttps(req) ? '; Secure' : ''}`;
export const esHttps = req => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket?.encrypted;

export function cerrarSesion(p, req) { const t = leerCookie(req); if (t) p.sesiones.delete(t); }
export function cerrarSesionesDe(p, usuarioId) { for (const [t, s] of p.sesiones) if (s.usuarioId === usuarioId) p.sesiones.delete(t); }

/* ------------------------------------------------------------------ claves personales (Administración) */
const LETRAS = 'abcdefghijkmnpqrstuvwxyz23456789';
const nuevaClave = () => { const b = randomBytes(20); return Array.from({ length: 4 }, (_, g) => Array.from({ length: 5 }, (_, i) => LETRAS[b[g * 5 + i] % LETRAS.length]).join('')).join('-'); };

const soloSuper = actor => { if (!actor.es_superusuario) falla(NO_AUTORIZADO, 'Solo el Superusuario administra las claves del sitio de pruebas'); };

export async function listarClaves(db, actor) {
  soloSuper(actor);
  return (await db.query('SELECT usuario_id, creada_en FROM clave_pruebas')).rows.map(r => ({ usuarioId: Number(r.usuario_id), creadaEn: r.creada_en }));
}

/** Genera (o reemplaza) la clave personal de un usuario. Devuelve la clave en claro una sola vez. */
export async function generarClave(db, p, actor, usuarioId) {
  soloSuper(actor);
  const u = (await db.query('SELECT id, correo FROM usuario WHERE id = $1', [usuarioId])).rows[0];
  if (!u) falla(NO_ENCONTRADO, 'Usuario no encontrado');
  const clave = nuevaClave(), { sal, resumen: r } = resumirClave(clave);
  await db.tx(async t => {
    await t.query(`INSERT INTO clave_pruebas (usuario_id, resumen, sal, creada_por) VALUES ($1, $2, $3, $4)
      ON CONFLICT (usuario_id) DO UPDATE SET resumen = EXCLUDED.resumen, sal = EXCLUDED.sal, creada_por = EXCLUDED.creada_por, creada_en = now()`, [usuarioId, r, sal, actor.id]);
    await registrarBitacora(t, { usuarioId: actor.id, modulo: 'ADMINISTRACION', accion: 'GENERAR_CLAVE_PRUEBAS', entidad: 'usuario', entidadId: usuarioId, detalle: u.correo });
  });
  cerrarSesionesDe(p, Number(usuarioId));
  return { correo: u.correo, clave };
}

export async function quitarClave(db, p, actor, usuarioId) {
  soloSuper(actor);
  await db.tx(async t => {
    const r = (await t.query('DELETE FROM clave_pruebas WHERE usuario_id = $1 RETURNING usuario_id', [usuarioId])).rows[0];
    if (!r) falla(NO_ENCONTRADO, 'Ese usuario no tiene clave del sitio');
    await registrarBitacora(t, { usuarioId: actor.id, modulo: 'ADMINISTRACION', accion: 'QUITAR_CLAVE_PRUEBAS', entidad: 'usuario', entidadId: usuarioId });
  });
  cerrarSesionesDe(p, Number(usuarioId));
}

export { SIN_SESION };
