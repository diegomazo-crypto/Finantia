/**
 * Nómina por cargo (cifrada, solo con detalle sensible) y evaluación del presupuesto del equipo
 * (solo 2027). Corre sobre PGlite con los usuarios de `npm run demo`; las cifras son de ejemplo.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { desdePGlite, migrar } from '../servidor/db/conexion.js';
import { crearServidor } from '../servidor/web/servidor.js';
import { sembrarDemo } from '../servidor/web/demo.js';
import { crearNomina, interpretarNomina, numero, leerCsv } from '../servidor/presupuesto/nomina.js';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { leerXlsx } from '../servidor/presupuesto/xlsx.js';
import { libroXlsx } from '../web/xlsx.js';
import { validarEvaluacion } from '../servidor/presupuesto/evaluacion.js';

const U = { su: 'superusuario@demo.finantia', adm: 'administracion@demo.finantia', apr: 'aprobacion@demo.finantia', con: 'consulta@demo.finantia' };
const LLAVE = randomBytes(32);
let db, srv, base, sinLlave, baseSinLlave, otraLlave, baseOtra;

const CSV = '﻿Rubro;Proceso;Cargo;Continúan;Nuevos;Vacantes;Salario 2026;Salario 2027;Costo anual\n'
  + '4.1 Costos de prestación;Docentes Pregrado;Profesor tiempo completo;10;1;0;$ 8.000.000;8.480.000;1.500.000.000,50\n'
  + '4.1;Docentes Pregrado;Coordinador académico;1;0;0;9000000;9540000;150000000\n'
  + 'DIRECCION;Rectoría;Cargo de dirección;1;0;0;40.000.000;42.400.000;700.000.000\n'
  + '"6.3";"Financiera; tributaria";"Analista ""senior""";2,5;0;1;5000000;5300000;250000000\n';

const escuchar = async s => { await new Promise(r => s.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${s.address().port}`; };
async function pedir(b, metodo, ruta, { como, cuerpo, crudo, nombre } = {}) {
  const h = { 'X-Finantia': '1' };
  if (como) h['X-Finantia-Correo'] = como;
  if (cuerpo !== undefined) h['Content-Type'] = 'application/json';
  if (crudo !== undefined) { h['Content-Type'] = 'application/octet-stream'; h['X-Nombre'] = encodeURIComponent(nombre); }
  const r = await fetch(b + ruta, { method: metodo, headers: h, body: crudo !== undefined ? crudo : cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  return { status: r.status, datos: await r.json().catch(() => null) };
}
const ok = async (p, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.datos)); return r.datos; };
const subir = (como, texto, nombre = 'nomina.csv', b = base) => pedir(b, 'POST', '/api/presupuesto/ejercicios/2027/nomina', { como, crudo: Buffer.isBuffer(texto) ? texto : Buffer.from(texto, 'utf8'), nombre });
const XLSX = readFileSync(new URL('./referencias/nomina_ejemplo.xlsx', import.meta.url));
const inflar = (d, max) => inflateRawSync(d, { maxOutputLength: max });
const aXlsx = async filas => Buffer.from(await libroXlsx(filas).arrayBuffer());

before(async () => {
  db = desdePGlite(new PGlite());
  await migrar(db);
  await sembrarDemo(db);
  const auth = { modo: 'desarrollo' };
  srv = crearServidor(db, { auth, nomina: crearNomina({ llave: LLAVE }) });
  sinLlave = crearServidor(db, { auth, nomina: crearNomina({ env: {} }) });
  otraLlave = crearServidor(db, { auth, nomina: crearNomina({ llave: randomBytes(32) }) });
  [base, baseSinLlave, baseOtra] = await Promise.all([srv, sinLlave, otraLlave].map(escuchar));
});
after(async () => { await Promise.all([srv, sinLlave, otraLlave].map(s => new Promise(r => s.close(r)))); await db.cerrar(); });

describe('Lectura del archivo de nómina', () => {
  test('números en formato colombiano o con punto decimal', () => {
    assert.equal(numero('$ 8.000.000'), 8e6);
    assert.equal(numero('1.500.000.000,50'), 1500000000.5);
    assert.equal(numero('1.500'), 1500);
    assert.equal(numero('2,5'), 2.5);
    assert.equal(numero('0.5'), 0.5);
    assert.equal(numero('259727785.1208'), 259727785.1208);
    assert.equal(numero('1,234,567'), 1234567);
    assert.equal(numero(''), 0);
    assert.ok(Number.isNaN(numero('abc')));
  });

  test('CSV con punto y coma, comillas y encabezados con tildes', () => {
    assert.deepEqual(leerCsv('a;"b;c";"d ""e"""\r\n1;2;3\n'), [['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
    const f = interpretarNomina(CSV.slice(1));
    assert.equal(f.length, 4);
    assert.deepEqual(f.map(x => x.rubro), ['PRESTACION', 'PRESTACION', 'DIRECCION', 'ADMINISTRATIVOS']);
    assert.equal(f[3].proceso, 'Financiera; tributaria');
    assert.equal(f[3].cargo, 'Analista "senior"');
    assert.equal(f[3].continuan, 2.5);
    assert.equal(f[0].costoAnual, 1500000000.5);
  });

  test('acepta nombre y cédula de cada persona e ignora correos; rechaza rubros desconocidos y columnas faltantes', () => {
    const [f] = interpretarNomina('rubro;proceso;cargo;Cédula;Nombres;Apellidos;Correo;continuan;nuevos;vacantes;salario_2027;costo_anual\n4.1;A;B;1.017.123.456;Ana María;Pérez Gómez;ana@x.co;1;0;0;1;1');
    assert.equal(f.cedula, '1017123456');
    assert.equal(f.nombre, 'Ana María Pérez Gómez');
    assert.ok(!JSON.stringify(f).includes('ana@x.co'), 'el correo no se guarda');
    assert.throws(() => interpretarNomina('rubro;proceso;cargo;cedula;continuan;nuevos;vacantes;salario_2027;costo_anual\n4.1;A;B;<script>;1;0;0;1;1'), /cédula inválida/);
    assert.throws(() => interpretarNomina('rubro;proceso;cargo;continuan;nuevos;vacantes;salario_2027;costo_anual\n5.1;A;B;1;0;0;1;1'), /Fila 2: rubro "5.1" desconocido/);
    assert.throws(() => interpretarNomina('rubro;proceso;cargo\n4.1;A;B'), /Faltan columnas: continuan/);
    assert.throws(() => interpretarNomina('rubro;proceso;cargo;continuan;nuevos;vacantes;salario_2027;costo_anual\n4.1;A;B;-1;0;0;1;1'), /Fila 2: valor inválido en continuan/);
  });
});

describe('Nómina por cargo por la API', () => {
  test('sin llave de cifrado no se puede cargar y lo dice', async () => {
    const r = await ok(pedir(baseSinLlave, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm }));
    assert.deepEqual(r, { activa: false, carga: null, filas: [] });
    const s = await subir(U.adm, CSV, 'nomina.csv', baseSinLlave);
    assert.equal(s.status, 503);
    assert.match(s.datos.error, /FINANTIA_LLAVE_NOMINA/);
  });

  test('solo quien tiene el detalle sensible la ve; solo quien además edita la sube', async () => {
    assert.equal((await subir(U.con, CSV)).status, 403, 'consulta no sube');
    assert.equal((await subir(U.apr, CSV)).status, 403, 'aprobación sin detalle sensible no sube');
    const { id } = await ok(subir(U.adm, CSV, 'Nómina 2027.csv'));
    for (const como of [U.con, U.apr]) assert.equal((await pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como })).status, 403);
    const r = await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm }));
    assert.equal(r.carga.id, id);
    assert.equal(r.carga.nombre, 'Nómina 2027.csv');
    assert.equal(r.carga.filas, 4);
    assert.equal(r.carga.personas, 16.5);
    assert.equal(r.carga.costoTotal, 2600000000.5);
    assert.equal(r.filas[2].cargo, 'Cargo de dirección');
    assert.equal((await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.su }))).filas.length, 4, 'el Superusuario la ve');
  });

  test('en la base queda cifrada; la bitácora guarda totales, no cargos ni salarios', async () => {
    const fila = (await db.query('SELECT cifrado, iv, etiqueta FROM nomina_carga WHERE retirado_en IS NULL')).rows[0];
    const crudo = Buffer.from(fila.cifrado).toString('latin1');
    assert.ok(!crudo.includes('Profesor') && !crudo.includes('8480000'), 'el contenido no está en claro');
    assert.equal(Buffer.from(fila.iv).length, 12);
    assert.equal(Buffer.from(fila.etiqueta).length, 16);
    const bit = (await db.query("SELECT accion, antes::text, despues::text, detalle FROM bitacora WHERE accion IN ('SUBIR_NOMINA', 'VER_NOMINA')")).rows;
    assert.ok(bit.some(b => b.accion === 'SUBIR_NOMINA') && bit.some(b => b.accion === 'VER_NOMINA'));
    assert.ok(bit.every(b => !JSON.stringify(b).includes('Profesor') && !JSON.stringify(b).includes('8480000')));
    const v = await ok(pedir(base, 'GET', '/api/presupuesto/versiones/1', { como: U.adm }));
    assert.ok(!JSON.stringify(v).includes('Cargo de dirección'), 'la nómina por cargo no entra en la versión (ni al asistente)');
  });

  test('con otra llave no se puede leer', async () => {
    const r = await pedir(baseOtra, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm });
    assert.equal(r.status, 503);
    assert.match(r.datos.error, /descifrar/);
  });

  test('rechaza otro formato y archivos que no son UTF-8', async () => {
    assert.equal((await subir(U.adm, CSV, 'nomina.xlsx')).status, 422, 'un CSV con extensión .xlsx');
    assert.equal((await subir(U.adm, XLSX, 'nomina.csv')).status, 422, 'un Excel con extensión .csv');
    assert.equal((await subir(U.adm, CSV, 'nomina.pdf')).status, 422);
    const latin1 = await pedir(base, 'POST', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm, crudo: Buffer.from('rubro;proceso;cargo;continuan;nuevos;vacantes;salario_2027;costo_anual\n4.1;Dirección;B;1;0;0;1;1', 'latin1'), nombre: 'n.csv' });
    assert.equal(latin1.status, 422);
    assert.match(latin1.datos.error, /UTF-8/);
  });

  test('una carga nueva reemplaza la anterior y borra su contenido; retirar también lo borra', async () => {
    const antes = (await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm }))).carga.id;
    const { id } = await ok(subir(U.adm, CSV.replace('Profesor tiempo completo', 'Profesor TC')));
    const vieja = (await db.query('SELECT cifrado, retirado_en FROM nomina_carga WHERE id = $1', [antes])).rows[0];
    assert.equal(vieja.cifrado, null);
    assert.ok(vieja.retirado_en);
    assert.equal((await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm }))).filas[0].cargo, 'Profesor TC');
    assert.equal((await pedir(base, 'DELETE', `/api/presupuesto/nomina/${id}`, { como: U.con })).status, 403);
    await ok(pedir(base, 'DELETE', `/api/presupuesto/nomina/${id}`, { como: U.adm }));
    assert.equal((await db.query('SELECT cifrado FROM nomina_carga WHERE id = $1', [id])).rows[0].cifrado, null);
    assert.equal((await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm }))).carga, null);
    assert.equal((await pedir(base, 'DELETE', `/api/presupuesto/nomina/${id}`, { como: U.adm })).status, 404);
  });
});

describe('Evaluación del presupuesto del equipo', () => {
  const EV = {
    referencia: 'Ejemplo de prueba.',
    rubros: [{ clave: 'NET', equipo: 61e9, lectura: 'El equipo proyecta más ingreso.' }, { clave: 'RN', equipo: -1e8 }],
    unidades: [{ unidad: 'PRE', equipo: 33e9, lectura: 'Base distinta.' }, { unidad: 'BAQ', equipo: 7e9 }],
    partidas: [{ codigo: 'CP201', rubro: 'Materiales', equipo: 9e7, modelo: 4e7, explicacion: 'Desarrollo de material.' }],
    observaciones: [{ titulo: 'Soportes', texto: 'Validar partidas.' }],
    conclusiones: ['Conclusión de prueba.']
  };

  test('valida el contenido', () => {
    assert.throws(() => validarEvaluacion({ rubros: [{ clave: 'XX', equipo: 1 }] }), /clave desconocida/);
    assert.throws(() => validarEvaluacion({ rubros: [{ clave: 'NET', equipo: '1' }] }), /debe ser un número/);
    assert.throws(() => validarEvaluacion({ unidades: [{ unidad: 'PRE', equipo: 1 }, { unidad: 'PRE', equipo: 2 }] }), /repetidas/);
    assert.throws(() => validarEvaluacion({}), /no trae cifras/);
    assert.deepEqual(validarEvaluacion(EV).rubros[1], { clave: 'RN', equipo: -1e8, lectura: '' });
  });

  test('solo existe para 2027 y solo con el detalle sensible', async () => {
    // Viene cargada desde la instalación (datos/evaluacion2027.json): nadie tiene que volver a subirla
    const inicial = (await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/evaluacion', { como: U.adm }))).evaluacion;
    assert.ok(inicial.rubros.length > 10 && inicial.unidades.length && inicial.partidas.length && inicial.conclusiones.length);
    assert.equal((await pedir(base, 'GET', '/api/presupuesto/ejercicios/2028/evaluacion', { como: U.adm })).status, 404);
    assert.equal((await pedir(base, 'PUT', '/api/presupuesto/ejercicios/2028/evaluacion', { como: U.adm, cuerpo: EV })).status, 404);
    assert.equal((await pedir(base, 'PUT', '/api/presupuesto/ejercicios/2027/evaluacion', { como: U.con, cuerpo: EV })).status, 403);
    assert.equal((await pedir(base, 'PUT', '/api/presupuesto/ejercicios/2027/evaluacion', { como: U.adm, cuerpo: { rubros: [{ clave: 'NET' }] } })).status, 422);
    await ok(pedir(base, 'PUT', '/api/presupuesto/ejercicios/2027/evaluacion', { como: U.adm, cuerpo: EV }));
    for (const como of [U.con, U.apr]) assert.equal((await pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/evaluacion', { como })).status, 403);
    const { evaluacion } = await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/evaluacion', { como: U.adm }));
    assert.equal(evaluacion.cargadoPor, 'Equipo financiero (demo)');
    assert.deepEqual(evaluacion.partidas, EV.partidas);
    await ok(pedir(base, 'PUT', '/api/presupuesto/ejercicios/2027/evaluacion', { como: U.adm, cuerpo: { ...EV, conclusiones: ['Otra.'] } }));
    assert.deepEqual((await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/evaluacion', { como: U.su }))).evaluacion.conclusiones, ['Otra.']);
    const bit = (await db.query("SELECT count(*)::int AS n FROM bitacora WHERE accion = 'CARGAR_EVALUACION'")).rows[0].n;
    assert.equal(bit, 3);
  });
});

describe('Nómina en Excel (.xlsx)', () => {
  test('lee la primera hoja de un libro hecho en Excel: números, textos y encabezados con tildes', async () => {
    const filas = interpretarNomina(await leerXlsx(XLSX, inflar));
    assert.equal(filas.length, 4, 'la fila vacía se omite y la segunda hoja no se lee');
    assert.deepEqual(filas[0], { rubro: 'PRESTACION', proceso: 'Docentes Pregrado', cargo: 'Profesor tiempo completo', continuan: 10, nuevos: 1, vacantes: 0, salario2026: 8000000, salario2027: 8480000, costoAnual: 1500000000.5 });
    assert.equal(filas[2].costoAnual, 700000000, 'cifras escritas como texto con puntos de miles');
    assert.equal(filas[3].cargo, 'Analista "senior" <2>');
    assert.equal(filas[3].proceso, 'Financiera & tributaria');
    assert.equal(filas[3].continuan, 2.5);
  });

  test('da lo mismo subir el CSV o el Excel', async () => {
    const csv = interpretarNomina(CSV), xl = interpretarNomina(await leerXlsx(XLSX, inflar));
    assert.deepEqual(xl.map(f => f.costoAnual), csv.map(f => f.costoAnual));
  });

  test('la plantilla que se descarga se puede volver a subir', async () => {
    const f = interpretarNomina(await leerXlsx(await aXlsx([['rubro', 'proceso', 'cargo', 'continuan', 'nuevos', 'vacantes', 'salario_2026', 'salario_2027', 'costo_anual'], ['4.1', 'Docentes', 'Profesor', 20, 2, 1, 9000000, 9540000, 3200000000]]), inflar));
    assert.equal(f[0].costoAnual, 3200000000);
  });

  test('acepta nombre y cédula; rechaza fórmulas sin valor y archivos que no son Excel', async () => {
    const [p] = interpretarNomina(await leerXlsx(await aXlsx([['rubro', 'proceso', 'cargo', 'Cédula', 'Nombre', 'continuan', 'nuevos', 'vacantes', 'salario_2027', 'costo_anual'], ['4.1', 'A', 'B', 71234567, 'Juan Ejemplo', 1, 0, 0, 1, 1]]), inflar));
    assert.deepEqual([p.cedula, p.nombre], ['71234567', 'Juan Ejemplo'], 'la cédula numérica de Excel se lee sin decimales');
    await assert.rejects(leerXlsx(readFileSync(new URL('./referencias/nomina_formula_sin_valor.xlsx', import.meta.url)), inflar), /fórmula sin valor/);
    await assert.rejects(leerXlsx(Buffer.from('no soy un zip'), inflar), /no es un .xlsx/);
    await assert.rejects(leerXlsx(XLSX.subarray(0, 1000), inflar), /no se pudo leer/);
  });

  test('se sube por la API, se cifra y se lee igual que el CSV', async () => {
    const { id } = await ok(subir(U.adm, XLSX, 'Nómina 2027.xlsx'));
    const v = await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm }));
    assert.equal(v.carga.id, id);
    assert.equal(v.carga.nombre, 'Nómina 2027.xlsx');
    assert.equal(v.filas.length, 4);
    const r = (await db.query('SELECT cifrado FROM nomina_carga WHERE id = $1', [id])).rows[0];
    assert.ok(!Buffer.from(r.cifrado).toString('latin1').includes('Profesor'));
  });

  test('nombre y cédula quedan cifrados: no aparecen en la base sin descifrar ni en la bitácora', async () => {
    const libro = await aXlsx([['rubro', 'proceso', 'cargo', 'cedula', 'nombre', 'continuan', 'nuevos', 'vacantes', 'salario_2027', 'costo_anual'], ['6.3', 'Contabilidad', 'Analista', 98765432, 'Persona De Prueba', 1, 0, 0, 3000000, 45000000]]);
    const { id } = await ok(subir(U.adm, libro, 'nomina_personas.xlsx'));
    const v = await ok(pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.adm }));
    assert.deepEqual([v.filas[0].cedula, v.filas[0].nombre], ['98765432', 'Persona De Prueba']);
    assert.equal((await pedir(base, 'GET', '/api/presupuesto/ejercicios/2027/nomina', { como: U.con })).status, 403);
    const todo = JSON.stringify((await db.query('SELECT * FROM nomina_carga WHERE id = $1', [id])).rows) + JSON.stringify((await db.query('SELECT * FROM bitacora')).rows);
    assert.ok(!todo.includes('98765432') && !todo.includes('Persona De Prueba'));
  });
});
