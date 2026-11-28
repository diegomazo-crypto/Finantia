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
import { ingresarPruebas, sesionDe, cookieSesion, cookieBorrar, cerrarSesion, esHttps } from './pruebas.js';
import { rutasApi } from './api.js';
import { crearAsistente } from '../presupuesto/asistente.js';
import { crearNomina } from '../presupuesto/nomina.js';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const MOTOR = fileURLToPath(new URL('../../motor/', import.meta.url)); /* el navegador usa el mismo motor de cálculo */
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const HTTP = { SIN_SESION: 401, NO_AUTORIZADO: 403, NO_ENCONTRADO: 404, ESTADO_INVALIDO: 409, DATOS_INVALIDOS: 422, NO_DISPONIBLE: 503 };

function cabecerasSeguridad(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); /* fuera de los buscadores */
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (esHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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

async function leerCrudo(req, limite) {
  const partes = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limite) throw new ErrorFinantia('DATOS_INVALIDOS', 'El archivo supera el tamaño permitido'); partes.push(c); }
  return Buffer.concat(partes);
}

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
  let raiz = WEB;
  if (ruta.startsWith('/motor/')) { raiz = MOTOR; ruta = ruta.slice('/motor'.length); if (extname(ruta) !== '.js') return json(res, 404, { error: 'No encontrado' }); }
  else if (ruta === '/' || !extname(ruta)) ruta = '/index.html';
  const archivo = normalize(join(raiz, ruta));
  if (!archivo.startsWith(raiz)) return json(res, 404, { error: 'No encontrado' });
  try {
    const cuerpo = await readFile(archivo);
    res.writeHead(200, { 'Content-Type': TIPOS[extname(archivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(cuerpo);
  } catch { json(res, 404, { error: 'No encontrado' }); }
}

/**
 * @param {object} db    conexión (servidor/db/conexion.js)
 * @param {object} [op]  { auth, asistente, nomina } (por defecto, configurados desde el entorno)
 */
export function crearServidor(db, { auth = configurarAutenticacion(), asistente = crearAsistente(), nomina = crearNomina() } = {}) {
  const rutas = rutasApi(db, auth, asistente, nomina);
  return createServer(async (req, res) => {
    cabecerasSeguridad(req, res);
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('User-agent: *\nDisallow: /\n'); }
    if (auth.modo === 'pruebas') {
      const p = auth.pruebas;
      if (url.pathname === '/api/pruebas/ingreso' && req.method === 'POST') {
        if (req.headers['x-finantia'] !== '1') return json(res, 403, { error: 'Falta la cabecera X-Finantia', codigo: 'NO_AUTORIZADO' });
        try {
          const { token } = await ingresarPruebas(db, p, req, await leerCuerpo(req, 4096));
          res.setHeader('Set-Cookie', cookieSesion(req, token));
          return json(res, 200, { ok: true });
        } catch (e) {
          if (e instanceof ErrorFinantia) return json(res, e.codigo === 'NO_AUTORIZADO' ? 401 : HTTP[e.codigo] || 400, { error: e.message, codigo: e.codigo });
          console.error(e); return json(res, 500, { error: 'Error interno' });
        }
      }
      if (url.pathname === '/api/pruebas/salir' && req.method === 'POST') {
        cerrarSesion(p, req); res.setHeader('Set-Cookie', cookieBorrar(req)); return json(res, 200, { ok: true });
      }
      /* Sin sesión: solo la página de ingreso y lo que ella usa */
      if (!url.pathname.startsWith('/api/') && !sesionDe(p, req)) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método no permitido' });
        if (['/estilos.css', '/ingreso-pruebas.js', '/marca/finantia.png'].includes(url.pathname)) return estatico(req, res);
        try {
          const html = await readFile(join(WEB, 'ingreso-pruebas.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(html);
        } catch { return json(res, 500, { error: 'Error interno' }); }
      }
    }
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método no permitido' });
      return estatico(req, res);
    }
    try {
      for (const r of rutas) {
        if (r.metodo !== req.method) continue;
        const m = url.pathname.match(r.patron);
        if (!m) continue;
        const ctx = { params: m.groups || {}, query: Object.fromEntries(url.searchParams), headers: req.headers };
        if (r.publica) return json(res, 200, await r.fn(ctx));
        if (req.headers['x-finantia'] !== '1') return json(res, 403, { error: 'Falta la cabecera X-Finantia', codigo: 'NO_AUTORIZADO' }); /* frena peticiones de otros sitios */
        ctx.actor = await identificar(db, auth, req, { registrar: r.registrarIngreso });
        ctx.body = !['POST', 'PUT', 'PATCH'].includes(req.method) ? {} : r.crudo ? await leerCrudo(req, r.crudo) : await leerCuerpo(req);
        const out = await r.fn(ctx);
        if (out && out.descarga) {
          const { nombre, contenido } = out.descarga;
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream', 'Content-Length': contenido.length, 'Cache-Control': 'no-store',
            'Content-Disposition': `attachment; filename="${nombre.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`
          });
          return res.end(contenido);
        }
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
