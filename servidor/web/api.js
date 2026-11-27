/** Rutas de la API. Cada ruta llama a un servicio, que es quien revisa los permisos. */
import * as A from '../admin/admin.js';
import { puede, veDetalleSensible } from '../admin/permisos.js';
import * as P from '../presupuesto/servicio.js';
import * as AR from '../presupuesto/archivos.js';
import { falla, DATOS_INVALIDOS } from '../errores.js';
import { DEFAULTS } from '../../motor/parametros.js';

const ruta = (metodo, patron, fn, extra = {}) => ({ metodo, patron: new RegExp('^' + patron.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, ...extra });
const entero = v => { const n = Number(v); if (!Number.isInteger(n)) falla(DATOS_INVALIDOS, `Número inválido: ${v}`); return n; };

/** Lo que el navegador necesita saber del usuario para armar el menú. */
function perfil(a) {
  const modulos = [...a.modulosActivos].filter(m => m !== 'ADMINISTRACION').map(m => ({
    modulo: m, rol: a.accesos[m]?.rol || (a.es_superusuario ? 'SUPERUSUARIO' : null),
    ver: puede(a, m, 'ver'), editar: puede(a, m, 'editar'), aprobar: puede(a, m, 'aprobar'), detalleSensible: veDetalleSensible(a, m)
  })).filter(x => x.ver);
  const admin = { ver: puede(a, 'ADMINISTRACION', 'ver'), editar: puede(a, 'ADMINISTRACION', 'editar') };
  return { id: a.id, nombre: a.nombre, correo: a.correo, superusuario: a.es_superusuario, modulos, admin };
}

export function rutasApi(db, auth, asistente) {
  const rutas = [
    ruta('GET', '/api/config', () => (auth.modo === 'entra' ? { modo: 'entra', tenant: auth.tenant, clientId: auth.clientId } : { modo: 'desarrollo' }), { publica: true }),
    ruta('POST', '/api/ingreso', ({ actor }) => perfil(actor), { registrarIngreso: true }),
    ruta('GET', '/api/yo', ({ actor }) => perfil(actor)),

    /* Administración */
    ruta('GET', '/api/admin/modulos', ({ actor }) => A.listarModulos(db, actor)),
    ruta('GET', '/api/admin/usuarios', ({ actor }) => A.listarUsuarios(db, actor)),
    ruta('POST', '/api/admin/usuarios', async ({ actor, body }) => ({ id: await A.crearUsuario(db, actor, body) })),
    ruta('PATCH', '/api/admin/usuarios/:id', async ({ actor, params, body }) => {
      const id = entero(params.id);
      if ('activo' in body) await A.cambiarActivo(db, actor, id, !!body.activo);
      if ('superusuario' in body) await A.cambiarSuperusuario(db, actor, id, !!body.superusuario);
    }),
    ruta('PUT', '/api/admin/usuarios/:id/accesos/:modulo', ({ actor, params, body }) =>
      A.asignarAcceso(db, actor, entero(params.id), params.modulo, body.rol, { detalleSensible: !!body.detalleSensible })),
    ruta('DELETE', '/api/admin/usuarios/:id/accesos/:modulo', ({ actor, params }) => A.quitarAcceso(db, actor, entero(params.id), params.modulo)),
    ruta('GET', '/api/admin/aprobacion/:modulo', ({ actor, params }) => A.obtenerConfigAprobacion(db, actor, params.modulo)),
    ruta('PUT', '/api/admin/aprobacion/:modulo', ({ actor, params, body }) => A.configurarAprobacion(db, actor, params.modulo, body)),
    ruta('GET', '/api/admin/bitacora', ({ actor, query }) => A.consultarBitacora(db, actor, {
      modulo: query.modulo || null, usuarioId: query.usuario ? entero(query.usuario) : null, desde: query.desde || null, hasta: query.hasta || null, limite: query.limite || 200
    })),

    /* Presupuesto */
    ruta('GET', '/api/presupuesto/ejercicios', ({ actor }) => P.listarEjercicios(db, actor)),
    ruta('POST', '/api/presupuesto/ejercicios', ({ actor, body }) => P.crearEjercicio(db, actor, entero(body.anio))),
    ruta('GET', '/api/presupuesto/datos-base', ({ actor }) => P.listarDatosBase(db, actor)),
    ruta('GET', '/api/presupuesto/ejercicios/:anio/versiones', ({ actor, params }) => P.listarVersiones(db, actor, entero(params.anio))),
    ruta('POST', '/api/presupuesto/versiones', async ({ actor, body }) => ({ id: await P.crearVersion(db, actor, {
      ejercicio: entero(body.ejercicio), nombre: String(body.nombre || '').trim() || 'Versión sin nombre',
      datosBaseId: body.datosBaseId ? entero(body.datosBaseId) : null, copiaDe: body.copiaDe ? entero(body.copiaDe) : null, supuestos: body.supuestos || {}
    }) })),
    ruta('GET', '/api/presupuesto/versiones/:id', async ({ actor, params }) => {
      const v = await P.obtenerVersion(db, actor, entero(params.id));
      return { ...v, base: await P.contextoBase(db, actor, v.datos_base_id), porDefecto: DEFAULTS };
    }),
    ruta('PATCH', '/api/presupuesto/versiones/:id/supuestos', ({ actor, params, body }) => P.editarSupuestos(db, actor, entero(params.id), body)),
    ruta('POST', '/api/presupuesto/versiones/:id/enviar', ({ actor, params }) => P.enviarARevision(db, actor, entero(params.id))),
    ruta('POST', '/api/presupuesto/versiones/:id/aprobar', ({ actor, params, body }) => P.aprobar(db, actor, entero(params.id), { observaciones: body.observaciones || null, escenarioOficial: body.escenarioOficial || null })),
    ruta('POST', '/api/presupuesto/versiones/:id/devolver', ({ actor, params, body }) => P.devolver(db, actor, entero(params.id), body.observaciones)),
    ruta('GET', '/api/presupuesto/versiones/:id/lineas', ({ actor, params, query }) => P.lineasPresupuestales(db, actor, entero(params.id), { unidad: query.unidad || null, mes: query.mes ? entero(query.mes) : null })),
    ruta('GET', '/api/presupuesto/versiones/:id/bitacora', ({ actor, params }) => P.historialVersion(db, actor, entero(params.id))),
    ruta('GET', '/api/presupuesto/datos-base/:id', ({ actor, params }) => P.contenidoDatosBase(db, actor, entero(params.id))),

    /* Archivos del ejercicio */
    ruta('GET', '/api/presupuesto/ejercicios/:anio/archivos', ({ actor, params }) => AR.listarArchivos(db, actor, entero(params.anio))),
    ruta('POST', '/api/presupuesto/ejercicios/:anio/archivos', async ({ actor, params, body, headers }) => {
      let nombre, descripcion;
      try { nombre = decodeURIComponent(headers['x-nombre'] || ''); descripcion = headers['x-descripcion'] ? decodeURIComponent(headers['x-descripcion']) : null; }
      catch { falla(DATOS_INVALIDOS, 'Nombre de archivo inválido'); }
      return { id: await AR.subirArchivo(db, actor, entero(params.anio), { nombre, descripcion, contenido: body }) };
    }, { crudo: AR.TAMANO_MAXIMO }),
    ruta('GET', '/api/presupuesto/archivos/:id', async ({ actor, params }) => ({ descarga: await AR.descargarArchivo(db, actor, entero(params.id)) })),
    ruta('DELETE', '/api/presupuesto/archivos/:id', ({ actor, params }) => AR.retirarArchivo(db, actor, entero(params.id))),

    /* Preguntas al asistente */
    ruta('GET', '/api/presupuesto/versiones/:id/preguntas', async ({ actor, params }) => ({ activo: asistente.activo, preguntas: await asistente.historial(db, actor, entero(params.id)) })),
    ruta('POST', '/api/presupuesto/versiones/:id/preguntas', ({ actor, params, body }) => asistente.preguntar(db, actor, entero(params.id), { pregunta: body.pregunta, escenario: body.escenario || 'Moderado' }))
  ];
  if (auth.modo === 'desarrollo') rutas.push(ruta('GET', '/api/desarrollo/usuarios', async () =>
    (await db.query('SELECT correo, nombre, es_superusuario FROM usuario WHERE activo ORDER BY nombre')).rows, { publica: true }));
  return rutas;
}
