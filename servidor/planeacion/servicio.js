/**
 * Planeación financiera · flujo de caja y resultado mensual.
 *
 * Por ahora el módulo toma el flujo de caja del presupuesto: de cada ejercicio usa la versión
 * aprobada (o, si todavía no hay, la última versión) y muestra su resultado mensual y su flujo
 * de caja por método directo en los tres escenarios. Quien tiene acceso a Planeación ve esto
 * aunque no tenga acceso al módulo de Presupuesto; no ve supuestos, nómina ni el resto de la versión.
 * Proyección proforma a 5 años (2027–2031) hasta el flujo de caja libre, con VPN, TIR, payback,
 * escenarios y sensibilidad: sale de la proyección guardada de la misma versión más los supuestos
 * de planeación del ejercicio (tabla planeacion_supuestos), que se editan aquí.
 */
import { exigir } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, NO_ENCONTRADO, DATOS_INVALIDOS } from '../errores.js';
import { modeloDe } from '../presupuesto/servicio.js';
import { project, ESCS } from '../../motor/index.js';
import { supuestosPlaneacion, proforma } from '../../motor/planeacion.js';

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

/* ---------- Proyección proforma, métricas y sensibilidad ---------- */

async function versionElegida(db, anio, versionId) {
  const vs = (await db.query('SELECT id, numero, nombre, estado, escenario_oficial, datos_base_id, supuestos FROM version WHERE ejercicio = $1 ORDER BY numero', [anio])).rows
    .map(r => ({ ...r, id: Number(r.id), supuestos: typeof r.supuestos === 'string' ? JSON.parse(r.supuestos) : r.supuestos }));
  const v = versionId != null ? vs.find(x => x.id === versionId) : versionPorDefecto(vs);
  if (versionId != null && !v) falla(NO_ENCONTRADO, `La versión ${versionId} no es del ejercicio ${anio}`);
  return v || null;
}

export async function supuestosGuardados(db, anio) {
  const f = (await db.query('SELECT contenido, actualizado_en FROM planeacion_supuestos WHERE ejercicio = $1', [anio])).rows[0];
  const c = f ? (typeof f.contenido === 'string' ? JSON.parse(f.contenido) : f.contenido) : {};
  return { sup: supuestosPlaneacion(c), actualizadoEn: f?.actualizado_en || null };
}

export const DESPLAZA_G = [-0.04, -0.02, 0, 0.02, 0.04];   /* crecimiento de estudiantes 2028–2031, puntos por año */
export const DESPLAZA_D = [-0.02, -0.01, 0, 0.01, 0.02];   /* % de descuento desde 2028, puntos */
export const TASAS = [0.10, 0.11, 0.12, 0.13, 0.14];
export const CAPEX = [0.02, 0.03, 0.04, 0.05, 0.06];

/** Sensibilidad del VPN: (1) crecimiento × descuento, recalculando la proyección; (2) tasa × capex. */
export function sensibilidad(modelo, escenario, sup, cajaIni) {
  const p0 = modelo.params[escenario], r = modelo.run(p0), H = modelo.datos.H;
  const vpnCon = (dg, dd) => {
    const p = JSON.parse(JSON.stringify(p0));
    p.lr.g = p.lr.g.map(g => g + dg); p.lr.dd = p.lr.dd.map((d, k) => (k === 0 ? d + dd : d));
    return proforma(project(p, H, r.tot, r.units).rows, sup, cajaIni).metricas.vpn;
  };
  const filas = project(p0, H, r.tot, r.units).rows;
  return {
    crecimiento: DESPLAZA_G, descuento: DESPLAZA_D,
    vpnCrecDesc: DESPLAZA_G.map(dg => DESPLAZA_D.map(dd => vpnCon(dg, dd))),
    tasas: TASAS, capex: CAPEX,
    vpnTasaCapex: TASAS.map(t => CAPEX.map(c => proforma(filas, { ...sup, tasa: t, gT: Math.min(sup.gT, t - 0.005), capexPct: c }, cajaIni).metricas.vpn))
  };
}

/** Proforma de los tres escenarios, métricas y sensibilidad del escenario elegido. */
export async function proyeccionProforma(db, actor, { ejercicio = null, versionId = null, escenario = null } = {}) {
  exigir(actor, M, 'ver');
  const anios = (await db.query('SELECT anio FROM ejercicio ORDER BY anio DESC')).rows.map(r => Number(r.anio));
  const anio = ejercicio ?? anios[0] ?? null;
  if (anio == null) return { ejercicio: null, version: null };
  if (!anios.includes(anio)) falla(NO_ENCONTRADO, `No existe el ejercicio ${anio}`);
  const { sup, actualizadoEn } = await supuestosGuardados(db, anio);
  const v = await versionElegida(db, anio, versionId);
  if (!v) return { ejercicio: anio, version: null, supuestos: sup, actualizadoEn };
  const res = {};
  for (const r of (await db.query('SELECT escenario, resumen FROM resultado WHERE version_id = $1', [v.id])).rows)
    res[r.escenario] = typeof r.resumen === 'string' ? JSON.parse(r.resumen) : r.resumen;
  const esc = ESCS.includes(escenario) ? escenario : (v.escenario_oficial || 'Moderado');
  const escenarios = {};
  for (const e of ESCS) if (res[e]?.proyeccion) escenarios[e] = proforma(res[e].proyeccion, sup, res[e].caja?.meses?.[0]?.SI ?? 0);
  let sens = null;
  if (escenarios[esc]) {
    const { modelo } = await modeloDe(db, v);
    sens = sensibilidad(modelo, esc, sup, res[esc].caja?.meses?.[0]?.SI ?? 0);
  }
  const { datos_base_id, supuestos, ...ver } = v;
  return { ejercicio: anio, version: { ...ver, ejercicio: anio }, escenario: esc, supuestos: sup, actualizadoEn, escenarios, sensibilidad: sens };
}

/** Guarda los supuestos de planeación del ejercicio (rol de edición en Planeación). */
export async function guardarSupuestos(db, actor, anio, cuerpo) {
  exigir(actor, M, 'editar');
  if (!(await db.query('SELECT 1 FROM ejercicio WHERE anio = $1', [anio])).rows.length) falla(NO_ENCONTRADO, `No existe el ejercicio ${anio}`);
  let sup;
  try { sup = supuestosPlaneacion(cuerpo || {}); } catch (e) { falla(DATOS_INVALIDOS, e.message); }
  const antes = (await supuestosGuardados(db, anio)).sup;
  await db.query(`INSERT INTO planeacion_supuestos (ejercicio, contenido, actualizado_por) VALUES ($1, $2, $3)
    ON CONFLICT (ejercicio) DO UPDATE SET contenido = EXCLUDED.contenido, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`, [anio, JSON.stringify(sup), actor.id]);
  await registrar(db, { usuarioId: actor.id, modulo: M, accion: 'EDITAR_SUPUESTOS_PLANEACION', entidad: 'ejercicio', entidadId: anio, antes, despues: sup });
  return { supuestos: sup };
}
