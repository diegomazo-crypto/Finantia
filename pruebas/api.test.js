/**
 * Servidor web y API: cabeceras, sesión, permisos por rol y el ciclo completo de una versión
 * por HTTP, como lo usan las pantallas. Corre sobre PGlite con los usuarios de `npm run demo`.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { desdePGlite, migrar } from '../servidor/db/conexion.js';
import { crearServidor } from '../servidor/web/servidor.js';
import { sembrarDemo } from '../servidor/web/demo.js';
import { leerJSON, TOL_COP } from './comun.js';

const REF = leerJSON('./referencias/excel_v21.json').escenarios;
const U = { su: 'superusuario@demo.finantia', adm: 'administracion@demo.finantia', apr: 'aprobacion@demo.finantia', con: 'consulta@demo.finantia' };
let db, srv, base;

async function pedir(metodo, ruta, { como, cuerpo, cabeceras = {}, sinX = false } = {}) {
  const h = { ...cabeceras };
  if (!sinX) h['X-Finantia'] = '1';
  if (como) h['X-Finantia-Correo'] = como;
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(base + ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, h: r.headers, datos: tipo.includes('json') ? await r.json() : await r.text() };
}
const ok = async (p, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.datos)); return r.datos; };

before(async () => {
  db = desdePGlite(new PGlite());
  await migrar(db);
  await sembrarDemo(db);
  srv = crearServidor(db, { auth: { modo: 'desarrollo' } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { await new Promise(r => srv.close(r)); await db.cerrar(); });

describe('Servidor', () => {
  test('sirve las pantallas con cabeceras de seguridad', async () => {
    const r = await pedir('GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.datos, /<title>Finantia<\/title>/);
    assert.match(r.h.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.h.get('x-frame-options') ?? 'DENY', 'DENY');
    assert.equal((await pedir('GET', '/presupuesto/algo')).status, 200, 'rutas sin extensión devuelven la aplicación');
    assert.equal((await pedir('GET', '/app.js')).status, 200);
  });

  test('no sirve archivos fuera de web/', async () => {
    for (const r of ['/..%2fpackage.json', '/%2e%2e/package.json', '/marca/../../package.json', '/%E0%A4%A']) {
      const x = await pedir('GET', r);
      assert.ok([400, 404].includes(x.status), `${r} → ${x.status}`);
      assert.doesNotMatch(typeof x.datos === 'string' ? x.datos : '', /"dependencies"/);
    }
  });

  test('configuración pública y sesión obligatoria', async () => {
    assert.deepEqual(await ok(pedir('GET', '/api/config')), { modo: 'desarrollo' });
    assert.equal((await pedir('GET', '/api/yo')).status, 401);
    assert.equal((await pedir('GET', '/api/yo', { como: U.adm, sinX: true })).status, 403, 'sin X-Finantia se rechaza');
    assert.equal((await pedir('GET', '/api/yo', { como: 'nadie@demo.finantia' })).status, 403);
    assert.equal((await pedir('GET', '/api/no-existe', { como: U.adm })).status, 404);
    assert.equal((await pedir('POST', '/api/presupuesto/versiones', { como: U.adm, cuerpo: undefined, cabeceras: { 'Content-Type': 'application/json' } })).status, 422);
  });

  test('el perfil dice qué puede hacer cada rol', async () => {
    const adm = await ok(pedir('POST', '/api/ingreso', { como: U.adm, cuerpo: {} }));
    assert.deepEqual(adm.modulos, [{ modulo: 'PRESUPUESTO', rol: 'ADMINISTRACION', ver: true, editar: true, aprobar: false, detalleSensible: false }]);
    assert.deepEqual(adm.admin, { ver: false, editar: false });
    const su = await ok(pedir('GET', '/api/yo', { como: U.su }));
    assert.equal(su.superusuario, true);
    assert.deepEqual(su.admin, { ver: true, editar: true });
    assert.equal(su.modulos.find(m => m.modulo === 'PRESUPUESTO').aprobar, false, 'el Superusuario no aprueba sin el rol de Aprobación');
    const con = await ok(pedir('GET', '/api/yo', { como: U.con }));
    assert.equal(con.modulos[0].editar, false);
  });
});

describe('Presupuesto por la API', () => {
  test('la versión de ejemplo cuadra con el Excel v21', async () => {
    const [e] = await ok(pedir('GET', '/api/presupuesto/ejercicios', { como: U.con }));
    assert.equal(e.anio, 2027);
    const [v] = await ok(pedir('GET', '/api/presupuesto/ejercicios/2027/versiones', { como: U.con }));
    const d = await ok(pedir('GET', `/api/presupuesto/versiones/${v.id}`, { como: U.con }));
    assert.equal(d.base.names.length, 7);
    assert.ok(d.porDefecto.Moderado.price > 0);
    for (const esc of ['Pesimista', 'Moderado', 'Optimista']) {
      assert.ok(Math.abs(d.resultados[esc].tot.EBITDA - REF[esc].rubros2027.EBITDA) < TOL_COP, `${esc} EBITDA`);
      assert.equal(d.resultados[esc].mensual.length, 12);
      assert.equal(d.resultados[esc].proyeccion.length, 6);
    }
  });

  test('consulta no edita ni administra', async () => {
    assert.equal((await pedir('PATCH', '/api/presupuesto/versiones/1/supuestos', { como: U.con, cuerpo: { params: { Moderado: { price: 0.07 } } } })).status, 403);
    assert.equal((await pedir('GET', '/api/admin/usuarios', { como: U.con })).status, 403);
    assert.equal((await pedir('POST', '/api/presupuesto/versiones/1/enviar', { como: U.con })).status, 403);
  });

  test('supuestos inválidos se rechazan', async () => {
    assert.equal((await pedir('PATCH', '/api/presupuesto/versiones/1/supuestos', { como: U.adm, cuerpo: { params: { Moderado: { precio: 0.07 } } } })).status, 422);
    assert.equal((await pedir('PATCH', '/api/presupuesto/versiones/1/supuestos', { como: U.adm, cuerpo: { params: { Moderado: { des: [1, 2] } } } })).status, 422);
  });

  test('ciclo completo: editar, enviar, devolver, reenviar, aprobar', async () => {
    const antes = (await ok(pedir('GET', '/api/presupuesto/versiones/1', { como: U.adm }))).resultados.Moderado.tot.IB;
    await ok(pedir('PATCH', '/api/presupuesto/versiones/1/supuestos', { como: U.adm, cuerpo: { params: { Moderado: { price: 0.07 } } } }));
    const v = await ok(pedir('GET', '/api/presupuesto/versiones/1', { como: U.adm }));
    assert.ok(v.resultados.Moderado.tot.IB > antes, 'más matrícula, más ingreso');
    assert.equal(v.supuestos.params.Moderado.price, 0.07);

    assert.equal((await pedir('POST', '/api/presupuesto/versiones/1/aprobar', { como: U.apr, cuerpo: {} })).status, 409, 'un borrador no se aprueba');
    await ok(pedir('POST', '/api/presupuesto/versiones/1/enviar', { como: U.adm }));
    assert.equal((await pedir('PATCH', '/api/presupuesto/versiones/1/supuestos', { como: U.adm, cuerpo: { params: { Moderado: { price: 0.08 } } } })).status, 409, 'en revisión no se edita');
    assert.equal((await pedir('POST', '/api/presupuesto/versiones/1/aprobar', { como: U.su, cuerpo: {} })).status, 403, 'Superusuario sin rol de Aprobación');
    assert.equal((await pedir('POST', '/api/presupuesto/versiones/1/devolver', { como: U.apr, cuerpo: { observaciones: '' } })).status, 422, 'devolver exige observaciones');
    await ok(pedir('POST', '/api/presupuesto/versiones/1/devolver', { como: U.apr, cuerpo: { observaciones: 'Revisar matrícula' } }));
    await ok(pedir('POST', '/api/presupuesto/versiones/1/enviar', { como: U.adm }));
    const r = await ok(pedir('POST', '/api/presupuesto/versiones/1/aprobar', { como: U.apr, cuerpo: { escenarioOficial: 'Moderado' } }));
    assert.equal(r.estado, 'APROBADA');

    const fin = await ok(pedir('GET', '/api/presupuesto/versiones/1', { como: U.con }));
    assert.equal(fin.estado, 'APROBADA');
    assert.equal(fin.ronda, 2);
    assert.deepEqual(fin.decisiones.map(d => d.decision), ['DEVOLVER', 'APROBAR']);
    const lineas = await ok(pedir('GET', '/api/presupuesto/versiones/1/lineas?mes=1', { como: U.con }));
    assert.ok(lineas.length > 0 && lineas.every(l => l.mes === 1));
    const hist = await ok(pedir('GET', '/api/presupuesto/versiones/1/bitacora', { como: U.con }));
    assert.ok(hist.some(h => h.accion === 'EDITAR_SUPUESTOS' && h.despues.params.Moderado.price === 0.07));
  });

  test('una copia de la versión aprobada arranca en borrador con sus supuestos', async () => {
    const { id } = await ok(pedir('POST', '/api/presupuesto/versiones', { como: U.adm, cuerpo: { ejercicio: 2027, nombre: 'Ajuste', copiaDe: 1 } }));
    const v = await ok(pedir('GET', `/api/presupuesto/versiones/${id}`, { como: U.adm }));
    assert.equal(v.estado, 'BORRADOR');
    assert.equal(v.supuestos.params.Moderado.price, 0.07);
  });
});

describe('Administración por la API', () => {
  test('quien envía no aprueba aunque tenga el rol', async () => {
    const yo = await ok(pedir('GET', '/api/yo', { como: U.apr }));
    await ok(pedir('PUT', `/api/admin/usuarios/${yo.id}/accesos/PRESUPUESTO`, { como: U.su, cuerpo: { rol: 'ADMINISTRACION' } }));
    const [, v2] = (await ok(pedir('GET', '/api/presupuesto/ejercicios/2027/versiones', { como: U.apr }))).sort((a, b) => a.id - b.id);
    await ok(pedir('POST', `/api/presupuesto/versiones/${v2.id}/enviar`, { como: U.apr }));
    await ok(pedir('PUT', `/api/admin/usuarios/${yo.id}/accesos/PRESUPUESTO`, { como: U.su, cuerpo: { rol: 'APROBACION' } }));
    assert.equal((await pedir('POST', `/api/presupuesto/versiones/${v2.id}/aprobar`, { como: U.apr, cuerpo: {} })).status, 403);
  });

  test('crear, asignar, desactivar y la bitácora lo registra', async () => {
    const { id } = await ok(pedir('POST', '/api/admin/usuarios', { como: U.su, cuerpo: { nombre: 'Nueva', correo: 'nueva@demo.finantia' } }));
    assert.equal((await pedir('POST', '/api/admin/usuarios', { como: U.su, cuerpo: { nombre: 'Nueva', correo: 'nueva@demo.finantia' } })).status, 409);
    await ok(pedir('PUT', `/api/admin/usuarios/${id}/accesos/PRESUPUESTO`, { como: U.su, cuerpo: { rol: 'VISUALIZACION', detalleSensible: true } }));
    let us = await ok(pedir('GET', '/api/admin/usuarios', { como: U.su }));
    assert.deepEqual(us.find(u => u.id === id).accesos, [{ modulo: 'PRESUPUESTO', rol: 'VISUALIZACION', detalle_sensible: true }]);
    assert.equal((await pedir('PUT', `/api/admin/usuarios/${id}/accesos/PRESUPUESTO`, { como: U.su, cuerpo: { rol: 'DUEÑO' } })).status, 422);
    await ok(pedir('PATCH', `/api/admin/usuarios/${id}`, { como: U.su, cuerpo: { activo: false } }));
    assert.equal((await pedir('GET', '/api/yo', { como: 'nueva@demo.finantia' })).status, 403, 'un usuario desactivado no entra');
    const bit = await ok(pedir('GET', `/api/admin/bitacora?usuario=${(await ok(pedir('GET', '/api/yo', { como: U.su }))).id}&modulo=ADMINISTRACION`, { como: U.su }));
    for (const a of ['CREAR_USUARIO', 'ASIGNAR_ACCESO', 'DESACTIVAR_USUARIO']) assert.ok(bit.some(b => b.accion === a), a);
  });

  test('configuración de aprobaciones', async () => {
    const us = await ok(pedir('GET', '/api/admin/usuarios', { como: U.su }));
    const apr = us.find(u => u.correo === U.apr).id;
    assert.equal((await pedir('PUT', '/api/admin/aprobacion/PRESUPUESTO', { como: U.su, cuerpo: { aprobacionesRequeridas: 6 } })).status, 422);
    assert.equal((await pedir('PUT', '/api/admin/aprobacion/PRESUPUESTO', { como: U.su, cuerpo: { aprobacionesRequeridas: 2, enOrden: true, aprobadores: [apr] } })).status, 422);
    await ok(pedir('PUT', '/api/admin/aprobacion/PRESUPUESTO', { como: U.su, cuerpo: { aprobacionesRequeridas: 1, enOrden: true, aprobadores: [apr] } }));
    const c = await ok(pedir('GET', '/api/admin/aprobacion/PRESUPUESTO', { como: U.su }));
    assert.deepEqual([c.aprobaciones_requeridas, c.en_orden, c.aprobadores], [1, true, [apr]]);
  });
});

describe('Ingreso con Microsoft 365', () => {
  test('verifica el token y vincula la cuenta por correo', async () => {
    const auth = { modo: 'entra', tenant: 't', clientId: 'c', async verificar(tk) { if (tk !== 'valido') throw new Error('firma'); return { oid: 'oid-1', correo: 'Consulta@demo.finantia', nombre: 'Consulta' }; } };
    const s2 = crearServidor(db, { auth });
    await new Promise(r => s2.listen(0, '127.0.0.1', r));
    const b2 = `http://127.0.0.1:${s2.address().port}`;
    try {
      const f = (tk, ruta = '/api/ingreso', m = 'POST') => fetch(b2 + ruta, { method: m, headers: { 'X-Finantia': '1', ...(tk ? { Authorization: 'Bearer ' + tk } : {}) } });
      assert.deepEqual(await (await f(null, '/api/config', 'GET')).json(), { modo: 'entra', tenant: 't', clientId: 'c' });
      assert.equal((await f(null)).status, 401);
      assert.equal((await f('falso')).status, 401);
      const r = await f('valido'); assert.equal(r.status, 200);
      assert.equal((await r.json()).correo, U.con);
      assert.equal((await fetch(b2 + '/api/desarrollo/usuarios')).status, 404, 'sin modo de desarrollo no se listan usuarios');
      const h = await fetch(b2 + '/api/yo', { headers: { 'X-Finantia': '1', 'X-Finantia-Correo': U.su } });
      assert.equal(h.status, 401, 'la cabecera de desarrollo no sirve en producción');
    } finally { await new Promise(r => s2.close(r)); }
  });
});
