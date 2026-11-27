/**
 * Base de datos, módulo de Administración y ciclo de una versión del presupuesto.
 * Corre sobre PGlite (PostgreSQL en memoria), sin servidor. Con FINANTIA_PRUEBA_PG_URL
 * corre contra un PostgreSQL real (una base vacía, que la prueba llena).
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { desdePGlite, conectar, migrar } from '../servidor/db/conexion.js';
import { cargarActor, puede } from '../servidor/admin/permisos.js';
import * as A from '../servidor/admin/admin.js';
import { ingresar } from '../servidor/admin/identidad.js';
import * as P from '../servidor/presupuesto/servicio.js';
import { datos, leerJSON, cuadra, TOL_COP } from './comun.js';

const REF = leerJSON('./referencias/excel_v21.json').escenarios;
const DOM = ['ceipa.edu.co'];
const rechaza = (p, codigo) => assert.rejects(p, e => e.codigo === codigo || assert.fail(`se esperaba ${codigo}, llegó ${e.codigo}: ${e.message}`));

let db, su, ids = {};
const actor = id => cargarActor(db, id);

before(async () => {
  db = process.env.FINANTIA_PRUEBA_PG_URL ? await conectar(process.env.FINANTIA_PRUEBA_PG_URL) : desdePGlite(new PGlite());
  assert.deepEqual(await migrar(db), ['001_administracion.sql', '002_presupuesto.sql', '003_archivos_preguntas.sql', '004_nomina_evaluacion.sql', '005_ejecucion.sql']);
  assert.deepEqual(await migrar(db), [], 'migrar dos veces no repite nada');
  ids.su = await A.inicializarSuperusuario(db, { correo: 'Superusuario@ceipa.edu.co', nombre: 'Superusuario' }, DOM);
  su = await actor(ids.su);
});

after(() => db.cerrar());

describe('Administración: usuarios y accesos', () => {
  test('solo se inicializa un Superusuario', async () => {
    await rechaza(A.inicializarSuperusuario(db, { correo: 'otro@ceipa.edu.co', nombre: 'Otro' }, DOM), 'ESTADO_INVALIDO');
  });

  test('crea usuarios con correo institucional, sin duplicados', async () => {
    ids.vis = await A.crearUsuario(db, su, { correo: 'visualiza@ceipa.edu.co', nombre: 'Visualización' }, DOM);
    ids.adm = await A.crearUsuario(db, su, { correo: 'administra@ceipa.edu.co', nombre: 'Administración' }, DOM);
    ids.ap1 = await A.crearUsuario(db, su, { correo: 'aprueba1@ceipa.edu.co', nombre: 'Aprobador uno' }, DOM);
    ids.ap2 = await A.crearUsuario(db, su, { correo: 'aprueba2@ceipa.edu.co', nombre: 'Aprobador dos' }, DOM);
    await rechaza(A.crearUsuario(db, su, { correo: 'ADMINISTRA@ceipa.edu.co', nombre: 'Repetido' }, DOM), 'ESTADO_INVALIDO');
    await rechaza(A.crearUsuario(db, su, { correo: 'alguien@gmail.com', nombre: 'Externo' }, DOM), 'DATOS_INVALIDOS');
    await rechaza(A.crearUsuario(db, su, { correo: 'no-es-correo', nombre: 'X' }, DOM), 'DATOS_INVALIDOS');
  });

  test('asigna un rol por módulo; el módulo en pausa no admite accesos', async () => {
    await A.asignarAcceso(db, su, ids.vis, 'PRESUPUESTO', 'VISUALIZACION');
    await A.asignarAcceso(db, su, ids.adm, 'PRESUPUESTO', 'ADMINISTRACION', { detalleSensible: true });
    await A.asignarAcceso(db, su, ids.ap1, 'PRESUPUESTO', 'APROBACION');
    await A.asignarAcceso(db, su, ids.ap2, 'PRESUPUESTO', 'APROBACION');
    await rechaza(A.asignarAcceso(db, su, ids.vis, 'AUDITORIA', 'VISUALIZACION'), 'ESTADO_INVALIDO');
    await rechaza(A.asignarAcceso(db, su, ids.vis, 'ADMINISTRACION', 'VISUALIZACION'), 'DATOS_INVALIDOS');
    await rechaza(A.asignarAcceso(db, su, ids.vis, 'PRESUPUESTO', 'JEFE'), 'DATOS_INVALIDOS');
    const lista = await A.listarUsuarios(db, su);
    assert.equal(lista.length, 5);
    assert.deepEqual(lista.find(u => u.id === ids.adm).accesos, [{ modulo: 'PRESUPUESTO', rol: 'ADMINISTRACION', detalle_sensible: true }]);
  });

  test('matriz de permisos', async () => {
    const [vis, adm, ap1] = await Promise.all([actor(ids.vis), actor(ids.adm), actor(ids.ap1)]);
    const fila = a => ['ver', 'editar', 'aprobar'].map(x => puede(a, 'PRESUPUESTO', x));
    assert.deepEqual(fila(vis), [true, false, false]);
    assert.deepEqual(fila(adm), [true, true, false]);
    assert.deepEqual(fila(ap1), [true, false, true]);
    assert.deepEqual(fila(su), [true, true, false], 'el Superusuario no aprueba sin el rol Aprobación');
    assert.equal(puede(adm, 'EJECUCION', 'ver'), false, 'sin acceso al módulo no ve nada');
    assert.equal(puede(adm, 'ADMINISTRACION', 'ver'), false);
    assert.equal(puede(su, 'ADMINISTRACION', 'editar'), true);
    await rechaza(A.crearUsuario(db, adm, { correo: 'x@ceipa.edu.co', nombre: 'X' }, DOM), 'NO_AUTORIZADO');
    await rechaza(A.consultarBitacora(db, adm), 'NO_AUTORIZADO');
  });

  test('debe quedar al menos un Superusuario activo; nadie se desactiva a sí mismo', async () => {
    await rechaza(A.cambiarSuperusuario(db, su, ids.su, false), 'ESTADO_INVALIDO');
    await rechaza(A.cambiarActivo(db, su, ids.su, false), 'ESTADO_INVALIDO');
  });
});

describe('Ingreso con Microsoft 365', () => {
  test('solo entra quien está registrado; el primer ingreso vincula la cuenta', async () => {
    await rechaza(ingresar(db, { oid: 'oid-x', correo: 'nadie@ceipa.edu.co', nombre: 'Nadie' }), 'NO_AUTORIZADO');
    const a = await ingresar(db, { oid: 'oid-vis', correo: 'Visualiza@ceipa.edu.co', nombre: 'Visualización' });
    assert.equal(a.id, ids.vis);
    assert.equal((await ingresar(db, { oid: 'oid-vis', correo: 'cambio@ceipa.edu.co' })).id, ids.vis, 'luego entra por el oid');
    await rechaza(ingresar(db, { oid: 'oid-otro', correo: 'visualiza@ceipa.edu.co' }), 'NO_AUTORIZADO');
  });

  test('un usuario desactivado no entra ni puede nada', async () => {
    await A.cambiarActivo(db, su, ids.vis, false);
    await rechaza(ingresar(db, { oid: 'oid-vis', correo: 'visualiza@ceipa.edu.co' }), 'NO_AUTORIZADO');
    assert.equal(puede(await actor(ids.vis), 'PRESUPUESTO', 'ver'), false);
    await A.cambiarActivo(db, su, ids.vis, true);
  });
});

describe('Presupuesto: versión, supuestos y aprobación', () => {
  let adm, vis, ap1, ap2, base, v1;
  before(async () => { [adm, vis, ap1, ap2] = await Promise.all([ids.adm, ids.vis, ids.ap1, ids.ap2].map(actor)); });

  test('carga los datos base y crea el ejercicio 2027', async () => {
    await rechaza(P.cargarDatosBase(db, vis, { anioBase: 2026, descripcion: 'x', contenido: datos }), 'NO_AUTORIZADO');
    await rechaza(P.cargarDatosBase(db, adm, { anioBase: 2026, descripcion: 'x', contenido: { ...datos, units: [] } }), 'DATOS_INVALIDOS');
    base = await P.cargarDatosBase(db, adm, { anioBase: 2026, descripcion: 'Base 2026E (Excel v21)', contenido: datos });
    await P.crearEjercicio(db, adm, 2027);
    await rechaza(P.crearEjercicio(db, adm, 2027), 'ESTADO_INVALIDO');
  });

  test('la versión nueva da las cifras del Excel v21 en los tres escenarios', async () => {
    v1 = await P.crearVersion(db, adm, { ejercicio: 2027, nombre: 'Presupuesto 2027 · propuesta', datosBaseId: base });
    const v = await P.obtenerVersion(db, vis, v1);
    assert.equal(v.estado, 'BORRADOR'); assert.equal(v.numero, 1);
    for (const e of ['Pesimista', 'Moderado', 'Optimista']) {
      const r = v.resultados[e];
      cuadra(r.tot.RN, REF[e].rubros2027['RESULTADO NETO'], TOL_COP, `${e} resultado`);
      cuadra(r.tot.EBITDA, REF[e].rubros2027.EBITDA, TOL_COP, `${e} EBITDA`);
      cuadra(r.metricas.npv, REF[e].metricas['NPV FCF 2027–2031 @ tasa de descuento (incluye −inversión inicial)'], TOL_COP, `${e} NPV`);
    }
  });

  test('editar supuestos: solo Administración, solo claves conocidas, con valor anterior en la bitácora', async () => {
    await rechaza(P.editarSupuestos(db, vis, v1, { params: { Moderado: { price: 0.07 } } }), 'NO_AUTORIZADO');
    await rechaza(P.editarSupuestos(db, adm, v1, { params: { Moderado: { precio: 0.07 } } }), 'DATOS_INVALIDOS');
    await rechaza(P.editarSupuestos(db, adm, v1, { params: { Moderado: { price: '7%' } } }), 'DATOS_INVALIDOS');
    await rechaza(P.editarSupuestos(db, adm, v1, { params: { Moderado: { dNew: [0, 0] } } }), 'DATOS_INVALIDOS');
    const rn0 = (await P.obtenerVersion(db, adm, v1)).resultados.Moderado.tot.RN;
    await P.editarSupuestos(db, adm, v1, { params: { Moderado: { price: 0.07 } } });
    const v = await P.obtenerVersion(db, adm, v1);
    assert.equal(v.supuestos.params.Moderado.price, 0.07);
    assert.ok(v.resultados.Moderado.tot.RN > rn0 + 300e6, 'subir la matrícula 0,7 pp sube el resultado unos 350 M');
    cuadra(v.resultados.Pesimista.tot.RN, REF.Pesimista.rubros2027['RESULTADO NETO'], TOL_COP, 'los otros escenarios no cambian');
    const b = (await A.consultarBitacora(db, su, { modulo: 'PRESUPUESTO' })).find(x => x.accion === 'EDITAR_SUPUESTOS');
    assert.deepEqual(b.antes, { params: { Moderado: { price: null } } }, 'antes no había cambio: venía del Excel');
    await P.editarSupuestos(db, adm, v1, { params: { Moderado: { price: 0.063 } } });
    const b2 = (await A.consultarBitacora(db, su, { modulo: 'PRESUPUESTO' })).find(x => x.accion === 'EDITAR_SUPUESTOS');
    assert.deepEqual(b2.antes, { params: { Moderado: { price: 0.07 } } });
    cuadra((await P.obtenerVersion(db, adm, v1)).resultados.Moderado.tot.RN, rn0, 1, 'volver al 6,3% da la cifra original');
  });

  test('enviar, aprobar y generar las líneas presupuestales', async () => {
    await rechaza(P.aprobar(db, ap1, v1), 'ESTADO_INVALIDO');
    await P.enviarARevision(db, adm, v1);
    await rechaza(P.editarSupuestos(db, adm, v1, { esicPct: 0.1 }), 'ESTADO_INVALIDO');
    await rechaza(P.aprobar(db, adm, v1), 'NO_AUTORIZADO');
    const r = await P.aprobar(db, ap1, v1, { observaciones: 'Conforme' });
    assert.deepEqual(r, { estado: 'APROBADA', aprobaciones: 1, requeridas: 1 });
    const v = await P.obtenerVersion(db, vis, v1);
    assert.equal(v.estado, 'APROBADA'); assert.equal(v.escenario_oficial, 'Moderado');
    const L = await P.lineasPresupuestales(db, vis, v1);
    const suma = c => L.filter(l => l.codigo === c).reduce((s, l) => s + l.valor, 0);
    cuadra(suma('IB') - suma('DS'), REF.Moderado.rubros2027['INGRESOS NETOS'], TOL_COP, 'ingreso neto de las líneas');
    const enero = L.filter(l => l.mes === 1 && l.bloque === 'PRESTACION').reduce((s, l) => s + l.valor, 0);
    cuadra(enero, REF.Moderado.mensual['4.1 Costos de prestación de servicios'][0], TOL_COP, 'CPS de enero');
    await rechaza(P.editarSupuestos(db, adm, v1, { esicPct: 0.1 }), 'ESTADO_INVALIDO');
  });

  test('una nueva versión aprobada reemplaza a la anterior', async () => {
    const v2 = await P.crearVersion(db, adm, { ejercicio: 2027, nombre: 'Ajuste de metas', copiaDe: v1, supuestos: { esicPct: 0.12 } });
    assert.equal((await P.obtenerVersion(db, adm, v2)).numero, 2);
    await P.enviarARevision(db, adm, v2);
    await P.aprobar(db, ap2, v2, { escenarioOficial: 'Pesimista' });
    const vs = await P.listarVersiones(db, vis, 2027);
    assert.deepEqual(vs.map(x => [x.numero, x.estado]), [[1, 'REEMPLAZADA'], [2, 'APROBADA']]);
    assert.equal(Number(vs[0].reemplazada_por), v2);
    assert.equal(vs[1].escenario_oficial, 'Pesimista');
  });

  test('dos aprobaciones en orden; devolver reinicia la ronda', async () => {
    await A.configurarAprobacion(db, su, 'PRESUPUESTO', { aprobacionesRequeridas: 2, enOrden: true, aprobadores: [ids.ap1, ids.ap2] });
    await rechaza(A.configurarAprobacion(db, su, 'PRESUPUESTO', { aprobacionesRequeridas: 2, enOrden: true, aprobadores: [ids.ap1, ids.vis] }), 'DATOS_INVALIDOS');
    await rechaza(A.configurarAprobacion(db, su, 'PRESUPUESTO', { aprobacionesRequeridas: 3 }), 'DATOS_INVALIDOS');
    const v3 = await P.crearVersion(db, adm, { ejercicio: 2027, nombre: 'Versión con dos firmas', copiaDe: v1 });
    await P.enviarARevision(db, adm, v3);
    await rechaza(P.aprobar(db, ap2, v3), 'NO_AUTORIZADO');                         /* no es su turno */
    assert.equal((await P.aprobar(db, ap1, v3)).estado, 'EN_REVISION');
    await rechaza(P.aprobar(db, ap1, v3), 'ESTADO_INVALIDO');                       /* ya aprobó */
    await rechaza(P.devolver(db, ap2, v3, ''), 'DATOS_INVALIDOS');
    await P.devolver(db, ap2, v3, 'Revisar la meta de Barranquilla');
    let v = await P.obtenerVersion(db, adm, v3);
    assert.equal(v.estado, 'BORRADOR'); assert.equal(v.ronda, 2);
    await P.enviarARevision(db, adm, v3);
    await rechaza(P.aprobar(db, ap2, v3), 'NO_AUTORIZADO');                         /* la ronda nueva empieza por el primero */
    await P.aprobar(db, ap1, v3);
    assert.equal((await P.aprobar(db, ap2, v3)).estado, 'APROBADA');
    v = await P.obtenerVersion(db, adm, v3);
    assert.deepEqual(v.decisiones.map(d => [d.ronda, d.decision]), [[1, 'APROBAR'], [1, 'DEVOLVER'], [2, 'APROBAR'], [2, 'APROBAR']]);
    const vs = await P.listarVersiones(db, vis, 2027);
    assert.deepEqual(vs.map(x => x.estado), ['REEMPLAZADA', 'REEMPLAZADA', 'APROBADA']);
    await A.configurarAprobacion(db, su, 'PRESUPUESTO', { aprobacionesRequeridas: 1 });
  });

  test('borrar versiones: borrador quien edita, reemplazada solo el Superusuario, la aprobada nunca', async () => {
    const [r1, , ap] = await P.listarVersiones(db, vis, 2027);
    const v4 = await P.crearVersion(db, adm, { ejercicio: 2027, nombre: 'Prueba para borrar', copiaDe: ap.id });
    await rechaza(P.borrarVersion(db, vis, v4), 'NO_AUTORIZADO');
    assert.deepEqual(await P.borrarVersion(db, adm, v4), { borrada: v4 });
    await rechaza(P.obtenerVersion(db, adm, v4), 'NO_ENCONTRADO');
    await rechaza(P.borrarVersion(db, adm, r1.id), 'NO_AUTORIZADO');
    await rechaza(P.borrarVersion(db, su, ap.id), 'ESTADO_INVALIDO');
    await P.borrarVersion(db, su, r1.id);
    assert.deepEqual((await P.listarVersiones(db, vis, 2027)).map(x => x.estado), ['REEMPLAZADA', 'APROBADA']);
    const b = (await db.query(`SELECT antes FROM bitacora WHERE accion = 'BORRAR_VERSION' ORDER BY id DESC LIMIT 1`)).rows[0].antes;
    const antes = typeof b === 'string' ? JSON.parse(b) : b;
    assert.equal(antes.estado, 'REEMPLAZADA'); assert.ok(antes.resumen.Moderado.RN, 'guarda el resumen para reconstruirla');
  });

  test('quitar el rol Aprobación lo saca del orden de aprobadores', async () => {
    await A.configurarAprobacion(db, su, 'PRESUPUESTO', { aprobacionesRequeridas: 1, enOrden: true, aprobadores: [ids.ap2] });
    await A.asignarAcceso(db, su, ids.ap2, 'PRESUPUESTO', 'VISUALIZACION');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM aprobador_orden')).rows[0].n, 0);
    await A.asignarAcceso(db, su, ids.ap2, 'PRESUPUESTO', 'APROBACION');
    await A.configurarAprobacion(db, su, 'PRESUPUESTO', { aprobacionesRequeridas: 1 });
  });
});

describe('Bitácora', () => {
  test('registra cada paso y no se puede modificar ni borrar', async () => {
    const b = await A.consultarBitacora(db, su, { limite: 1000 });
    const acciones = new Set(b.map(x => x.accion));
    for (const a of ['INICIALIZAR', 'CREAR_USUARIO', 'ASIGNAR_ACCESO', 'INGRESO', 'CARGAR_DATOS_BASE', 'CREAR_VERSION', 'EDITAR_SUPUESTOS', 'ENVIAR_REVISION', 'APROBAR', 'VERSION_APROBADA', 'REEMPLAZAR', 'DEVOLVER', 'CONFIGURAR_APROBACION'])
      assert.ok(acciones.has(a), `falta ${a} en la bitácora`);
    assert.ok((await A.consultarBitacora(db, su, { usuarioId: ids.ap1 })).every(x => Number(x.usuario_id) === ids.ap1));
    await assert.rejects(db.query('UPDATE bitacora SET accion = $1', ['X']), /no se puede modificar/);
    await assert.rejects(db.query('DELETE FROM bitacora'), /no se puede modificar/);
  });
});
