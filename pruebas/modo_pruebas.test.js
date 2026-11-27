/**
 * Sitio de pruebas: sin Microsoft 365 y con todo el sitio detrás de una clave.
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
let db, srv, base;
const basica = (u, c) => 'Basic ' + Buffer.from(`${u}:${c}`).toString('base64');
const pide = (ruta, h = {}) => fetch(base + ruta, { headers: h });

before(async () => {
  db = desdePGlite(new PGlite());
  await migrar(db);
  await sembrarDemo(db, { detalle: false });
  const auth = configurarAutenticacion({ FINANTIA_MODO_PRUEBAS: '1', FINANTIA_CLAVE_PRUEBAS: CLAVE, NODE_ENV: 'production' });
  srv = crearServidor(db, { auth, nomina: crearNomina({ env: {} }) });
  await new Promise(r => srv.listen(0, r));
  base = `http://localhost:${srv.address().port}`;
});
after(async () => { srv.close(); await db.cerrar(); });

test('exige una clave de 12 caracteres o más', () => {
  assert.throws(() => configurarAutenticacion({ FINANTIA_MODO_PRUEBAS: '1' }), /12 caracteres/);
  assert.throws(() => configurarAutenticacion({ FINANTIA_MODO_PRUEBAS: '1', FINANTIA_CLAVE_PRUEBAS: 'corta' }), /12 caracteres/);
});

test('sin la clave no se ve nada, ni las pantallas ni la configuración', async () => {
  for (const ruta of ['/', '/app.js', '/api/config']) {
    const r = await pide(ruta);
    assert.equal(r.status, 401, ruta);
    assert.match(r.headers.get('www-authenticate'), /^Basic realm="Finantia pruebas"/);
  }
  assert.equal((await pide('/', { Authorization: basica('x', 'otra-clave-cualquiera') })).status, 401);
  assert.equal((await pide('/', { Authorization: 'Basic %%%' })).status, 401);
});

test('con la clave entra en modo de desarrollo', async () => {
  const h = { Authorization: basica('ceipa', CLAVE) };
  assert.equal((await pide('/', h)).status, 200);
  assert.deepEqual(await (await pide('/api/config', h)).json(), { modo: 'desarrollo', pruebas: true });
  const yo = await pide('/api/yo', { ...h, 'X-Finantia': '1', 'X-Finantia-Correo': 'administracion@demo.finantia' });
  assert.equal(yo.status, 200);
});

test('el sitio de pruebas no lleva el auxiliar contable ni la evaluación', async () => {
  const fila = (await db.query('SELECT contenido FROM datos_base LIMIT 1')).rows[0];
  const c = typeof fila.contenido === 'string' ? JSON.parse(fila.contenido) : fila.contenido;
  assert.ok(c.L && !c.DD && !c.CCN && !c.CTN);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM evaluacion_equipo')).rows[0].n, 0);
});
