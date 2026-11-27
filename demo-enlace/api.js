/*
 * Finantia 2.0 · demostración sin servidor.
 *
 * Responde en el navegador las mismas llamadas que la API del servidor (servidor/web/api.js),
 * con los datos en memoria: se pierden al recargar la página. Usa el mismo motor de cálculo,
 * las mismas reglas de permisos (servidor/admin/permisos.js) y las mismas validaciones de
 * supuestos, nómina por cargo y evaluación del equipo. No hay Microsoft 365, cifrado ni
 * asistente: es para recorrer las pantallas.
 */
import { crearModelo, DEFAULTS, ESCS, FIXED, lineasMensuales } from '../motor/index.js';
import { puede, veDetalleSensible, ROLES } from '../servidor/admin/permisos.js';
import { ErrorFinantia } from '../servidor/errores.js';
import { validarSupuestos, sinAuxiliar } from '../servidor/presupuesto/servicio.js';
import { filasDelArchivo, contenidoDeArchivo, avisosCarga, filasDePersonas } from '../servidor/presupuesto/nomina.js';
import { planNomina, smmlv2027, MODOS } from '../motor/nomina.js';
import { versionPorDefecto, soloFlujo } from '../servidor/planeacion/servicio.js';
import { validarEvaluacion, EJERCICIOS as EJ_EVALUACION } from '../servidor/presupuesto/evaluacion.js';

const HTTP = { SIN_SESION: 401, NO_AUTORIZADO: 403, NO_ENCONTRADO: 404, ESTADO_INVALIDO: 409, DATOS_INVALIDOS: 422, NO_DISPONIBLE: 503 };
const falla = (codigo, m) => { throw new ErrorFinantia(codigo, m); };
const exigir = (a, mod, acc) => { if (!puede(a, mod, acc)) falla('NO_AUTORIZADO', `Sin permiso para ${acc} en ${mod}`); };
const ahora = () => new Date().toISOString();
const clone = o => JSON.parse(JSON.stringify(o));
function mezclar(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return clone(b);
  const o = a && typeof a === 'object' && !Array.isArray(a) ? clone(a) : {};
  for (const [k, v] of Object.entries(b)) o[k] = mezclar(o[k], v);
  return o;
}

/* ---------- estado inicial: el mismo de `npm run demo` ---------- */
const MODULOS = [['ADMINISTRACION', 'Administración', true], ['PRESUPUESTO', 'Presupuesto', true], ['EJECUCION', 'Ejecución presupuestal', true], ['AUDITORIA', 'Auditoría contable', false], ['PLANEACION', 'Planeación financiera', true]]
  .map(([codigo, nombre, activo]) => ({ codigo, nombre, activo }));
const S = {
  usuarios: [
    { id: 1, correo: 'superusuario@demo.finantia', nombre: 'Superusuario (demo)', activo: true, es_superusuario: true, ultimo_ingreso: null, accesos: {} },
    { id: 2, correo: 'administracion@demo.finantia', nombre: 'Equipo financiero (demo)', activo: true, es_superusuario: false, ultimo_ingreso: null, accesos: { PRESUPUESTO: { modulo: 'PRESUPUESTO', rol: 'ADMINISTRACION', detalle_sensible: true }, PLANEACION: { modulo: 'PLANEACION', rol: 'ADMINISTRACION', detalle_sensible: false } } },
    { id: 3, correo: 'aprobacion@demo.finantia', nombre: 'Aprobador (demo)', activo: true, es_superusuario: false, ultimo_ingreso: null, accesos: { PRESUPUESTO: { modulo: 'PRESUPUESTO', rol: 'APROBACION', detalle_sensible: false }, PLANEACION: { modulo: 'PLANEACION', rol: 'APROBACION', detalle_sensible: false } } },
    { id: 4, correo: 'consulta@demo.finantia', nombre: 'Consulta (demo)', activo: true, es_superusuario: false, ultimo_ingreso: null, accesos: { PRESUPUESTO: { modulo: 'PRESUPUESTO', rol: 'VISUALIZACION', detalle_sensible: false }, PLANEACION: { modulo: 'PLANEACION', rol: 'VISUALIZACION', detalle_sensible: false } } }
  ],
  aprob: { modulo: 'PRESUPUESTO', aprobaciones_requeridas: 1, en_orden: false, actualizado_en: ahora(), aprobadores: [] },
  ejercicios: [], versiones: [], decisiones: [], bitacora: [], archivos: [], nomina: [], evaluacion: {},
  datos: null, base: null
};
const reg = (usuarioId, modulo, accion, extra = {}) => S.bitacora.push({ id: S.bitacora.length + 1, fecha: ahora(), usuario_id: usuarioId, modulo, accion, entidad: null, entidad_id: null, antes: null, despues: null, detalle: null, ...extra });
const usuario = id => S.usuarios.find(u => u.id === id) || falla('NO_ENCONTRADO', `No existe el usuario ${id}`);
const actorDe = u => ({ ...u, accesos: u.accesos, modulosActivos: new Set(MODULOS.filter(m => m.activo).map(m => m.codigo)) });

function resumen(x) {
  const t = x.presupuesto.tot;
  return {
    tot: t, unidades: x.presupuesto.units.map(u => ({ IB: u.IB, DS: u.DS, NET: u.NET, OI: u.OI, N: u.N, C: u.C, TC: u.TC, EBITDA: u.EBITDA, RN: u.RN })),
    eerr: x.pyg.tot, eerrUnidades: x.pyg.units, proyeccion: x.proyeccion.rows, metricas: x.metricas, mensual: x.mensualPyG,
    caja: { saldoFinal: x.caja.saldoFinal, saldoMinimo: x.caja.saldoMinimo, mesMinimo: x.caja.mesMinimo, mesesBajoMinimo: x.caja.mesesBajoMinimo, meses: x.caja.meses },
    motorVersion: 'demo', calculadoEn: ahora()
  };
}
const recalcular = v => { const m = crearModelo(S.datos, v.supuestos); v.resultados = Object.fromEntries(ESCS.map(e => [e, resumen(m.escenario(e))])); return m; };

async function iniciar() {
  if (S.datos) return;
  S.datos = await (await fetch(new URL('../datos/base2026.json', import.meta.url))).json();
  S.mapaNomina = await (await fetch(new URL('../datos/nomina_mapa.json', import.meta.url))).json();
  const m = crearModelo(S.datos), g = m.pyg2026();
  S.base = { units: S.datos.units, names: S.datos.names, base2026: m.base2026, eerr2026: g.tot, eerr2026Unidades: g.units };
  S.ejercicios.push({ anio: 2027, estado: 'ABIERTO', creado_en: ahora() });
  reg(2, 'PRESUPUESTO', 'CREAR_EJERCICIO', { entidad: 'ejercicio', entidad_id: '2027' });
  nuevaVersion(2, { ejercicio: 2027, nombre: 'Presupuesto 2027 · propuesta inicial', copiaDe: null, supuestos: {} });
  const ev = await (await fetch(new URL('../datos/evaluacion2027.json', import.meta.url))).json();
  S.evaluacion[2027] = { ...validarEvaluacion(ev), cargadoEn: ahora(), cargadoPor: 'Equipo financiero (demo)' };
}

function nuevaVersion(uid, { ejercicio, nombre, copiaDe, supuestos }) {
  const ej = S.ejercicios.find(e => e.anio === ejercicio) || falla('NO_ENCONTRADO', `No existe el ejercicio ${ejercicio}`);
  if (ej.estado !== 'ABIERTO') falla('ESTADO_INVALIDO', `El ejercicio ${ejercicio} está cerrado`);
  let sup = supuestos;
  if (copiaDe) sup = mezclar(versionDe(copiaDe).supuestos, supuestos);
  const v = { id: S.versiones.length + 1, ejercicio, numero: S.versiones.filter(x => x.ejercicio === ejercicio).length + 1, nombre, estado: 'BORRADOR', datos_base_id: 1, supuestos: sup || {},
    escenario_oficial: null, copia_de: copiaDe, ronda: 1, creada_en: ahora(), creada_por: uid, enviada_en: null, enviada_por: null, aprobada_en: null, reemplazada_en: null, reemplazada_por: null, lineas: [] };
  recalcular(v); S.versiones.push(v);
  reg(uid, 'PRESUPUESTO', 'CREAR_VERSION', { entidad: 'version', entidad_id: String(v.id), despues: { ejercicio, numero: v.numero, nombre, datosBaseId: 1, copiaDe } });
  return v.id;
}
const versionDe = id => S.versiones.find(v => v.id === id) || falla('NO_ENCONTRADO', `No existe la versión ${id}`);

function perfil(a) {
  const modulos = [...a.modulosActivos].filter(m => m !== 'ADMINISTRACION').map(m => ({
    modulo: m, rol: a.accesos[m]?.rol || (a.es_superusuario ? 'SUPERUSUARIO' : null),
    ver: puede(a, m, 'ver'), editar: puede(a, m, 'editar'), aprobar: puede(a, m, 'aprobar'), detalleSensible: veDetalleSensible(a, m)
  })).filter(x => x.ver);
  return { id: a.id, nombre: a.nombre, correo: a.correo, superusuario: a.es_superusuario, modulos, admin: { ver: puede(a, 'ADMINISTRACION', 'ver'), editar: puede(a, 'ADMINISTRACION', 'editar') } };
}
const sensible = (a, acc, que) => { exigir(a, 'PRESUPUESTO', acc); if (!veDetalleSensible(a, 'PRESUPUESTO')) falla('NO_AUTORIZADO', `Sin permiso para ver ${que} (requiere el detalle sensible del módulo Presupuesto)`); };
const vista = v => { const { lineas, ...r } = v; return { ...r, decisiones: S.decisiones.filter(d => d.version_id === v.id).map(({ version_id, usuario_id, ...d }) => ({ ...d, nombre: usuario(usuario_id).nombre })) }; };
const entero = x => { const n = Number(x); if (!Number.isInteger(n)) falla('DATOS_INVALIDOS', `Número inválido: ${x}`); return n; };

/* ---------- rutas (mismas de servidor/web/api.js) ---------- */
const R = [];
const ruta = (metodo, patron, fn) => R.push({ metodo, patron: new RegExp('^' + patron.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

ruta('POST', '/api/ingreso', ({ a }) => { usuario(a.id).ultimo_ingreso = ahora(); reg(a.id, 'ADMINISTRACION', 'INGRESO', { entidad: 'usuario', entidad_id: String(a.id), detalle: 'demostración' }); return perfil(a); });
ruta('GET', '/api/yo', ({ a }) => perfil(a));

/* Administración */
ruta('GET', '/api/admin/modulos', ({ a }) => { exigir(a, 'ADMINISTRACION', 'ver'); return MODULOS; });
ruta('GET', '/api/admin/usuarios', ({ a }) => { exigir(a, 'ADMINISTRACION', 'ver'); return [...S.usuarios].sort((x, y) => x.nombre.localeCompare(y.nombre)).map(u => ({ ...u, accesos: Object.values(u.accesos) })); });
ruta('POST', '/api/admin/usuarios', ({ a, b }) => {
  exigir(a, 'ADMINISTRACION', 'editar');
  const c = String(b.correo || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) falla('DATOS_INVALIDOS', 'Correo inválido');
  if (!String(b.nombre || '').trim()) falla('DATOS_INVALIDOS', 'Falta el nombre');
  if (S.usuarios.some(u => u.correo === c)) falla('ESTADO_INVALIDO', `Ya existe un usuario con el correo ${c}`);
  const id = Math.max(...S.usuarios.map(u => u.id)) + 1;
  S.usuarios.push({ id, correo: c, nombre: String(b.nombre).trim(), activo: true, es_superusuario: false, ultimo_ingreso: null, accesos: {} });
  reg(a.id, 'ADMINISTRACION', 'CREAR_USUARIO', { entidad: 'usuario', entidad_id: String(id), despues: { correo: c, nombre: b.nombre } });
  return { id };
});
ruta('PATCH', '/api/admin/usuarios/:id', ({ a, p, b }) => {
  exigir(a, 'ADMINISTRACION', 'editar');
  const u = usuario(entero(p.id));
  const quedan = () => S.usuarios.filter(x => x.es_superusuario && x.activo).length;
  if ('activo' in b) { if (!b.activo && u.es_superusuario && quedan() === 1) falla('ESTADO_INVALIDO', 'Debe quedar al menos un Superusuario activo'); u.activo = !!b.activo; reg(a.id, 'ADMINISTRACION', b.activo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO', { entidad: 'usuario', entidad_id: String(u.id) }); }
  if ('superusuario' in b) { if (!b.superusuario && u.es_superusuario && quedan() === 1) falla('ESTADO_INVALIDO', 'Debe quedar al menos un Superusuario activo'); u.es_superusuario = !!b.superusuario; reg(a.id, 'ADMINISTRACION', 'CAMBIAR_SUPERUSUARIO', { entidad: 'usuario', entidad_id: String(u.id), despues: { es_superusuario: u.es_superusuario } }); }
});
ruta('PUT', '/api/admin/usuarios/:id/accesos/:modulo', ({ a, p, b }) => {
  exigir(a, 'ADMINISTRACION', 'editar');
  if (!ROLES.includes(b.rol)) falla('DATOS_INVALIDOS', `Rol desconocido: ${b.rol}`);
  const u = usuario(entero(p.id));
  u.accesos[p.modulo] = { modulo: p.modulo, rol: b.rol, detalle_sensible: !!b.detalleSensible };
  reg(a.id, 'ADMINISTRACION', 'ASIGNAR_ACCESO', { entidad: 'acceso', entidad_id: `${u.id}/${p.modulo}`, despues: { rol: b.rol, detalle_sensible: !!b.detalleSensible } });
});
ruta('DELETE', '/api/admin/usuarios/:id/accesos/:modulo', ({ a, p }) => { exigir(a, 'ADMINISTRACION', 'editar'); const u = usuario(entero(p.id)); delete u.accesos[p.modulo]; reg(a.id, 'ADMINISTRACION', 'QUITAR_ACCESO', { entidad: 'acceso', entidad_id: `${u.id}/${p.modulo}` }); });
ruta('GET', '/api/admin/aprobacion/:modulo', ({ a }) => { exigir(a, 'ADMINISTRACION', 'ver'); return clone(S.aprob); });
ruta('PUT', '/api/admin/aprobacion/:modulo', ({ a, b }) => {
  exigir(a, 'ADMINISTRACION', 'editar');
  const n = Number(b.aprobacionesRequeridas ?? 1), orden = !!b.enOrden, lista = b.aprobadores || [];
  if (!Number.isInteger(n) || n < 1 || n > 5) falla('DATOS_INVALIDOS', 'Las aprobaciones requeridas van de 1 a 5');
  if (orden && lista.length !== n) falla('DATOS_INVALIDOS', `Con orden fijo se necesitan exactamente ${n} aprobadores`);
  const aprobadores = S.usuarios.filter(u => u.activo && u.accesos.PRESUPUESTO?.rol === 'APROBACION');
  if (!orden && aprobadores.length < n) falla('DATOS_INVALIDOS', `Solo hay ${aprobadores.length} usuarios con rol Aprobación en PRESUPUESTO; se piden ${n}`);
  if (orden && lista.some(id => !aprobadores.some(u => u.id === id))) falla('DATOS_INVALIDOS', 'Un aprobador no tiene el rol Aprobación activo');
  Object.assign(S.aprob, { aprobaciones_requeridas: n, en_orden: orden, aprobadores: orden ? lista : [], actualizado_en: ahora() });
  reg(a.id, 'ADMINISTRACION', 'CONFIGURAR_APROBACION', { entidad: 'config_aprobacion', entidad_id: 'PRESUPUESTO', despues: { aprobaciones_requeridas: n, en_orden: orden } });
});
ruta('GET', '/api/admin/bitacora', ({ a, q }) => {
  exigir(a, 'ADMINISTRACION', 'ver');
  return [...S.bitacora].reverse().filter(x => (!q.modulo || x.modulo === q.modulo) && (!q.usuario || x.usuario_id === Number(q.usuario)) && (!q.desde || x.fecha >= q.desde) && (!q.hasta || x.fecha < q.hasta))
    .slice(0, Math.min(Number(q.limite) || 200, 1000)).map(x => ({ ...x, correo: x.usuario_id ? usuario(x.usuario_id).correo : null }));
});

/* Presupuesto */
ruta('GET', '/api/presupuesto/ejercicios', ({ a }) => { exigir(a, 'PRESUPUESTO', 'ver'); return [...S.ejercicios].sort((x, y) => y.anio - x.anio).map(e => ({ ...e, versiones: S.versiones.filter(v => v.ejercicio === e.anio).length, aprobada: S.versiones.find(v => v.ejercicio === e.anio && v.estado === 'APROBADA')?.id ?? null })); });
ruta('POST', '/api/presupuesto/ejercicios', ({ a, b }) => {
  exigir(a, 'PRESUPUESTO', 'editar');
  const anio = entero(b.anio);
  if (anio < 2026 || anio > 2100) falla('DATOS_INVALIDOS', `Año inválido: ${anio}`);
  if (S.ejercicios.some(e => e.anio === anio)) falla('ESTADO_INVALIDO', `El ejercicio ${anio} ya existe`);
  S.ejercicios.push({ anio, estado: 'ABIERTO', creado_en: ahora() });
  reg(a.id, 'PRESUPUESTO', 'CREAR_EJERCICIO', { entidad: 'ejercicio', entidad_id: String(anio) });
});
ruta('GET', '/api/presupuesto/datos-base', ({ a }) => { exigir(a, 'PRESUPUESTO', 'ver'); return [{ id: 1, anio_base: 2026, descripcion: 'Base 2026E (Excel v21)', huella: '—', cargado_en: S.ejercicios[0].creado_en }]; });
ruta('GET', '/api/presupuesto/datos-base/:id', ({ a }) => { exigir(a, 'PRESUPUESTO', 'ver'); return sinAuxiliar(S.datos, a); });
ruta('GET', '/api/presupuesto/ejercicios/:anio/versiones', ({ a, p }) => {
  exigir(a, 'PRESUPUESTO', 'ver');
  return S.versiones.filter(v => v.ejercicio === Number(p.anio)).map(({ id, numero, nombre, estado, escenario_oficial, ronda, creada_en, enviada_en, aprobada_en, reemplazada_por }) => ({ id, numero, nombre, estado, escenario_oficial, ronda, creada_en, enviada_en, aprobada_en, reemplazada_por }));
});
ruta('POST', '/api/presupuesto/versiones', ({ a, b }) => {
  exigir(a, 'PRESUPUESTO', 'editar');
  validarSupuestos(b.supuestos || {});
  return { id: nuevaVersion(a.id, { ejercicio: entero(b.ejercicio), nombre: String(b.nombre || '').trim() || 'Versión sin nombre', copiaDe: b.copiaDe ? entero(b.copiaDe) : null, supuestos: b.supuestos || {} }) };
});
ruta('GET', '/api/planeacion/flujo', ({ a, q }) => {
  exigir(a, 'PLANEACION', 'ver');
  const anios = S.ejercicios.map(e => e.anio).sort((x, y) => y - x);
  const anio = q.ejercicio ? entero(q.ejercicio) : anios[0] ?? null;
  if (anio == null) return { ejercicios: [], ejercicio: null, versiones: [], version: null };
  if (!anios.includes(anio)) falla('NO_ENCONTRADO', `No existe el ejercicio ${anio}`);
  const versiones = S.versiones.filter(v => v.ejercicio === anio).map(({ id, numero, nombre, estado, escenario_oficial, aprobada_en }) => ({ id, numero, nombre, estado, escenario_oficial, aprobada_en }));
  const v = q.version ? versiones.find(x => x.id === entero(q.version)) : versionPorDefecto(versiones);
  if (q.version && !v) falla('NO_ENCONTRADO', `La versión ${q.version} no es del ejercicio ${anio}`);
  if (!v) return { ejercicios: anios, ejercicio: anio, versiones, version: null };
  return { ejercicios: anios, ejercicio: anio, versiones, version: { ...v, ejercicio: anio, resultados: soloFlujo(versionDe(v.id).resultados) } };
});
ruta('GET', '/api/presupuesto/versiones/:id', ({ a, p }) => { exigir(a, 'PRESUPUESTO', 'ver'); return { ...vista(versionDe(entero(p.id))), base: S.base, porDefecto: DEFAULTS, cintanaUSD: FIXED.cintanaUSD }; });
ruta('PATCH', '/api/presupuesto/versiones/:id/supuestos', ({ a, p, b }) => {
  exigir(a, 'PRESUPUESTO', 'editar');
  validarSupuestos(b);
  const v = versionDe(entero(p.id));
  if (v.estado !== 'BORRADOR') falla('ESTADO_INVALIDO', `La versión está ${v.estado}; solo se editan borradores`);
  v.supuestos = mezclar(v.supuestos, b); recalcular(v);
  reg(a.id, 'PRESUPUESTO', 'EDITAR_SUPUESTOS', { entidad: 'version', entidad_id: String(v.id), despues: b });
});
ruta('POST', '/api/presupuesto/versiones/:id/enviar', ({ a, p }) => {
  exigir(a, 'PRESUPUESTO', 'editar');
  const v = versionDe(entero(p.id));
  if (v.estado !== 'BORRADOR') falla('ESTADO_INVALIDO', `Solo se envía un borrador (está ${v.estado})`);
  Object.assign(v, { estado: 'EN_REVISION', enviada_en: ahora(), enviada_por: a.id });
  reg(a.id, 'PRESUPUESTO', 'ENVIAR_REVISION', { entidad: 'version', entidad_id: String(v.id), antes: { estado: 'BORRADOR' }, despues: { estado: 'EN_REVISION', ronda: v.ronda } });
});
ruta('POST', '/api/presupuesto/versiones/:id/aprobar', ({ a, p, b }) => {
  exigir(a, 'PRESUPUESTO', 'aprobar');
  if (b.escenarioOficial && !ESCS.includes(b.escenarioOficial)) falla('DATOS_INVALIDOS', `Escenario desconocido: ${b.escenarioOficial}`);
  const v = versionDe(entero(p.id));
  if (v.estado !== 'EN_REVISION') falla('ESTADO_INVALIDO', `Solo se aprueba una versión en revisión (está ${v.estado})`);
  if (v.enviada_por === a.id) falla('NO_AUTORIZADO', 'Quien envió la versión no puede aprobarla');
  const previas = S.decisiones.filter(d => d.version_id === v.id && d.ronda === v.ronda && d.decision === 'APROBAR').map(d => d.usuario_id);
  if (previas.includes(a.id)) falla('ESTADO_INVALIDO', 'Ya aprobó esta versión');
  if (S.aprob.en_orden && S.aprob.aprobadores[previas.length] !== a.id) falla('NO_AUTORIZADO', 'No es su turno de aprobar');
  S.decisiones.push({ version_id: v.id, ronda: v.ronda, usuario_id: a.id, decision: 'APROBAR', observaciones: b.observaciones || null, fecha: ahora() });
  const n = previas.length + 1, req = S.aprob.aprobaciones_requeridas;
  reg(a.id, 'PRESUPUESTO', 'APROBAR', { entidad: 'version', entidad_id: String(v.id), despues: { aprobacion: n, requeridas: req, ronda: v.ronda }, detalle: b.observaciones || null });
  if (n < req) return { estado: 'EN_REVISION', aprobaciones: n, requeridas: req };
  const oficial = b.escenarioOficial || 'Moderado';
  const ant = S.versiones.find(x => x.ejercicio === v.ejercicio && x.estado === 'APROBADA');
  if (ant) { Object.assign(ant, { estado: 'REEMPLAZADA', reemplazada_en: ahora(), reemplazada_por: v.id }); reg(a.id, 'PRESUPUESTO', 'REEMPLAZAR', { entidad: 'version', entidad_id: String(ant.id) }); }
  Object.assign(v, { estado: 'APROBADA', aprobada_en: ahora(), escenario_oficial: oficial });
  v.lineas = lineasMensuales(S.datos, crearModelo(S.datos, v.supuestos).escenario(oficial).pyg).map(l => ({ ...l, valor: Math.round(l.valor * 100) / 100 }));
  reg(a.id, 'PRESUPUESTO', 'VERSION_APROBADA', { entidad: 'version', entidad_id: String(v.id), despues: { estado: 'APROBADA', escenario_oficial: oficial, lineas: v.lineas.length } });
  return { estado: 'APROBADA', aprobaciones: n, requeridas: req };
});
ruta('POST', '/api/presupuesto/versiones/:id/devolver', ({ a, p, b }) => {
  exigir(a, 'PRESUPUESTO', 'aprobar');
  if (!String(b.observaciones || '').trim()) falla('DATOS_INVALIDOS', 'Para devolver una versión escriba las observaciones');
  const v = versionDe(entero(p.id));
  if (v.estado !== 'EN_REVISION') falla('ESTADO_INVALIDO', `Solo se devuelve una versión en revisión (está ${v.estado})`);
  S.decisiones.push({ version_id: v.id, ronda: v.ronda, usuario_id: a.id, decision: 'DEVOLVER', observaciones: b.observaciones, fecha: ahora() });
  Object.assign(v, { estado: 'BORRADOR', ronda: v.ronda + 1, enviada_en: null, enviada_por: null });
  reg(a.id, 'PRESUPUESTO', 'DEVOLVER', { entidad: 'version', entidad_id: String(v.id), antes: { estado: 'EN_REVISION', ronda: v.ronda - 1 }, despues: { estado: 'BORRADOR', ronda: v.ronda }, detalle: b.observaciones });
});
ruta('GET', '/api/presupuesto/versiones/:id/lineas', ({ a, p, q }) => { exigir(a, 'PRESUPUESTO', 'ver'); return versionDe(entero(p.id)).lineas.filter(l => (!q.unidad || l.unidad === q.unidad) && (!q.mes || l.mes === Number(q.mes))); });
ruta('GET', '/api/presupuesto/versiones/:id/bitacora', ({ a, p }) => {
  exigir(a, 'PRESUPUESTO', 'ver');
  return [...S.bitacora].reverse().filter(x => x.modulo === 'PRESUPUESTO' && x.entidad === 'version' && x.entidad_id === p.id).map(x => ({ fecha: x.fecha, nombre: usuario(x.usuario_id).nombre, accion: x.accion, antes: x.antes, despues: x.despues, detalle: x.detalle }));
});

/* Archivos: quedan solo en esta pestaña del navegador */
ruta('GET', '/api/presupuesto/ejercicios/:anio/archivos', ({ a, p }) => { exigir(a, 'PRESUPUESTO', 'ver'); return S.archivos.filter(x => x.ejercicio === Number(p.anio) && !x.retirado).map(({ contenido, ...x }) => x).reverse(); });
ruta('POST', '/api/presupuesto/ejercicios/:anio/archivos', async ({ a, p, b, cab }) => {
  exigir(a, 'PRESUPUESTO', 'editar');
  const nombre = decodeURIComponent(cab['X-Nombre'] || '').replace(/[\\/\x00-\x1f"<>|:*?]/g, '_').slice(0, 180);
  if (b.size > 15 * 1024 * 1024) falla('DATOS_INVALIDOS', 'El archivo supera 15 MB');
  const id = S.archivos.length + 1;
  S.archivos.push({ id, ejercicio: Number(p.anio), nombre, tipo: b.type || 'application/octet-stream', tamano: b.size, descripcion: cab['X-Descripcion'] ? decodeURIComponent(cab['X-Descripcion']) : null, huella: '—', subido_en: ahora(), subido_por: a.nombre, contenido: b });
  reg(a.id, 'PRESUPUESTO', 'SUBIR_ARCHIVO', { entidad: 'archivo', entidad_id: String(id), despues: { nombre, tamano: b.size } });
  return { id };
});
ruta('GET', '/api/presupuesto/archivos/:id', ({ a, p }) => { exigir(a, 'PRESUPUESTO', 'ver'); const x = S.archivos.find(f => f.id === Number(p.id) && !f.retirado) || falla('NO_ENCONTRADO', 'El archivo no existe o fue retirado'); return x.contenido; });
ruta('DELETE', '/api/presupuesto/archivos/:id', ({ a, p }) => { exigir(a, 'PRESUPUESTO', 'editar'); const x = S.archivos.find(f => f.id === Number(p.id) && !f.retirado) || falla('NO_ENCONTRADO', 'El archivo no existe o ya fue retirado'); x.retirado = true; reg(a.id, 'PRESUPUESTO', 'RETIRAR_ARCHIVO', { entidad: 'archivo', entidad_id: p.id }); });

/* Nómina por cargo: se lee en el navegador y no sale de él (en el servidor real va cifrada) */
ruta('GET', '/api/presupuesto/ejercicios/:anio/nomina', ({ a, p }) => {
  sensible(a, 'ver', 'la nómina por cargo');
  const c = S.nomina.find(n => n.ejercicio === Number(p.anio) && !n.retirado);
  if (!c) return { activa: true, carga: null, filas: [] };
  reg(a.id, 'PRESUPUESTO', 'VER_NOMINA', { entidad: 'nomina', entidad_id: String(c.id) });
  return { activa: true, carga: c.carga, avisos: avisosCarga(c.contenido), filas: c.filas, ...(c.personas ? { personas: c.personas } : {}) };
});
const opPlan = (sm = DEFAULTS.Moderado.sm) => ({ REP: S.datos.REP, nLineas: S.datos.LP.length, sm27: smmlv2027(sm) });
ruta('POST', '/api/presupuesto/versiones/:id/nomina', ({ a, p, b }) => {
  sensible(a, 'editar', 'la nómina por cargo');
  const v = S.versiones.find(x => x.id === Number(p.id)) || falla('NO_ENCONTRADO', `No existe la versión ${p.id}`);
  if (v.estado !== 'BORRADOR') falla('ESTADO_INVALIDO', `La versión está ${v.estado}; solo se editan borradores`);
  const { LP: _lp, nominaPlan: antes, ...resto } = v.supuestos || {};
  if (b.modo === null) { v.supuestos = resto; recalcular(v); reg(a.id, 'PRESUPUESTO', 'NOMINA_VERSION', { entidad: 'version', entidad_id: String(v.id), antes }); return null; }
  if (!MODOS.some(([m]) => m === b.modo)) falla('DATOS_INVALIDOS', `Modo desconocido: ${b.modo}`);
  const c = S.nomina.find(n => n.ejercicio === v.ejercicio && !n.retirado);
  if (!c || !c.personas) falla('ESTADO_INVALIDO', 'Para aplicar la nómina a la versión, suba primero el plan por persona del ejercicio');
  const personas = b.personas || {};
  const plan = planNomina(c.personas, { ...opPlan(v.supuestos?.params?.Moderado?.sm), modo: b.modo, personasPorProceso: personas });
  const nominaPlan = { cargaId: c.id, huella: '—', modo: b.modo, personas, total: plan.total };
  v.supuestos = { ...resto, LP: plan.LP, nominaPlan }; recalcular(v);
  reg(a.id, 'PRESUPUESTO', 'NOMINA_VERSION', { entidad: 'version', entidad_id: String(v.id), antes, despues: nominaPlan });
  return nominaPlan;
});
ruta('POST', '/api/presupuesto/ejercicios/:anio/nomina', async ({ a, p, b, cab }) => {
  sensible(a, 'editar', 'la nómina por cargo');
  const nombre = decodeURIComponent(cab['X-Nombre'] || '');
  const inflar = async d => new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const celdas = await filasDelArchivo(nombre, new Uint8Array(await b.arrayBuffer()), inflar);
  const previo = S.nomina.find(n => n.ejercicio === Number(p.anio) && !n.retirado)?.contenido || null;
  const contenido = contenidoDeArchivo(celdas, previo, { mapa: S.mapaNomina, nLineas: S.datos.LP.length });
  const personas = contenido.formato === 'personas' ? contenido.personas : null;
  const filas = personas ? filasDePersonas(planNomina(personas, opPlan())) : contenido.formato === 'bdd' ? [] : contenido;
  S.nomina.filter(n => n.ejercicio === Number(p.anio)).forEach(n => { n.retirado = true; n.filas = []; n.personas = null; n.contenido = null; });
  const id = S.nomina.length + 1;
  const carga = { id, nombre, filas: filas.length, personas: filas.reduce((s, f) => s + f.continuan + f.nuevos + f.vacantes, 0), costoTotal: filas.reduce((s, f) => s + f.costoAnual, 0), huella: '—', subidoEn: ahora(), subidoPor: a.nombre };
  carga.formato = contenido.formato || 'cargos'; if (personas) carga.filas = personas.length;
  S.nomina.push({ id, ejercicio: Number(p.anio), carga, filas, personas, contenido });
  reg(a.id, 'PRESUPUESTO', 'SUBIR_NOMINA', { entidad: 'nomina', entidad_id: String(id), despues: { filas: filas.length, costoTotal: carga.costoTotal } });
  return { id };
});
ruta('DELETE', '/api/presupuesto/nomina/:id', ({ a, p }) => { sensible(a, 'editar', 'la nómina por cargo'); const c = S.nomina.find(n => n.id === Number(p.id) && !n.retirado) || falla('NO_ENCONTRADO', 'La carga de nómina no existe o ya fue retirada'); c.retirado = true; c.filas = []; c.personas = null; c.contenido = null; reg(a.id, 'PRESUPUESTO', 'RETIRAR_NOMINA', { entidad: 'nomina', entidad_id: p.id }); });

/* Evaluación del equipo (solo 2027) */
ruta('GET', '/api/presupuesto/ejercicios/:anio/evaluacion', ({ a, p }) => {
  sensible(a, 'ver', 'la evaluación del equipo');
  if (!EJ_EVALUACION.includes(Number(p.anio))) falla('NO_ENCONTRADO', `La evaluación del equipo solo existe para el ejercicio ${EJ_EVALUACION.join(', ')}`);
  return { evaluacion: S.evaluacion[p.anio] || null };
});
ruta('PUT', '/api/presupuesto/ejercicios/:anio/evaluacion', ({ a, p, b }) => {
  sensible(a, 'editar', 'la evaluación del equipo');
  if (!EJ_EVALUACION.includes(Number(p.anio))) falla('NO_ENCONTRADO', `La evaluación del equipo solo existe para el ejercicio ${EJ_EVALUACION.join(', ')}`);
  S.evaluacion[p.anio] = { ...validarEvaluacion(b), cargadoEn: ahora(), cargadoPor: a.nombre };
  reg(a.id, 'PRESUPUESTO', 'CARGAR_EVALUACION', { entidad: 'evaluacion', entidad_id: p.anio });
  return { ok: true };
});

/* Asistente: en la demostración no hay llave de la API */
ruta('GET', '/api/presupuesto/versiones/:id/preguntas', ({ a }) => { exigir(a, 'PRESUPUESTO', 'ver'); return { activo: false, preguntas: [] }; });
ruta('POST', '/api/presupuesto/versiones/:id/preguntas', () => falla('NO_DISPONIBLE', 'El asistente no está activo en la demostración.'));

/** Igual que `api()` de web/comun.js, pero respondido aquí. */
export async function apiDemo(metodo, rutaCompleta, cuerpo, { binario = false, cab = {}, correo = null } = {}) {
  await iniciar();
  const url = new URL(rutaCompleta, 'http://demo');
  try {
    if (url.pathname === '/api/config') return { modo: 'desarrollo' };
    if (url.pathname === '/api/desarrollo/usuarios') return S.usuarios.filter(u => u.activo).map(({ correo: c, nombre, es_superusuario }) => ({ correo: c, nombre, es_superusuario })).sort((x, y) => x.nombre.localeCompare(y.nombre));
    for (const r of R) {
      if (r.metodo !== metodo) continue;
      const m = url.pathname.match(r.patron); if (!m) continue;
      const u = S.usuarios.find(x => x.correo === correo);
      if (!correo) falla('SIN_SESION', 'Inicie sesión');
      if (!u || !u.activo) falla('NO_AUTORIZADO', 'Usuario no registrado en Finantia');
      const out = await r.fn({ a: actorDe(u), p: m.groups || {}, q: Object.fromEntries(url.searchParams), b: cuerpo === undefined ? {} : cuerpo instanceof Blob ? cuerpo : clone(cuerpo), cab });
      return out === undefined ? { ok: true } : binario ? out : clone(out);
    }
    falla('NO_ENCONTRADO', 'Ruta no encontrada');
  } catch (e) {
    const err = new Error(e instanceof ErrorFinantia ? e.message : 'Error interno de la demostración');
    err.status = e instanceof ErrorFinantia ? HTTP[e.codigo] || 400 : 500;
    if (!(e instanceof ErrorFinantia)) console.error(e);
    throw err;
  }
}
