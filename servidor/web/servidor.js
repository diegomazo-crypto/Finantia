/**
 * Servidor web de Finantia 2.0: API JSON bajo /api y pantallas estáticas (carpeta web/).
 * Sin framework: node:http con un enrutador mínimo.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorFinantia } from '../errores.js';
import { configurarAutenticacion, identificar } from './autenticacion.js';
import { rutasApi } from './api.js';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const HTTP = { SIN_SESION: 401, NO_AUTORIZADO: 403, NO_ENCONTRADO: 404, ESTADO_INVALIDO: 409, DATOS_INVALIDOS: 422 };

function cabecerasSeguridad(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self' https://alcdn.msauth.net", "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self' https://login.microsoftonline.com",
    "frame-src https://login.microsoftonline.com", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"
  ].join('; '));
}

const json = (res, codigo, cuerpo) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(cuerpo));
};

async function leerCuerpo(req, limite = 2 * 1024 * 1024) {
  const partes = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limite) throw new ErrorFinantia('DATOS_INVALIDOS', 'Cuerpo demasiado grande'); partes.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { throw new ErrorFinantia('DATOS_INVALIDOS', 'JSON inválido'); }
}

async function estatico(req, res) {
  const url = new URL(req.url, 'http://x');
  let ruta;
  try { ruta = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Ruta inválida' }); }
  if (ruta === '/' || !extname(ruta)) ruta = '/index.html';
  const archivo = normalize(join(WEB, ruta));
  if (!archivo.startsWith(WEB)) return json(res, 404, { error: 'No encontrado' });
  try {
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream', 'Cache-Control': ruta === '/index.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(cuerpo);
  } catch { json(res, 404, { error: 'No encontrado' }); }
}

/**
 * @param {object} db    conexión (servidor/db/conexion.js)
 * @param {object} [op]  { auth } configuración de autenticación (por defecto, desde el entorno)
 */
export function crearServidor(db, { auth = configurarAutenticacion() } = {}) {
  const rutas = rutasApi(db, auth);
  return createServer(async (req, res) => {
    cabecerasSeguridad(res);
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método no permitido' });
      return estatico(req, res);
    }
    try {
      for (const r of rutas) {
        if (r.metodo !== req.method) continue;
        const m = url.pathname.match(r.patron);
        if (!m) continue;
        const ctx = { params: m.groups || {}, query: Object.fromEntries(url.searchParams), body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await leerCuerpo(req) : {} };
        if (r.publica) return json(res, 200, await r.fn(ctx));
        if (req.headers['x-finantia'] !== '1') return json(res, 403, { error: 'Falta la cabecera X-Finantia', codigo: 'NO_AUTORIZADO' }); /* frena peticiones de otros sitios */
        ctx.actor = await identificar(db, auth, req, { registrar: r.registrarIngreso });
        const out = await r.fn(ctx);
        return json(res, 200, out ?? { ok: true });
      }
      json(res, 404, { error: 'Ruta no encontrada' });
    } catch (e) {
      if (e instanceof ErrorFinantia) return json(res, HTTP[e.codigo] || 400, { error: e.message, codigo: e.codigo });
      console.error(e);
      json(res, 500, { error: 'Error interno' });
    }
  });
}
