/**
 * Programación académica optimizada (tarjeta de la pestaña CPS en Finantia Admon
 * 1.0). Existe solo en el simulador: el Excel v21 no la tiene. Lógica copiada sin
 * cambios de fórmula.
 */
import { SEGS } from './parametros.js';
import { GRP, TOPE } from './presupuesto.js';

const clone = o => JSON.parse(JSON.stringify(o));

/** Tamaño mínimo sostenible de los grupos de cursos específicos (por validar con la Vicerrectoría Académica). */
export const OPT0 = { pres_e: 20, virt_e: 25, baq_e: 20 };

/**
 * Ahorro en cátedra de las tres palancas: (1) Vértice, (2) comunes al tope,
 * (3) específicos al tamaño mínimo.
 * @param {Function} run  cálculo del presupuesto con las entradas fijadas
 * @param {object} p      parámetros del escenario
 * @param {object} [min]  tamaños mínimos de específicos (OPT0 por defecto)
 */
export function optimizarProgramacion(run, p, min = {}) {
  const T = Object.assign({}, OPT0, min);
  const base = Object.assign(clone(p), { grp: {} }), catOf = q => { const u = run(q).units; return u[0].C + u[6].C; };
  const s1 = Object.assign(clone(base), { vert: 1 });
  const TP = TOPE(p), mn = (k, v) => Math.min(TP[k.split('_')[0]], v);
  const s2 = Object.assign(clone(s1), { grp: { pres_c: TP.pres, virt_c: TP.virt, baq_c: TP.baq } });
  const s3 = Object.assign(clone(s2), { grp: Object.assign({}, s2.grp, { pres_e: mn('pres_e', Math.max(GRP.pres_e, T.pres_e)), virt_e: mn('virt_e', Math.max(GRP.virt_e, T.virt_e)), baq_e: mn('baq_e', Math.max(GRP.baq_e, T.baq_e)) }) });
  const c0 = catOf(base), c1 = catOf(s1), c2 = catOf(s2), c3 = catOf(s3);
  const segmentos = [];
  ['pres', 'virt', 'baq'].forEach(m => ['c', 'e'].forEach(t => {
    const k = m + '_' + t, rows = SEGS.filter(x => x[0] === m && x[1] === t), J = rows.reduce((a, x) => a + x[2], 0), E = rows.reduce((a, x) => a + x[3], 0), S1 = Math.min(s3.grp[k], TP[m]);
    segmentos.push({ k, estudiantes: E, tamanoHoy: GRP[k], tamanoOpt: S1, gruposHoy: J, gruposOpt: J * GRP[k] / S1, tope: TP[m] });
  }));
  return {
    catedra: [c0, c1, c2, c3],
    ahorro: { vertice: c0 - c1, comunes: c1 - c2, especificos: c2 - c3, total: c0 - c3 },
    grp: s3.grp,
    segmentos
  };
}
