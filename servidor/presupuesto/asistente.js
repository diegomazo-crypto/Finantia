/**
 * Preguntas sobre una versión del presupuesto, respondidas por Claude (API de Anthropic).
 *
 * Solo funciona si el servidor tiene ANTHROPIC_API_KEY. Le envía a Claude los supuestos
 * y los resultados agregados de la versión (estado de resultados total y por unidad,
 * proyección, métricas, mensual y caja de los tres escenarios). No envía nómina por
 * persona ni por cargo: esos datos no están en la versión.
 */
import Anthropic from '@anthropic-ai/sdk';
import { exigir } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, DATOS_INVALIDOS, NO_DISPONIBLE } from '../errores.js';
import { obtenerVersion, contextoBase } from './servicio.js';
import { ESCS } from '../../motor/index.js';

const M = 'PRESUPUESTO';
export const MODELO_POR_DEFECTO = 'claude-opus-5-5';
const HISTORIAL = 6;

const SISTEMA = `Eres el asistente financiero de Finantia, la plataforma de presupuesto de la Institución Universitaria CEIPA (Medellín, Colombia).
Respondes preguntas del equipo directivo sobre una versión del presupuesto, usando solo los datos que vienen en el mensaje.
- Responde en español, claro y directo, en frases completas. Cifras en millones de pesos colombianos con separador de miles (por ejemplo $57.974 M).
- Si el dato no está en lo que recibiste, dilo y explica qué haría falta; no inventes cifras.
- Cuando hagas un cálculo, muestra de dónde sale en una línea.
- Distingue los escenarios (Pesimista, Moderado, Optimista) y di cuál usas. Por defecto, el que indica el mensaje.
- Es información confidencial de CEIPA: no la relaciones con otras instituciones ni sugieras compartirla.`;

const mill = v => (v == null || !isFinite(v) ? null : Math.round(v / 1e6));
const millObj = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, mill(v)]));

/** Lo que Claude recibe de la versión, en millones de COP. */
export function contextoVersion(v, base) {
  const R = v.resultados, n = base.names;
  const esc = Object.fromEntries(ESCS.map(e => [e, {
    estadoResultados: millObj(R[e].eerr),
    porUnidad: Object.fromEntries(R[e].eerrUnidades.map((u, i) => [n[i], millObj(u)])),
    proyeccion: R[e].proyeccion.map((x, i) => ({ anio: v.ejercicio - 1 + i, ...millObj(x) })),
    metricas: { npv: mill(R[e].metricas.npv), npvConValorTerminal: mill(R[e].metricas.npvTV), tir: R[e].metricas.irr, paybackSimple: R[e].metricas.paybackSimple, paybackDescontado: R[e].metricas.paybackDescontado },
    mensual: R[e].mensual.map((x, i) => ({ mes: i + 1, ingresoNeto: mill(x.NET), ebitda: mill(x.EBITDA), resultado: mill(x.RN) })),
    caja: { saldoFinal: mill(R[e].caja.saldoFinal), saldoMinimo: mill(R[e].caja.saldoMinimo), mesSaldoMinimo: R[e].caja.mesMinimo + 1, saldoFinalPorMes: R[e].caja.meses.map(m => mill(m.SF)) }
  }]));
  return {
    version: { ejercicio: v.ejercicio, numero: v.numero, nombre: v.nombre, estado: v.estado, escenarioOficial: v.escenario_oficial },
    claves: 'IB ingreso bruto, DS descuentos y becas, NET ingreso neto, CD costos directos (PRESTACION, ADM_ACADEMICA, UNIDADES, VENTAS), MB margen bruto, GO gastos de operación (TECNOLOGIA, CORPORATIVO, ADMINISTRATIVOS, DIRECCION), RO resultado operacional, OTROS_INGRESOS, BANCARIOS, DA depreciación, OTROS_GASTOS, RN resultado neto, EBITDA; n_X es la nómina dentro del rubro X; FCF flujo libre de caja.',
    supuestosCambiados: v.supuestos || {},
    base2026E: { estadoResultados: millObj(base.eerr2026), porUnidad: Object.fromEntries(base.eerr2026Unidades.map((u, i) => [n[i], millObj(u)])) },
    escenarios: esc
  };
}

/**
 * @param {object} [op]
 * @param {object} [op.cliente]  cliente con messages.create (por defecto, el SDK de Anthropic)
 * @param {string} [op.modelo]
 * @param {object} [op.env]
 */
export function crearAsistente({ cliente = null, modelo = null, env = process.env } = {}) {
  const activo = !!cliente || !!env.ANTHROPIC_API_KEY;
  const mod = modelo || env.FINANTIA_MODELO || MODELO_POR_DEFECTO;
  let c = cliente;
  const sdk = () => (c ??= new Anthropic());

  async function preguntar(db, actor, versionId, { pregunta, escenario = 'Moderado' }) {
    exigir(actor, M, 'ver');
    if (!activo) falla(NO_DISPONIBLE, 'El asistente no está configurado en este servidor (falta ANTHROPIC_API_KEY).');
    const q = String(pregunta || '').trim();
    if (!q) falla(DATOS_INVALIDOS, 'Escriba la pregunta');
    if (q.length > 4000) falla(DATOS_INVALIDOS, 'La pregunta es demasiado larga (máximo 4.000 caracteres)');
    if (!ESCS.includes(escenario)) falla(DATOS_INVALIDOS, `Escenario desconocido: ${escenario}`);
    const v = await obtenerVersion(db, actor, versionId);
    const base = await contextoBase(db, actor, v.datos_base_id);
    const previas = (await db.query('SELECT pregunta, respuesta FROM pregunta WHERE version_id = $1 AND usuario_id = $2 AND respuesta IS NOT NULL ORDER BY id DESC LIMIT $3',
      [versionId, actor.id, HISTORIAL])).rows.reverse();
    const datos = JSON.stringify(contextoVersion(v, base));
    const messages = [];
    previas.forEach((p, i) => {
      messages.push({ role: 'user', content: i === 0 ? [{ type: 'text', text: `Datos de la versión (JSON, millones de COP):\n${datos}`, cache_control: { type: 'ephemeral' } }, { type: 'text', text: p.pregunta }] : p.pregunta });
      messages.push({ role: 'assistant', content: p.respuesta });
    });
    const texto = `Escenario por defecto: ${escenario}.\n\n${q}`;
    messages.push({ role: 'user', content: previas.length ? texto : [{ type: 'text', text: `Datos de la versión (JSON, millones de COP):\n${datos}`, cache_control: { type: 'ephemeral' } }, { type: 'text', text: texto }] });

    let r;
    try {
      r = await sdk().beta.messages.create({
        model: mod, max_tokens: 8000, system: SISTEMA, messages,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default'
      });
    } catch (e) {
      const estado = e?.status;
      falla(NO_DISPONIBLE, estado === 429 ? 'El asistente está ocupado; intente en un momento.' : estado === 401 ? 'La llave del asistente no es válida.' : 'No se pudo consultar al asistente.');
    }
    const respuesta = r.stop_reason === 'refusal'
      ? 'El asistente no puede responder esta pregunta. Intente formularla de otra manera.'
      : (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim() || 'Sin respuesta.';
    const id = Number((await db.query(
      'INSERT INTO pregunta (version_id, usuario_id, escenario, pregunta, respuesta, modelo, tokens_entrada, tokens_salida) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
      [versionId, actor.id, escenario, q, respuesta, r.model || mod, r.usage?.input_tokens ?? null, r.usage?.output_tokens ?? null])).rows[0].id);
    await registrar(db, { usuarioId: actor.id, modulo: M, accion: 'PREGUNTAR', entidad: 'version', entidadId: versionId, detalle: `pregunta ${id}` });
    return { id, pregunta: q, respuesta, escenario };
  }

  async function historial(db, actor, versionId) {
    exigir(actor, M, 'ver');
    return (await db.query(`SELECT p.id, p.pregunta, p.respuesta, p.escenario, p.fecha, u.nombre FROM pregunta p JOIN usuario u ON u.id = p.usuario_id
      WHERE p.version_id = $1 ORDER BY p.id DESC LIMIT 50`, [versionId])).rows.map(x => ({ ...x, id: Number(x.id) })).reverse();
  }

  return { activo, modelo: mod, preguntar, historial };
}
