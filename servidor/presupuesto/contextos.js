/**
 * Lo que el asistente recibe en Ejecución y en Planeación: solo cifras agregadas del módulo,
 * en millones de COP. Nunca nómina por persona o cargo, ni centros de costos y cuentas contables, ni
 * movimientos bancarios o terceros, ni el pago a CINTANA aparte. En Planeación sí recibe la caja
 * real de bancos (aprobado por Diego el 2026-11-28): saldos mensuales por cuenta y destinación y la
 * caja libre real y proyectada.
 */
import { analizar, interpretar, RUBROS } from '../../motor/ejecucion.js';
import { tablero } from '../ejecucion/servicio.js';
import { proyeccionProforma, flujoDeCaja } from '../planeacion/servicio.js';
import { cajaDelAnio } from '../planeacion/bancos.js';

const mill = v => (v == null || !isFinite(v) ? null : Math.round(v / 1e6));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export async function contextoEjecucion(db, actor, anio) {
  const t = await tablero(db, actor, anio);
  const cargados = t.meses.map(m => m.mes);
  if (!t.base || !cargados.length) return { anio, aviso: 'Todavía no hay base de comparación o balances cargados para este año.' };
  const hasta = Math.max(...cargados), d = { L: t.lineas.L, LN: t.lineas.LN }, nombres = t.lineas.names;
  const rub = a => Object.fromEntries(a.rubros.map(x => [x.t, { presupuestoALaFecha: mill(x.ppto), real: mill(x.real), diferencia: mill(x.dif), ejecucion: x.pct == null ? null : Math.round(x.pct * 1000) / 10, semaforo: x.color, presupuestoAnual: mill(x.anual) }]));
  const a = analizar(d, t.P, t.R, { hasta });
  const porUnidad = nombres.map((n, j) => { const x = analizar(d, t.P, t.R, { hasta, unidad: j }); const r = Object.fromEntries(x.rubros.map(y => [y.k, y])); return { j, nombre: n, r, difRN: r.RN.dif, x }; });
  return {
    anio, base: t.base.descripcion, mesesCargados: cargados.map(m => MESES[m - 1]), acumuladoHasta: MESES[hasta - 1],
    mesesEstimadosConSaldoAnterior: (t.estimados || []).map(m => MESES[m - 1]),
    sinCentroDeCostos: t.meses.filter(m => !m.conCC).map(m => MESES[m.mes - 1]),
    lecturas: interpretar(a, { meses: MESES, porUnidad }),
    total: rub(a),
    porMes: a.serie.map(s => ({ mes: MESES[s.mes - 1], ingresoNetoPresupuesto: mill(s.pNET), ingresoNetoReal: mill(s.rNET), resultadoPresupuesto: mill(s.pRN), resultadoReal: mill(s.rRN) })),
    porUnidad: Object.fromEntries(porUnidad.map(u => [u.nombre, rub(u.x)])),
    umbralesSemaforo: 'Ingresos: verde ≥ 98 %, amarillo 90–98 %, rojo < 90 %. Costos y gastos: verde hasta 102 %, amarillo 102–110 %, rojo > 110 %; por debajo de 75 % es baja ejecución.',
    rubros: RUBROS.map(([, t]) => t)
  };
}

/** Caja real de bancos de un año: saldos por cuenta y destinación y caja libre real y proyectada. */
async function cajaReal(db, actor, anio) {
  const d = await cajaDelAnio(db, actor, anio);
  if (!d.extractos.length) return null;
  const nombre = c => `${c.banco} · ${c.nombre}${c.terminacion ? ' ··' + c.terminacion : ''}`;
  return {
    anio, fuenteFlujoProyectado: d.fuente, flujoProyectadoEsAproximado: d.aproximado, cajaMinimaDeseada: mill(d.cajaMinima),
    ultimoMesConExtractos: d.caja.ultimo ? MESES[d.caja.ultimo - 1] : null,
    cuentas: d.cuentas.map(c => ({ cuenta: nombre(c), tipo: c.tipo, destinacion: c.destinacion === 'LIBRE' ? 'libre' : 'específica', para: c.detalle || undefined, activa: c.activa,
      saldosFinales: Object.fromEntries(d.extractos.filter(e => e.cuentaId === c.id).map(e => [MESES[e.mes - 1], { inicial: mill(e.saldoInicial), entradas: mill(e.entradas), salidas: mill(e.salidas), final: mill(e.saldoFinal) }])) })),
    meses: d.caja.meses.filter(x => x.tipo !== 'sin-dato').map(x => ({ mes: MESES[x.mes - 1], estado: x.tipo === 'real' ? (x.faltan.length ? 'real (faltan cuentas)' : 'real') : 'proyectado',
      flujoPresupuestado: mill(x.flujoPpto), ajustes: mill(x.ajuste), flujo: mill(x.flujo), cajaLibre: mill(x.libre), destinacionEspecifica: mill(x.especifica), totalBancos: mill(x.total) })),
    ajustesEsperados: d.ajustes.map(a => ({ mes: MESES[a.mes - 1], concepto: a.concepto, valor: mill(a.valor) })),
    mesesBajoCajaMinima: d.caja.bajoMinimo.map(m => MESES[m - 1])
  };
}

export async function contextoPlaneacion(db, actor, anio, { escenario = null } = {}) {
  const hoy = new Date().getFullYear();
  const cajas = (await Promise.all([...new Set([hoy, anio])].sort().map(a => cajaReal(db, actor, a)))).filter(Boolean);
  const pf = await proyeccionProforma(db, actor, { ejercicio: anio, escenario });
  if (!pf.version) return { anio, aviso: 'Este ejercicio todavía no tiene una versión del presupuesto calculada.', cajaRealBancos: cajas };
  const fl = await flujoDeCaja(db, actor, { ejercicio: anio, versionId: pf.version.id });
  const s = pf.supuestos;
  const anioP = a => ({ anio: a.anio + (a.referencia ? ' (estimado de cierre)' : ''), ingresosBrutos: mill(a.IB), descuentos: mill(a.DS), ingresosNetos: mill(a.NET), otrosIngresos: mill(a.OI), nomina: mill(a.N), catedraYCostosVariables: mill(a.CV),
    gastosFijosYOtros: mill(a.FO), ebitda: mill(a.EBITDA), margenEbitda: a.margen == null ? null : Math.round(a.margen * 1000) / 10, depreciacion: mill(a.DA), ebit: mill(a.EBIT),
    ...(a.referencia ? {} : { intereses: mill(a.INT), impuesto: mill(a.IMP), resultadoNeto: mill(a.UN), capex: mill(a.CAPEX), capitalDeTrabajo: mill(a.KT), flujoCajaLibre: mill(a.FCL), flujoDescontado: mill(a.DFCL),
      servicioDeuda: mill(a.SD), flujoDespuesDeuda: mill(a.FCA), cajaFinal: mill(a.cajaFin), saldoDeuda: mill(a.DEUDA) }) });
  const met = m => ({ vpn: mill(m.vpn), vpnConValorTerminal: mill(m.vpnVT), tir: m.tir, paybackSimple: m.paybackSimple, paybackDescontado: m.paybackDescontado, flujoCajaLibreAcumulado: mill(m.fclTotal),
    ebitdaAcumulado: mill(m.ebitdaTotal), margenEbitdaPromedio: Math.round(m.margenPromedio * 1000) / 10, cajaMinima: mill(m.cajaMinima), anioCajaMinima: m.anioCajaMinima, aniosBajoCajaMinima: m.bajoMinimo,
    tirYPaybackNoAplican: m.sinInversion ? 'No hay inversión inicial registrada' : undefined });
  const S = pf.sensibilidad;
  return {
    ejercicio: anio, version: `V${pf.version.numero} · ${pf.version.nombre} (${pf.version.estado})`, escenarioElegido: pf.escenario,
    supuestosPlaneacion: { tasaDescuento: s.tasa, crecimientoPerpetuidad: s.gT, capexPctIngresoNeto: s.capexPct, capitalTrabajoPctAumentoIngreso: s.ktPct, impuesto: s.impuesto,
      inversionInicial: mill(s.inversionInicial), inversionesPorAnio: s.inversiones.map(mill), creditos: s.deuda.map(d => ({ nombre: d.nombre, saldo: mill(d.saldo), tasa: d.tasa, anios: d.anios })), cajaMinimaDeseada: mill(s.cajaMinima) },
    escenarios: Object.fromEntries(Object.entries(pf.escenarios).map(([e, x]) => [e, { metricas: met(x.metricas), proforma: x.anios.map(anioP) }])),
    sensibilidadVPN: S && {
      crecimientoEstudiantesPorDescuento: { filas_crecimientoPp: S.crecimiento, columnas_descuentoPp: S.descuento, vpn: S.vpnCrecDesc.map(f => f.map(mill)) },
      tasaPorCapex: { filas_tasa: S.tasas, columnas_capexPct: S.capex, vpn: S.vpnTasaCapex.map(f => f.map(mill)) } },
    cajaRealBancos: cajas.length ? cajas : 'Todavía no hay extractos bancarios cargados.',
    flujoCajaMensualPresupuesto: fl.version && Object.fromEntries(Object.entries(fl.version.resultados).map(([e, r]) => [e, {
      saldoFinalAnio: mill(r.caja.saldoFinal), saldoMinimo: mill(r.caja.saldoMinimo), mesSaldoMinimo: MESES[r.caja.mesMinimo],
      meses: r.caja.meses.map((m, i) => ({ mes: MESES[i], entradas: mill(m.TE), salidas: mill(m.TS), flujoNeto: mill(m.FN), saldoFinal: mill(m.SF) })) }]))
  };
}
