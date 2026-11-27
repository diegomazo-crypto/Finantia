/**
 * Módulo de Ejecución presupuestal: lectura del balance de prueba (incluido el formato por NIT de
 * Contai), clasificación por línea y unidad, semáforos, meses completados con el saldo anterior y
 * el servicio sobre PGlite. Todas las cifras y terceros son inventados.
 */
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { desdePGlite, migrar } from '../servidor/db/conexion.js';
import { cargarActor } from '../servidor/admin/permisos.js';
import * as A from '../servidor/admin/admin.js';
import * as P from '../servidor/presupuesto/servicio.js';
import * as EJ from '../servidor/ejecucion/servicio.js';
import { leerBalance, fechaDelTitulo } from '../servidor/ejecucion/lectura.js';
import { semaforo, completarConSaldoAnterior, analizar } from '../motor/ejecucion.js';
import { datos } from './comun.js';

/* Balance por NIT con la forma del de Contai: título con la fecha, cuentas de mayor, total de la cuenta y una fila por tercero */
const ENC = ['Cuenta', 'Equivalencia', 'Nombre', 'NIT', 'Nombre NIT', 'Saldo Anterior', 'Débitos', 'Créditos', 'Nuevo Saldo'];
const BAL = [
  ['INSTITUCION DE EJEMPLO'], ['Balance de Prueba por NIT (Normal)  Sep-30-2026'], ENC,
  ['4', '', 'INGRESOS', '', '', -900, 0, 120, -1020],
  ['4305', '', 'SERVICIOS EDUCATIVOS', '', '', -900, 0, 120, -1020],
  ['43051402', '', 'MATRICULA PREGRADO', '', '', -900, 0, 120, -1020],
  ['43051402', '', 'MATRICULA PREGRADO', ' 1.000.000.001-1', 'ESTUDIANTE EJEMPLO UNO', -500, 0, 70, -570],
  ['43051402', '', 'MATRICULA PREGRADO', ' 1.000.000.002-2', 'ESTUDIANTE EJEMPLO DOS', -400, 0, 50, -450],
  ['1105', '', 'CAJA', '', '', 10, 5, 0, 15]
].map(f => f.map(x => (typeof x === 'number' ? x * 1e6 : x)));
const csv = filas => filas.map(f => f.map(x => (typeof x === 'string' && /[,"]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(',')).join('\n');

describe('Lectura del balance de prueba', () => {
  test('por NIT: usa el total de cada cuenta, sin terceros ni cuentas de mayor, con el saldo anterior', () => {
    const b = leerBalance(BAL);
    assert.equal(b.forma, 'débitos − créditos'); assert.equal(b.porTercero, true); assert.equal(b.conCC, false);
    assert.deepEqual(b.fecha, { mes: 9, anio: 2026 });
    const m = b.filas.find(f => f.cuenta === '43051402');
    assert.equal(b.filas.filter(f => f.cuenta.startsWith('4')).length, 1, 'ni 4 ni 4305 ni los terceros');
    assert.equal(m.movimiento, -120e6); assert.equal(m.anterior, -900e6);
    assert.ok(!JSON.stringify(b.filas).includes('EJEMPLO UNO'), 'no guarda terceros');
  });
  test('sin fila de total: suma los terceros', () => {
    const b = leerBalance([ENC, ['51050601', '', 'SUELDOS', '1-1', 'A', 0, 30, 0, 30], ['51050601', '', 'SUELDOS', '2-2', 'B', 0, 20, 5, 15]]);
    assert.equal(b.filas[0].movimiento, 45);
  });
  test('con centro de costos y movimiento', () => {
    const b = leerBalance([['Cuenta', 'Centro de costos', 'Movimiento'], ['51050601', '1407002 Admon', '1.234,5'], ['5105', '1407002', 99]]);
    assert.deepEqual(b.filas.map(f => [f.cuenta, f.cc, f.movimiento]), [['51050601', '1407002', 1234.5]]);
  });
  test('fecha del título', () => {
    assert.deepEqual(fechaDelTitulo([['Balance a 31 de marzo de 2027']]), { mes: 3, anio: 2027 });
    assert.equal(fechaDelTitulo([['Balance de prueba']]), null);
  });
  test('rechaza un archivo sin columnas reconocibles', () => assert.throws(() => leerBalance([['a', 'b'], [1, 2]]), /No se reconoce/));
});

describe('Motor de ejecución', () => {
  test('semáforos', () => {
    assert.equal(semaforo('ingreso', 100, 99).color, 'verde');
    assert.equal(semaforo('ingreso', 100, 93).color, 'amarillo');
    assert.equal(semaforo('ingreso', 100, 80).color, 'rojo');
    assert.equal(semaforo('gasto', 100, 101).color, 'verde');
    assert.equal(semaforo('gasto', 100, 105).color, 'amarillo');
    assert.equal(semaforo('gasto', 100, 120).color, 'rojo');
    assert.equal(semaforo('gasto', 100, 50).color, 'azul');
    assert.equal(semaforo('gasto', 0, 10e6).color, 'rojo');
    assert.equal(semaforo('ingreso', -100, -50).color, 'verde', 'resultado negativo que mejora');
  });
  test('el saldo anterior completa los meses sin balance y cuadra el acumulado', () => {
    const R = Array(12).fill(null); R[2] = [[5, 0]];
    const P = Array.from({ length: 12 }, (_, m) => [[m === 0 ? 1 : 3, 0]]);
    const est = completarConSaldoAnterior(R, [{ mes: 3, previo: [[40, 0]] }], P);
    assert.deepEqual(est, [1, 2]);
    assert.equal(R[0][0][0] + R[1][0][0], 40); assert.equal(R[0][0][0], 10);
  });
  test('analizar devuelve rubros, líneas y serie', () => {
    const P = Array.from({ length: 12 }, () => datos.L.map(l => l[3].map(v => v / 12)));
    const a = analizar(datos, P, P.map((x, m) => (m < 3 ? x : null)), { hasta: 3 });
    const net = a.rubros.find(r => r.k === 'NET');
    assert.ok(Math.abs(net.pct - 1) < 1e-9); assert.equal(net.color, 'verde');
    assert.equal(a.serie.filter(s => s.cargado).length, 3);
  });
});

describe('Servicio de ejecución', () => {
  let db, su, vis;
  before(async () => {
    db = desdePGlite(new PGlite()); await migrar(db);
    su = await cargarActor(db, await A.inicializarSuperusuario(db, { correo: 'su@ceipa.edu.co', nombre: 'Super' }, ['ceipa.edu.co']));
    const { DD, CCN, CTN, ...sinAuxiliar } = datos; /* como el sitio de pruebas: usa el reparto de datos/base2026.json */
    await P.cargarDatosBase(db, su, { anioBase: 2026, descripcion: 'Base', contenido: sinAuxiliar });
    const idv = await A.crearUsuario(db, su, { correo: 'vis@ceipa.edu.co', nombre: 'Consulta' }, ['ceipa.edu.co']);
    await A.asignarAcceso(db, su, idv, 'EJECUCION', 'VISUALIZACION');
    vis = await cargarActor(db, idv);
  });
  test('sube el balance de septiembre, rechaza el mes equivocado y estima enero a agosto', async () => {
    const contenido = Buffer.from(csv(BAL));
    await assert.rejects(EJ.subirMes(db, su, 2026, 8, { nombre: 'bal.csv', contenido }), /septiembre de 2026/);
    await assert.rejects(EJ.subirMes(db, vis, 2026, 9, { nombre: 'bal.csv', contenido }), e => e.codigo === 'NO_AUTORIZADO');
    const r = await EJ.subirMes(db, su, 2026, 9, { nombre: 'bal.csv', contenido });
    assert.equal(r.filas, 1); assert.equal(r.conCC, false);
    const t = await EJ.tablero(db, su, 2026);
    assert.deepEqual(t.estimados, [1, 2, 3, 4, 5, 6, 7, 8]);
    const ib = R => R.reduce((s, f, li) => s + (datos.L[li][1] === 'IB' ? f.reduce((a, b) => a + b, 0) : 0), 0);
    const aparte = t.meses[0].aparte.IB;
    assert.ok(Math.abs(ib(t.R[8]) + aparte - 120e6) < 1, 'septiembre: 120 de ingreso (ESIC aparte)');
    const acum = t.R.slice(0, 9).reduce((s, R) => s + ib(R), 0);
    assert.ok(Math.abs(acum - 1020e6 * ib(t.R[8]) / 120e6) < 10, 'el acumulado a septiembre es el nuevo saldo');
    assert.equal(t.sensible, true);
  });
  test('el detalle por cuenta exige el detalle sensible', async () => {
    const li = datos.L.findIndex(l => l[1] === 'IB');
    await assert.rejects(EJ.detalleLinea(db, vis, 2026, { linea: li }), e => e.codigo === 'NO_AUTORIZADO');
    const t = await EJ.tablero(db, vis, 2026); assert.equal(t.sensible, false);
  });
  test('quitar un balance', async () => {
    await EJ.borrarMes(db, su, 2026, 9);
    assert.equal((await EJ.tablero(db, su, 2026)).meses.length, 0);
    await assert.rejects(EJ.borrarMes(db, su, 2026, 9), e => e.codigo === 'NO_ENCONTRADO');
  });
});
