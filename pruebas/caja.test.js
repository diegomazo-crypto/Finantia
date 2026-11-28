/**
 * Planeación financiera · bancos, extractos y caja del año (datos inventados).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { desdePGlite, migrar } from '../servidor/db/conexion.js';
import { crearServidor } from '../servidor/web/servidor.js';
import { sembrarDemo } from '../servidor/web/demo.js';
import { leerExtracto, fechaDe } from '../servidor/planeacion/extractos.js';
import { leerCsv } from '../servidor/presupuesto/nomina.js';
import { proyectarCaja } from '../motor/planeacion.js';

const U = { su: 'superusuario@demo.finantia', adm: 'administracion@demo.finantia', con: 'consulta@demo.finantia' };
let db, srv, base;
async function pedir(metodo, ruta, { como, cuerpo, crudo, nombre } = {}) {
  const h = { 'X-Finantia': '1', 'X-Finantia-Correo': como };
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
  if (crudo) { h['Content-Type'] = 'application/octet-stream'; h['X-Nombre'] = encodeURIComponent(nombre); }
  const r = await fetch(base + ruta, { method: metodo, headers: h, body: crudo ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo)) });
  return { status: r.status, datos: await r.json().catch(() => null) };
}
const ok = async (p, s = 200) => { const r = await p; assert.equal(r.status, s, JSON.stringify(r.datos)); return r.datos; };

before(async () => {
  db = desdePGlite(new PGlite()); await migrar(db); await sembrarDemo(db, { detalle: false });
  srv = crearServidor(db, { auth: { modo: 'desarrollo' } });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => { await new Promise(r => srv.close(r)); await db.cerrar(); });

const CSV_ASC = `Banco Inventado S.A.;;;;
Extracto cuenta de ahorros ****9999;;;;
FECHA;DESCRIPCION;REFERENCIA;VALOR;SALDO
2026/10/01;CONSIGNACION MATRICULAS;1;1.500.000,00;11.500.000,00
2026/10/15;PAGO PROVEEDOR;2;-2.000.000,00;9.500.000,00
2026/10/31;ABONO INTERESES;3;25.000,00;9.525.000,00
`;
const CSV_DESC = `Fecha,Descripción,Débito,Crédito,Saldo
31/10/2026,Nómina,"4,000,000.00",,"6,000,000.00"
10/10/2026,Recaudo,,"3,000,000.00","10,000,000.00"
`;

test('fechas de extracto', () => {
  assert.deepEqual(fechaDe('2026/10/31'), { anio: 2026, mes: 10, dia: 31 });
  assert.deepEqual(fechaDe('31/10/2026'), { anio: 2026, mes: 10, dia: 31 });
  assert.deepEqual(fechaDe('31/10', 2026), { anio: 2026, mes: 10, dia: 31 });
  assert.deepEqual(fechaDe(46326), { anio: 2026, mes: 10, dia: 31 });
  assert.equal(fechaDe('TOTAL'), null);
});

test('lee extractos con valor con signo o débitos y créditos, en cualquier orden', () => {
  const a = leerExtracto(leerCsv(CSV_ASC), { anio: 2026, mes: 10 });
  assert.equal(a.movimientos, 3); assert.equal(a.entradas, 1525000); assert.equal(a.salidas, 2000000);
  assert.equal(a.saldoInicial, 10000000); assert.equal(a.saldoFinal, 9525000);
  const d = leerExtracto(leerCsv(CSV_DESC), { anio: 2026, mes: 10 });
  assert.equal(d.saldoFinal, 6000000); assert.equal(d.saldoInicial, 7000000); assert.equal(d.entradas, 3000000); assert.equal(d.salidas, 4000000);
  assert.throws(() => leerExtracto(leerCsv(CSV_ASC), { anio: 2026, mes: 11 }), /octubre de 2026/);
  assert.throws(() => leerExtracto(leerCsv('a;b\n1;2\n'), { anio: 2026, mes: 10 }), /No se reconoce el extracto/);
});

test('proyección: real hasta el último mes cargado, la específica se mantiene y se avisa bajo el mínimo', () => {
  const cuentas = [{ id: 1, destinacion: 'LIBRE' }, { id: 2, destinacion: 'ESPECIFICA' }];
  const extractos = [{ cuentaId: 1, mes: 10, saldoInicial: 5e9, entradas: 1e9, salidas: 2e9, saldoFinal: 4e9 }, { cuentaId: 2, mes: 10, saldoInicial: 1e9, entradas: 0, salidas: 0, saldoFinal: 1e9 }];
  const flujo = Array(12).fill(-1e9);
  const k = proyectarCaja({ cuentas, extractos, flujo, ajustes: [{ mes: 12, concepto: 'Prima', valor: -0.5e9 }], cajaMinima: 2.8e9 });
  assert.equal(k.ultimo, 10);
  assert.equal(k.meses[9].tipo, 'real'); assert.equal(k.meses[9].flujo, -1e9); assert.equal(k.meses[9].libre, 4e9);
  assert.equal(k.meses[10].libre, 3e9); assert.equal(k.meses[11].libre, 1.5e9); assert.equal(k.meses[11].especifica, 1e9);
  assert.deepEqual(k.proyectados, [11, 12]); assert.deepEqual(k.bajoMinimo, [12]);
  assert.equal(k.meses[0].tipo, 'sin-dato');
});

test('API: cuentas en Administración, extractos y caja del año', async () => {
  assert.equal((await pedir('POST', '/api/bancos/cuentas', { como: U.con, cuerpo: { banco: 'X', nombre: 'Y' } })).status, 403);
  assert.equal((await pedir('POST', '/api/bancos/cuentas', { como: U.su, cuerpo: { banco: 'Banco A', nombre: 'Convenio', destinacion: 'ESPECIFICA' } })).status, 422, 'específica exige el detalle');
  assert.equal((await pedir('POST', '/api/bancos/cuentas', { como: U.su, cuerpo: { banco: 'Banco A', nombre: 'Op', terminacion: '123456' } })).status, 422, 'solo 4 dígitos');
  const lib = await ok(pedir('POST', '/api/bancos/cuentas', { como: U.su, cuerpo: { banco: 'Banco Inventado', nombre: 'Operación', terminacion: '9999' } }));
  const esp = await ok(pedir('POST', '/api/bancos/cuentas', { como: U.su, cuerpo: { banco: 'Banco B', nombre: 'Becas', destinacion: 'ESPECIFICA', detalle: 'Fondo de becas', tipo: 'FIDUCIA' } }));
  const lista = await ok(pedir('GET', '/api/bancos/cuentas', { como: U.con }));
  assert.equal(lista.length, 2);
  // extracto por archivo (consulta no puede) y a mano
  assert.equal((await pedir('POST', `/api/planeacion/caja/2027/10/cuentas/${lib.id}`, { como: U.con, crudo: Buffer.from(CSV_ASC), nombre: 'oct.csv' })).status, 403);
  assert.equal((await pedir('POST', `/api/planeacion/caja/2027/10/cuentas/${lib.id}`, { como: U.adm, crudo: Buffer.from(CSV_ASC), nombre: 'oct.csv' })).status, 422, 'el archivo es de 2026');
  await ok(pedir('POST', `/api/planeacion/caja/2026/10/cuentas/${lib.id}`, { como: U.adm, crudo: Buffer.from(CSV_ASC), nombre: 'oct.csv' }));
  assert.equal((await pedir('PUT', `/api/planeacion/caja/2026/10/cuentas/${esp.id}`, { como: U.adm, cuerpo: { saldoInicial: 1e6, entradas: 5, saldoFinal: 2e6 } })).status, 422, 'no cuadra');
  await ok(pedir('PUT', `/api/planeacion/caja/2026/10/cuentas/${esp.id}`, { como: U.adm, cuerpo: { saldoInicial: 1e6, saldoFinal: 2e6 } }));
  await ok(pedir('PUT', '/api/planeacion/caja/2026/ajustes', { como: U.adm, cuerpo: { ajustes: [{ mes: 12, concepto: 'Prima de diciembre', valor: -3e6 }] } }));
  const c = await ok(pedir('GET', '/api/planeacion/caja/2026', { como: U.con }));
  assert.equal(c.caja.ultimo, 10);
  assert.equal(c.caja.meses[9].libre, 9525000); assert.equal(c.caja.meses[9].especifica, 2e6);
  assert.equal(c.caja.meses[11].tipo, 'proyectado');
  assert.ok(Math.abs(c.caja.meses[11].libre - (9525000 + c.flujo[10] + c.flujo[11] - 3e6)) < 1);
  // 2027 toma el flujo de caja (método directo) del presupuesto
  const c27 = await ok(pedir('GET', '/api/planeacion/caja/2027', { como: U.con }));
  assert.match(c27.fuente, /método directo/); assert.equal(c27.aproximado, false); assert.equal(c27.flujo.length, 12);
  // borrar e inactivar
  await ok(pedir('DELETE', `/api/planeacion/caja/2026/10/cuentas/${esp.id}`, { como: U.adm }));
  await ok(pedir('PUT', `/api/bancos/cuentas/${esp.id}`, { como: U.su, cuerpo: { activa: false } }));
  const c2 = await ok(pedir('GET', '/api/planeacion/caja/2026', { como: U.con }));
  assert.equal(c2.cuentas.length, 1, 'la cuenta inactiva sin extractos no aparece');
  assert.equal(c2.caja.meses[9].faltan.length, 0);
});
