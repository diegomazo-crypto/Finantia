/* Finantia 2.0 · utilidades comunes de las pantallas: formatos, sesión y llamadas a la API. */

export const ganchos = {};
export const $ = s => document.querySelector(s);
export const app = $('#app');
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ESCS = ['Pesimista', 'Moderado', 'Optimista'];
export const ESTADOS = { BORRADOR: 'Borrador', EN_REVISION: 'En revisión', APROBADA: 'Aprobada', REEMPLAZADA: 'Reemplazada' };
export const ROLES = { VISUALIZACION: 'Visualización', ADMINISTRACION: 'Administración', APROBACION: 'Aprobación' };
export const ACCIONES = {
  INGRESO: 'Ingresó', CREAR_USUARIO: 'Creó un usuario', ACTIVAR_USUARIO: 'Activó un usuario', DESACTIVAR_USUARIO: 'Desactivó un usuario', CAMBIAR_ACTIVO: 'Cambió el estado de un usuario',
  ASIGNAR_ACCESO: 'Asignó un acceso', QUITAR_ACCESO: 'Quitó un acceso', CONFIGURAR_APROBACION: 'Configuró la aprobación',
  CARGAR_DATOS_BASE: 'Cargó datos base', CREAR_EJERCICIO: 'Abrió un ejercicio', CREAR_VERSION: 'Creó la versión', EDITAR_SUPUESTOS: 'Editó supuestos', EDITAR_SUPUESTOS_PLANEACION: 'Editó supuestos de planeación',
  ENVIAR_REVISION: 'Envió a revisión', APROBAR: 'Aprobó', DEVOLVER: 'Devolvió', VERSION_APROBADA: 'La versión quedó aprobada', REEMPLAZAR: 'Quedó reemplazada', CAMBIAR_SUPERUSUARIO: 'Cambió superusuario', INICIALIZAR: 'Inicializó Finantia',
  SUBIR_ARCHIVO: 'Subió un archivo', RETIRAR_ARCHIVO: 'Retiró un archivo', PREGUNTAR: 'Preguntó al asistente',
  SUBIR_NOMINA: 'Cargó la nómina por cargo', VER_NOMINA: 'Consultó la nómina por cargo', RETIRAR_NOMINA: 'Retiró la nómina por cargo', CARGAR_EVALUACION: 'Cargó la evaluación del equipo',
  GENERAR_CLAVE_PRUEBAS: 'Generó una clave del sitio de pruebas', QUITAR_CLAVE_PRUEBAS: 'Quitó una clave del sitio de pruebas',
  SUBIR_BALANCE: 'Subió un balance de prueba', BORRAR_BALANCE: 'Quitó un balance de prueba', SUBIR_BASE_EJECUCION: 'Cargó la base de ejecución', BORRAR_BASE_EJECUCION: 'Quitó la base de ejecución', BORRAR_VERSION: 'Borró una versión'
};

/* ---------- formatos ---------- */
export const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const nf1 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const mill = v => Math.round(v / 1e6); /* el signo se decide después de redondear: nunca «−0» */
export const M = v => v == null || !isFinite(v) ? '—' : (mill(v) < 0 ? '−' : '') + '$' + nf0.format(Math.abs(mill(v))) + ' M';
export const Mn = v => v == null || !isFinite(v) ? '—' : (mill(v) < 0 ? '−' : '') + nf0.format(Math.abs(mill(v)));
export const P = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '') + nf1.format(Math.abs(v) * 100) + '%';
export const cls = v => v < 0 ? 'neg' : '';
export const fecha = s => s ? new Date(s).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/* ---------- sesión ---------- */
export const sesion = { config: null, perfil: null, token: null, correo: null, msal: null };
export const almacen = {
  leer(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  poner(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
};

export function cabeceras(extra = {}) {
  const h = { 'X-Finantia': '1', ...extra };
  if (sesion.token) h.Authorization = 'Bearer ' + sesion.token;
  if (sesion.correo) h['X-Finantia-Correo'] = sesion.correo;
  return h;
}

/**
 * Llama a la API. `cuerpo` es JSON salvo que sea un Blob o un File (se envía tal cual).
 * Con `{ binario: true }` devuelve un Blob (descargas).
 */
export async function api(metodo, ruta, cuerpo, { binario = false, cab = {} } = {}) {
  const crudo = cuerpo instanceof Blob;
  const h = cabeceras(cab);
  if (cuerpo !== undefined && !crudo) h['Content-Type'] = 'application/json';
  if (crudo) h['Content-Type'] = 'application/octet-stream';
  const r = await fetch(ruta, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : crudo ? cuerpo : JSON.stringify(cuerpo) });
  if (r.ok && binario) return r.blob();
  const datos = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    if (r.status === 401 && ruta !== '/api/ingreso') ganchos.sinSesion?.();
    const e = new Error(datos?.error || `Error ${r.status}`); e.status = r.status; throw e;
  }
  return datos;
}

export function aviso(texto, error = false) {
  const a = $('#aviso'); a.textContent = texto; a.className = error ? 'error' : ''; a.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => { a.hidden = true; }, error ? 6000 : 3000);
}
export async function accion(fn, ok) {
  try { const r = await fn(); if (ok) aviso(ok); return r; } catch (e) { aviso(e.message, true); throw e; }
}

export const modulo = c => sesion.perfil.modulos.find(m => m.modulo === c);
export const kpi = (t, v, sub = '') => `<div class="kpi"><small>${t}</small><b class="${v < 0 ? 'neg' : ''}">${M(v)}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
export const nfMil = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
/** Pone el ancho (y la posición) de las barras después de pintar: la CSP no permite estilos en línea en el HTML. */
export function anchos(raiz) { raiz.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; el.style.left = (el.dataset.l || 0) + '%'; }); }


/* Estructura del estado de resultados (misma de Finantia 1.0) */
export const EERR = [
  ['IB', 'Ingreso bruto', 'sub'], ['DS', 'Descuentos y becas', 'det', -1], ['NET', 'Ingreso neto', 'sub'],
  ['PRESTACION', 'Costo de prestación', 'det'], ['ADM_ACADEMICA', 'Administración académica', 'det'], ['UNIDADES', 'Unidades de negocio', 'det'], ['VENTAS', 'Ventas y mercadeo', 'det'],
  ['CD', 'Costos directos', 'sub'], ['MB', 'Margen bruto', 'sub'],
  ['TECNOLOGIA', 'Tecnología', 'det'], ['CORPORATIVO', 'Corporativo', 'det'], ['ADMINISTRATIVOS', 'Administrativos', 'det'], ['DIRECCION', 'Dirección', 'det'],
  ['GO', 'Gastos de operación', 'sub'], ['RO', 'Resultado operacional', 'sub'],
  ['OTROS_INGRESOS', 'Otros ingresos', 'det'], ['BANCARIOS', 'Gastos bancarios', 'det', -1], ['DA', 'Depreciación y amortización', 'det', -1], ['OTROS_GASTOS', 'Otros gastos', 'det', -1],
  ['RN', 'Resultado neto', 'total'], ['EBITDA', 'EBITDA', 'sub']
];
