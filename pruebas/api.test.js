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
    assert.deepEqual(adm.modulos.find(m => m.modulo === 'PRESUPUESTO'), { modulo: 'PRESUPUESTO', rol: 'ADMINISTRACION', ver: true, editar: true, aprobar: false, detalleSensible: true });
    assert.deepEqual(adm.modulos.find(m => m.modulo === 'PLANEACION'), { modulo: 'PLANEACION', rol: 'ADMINISTRACION', ver: true, editar: true, aprobar: false, detalleSensible: false });
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

describe('Motor en el navegador y datos base', () => {
  test('sirve el motor y los datos base; el navegador calcula lo mismo que el servidor', async () => {
    const js = await pedir('GET', '/motor/index.js');
    assert.equal(js.status, 200);
    assert.match(js.h.get('content-type'), /javascript/);
    assert.equal((await pedir('GET', '/motor/../package.json')).status, 404);
    assert.equal((await pedir('GET', '/motor/parametros.txt')).status, 404);
    const v = await ok(pedir('GET', '/api/presupuesto/versiones/1', { como: U.con }));
    const datos = await ok(pedir('GET', `/api/presupuesto/datos-base/${v.datos_base_id}`, { como: U.con }));
    const { crearModelo } = await import('../motor/index.js');
    const m = crearModelo(datos, v.supuestos);
    for (const e of ['Pesimista', 'Moderado', 'Optimista']) assert.ok(Math.abs(m.run(m.params[e]).tot.RN - v.resultados[e].tot.RN) < 1, e);
    assert.equal((await pedir('GET', `/api/presupuesto/datos-base/${v.datos_base_id}`)).status, 401);
    // El reparto por centro de costos y cuenta solo llega a quien ve el detalle sensible
    assert.equal(datos.DD, undefined); assert.equal(datos.CCN, undefined); assert.equal(datos.CTN, undefined);
    const conAux = await ok(pedir('GET', `/api/presupuesto/datos-base/${v.datos_base_id}`, { como: U.adm }));
    assert.ok(conAux.DD && conAux.CCN.length && conAux.CTN.length);
  });

  test('planeación financiera: flujo de caja de la versión del presupuesto, solo con acceso al módulo', async () => {
    const d = await ok(pedir('GET', '/api/planeacion/flujo', { como: U.con }));
    assert.equal(d.ejercicio, 2027);
    assert.ok(d.versiones.length >= 1 && d.version);
    for (const e of ['Pesimista', 'Moderado', 'Optimista']) {
      const r = d.version.resultados[e];
      assert.equal(r.mensual.length, 12); assert.equal(r.caja.meses.length, 12);
      assert.ok(['REC', 'NOM', 'PRI', 'CES', 'PROV', 'CAP', 'SF'].every(k => k in r.caja.meses[0]));
      assert.equal(r.supuestos, undefined);
    }
    assert.equal(d.version.supuestos, undefined);
    const v1 = d.versiones[0].id;
    assert.equal((await ok(pedir('GET', `/api/planeacion/flujo?ejercicio=2027&version=${v1}`, { como: U.con }))).version.id, v1);
    assert.equal((await pedir('GET', '/api/planeacion/flujo?ejercicio=2031', { como: U.con })).status, 404);
    assert.equal((await pedir('GET', '/api/planeacion/flujo')).status, 401);
    const yo = await ok(pedir('GET', '/api/yo', { como: U.con }));
    assert.ok(yo.modulos.some(m => m.modulo === 'PLANEACION'));
    // sin acceso a Planeación: 403
    const su = await ok(pedir('GET', '/api/admin/usuarios', { como: U.su }));
    const con = su.find(u => u.correo === U.con);
    await ok(pedir('DELETE', `/api/admin/usuarios/${con.id}/accesos/PLANEACION`, { como: U.su }));
    assert.equal((await pedir('GET', '/api/planeacion/flujo', { como: U.con })).status, 403);
    await ok(pedir('PUT', `/api/admin/usuarios/${con.id}/accesos/PLANEACION`, { como: U.su, cuerpo: { rol: 'VISUALIZACION' } }));
  });

  test('planeación financiera: proforma a 5 años, VPN por escenario, sensibilidad y supuestos editables', async () => {
    const d = await ok(pedir('GET', '/api/planeacion/proforma?escenario=Moderado', { como: U.con }));
    assert.equal(d.ejercicio, 2027); assert.equal(d.escenario, 'Moderado');
    assert.equal(d.supuestos.tasa, 0.12);
    const v = await ok(pedir('GET', `/api/presupuesto/versiones/${d.version.id}`, { como: U.adm }));
    for (const e of ['Pesimista', 'Moderado', 'Optimista']) {
      const x = d.escenarios[e];
      assert.equal(x.anios.length, 6); assert.deepEqual(x.anios.map(a => a.anio), [2026, 2027, 2028, 2029, 2030, 2031]);
      // con los supuestos por defecto el VPN es el mismo de la pestaña Proyección y NPV del presupuesto
      assert.ok(Math.abs(x.metricas.vpn - v.resultados[e].metricas.npv) < 1, e);
      assert.equal(x.anios[1].FX, undefined, 'CINTANA no va aparte');
    }
    const S = d.sensibilidad;
    assert.equal(S.vpnCrecDesc.length, 5); assert.equal(S.vpnTasaCapex[2].length, 5);
    assert.ok(Math.abs(S.vpnCrecDesc[2][2] - d.escenarios.Moderado.metricas.vpn) < 1, 'el centro es el caso base');
    assert.ok(S.vpnCrecDesc[4][2] > S.vpnCrecDesc[0][2], 'más estudiantes, más VPN');
    assert.ok(S.vpnCrecDesc[2][4] < S.vpnCrecDesc[2][0], 'más descuento, menos VPN');
    assert.ok(S.vpnTasaCapex[0][2] > S.vpnTasaCapex[4][2], 'más tasa, menos VPN');
    // solo quien edita Planeación cambia los supuestos
    const nuevo = { ...d.supuestos, inversionInicial: 3000e6, deuda: [{ nombre: 'Crédito de prueba', saldo: 1000e6, tasa: 0.1, anios: 4 }] };
    assert.equal((await pedir('PUT', '/api/planeacion/supuestos/2027', { como: U.con, cuerpo: nuevo })).status, 403);
    assert.equal((await pedir('PUT', '/api/planeacion/supuestos/2027', { como: U.adm, cuerpo: { ...nuevo, gT: 0.2 } })).status, 422);
    await ok(pedir('PUT', '/api/planeacion/supuestos/2027', { como: U.adm, cuerpo: nuevo }));
    const d2 = await ok(pedir('GET', '/api/planeacion/proforma', { como: U.con }));
    const m = d2.escenarios.Moderado;
    assert.ok(Math.abs(m.metricas.vpn - (d.escenarios.Moderado.metricas.vpn - 3000e6)) < 1, 'la inversión inicial va en el año 0');
    assert.ok(m.metricas.tir != null && m.metricas.paybackSimple != null, 'con inversión hay TIR y payback');
    assert.ok(Math.abs(m.anios.slice(1).reduce((t, a) => t + a.CAPd, 0) - 1000e6) < 1, 'la deuda se paga en el plazo');
    assert.equal(m.anios[5].DEUDA, 0);
    const bit = await ok(pedir('GET', '/api/admin/bitacora', { como: U.su }));
    assert.ok((bit.filas || bit).some(b => b.accion === 'EDITAR_SUPUESTOS_PLANEACION'));
    await ok(pedir('PUT', '/api/planeacion/supuestos/2027', { como: U.adm, cuerpo: {} }));
  });

  test('TRM: cambia el pago a CINTANA y el puente del excedente cuadra', async () => {
    const { id } = await ok(pedir('POST', '/api/presupuesto/versiones', { como: U.adm, cuerpo: { ejercicio: 2027, nombre: 'TRM' } }));
    const v0 = await ok(pedir('GET', `/api/presupuesto/versiones/${id}`, { como: U.adm }));
    assert.deepEqual(v0.cintanaUSD.slice(0, 2), [200000, 200000]);
    const t0 = v0.resultados.Moderado.tot, b = v0.base.base2026;
    assert.ok(Math.abs(t0.FX - 200000 * v0.porDefecto.Moderado.trm[0]) < 1);
    // el puente de la pantalla: excedente 2026E + cambios = excedente 2027
    const puente = b.RN + (t0.NET - b.NET) + (t0.OI - b.OI) - (t0.N - b.N) - (t0.C - b.C) - (t0.V + t0.VI - b.V - b.VI) - (t0.FX - b.FX) - (t0.F - b.F) - (t0.DA - b.DA);
    assert.ok(Math.abs(puente - t0.RN) < 1);
    assert.equal((await pedir('PATCH', `/api/presupuesto/versiones/${id}/supuestos`, { como: U.adm, cuerpo: { params: { Moderado: { trm: [4.2, 4100, 4200, 4300, 4400] } } } })).status, 422);
    await ok(pedir('PATCH', `/api/presupuesto/versiones/${id}/supuestos`, { como: U.adm, cuerpo: { params: { Moderado: { trm: [4500, 4100, 4200, 4300, 4400] } } } }));
    const t1 = (await ok(pedir('GET', `/api/presupuesto/versiones/${id}`, { como: U.adm }))).resultados.Moderado.tot;
    assert.ok(Math.abs(t1.FX - 200000 * 4500) < 1);
    assert.ok(Math.abs((t0.RN - t1.RN) - 200000 * (4500 - v0.porDefecto.Moderado.trm[0])) < 1);
  });

  test('metas por intake: valida unidad y cantidad de intakes', async () => {
    const { id } = await ok(pedir('POST', '/api/presupuesto/versiones', { como: U.adm, cuerpo: { ejercicio: 2027, nombre: 'Metas' } }));
    const patch = metas => pedir('PATCH', `/api/presupuesto/versiones/${id}/supuestos`, { como: U.adm, cuerpo: { metas } });
    assert.equal((await patch({ 9: [1, 2] })).status, 422);
    assert.equal((await patch({ 0: [1, 2] })).status, 422);
    const antes = (await ok(pedir('GET', `/api/presupuesto/versiones/${id}`, { como: U.adm }))).resultados.Moderado.tot.IB;
    await ok(patch({ 0: [800, 202, 248, 300, 169] }));
    const v = await ok(pedir('GET', `/api/presupuesto/versiones/${id}`, { como: U.adm }));
    assert.ok(v.resultados.Moderado.tot.IB > antes, 'más meta de nuevos, más ingreso');
  });
});

describe('Archivos del ejercicio', () => {
  const subir = (como, nombre, contenido, desc) => fetch(`${base}/api/presupuesto/ejercicios/2027/archivos`, {
    method: 'POST', body: contenido,
    headers: { 'X-Finantia': '1', 'X-Finantia-Correo': como, 'Content-Type': 'application/octet-stream', 'X-Nombre': encodeURIComponent(nombre), ...(desc ? { 'X-Descripcion': encodeURIComponent(desc) } : {}) }
  });

  test('subir, listar, descargar y retirar', async () => {
    const r = await subir(U.adm, 'Matrículas 2026-2.csv', Buffer.from('programa,n\nA,1\n'), 'Matriculados por programa');
    assert.equal(r.status, 200);
    const { id } = await r.json();
    const lista = await ok(pedir('GET', '/api/presupuesto/ejercicios/2027/archivos', { como: U.con }));
    assert.equal(lista[0].nombre, 'Matrículas 2026-2.csv');
    assert.equal(lista[0].descripcion, 'Matriculados por programa');
    const d = await fetch(`${base}/api/presupuesto/archivos/${id}`, { headers: { 'X-Finantia': '1', 'X-Finantia-Correo': U.con } });
    assert.equal(d.status, 200);
    assert.match(d.headers.get('content-disposition'), /^attachment;/);
    assert.equal(d.headers.get('content-type'), 'application/octet-stream');
    assert.equal(await d.text(), 'programa,n\nA,1\n');
    assert.equal((await pedir('DELETE', `/api/presupuesto/archivos/${id}`, { como: U.con })).status, 403, 'consulta no retira');
    await ok(pedir('DELETE', `/api/presupuesto/archivos/${id}`, { como: U.adm }));
    assert.equal((await ok(pedir('GET', '/api/presupuesto/ejercicios/2027/archivos', { como: U.con }))).length, 0);
    assert.equal((await pedir('GET', `/api/presupuesto/archivos/${id}`, { como: U.con })).status, 404);
    const bit = await ok(pedir('GET', '/api/admin/bitacora?modulo=PRESUPUESTO', { como: U.su }));
    assert.ok(bit.some(b => b.accion === 'SUBIR_ARCHIVO') && bit.some(b => b.accion === 'RETIRAR_ARCHIVO'));
  });

  test('rechaza tipos no permitidos, vacíos, sin permiso o demasiado grandes', async () => {
    assert.equal((await subir(U.adm, 'script.exe', Buffer.from('x'))).status, 422);
    assert.equal((await subir(U.adm, 'pagina.html', Buffer.from('<script>'))).status, 422);
    assert.equal((await subir(U.adm, 'vacio.csv', Buffer.alloc(0))).status, 422);
    assert.equal((await subir(U.con, 'datos.csv', Buffer.from('a'))).status, 403);
    assert.equal((await subir(U.adm, 'grande.csv', Buffer.alloc(15 * 1024 * 1024 + 1, 65))).status, 422);
    const r = await subir(U.adm, '../../etc/x.csv', Buffer.from('a'));
    assert.equal(r.status, 200);
    const lista = await ok(pedir('GET', '/api/presupuesto/ejercicios/2027/archivos', { como: U.con }));
    assert.ok(!lista[0].nombre.includes('/'), lista[0].nombre);
  });
});

describe('Preguntas al asistente', () => {
  test('sin llave queda inactivo y lo dice', async () => {
    const r = await ok(pedir('GET', '/api/presupuesto/versiones/1/preguntas', { como: U.con }));
    assert.equal(r.activo, false);
    const p = await pedir('POST', '/api/presupuesto/versiones/1/preguntas', { como: U.con, cuerpo: { pregunta: 'Hola' } });
    assert.equal(p.status, 503);
  });

  test('con un cliente: envía los datos de la versión, guarda la respuesta y el historial', async () => {
    const llamadas = [];
    const cliente = { beta: { messages: { create: async req => { llamadas.push(req); return { model: req.model, stop_reason: 'end_turn', content: [{ type: 'text', text: `Respuesta ${llamadas.length}` }], usage: { input_tokens: 10, output_tokens: 5 } }; } } } };
    const { crearAsistente } = await import('../servidor/presupuesto/asistente.js');
    const s2 = crearServidor(db, { auth: { modo: 'desarrollo' }, asistente: crearAsistente({ cliente, modelo: 'modelo-prueba' }) });
    await new Promise(r => s2.listen(0, '127.0.0.1', r));
    const b2 = `http://127.0.0.1:${s2.address().port}`;
    const preg = (cuerpo, como = U.con) => fetch(`${b2}/api/presupuesto/versiones/1/preguntas`, { method: 'POST', headers: { 'X-Finantia': '1', 'X-Finantia-Correo': como, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    try {
      assert.equal((await preg({ pregunta: '' })).status, 422);
      assert.equal((await preg({ pregunta: 'x', escenario: 'Otro' })).status, 422);
      const r1 = await preg({ pregunta: '¿Cuál es el EBITDA?', escenario: 'Pesimista' });
      assert.equal(r1.status, 200);
      assert.equal((await r1.json()).respuesta, 'Respuesta 1');
      const req = llamadas[0];
      assert.equal(req.model, 'modelo-prueba');
      const texto = JSON.stringify(req.messages);
      assert.match(texto, /Escenario por defecto: Pesimista/);
      assert.match(texto, /estadoResultados/);
      assert.doesNotMatch(texto, /LP|planUnits/, 'no envía la nómina plan por línea');
      await preg({ pregunta: '¿Y el resultado?' });
      assert.equal(llamadas[1].messages.length, 3, 'incluye la pregunta anterior');
      const h = await (await fetch(`${b2}/api/presupuesto/versiones/1/preguntas`, { headers: { 'X-Finantia': '1', 'X-Finantia-Correo': U.adm } })).json();
      assert.equal(h.activo, true);
      assert.deepEqual(h.preguntas.map(x => x.respuesta), ['Respuesta 1', 'Respuesta 2']);
    } finally { await new Promise(r => s2.close(r)); }
  });
});
