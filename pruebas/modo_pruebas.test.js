/**
 * Sitio de pruebas: sin Microsoft 365. Cada persona entra con correo y clave personal; sin sesión
 * solo se ve la página de ingreso. Bloqueo por intentos fallidos, cierre por inactividad y
 * cabeceras de seguridad.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { desdePGlite, migrar } from '../servidor/db/conexion.js';
import { configurarAutenticacion } from '../servidor/web/autenticacion.js';
import { crearServidor } from '../servidor/web/servidor.js';
import { crearNomina } from '../servidor/presupuesto/nomina.js';
import { sembrarDemo } from '../servidor/web/demo.js';

const CLAVE = 'clave-de-prueba-larga';
let db, srv, base, auth;
const J = { 'Content-Type': 'application/json', 'X-Finantia': '1' };
const pide = (ruta, h = {}, op = {}) => fetch(base + ruta, { headers: h, redirect: 'manual', ...op });
const ingresar = (correo, clave, ip = '10.0.0.1') => pide('/api/pruebas/ingreso', { ...J, 'X-Forwarded-For': ip }, { method: 'POST', body: JSON.stringify({ correo, clave }) });
const cookie = r => (r.headers.get('set-cookie') || '').split(';')[0];

before(async () => {
  db = desdePGlite(new PGlite());
  await migrar(db);
  await sembrarDemo(db, { detalle: false });
  auth = configurarAutenticacion({ FINANTIA_MODO_PRUEBAS: '1', FINANTIA_CLAVE_PRUEBAS: CLAVE, NODE_ENV: 'production', FINANTIA_INACTIVIDAD_MIN: '30' });
  srv = crearServidor(db, { auth, nomina: crearNomina({ env: {} }) });
  await new Promise(r => srv.listen(0, r));
  base = `http://localhost:${srv.address().port}`;
});
after(async () => { srv.close(); await db.cerrar(); });

test('exige una clave maestra de 12 caracteres o más', () => {
  assert.throws(() => configurarAutenticacion({ FINANTIA_MODO_PRUEBAS: '1' }), /12 caracteres/);
  assert.throws(() => configurarAutenticacion({ FINANTIA_MODO_PRUEBAS: '1', FINANTIA_CLAVE_PRUEBAS: 'corta' }), /12 caracteres/);
});

test('sin sesión solo se ve la página de ingreso', async () => {
  for (const ruta of ['/', '/app.js', '/motor/index.js', '/ejecucion/2026']) {
    const r = await pide(ruta), t = await r.text();
    assert.match(t, /id="f"/, ruta); assert.doesNotMatch(t, /import /, ruta);
  }
  assert.equal((await pide('/estilos.css')).status, 200);
  assert.equal((await pide('/api/yo', { 'X-Finantia': '1' })).status, 401);
  assert.equal((await pide('/api/desarrollo/usuarios')).status, 404, 'no lista usuarios');
  assert.deepEqual(await (await pide('/api/config')).json(), { modo: 'pruebas' });
});

test('cabeceras de seguridad y fuera de buscadores', async () => {
  const r = await pide('/', { 'X-Forwarded-Proto': 'https' });
  assert.match(r.headers.get('x-robots-tag'), /noindex/);
  assert.match(r.headers.get('strict-transport-security'), /max-age/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(await (await pide('/robots.txt')).text(), /Disallow: \//);
});

test('la clave maestra solo sirve para el superusuario; la sesión va en cookie y no se puede suplantar', async () => {
  assert.equal((await ingresar('administracion@demo.finantia', CLAVE)).status, 401);
  const r = await ingresar('superusuario@demo.finantia', CLAVE);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const c = cookie(r);
  const yo = await (await pide('/api/yo', { 'X-Finantia': '1', Cookie: c, 'X-Finantia-Correo': 'administracion@demo.finantia' })).json();
  assert.equal(yo.correo, 'superusuario@demo.finantia', 'la cabecera de correo no cambia quién es');
  assert.equal((await pide('/', { Cookie: c })).status, 200);
  assert.match(await (await pide('/', { Cookie: c })).text(), /app\.js/);
  /* salir cierra la sesión */
  await pide('/api/pruebas/salir', { ...J, Cookie: c }, { method: 'POST' });
  assert.equal((await pide('/api/yo', { 'X-Finantia': '1', Cookie: c })).status, 401);
});

test('claves personales generadas por el superusuario', async () => {
  const su = cookie(await ingresar('superusuario@demo.finantia', CLAVE));
  const adm = (await db.query("SELECT id FROM usuario WHERE correo = 'administracion@demo.finantia'")).rows[0].id;
  const g = await (await pide(`/api/admin/usuarios/${adm}/clave-pruebas`, { ...J, Cookie: su }, { method: 'POST' })).json();
  assert.match(g.clave, /^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
  const fila = (await db.query('SELECT resumen FROM clave_pruebas WHERE usuario_id = $1', [adm])).rows[0];
  assert.ok(!fila.resumen.includes(g.clave), 'solo se guarda el resumen');
  const r = await ingresar('Administracion@demo.finantia', g.clave);
  assert.equal(r.status, 200);
  const c = cookie(r);
  assert.equal((await (await pide('/api/yo', { 'X-Finantia': '1', Cookie: c })).json()).correo, 'administracion@demo.finantia');
  assert.equal((await ingresar('consulta@demo.finantia', g.clave)).status, 401, 'la clave es solo de su dueño');
  /* el no superusuario no administra claves */
  assert.equal((await pide(`/api/admin/usuarios/${adm}/clave-pruebas`, { ...J, Cookie: c }, { method: 'POST' })).status, 403);
  /* quitar la clave cierra sus sesiones */
  await pide(`/api/admin/usuarios/${adm}/clave-pruebas`, { ...J, Cookie: su }, { method: 'DELETE' });
  assert.equal((await pide('/api/yo', { 'X-Finantia': '1', Cookie: c })).status, 401);
  assert.equal((await ingresar('administracion@demo.finantia', g.clave, '10.0.0.9')).status, 401);
});

test('5 intentos fallidos bloquean 15 minutos', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await ingresar('superusuario@demo.finantia', 'mala-clave-xxxx', '10.0.0.5')).status, 401);
  const r = await ingresar('superusuario@demo.finantia', CLAVE, '10.0.0.5');
  assert.equal(r.status, 401); assert.match((await r.json()).error, /Demasiados intentos/);
  const otra = await ingresar('superusuario@demo.finantia', CLAVE, '10.0.0.6');
  assert.equal(otra.status, 401, 'el correo también queda bloqueado');
  auth.pruebas.fallos.clear();
  assert.equal((await ingresar('superusuario@demo.finantia', CLAVE, '10.0.0.6')).status, 200);
});

test('la sesión se cierra por inactividad', async () => {
  const c = cookie(await ingresar('superusuario@demo.finantia', CLAVE, '10.0.0.7'));
  assert.equal((await pide('/api/yo', { 'X-Finantia': '1', Cookie: c })).status, 200);
  const real = auth.pruebas.ahora;
  auth.pruebas.ahora = () => real() + 31 * 60e3;
  try { assert.equal((await pide('/api/yo', { 'X-Finantia': '1', Cookie: c })).status, 401); }
  finally { auth.pruebas.ahora = real; }
});

test('el sitio de pruebas no lleva el auxiliar contable ni la evaluación', async () => {
  const fila = (await db.query('SELECT contenido FROM datos_base LIMIT 1')).rows[0];
  const c = typeof fila.contenido === 'string' ? JSON.parse(fila.contenido) : fila.contenido;
  assert.ok(c.L && !c.DD && !c.CCN && !c.CTN);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM evaluacion_equipo')).rows[0].n, 0);
});
