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

/* ---------- extractos en PDF (formatos de los bancos, con cifras inventadas) ---------- */
import { leerResumenPdf, numeroPdf } from '../servidor/planeacion/extractosPdf.js';
import { lineasPdf } from '../servidor/planeacion/pdf.js';

/** PDF mínimo de una página con una línea de texto por renglón (Helvetica, solo ASCII). */
function pdfDe(lineas) {
  const tx = s => s.replace(/[\\()]/g, m => '\\' + m);
  const flujo = 'BT /F1 9 Tf 40 800 Td 12 TL\n' + lineas.map(l => `(${tx(l)}) Tj T*`).join('\n') + '\nET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let s = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(s, 'latin1');
}
const BANCOLOMBIA = ['ESTADO DE CUENTA', 'DESDE: 2026/09/30 HASTA: 2026/10/31', 'CUENTA CORRIENTE', 'NUMERO 123456789',
  'SALDO ANTERIOR $ -1,000,000.00 SALDO PROMEDIO $ 5,000,000', 'TOTAL ABONOS $ 9,000,000.50 CUPO SOBREGIRO $ .00',
  'TOTAL CARGOS $ 3,000,000.25 VALOR INTERESES COBRADOS $ .00', 'SALDO ACTUAL $ 5,000,000.25 RETEFUENTE $ .00',
  'FECHA DESCRIPCION SUCURSAL DCTO. VALOR SALDO', '1/10 PAGO DE PROV TERCERO INVENTADO 9,000,000.50 8,000,000.50'];
const PANAMA = ['EMPRESA INVENTADA DESDE 01/10/2026 HASTA 31/10/2026', 'CUENTA DE AHORROS', 'CIUDAD NUMERO 80100099991',
  'SALDO ANTERIOR USD 1,000.00 SALDO PROMEDIO USD 1,000.00', 'TOTAL ABONOS USD 500.00', 'TOTAL CARGOS USD 100.00', 'SALDO ACTUAL USD 1,400.00'];

test('lee el resumen de los formatos en PDF de cada banco', () => {
  assert.equal(numeroPdf('2.520.320,92'), 2520320.92); assert.equal(numeroPdf('$ -14,302,253.93'), -14302253.93); assert.equal(numeroPdf('$ .00'), 0);
  const b = leerResumenPdf(BANCOLOMBIA);
  assert.deepEqual([b.banco, b.tipo, b.moneda, b.anio, b.mes, b.terminacion, b.saldoInicial, b.entradas, b.salidas, b.saldoFinal],
    ['Bancolombia', 'CORRIENTE', 'COP', 2026, 10, '6789', -1000000, 9000000.5, 3000000.25, 5000000.25]);
  const p = leerResumenPdf(PANAMA);
  assert.deepEqual([p.banco, p.tipo, p.moneda, p.terminacion, p.saldoFinal], ['Bancolombia Panamá', 'AHORROS', 'USD', '9991', 1400]);
  const d = leerResumenPdf(['CUENTA DE AHORROS', '0000 0000 4321', 'INFORME DEL MES: OCTUBRE /2026', 'Saldo Anterior $1,000.00', 'Más Créditos $200.00', 'Menos Débitos $50.00', 'Nuevo Saldo $1,150.00']);
  assert.deepEqual([d.banco, d.tipo, d.mes, d.terminacion, d.saldoFinal], ['Davivienda', 'AHORROS', 10, '4321', 1150]);
  const g = leerResumenPdf(['Extracto Cuenta Corriente', 'FECHA EXTRACTO Octubre - Octubre 2026', 'Cuenta Número: 111222333', 'Saldo Inicial: 1,000.00',
    'Total 000010 Abonos: 500.00', 'Total 000020 Cargos: -300.00', 'Total IVA: -10.00', 'Total 4x1000 GMF: -2.00', 'Saldo Final: 1,188.00']);
  assert.deepEqual([g.banco, g.mes, g.terminacion, g.entradas, g.salidas], ['Banco de Bogotá', 10, '2333', 500, 312]);
  const f = leerResumenPdf(['Desde: 01 OCTUBRE 2026', 'Hasta: 31 OCTUBRE 2026', 'Fondo Inventado', 'Tipo de Fondo Número de Encargo', 'Abierto Moderado 01/01/2000 80010009999-1',
    'Saldo Inicial 1.000,00 1,0 0,00', 'Adiciones 100,00 0,00', 'Retiros 50,00 0,00', 'Rendimientos después de gastos 10,00 0,00', 'Saldo Final 1.060,00 1,0']);
  assert.deepEqual([f.banco, f.tipo, f.fondo, f.terminacion, f.entradas, f.salidas], ['Alianza Fiduciaria', 'FIDUCIA', 'Fondo Inventado', '9999', 110, 50]);
  assert.throws(() => leerResumenPdf([]), /escaneado/);
  assert.throws(() => leerResumenPdf(BANCOLOMBIA.map(l => l.replace('5,000,000.25 RETE', '5,000,101.25 RETE'))), /no cuadran/);
  assert.throws(() => leerResumenPdf(['Otro banco', 'Saldo 1']), /No se reconoce/);
});

test('extrae el texto de un PDF por líneas', async () => {
  const l = await lineasPdf(pdfDe(BANCOLOMBIA));
  assert.ok(l.includes('TOTAL ABONOS $ 9,000,000.50 CUPO SOBREGIRO $ .00'), l.join('|'));
});

test('carga extractos en PDF: crea la cuenta por confirmar y convierte la moneda extranjera', async () => {
  const r = await ok(pedir('POST', '/api/planeacion/extractos-pdf', { como: U.su, crudo: pdfDe(BANCOLOMBIA), nombre: 'octubre.pdf' }));
  assert.equal(r.creada, true); assert.equal(r.mes, 10); assert.equal(r.saldoFinal, 5000000.25);
  const r2 = await ok(pedir('POST', '/api/planeacion/extractos-pdf', { como: U.su, crudo: pdfDe(BANCOLOMBIA), nombre: 'otra vez.pdf' }));
  assert.equal(r2.creada, false); assert.equal(r2.cuenta.id, r.cuenta.id);
  const usd = await ok(pedir('POST', '/api/planeacion/extractos-pdf', { como: U.su, crudo: pdfDe(PANAMA), nombre: 'panama.pdf' }));
  assert.equal(usd.cuenta.moneda, 'USD');
  const ctas = await ok(pedir('GET', '/api/bancos/cuentas', { como: U.su }));
  const nueva = ctas.find(c => c.id === r.cuenta.id);
  assert.equal(nueva.porConfirmar, true); assert.equal(nueva.destinacion, 'LIBRE'); assert.equal(nueva.terminacion, '6789');
  let caja = await ok(pedir('GET', '/api/planeacion/caja/2026', { como: U.su }));
  assert.deepEqual(caja.faltaTasa, [{ mes: 10, moneda: 'USD' }]);
  assert.ok(!caja.extractos.some(e => e.cuentaId === usd.cuenta.id));
  await ok(pedir('PUT', '/api/planeacion/caja/2026/tasas', { como: U.su, cuerpo: { tasas: [{ mes: 10, moneda: 'USD', valor: 4000 }] } }));
  caja = await ok(pedir('GET', '/api/planeacion/caja/2026', { como: U.su }));
  assert.deepEqual(caja.faltaTasa, []);
  const e = caja.extractos.find(x => x.cuentaId === usd.cuenta.id);
  assert.equal(e.saldoFinal, 1400 * 4000); assert.equal(e.original.saldoFinal, 1400); assert.equal(e.tasa, 4000);
  /* confirmar desde Administración quita la marca */
  await ok(pedir('PUT', `/api/bancos/cuentas/${r.cuenta.id}`, { como: U.su, cuerpo: { nombre: 'Recaudo inventado' } }));
  assert.equal((await ok(pedir('GET', '/api/bancos/cuentas', { como: U.su }))).find(c => c.id === r.cuenta.id).porConfirmar, false);
  /* sin permiso de Administración no se crean cuentas nuevas */
  const otro = pdfDe(BANCOLOMBIA.map(l => l.replace('123456789', '987650000')));
  const sin = await pedir('POST', '/api/planeacion/extractos-pdf', { como: U.con, crudo: otro, nombre: 'x.pdf' });
  assert.notEqual(sin.status, 200);
  const malo = await pedir('POST', '/api/planeacion/extractos-pdf', { como: U.su, crudo: Buffer.from('no soy pdf'), nombre: 'x.pdf' });
  assert.equal(malo.status, 422);
});
