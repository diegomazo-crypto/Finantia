/**
 * Motor de cálculo de Finantia 2.0 (módulo Presupuesto).
 *
 * Sin pantallas ni dependencias: recibe la base 2026E (datos/base2026.json) y los
 * supuestos de cada escenario, y devuelve el presupuesto 2027, el estado de
 * resultados por unidad, la proyección 2028–2031 con métricas, el mensual, el
 * flujo de caja y la sensibilidad. Reproduce Finantia Admon 1.0 y cuadra con el
 * Excel CEIPA_Modelo_Presupuesto2027_v21_202611 (ver pruebas/).
 */
import { ESCS, FIXED, DEFAULTS } from './parametros.js';
import { compute, pyg, base2026, sum } from './presupuesto.js';
import { project, metricas } from './proyeccion.js';
import { mensual, mensualPyG, flujoCaja } from './mensual.js';

export * from './parametros.js';
export * from './presupuesto.js';
export * from './proyeccion.js';
export * from './mensual.js';
export * from './sensibilidad.js';
export * from './programacion.js';

const clone = o => JSON.parse(JSON.stringify(o));

/** Metas de nuevos 2027 por defecto (Metas2027, Moderado) y meta de ventas URE. */
export function metasBase() {
  const m = {}; Object.keys(FIXED.metas).forEach(k => (m[k] = FIXED.metas[k].meta.slice())); m.ure = FIXED.ure.meta;
  return m;
}

/**
 * Fija las entradas comunes a todos los escenarios y devuelve el modelo.
 * @param {object} datos  contenido de datos/base2026.json
 * @param {object} [entradas]
 * @param {object} [entradas.params]  supuestos por escenario; se mezclan sobre DEFAULTS, p. ej. {Moderado: {price: 0.07}}
 * @param {object} [entradas.metas]   nuevos por intake (ver metasBase)
 * @param {number[][]} [entradas.LP]  nómina plan por línea × unidad (por defecto datos.LP, plan del equipo)
 * @param {number} [entradas.esicVentas]  ventas de pregrado ESIC (COP)
 * @param {number} [entradas.esicPct]     participación de CEIPA en esas ventas
 */
export function crearModelo(datos, entradas = {}) {
  const H = datos.H, L = datos.L;
  const LP = entradas.LP || datos.LP;
  const metas = entradas.metas || metasBase();
  const esic = (entradas.esicVentas != null ? entradas.esicVentas : FIXED.esic.ventas) * (entradas.esicPct != null ? entradas.esicPct : FIXED.esic.pct);
  const planUnits = [0, 1, 2, 3, 4, 5, 6].map(i => sum(LP.map(v => v[i])));
  const params = {};
  ESCS.forEach(e => (params[e] = Object.assign(clone(DEFAULTS[e]), (entradas.params || {})[e] || {})));
  /** Presupuesto 2027 de los parámetros p con las entradas fijadas; o = choques u overrides de compute(). */
  const run = (p, o) => compute(p, H, Object.assign({ metas, planUnits, esic }, o || {}));
  const b26 = base2026(H);

  /** Calcula un escenario completo. */
  function escenario(nombre) {
    const p = params[nombre];
    if (!p) throw new Error('Escenario desconocido: ' + nombre);
    const r = run(p);
    const g = pyg(p, H, L, r, { metas, LP, esic });
    const pj = project(p, H, r.tot, r.units);
    const mon = mensual(datos, r);
    return {
      escenario: nombre, p, presupuesto: r, pyg: g, proyeccion: pj, metricas: metricas(pj),
      mensual: mon, mensualPyG: mensualPyG(datos, g), caja: flujoCaja(datos, p, r, g, mon, b26)
    };
  }

  return {
    datos, params, metas, LP, esic, planUnits, run, base2026: b26,
    pyg2026: () => pyg(params.Moderado, H, L, null),
    escenario,
    todos: () => Object.fromEntries(ESCS.map(e => [e, escenario(e)]))
  };
}
