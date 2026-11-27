/**
 * Planeación financiera · flujo de caja y resultado mensual.
 *
 * Por ahora el módulo toma el flujo de caja del presupuesto: de cada ejercicio usa la versión
 * aprobada (o, si todavía no hay, la última versión) y muestra su resultado mensual y su flujo
 * de caja por método directo en los tres escenarios. Quien tiene acceso a Planeación ve esto
 * aunque no tenga acceso al módulo de Presupuesto; no ve supuestos, nómina ni el resto de la versión.
 * Lo que sigue en el módulo (saldos de bancos semanales y proyección del mes por semana) llega después.
 */
import { exigir } from '../admin/permisos.js';
import { falla, NO_ENCONTRADO } from '../errores.js';

const M = 'PLANEACION';

/** Versión que usa Planeación por defecto: la aprobada; si no hay, la de número más alto. */
export function versionPorDefecto(versiones) {
  return versiones.find(v => v.estado === 'APROBADA') || [...versiones].sort((a, b) => b.numero - a.numero)[0] || null;
}

/** Solo lo que necesita la pantalla de flujo de caja de cada escenario. */
export function soloFlujo(resultados) {
  return Object.fromEntries(Object.entries(resultados).map(([e, r]) => [e, {
    tot: { NET: r.tot.NET, EBITDA: r.tot.EBITDA, RN: r.tot.RN }, mensual: r.mensual, caja: r.caja, calculadoEn: r.calculadoEn
  }]));
}

/** Ejercicios, versiones y el flujo de la versión elegida (o la de por defecto). */
export async function flujoDeCaja(db, actor, { ejercicio = null, versionId = null } = {}) {
  exigir(actor, M, 'ver');
  const anios = (await db.query('SELECT anio FROM ejercicio ORDER BY anio DESC')).rows.map(r => Number(r.anio));
  const anio = ejercicio ?? anios[0] ?? null;
  if (anio == null) return { ejercicios: [], ejercicio: null, versiones: [], version: null };
  if (!anios.includes(anio)) falla(NO_ENCONTRADO, `No existe el ejercicio ${anio}`);
  const versiones = (await db.query('SELECT id, numero, nombre, estado, escenario_oficial, aprobada_en FROM version WHERE ejercicio = $1 ORDER BY numero', [anio])).rows
    .map(r => ({ ...r, id: Number(r.id) }));
  const v = versionId != null ? versiones.find(x => x.id === versionId) : versionPorDefecto(versiones);
  if (versionId != null && !v) falla(NO_ENCONTRADO, `La versión ${versionId} no es del ejercicio ${anio}`);
  if (!v) return { ejercicios: anios, ejercicio: anio, versiones, version: null };
  const res = {};
  for (const r of (await db.query('SELECT escenario, resumen, calculado_en FROM resultado WHERE version_id = $1', [v.id])).rows)
    res[r.escenario] = { ...(typeof r.resumen === 'string' ? JSON.parse(r.resumen) : r.resumen), calculadoEn: r.calculado_en };
  return { ejercicios: anios, ejercicio: anio, versiones, version: { ...v, ejercicio: anio, resultados: soloFlujo(res) } };
}
