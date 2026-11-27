/**
 * Evaluación del presupuesto que propone el equipo financiero frente al modelo.
 *
 * Es un análisis de un solo ejercicio (2027): por decisión de la Rectoría no se repite en los
 * siguientes. Se guarda en la base (no en el repositorio) porque trae observaciones de
 * gobierno y salarios de cargos de dirección; por eso la ven y la cargan solo quienes tienen
 * el detalle sensible del módulo Presupuesto.
 *
 * Lo que se guarda son las cifras del equipo y las lecturas del análisis. La columna del
 * modelo la calcula la pantalla con la versión que se está viendo, salvo en las partidas por
 * proceso, que el modelo no tiene a ese nivel y vienen con su valor del momento del análisis.
 */
import { exigir, veDetalleSensible } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, DATOS_INVALIDOS, NO_AUTORIZADO, NO_ENCONTRADO } from '../errores.js';

const M = 'PRESUPUESTO';
export const EJERCICIOS = [2027];
export const RUBROS = ['NET', 'CD', 'PRESTACION', 'ADM_ACADEMICA', 'UNIDADES', 'VENTAS', 'MB', 'GO', 'TECNOLOGIA', 'CORPORATIVO', 'ADMINISTRATIVOS', 'DIRECCION', 'RO', 'OTROS_INGRESOS', 'BANCARIOS', 'DA', 'OTROS_GASTOS', 'RN'];
export const UNIDADES = ['PRE', 'POS', 'MAE', 'PLUS', 'EXT', 'URE', 'BAQ'];

const texto = (v, max, campo) => {
  if (v == null || v === '') return '';
  if (typeof v !== 'string') falla(DATOS_INVALIDOS, `${campo}: debe ser texto`);
  if (v.length > max) falla(DATOS_INVALIDOS, `${campo}: máximo ${max} caracteres`);
  return v.trim();
};
const cifra = (v, campo) => { if (typeof v !== 'number' || !Number.isFinite(v)) falla(DATOS_INVALIDOS, `${campo}: debe ser un número (pesos)`); return v; };
const lista = (v, max, campo) => { if (v == null) return []; if (!Array.isArray(v)) falla(DATOS_INVALIDOS, `${campo}: debe ser una lista`); if (v.length > max) falla(DATOS_INVALIDOS, `${campo}: máximo ${max} elementos`); return v; };

/** Valida y normaliza el contenido de la evaluación (cifras en pesos). */
export function validarEvaluacion(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) falla(DATOS_INVALIDOS, 'La evaluación debe ser un objeto JSON');
  const rubros = lista(c.rubros, RUBROS.length, 'rubros').map((r, i) => {
    if (!RUBROS.includes(r?.clave)) falla(DATOS_INVALIDOS, `rubros[${i}]: clave desconocida (${r?.clave}). Use: ${RUBROS.join(', ')}`);
    return { clave: r.clave, equipo: cifra(r.equipo, `rubros[${i}].equipo`), lectura: texto(r.lectura, 4000, `rubros[${i}].lectura`) };
  });
  if (new Set(rubros.map(r => r.clave)).size !== rubros.length) falla(DATOS_INVALIDOS, 'rubros: hay claves repetidas');
  const unidades = lista(c.unidades, UNIDADES.length, 'unidades').map((u, i) => {
    if (!UNIDADES.includes(u?.unidad)) falla(DATOS_INVALIDOS, `unidades[${i}]: unidad desconocida (${u?.unidad}). Use: ${UNIDADES.join(', ')}`);
    return { unidad: u.unidad, equipo: cifra(u.equipo, `unidades[${i}].equipo`), lectura: texto(u.lectura, 4000, `unidades[${i}].lectura`) };
  });
  if (new Set(unidades.map(u => u.unidad)).size !== unidades.length) falla(DATOS_INVALIDOS, 'unidades: hay unidades repetidas');
  const partidas = lista(c.partidas, 300, 'partidas').map((p, i) => ({
    codigo: texto(p?.codigo, 20, `partidas[${i}].codigo`), rubro: texto(p?.rubro, 200, `partidas[${i}].rubro`),
    equipo: cifra(p?.equipo, `partidas[${i}].equipo`), modelo: cifra(p?.modelo, `partidas[${i}].modelo`), explicacion: texto(p?.explicacion, 4000, `partidas[${i}].explicacion`)
  }));
  const observaciones = lista(c.observaciones, 30, 'observaciones').map((o, i) => ({ titulo: texto(o?.titulo, 300, `observaciones[${i}].titulo`), texto: texto(o?.texto, 6000, `observaciones[${i}].texto`) }));
  const conclusiones = lista(c.conclusiones, 30, 'conclusiones').map((t, i) => texto(t, 6000, `conclusiones[${i}]`));
  if (!rubros.length && !unidades.length) falla(DATOS_INVALIDOS, 'La evaluación no trae cifras del equipo (rubros o unidades)');
  return { referencia: texto(c.referencia, 1000, 'referencia'), rubros, unidades, partidas, observaciones, conclusiones };
}

function exigirSensible(actor, accion) {
  exigir(actor, M, accion);
  if (!veDetalleSensible(actor, M)) falla(NO_AUTORIZADO, 'Sin permiso para ver la evaluación del equipo (requiere el detalle sensible del módulo Presupuesto)');
}
function exigirEjercicio(anio) {
  if (!EJERCICIOS.includes(anio)) falla(NO_ENCONTRADO, `La evaluación del equipo solo existe para el ejercicio ${EJERCICIOS.join(', ')}`);
}

export async function obtenerEvaluacion(db, actor, anio) {
  exigirSensible(actor, 'ver');
  exigirEjercicio(anio);
  const r = (await db.query(`SELECT e.contenido, e.cargado_en, u.nombre AS cargado_por FROM evaluacion_equipo e JOIN usuario u ON u.id = e.cargado_por WHERE e.ejercicio = $1`, [anio])).rows[0];
  if (!r) return null;
  return { ...(typeof r.contenido === 'string' ? JSON.parse(r.contenido) : r.contenido), cargadoEn: r.cargado_en, cargadoPor: r.cargado_por };
}

export async function cargarEvaluacion(db, actor, anio, contenido) {
  exigirSensible(actor, 'editar');
  exigirEjercicio(anio);
  const c = validarEvaluacion(contenido);
  return db.tx(async t => {
    if (!(await t.query('SELECT 1 FROM ejercicio WHERE anio = $1', [anio])).rows.length) falla(NO_ENCONTRADO, `No existe el ejercicio ${anio}`);
    const antes = (await t.query('SELECT 1 FROM evaluacion_equipo WHERE ejercicio = $1', [anio])).rows.length > 0;
    await t.query(`INSERT INTO evaluacion_equipo (ejercicio, contenido, cargado_por) VALUES ($1, $2, $3)
      ON CONFLICT (ejercicio) DO UPDATE SET contenido = EXCLUDED.contenido, cargado_por = EXCLUDED.cargado_por, cargado_en = now()`, [anio, JSON.stringify(c), actor.id]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'CARGAR_EVALUACION', entidad: 'evaluacion', entidadId: anio,
      despues: { reemplaza: antes, rubros: c.rubros.length, unidades: c.unidades.length, partidas: c.partidas.length } });
    return { ok: true };
  });
}
