/**
 * Planeación financiera · bancos, extractos y caja del año.
 *
 * - Bancos y cuentas con su destinación (libre o específica): se registran en Administración
 *   (rol de edición en Administración); quien ve Planeación los consulta.
 * - Extractos mensuales por cuenta: archivo del banco (Excel o CSV) o saldos a mano. Solo se guardan
 *   saldo inicial, entradas, salidas y saldo final; nunca los movimientos ni los terceros.
 * - Caja del año: real hasta el último mes con extractos y, de ahí a diciembre, el flujo presupuestado
 *   (método directo de la versión del presupuesto del año; para un año presupuestado fuera de Finantia,
 *   el resultado más la depreciación del informe comparativo de Ejecución) más los ajustes esperados.
 */
import { exigir, puede } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, DATOS_INVALIDOS, NO_ENCONTRADO, NO_AUTORIZADO } from '../errores.js';
import { celdasDe, baseDelAnio } from '../ejecucion/servicio.js';
import { porRubro } from '../../motor/ejecucion.js';
import { proyectarCaja } from '../../motor/planeacion.js';
import { leerExtracto } from './extractos.js';
import { versionPorDefecto, supuestosGuardados } from './servicio.js';

const M = 'PLANEACION';
export const TAMANO_MAXIMO = 10 * 1024 * 1024;
const TIPOS = ['AHORROS', 'CORRIENTE', 'FIDUCIA', 'INVERSION', 'OTRA'], DESTINOS = ['LIBRE', 'ESPECIFICA'];
const num = x => (x == null ? null : Number(x));
const anioValido = a => { if (!Number.isInteger(a) || a < 2020 || a > 2100) falla(DATOS_INVALIDOS, 'Año inválido'); return a; };
const mesValido = m => { if (!Number.isInteger(m) || m < 1 || m > 12) falla(DATOS_INVALIDOS, 'Mes inválido'); return m; };
const fila = r => ({ id: Number(r.id), banco: r.banco, tipo: r.tipo, terminacion: r.terminacion, nombre: r.nombre, destinacion: r.destinacion, detalle: r.detalle, activa: r.activa });

/* ---------- cuentas (Administración) ---------- */
export async function listarCuentas(db, actor) {
  if (!puede(actor, 'ADMINISTRACION', 'ver') && !puede(actor, M, 'ver')) falla(NO_AUTORIZADO, 'Sin acceso a los bancos');
  return (await db.query('SELECT * FROM banco_cuenta ORDER BY activa DESC, destinacion DESC, banco, nombre')).rows.map(fila);
}

function limpiarCuenta(c) {
  const t = (v, n, nombre, req = false) => { const s = String(v ?? '').trim().slice(0, n); if (req && !s) falla(DATOS_INVALIDOS, `Falta ${nombre}`); return s; };
  const terminacion = String(c.terminacion ?? '').replace(/\D/g, '');
  if (terminacion.length > 4) falla(DATOS_INVALIDOS, 'Escriba solo los últimos 4 dígitos de la cuenta');
  const tipo = c.tipo || 'AHORROS', destinacion = c.destinacion || 'LIBRE';
  if (!TIPOS.includes(tipo)) falla(DATOS_INVALIDOS, 'Tipo de cuenta inválido');
  if (!DESTINOS.includes(destinacion)) falla(DATOS_INVALIDOS, 'Destinación inválida');
  const detalle = t(c.detalle, 300, 'el detalle');
  if (destinacion === 'ESPECIFICA' && !detalle) falla(DATOS_INVALIDOS, 'Indique para qué está destinada la cuenta');
  return { banco: t(c.banco, 80, 'el banco', true), tipo, terminacion, nombre: t(c.nombre, 120, 'el nombre', true), destinacion, detalle, activa: c.activa !== false };
}

export async function crearCuenta(db, actor, cuerpo) {
  exigir(actor, 'ADMINISTRACION', 'editar');
  const c = limpiarCuenta(cuerpo || {});
  return db.tx(async t => {
    const id = Number((await t.query('INSERT INTO banco_cuenta (banco, tipo, terminacion, nombre, destinacion, detalle, activa, creada_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [c.banco, c.tipo, c.terminacion, c.nombre, c.destinacion, c.detalle, c.activa, actor.id])).rows[0].id);
    await registrar(t, { usuarioId: actor.id, modulo: 'ADMINISTRACION', accion: 'CREAR_CUENTA_BANCO', entidad: 'banco_cuenta', entidadId: id, despues: c });
    return { id, ...c };
  });
}

export async function editarCuenta(db, actor, id, cuerpo) {
  exigir(actor, 'ADMINISTRACION', 'editar');
  return db.tx(async t => {
    const antes = (await t.query('SELECT * FROM banco_cuenta WHERE id = $1', [id])).rows[0];
    if (!antes) falla(NO_ENCONTRADO, 'La cuenta no existe');
    const c = limpiarCuenta({ ...fila(antes), ...(cuerpo || {}) });
    await t.query('UPDATE banco_cuenta SET banco=$2, tipo=$3, terminacion=$4, nombre=$5, destinacion=$6, detalle=$7, activa=$8 WHERE id=$1',
      [id, c.banco, c.tipo, c.terminacion, c.nombre, c.destinacion, c.detalle, c.activa]);
    await registrar(t, { usuarioId: actor.id, modulo: 'ADMINISTRACION', accion: 'EDITAR_CUENTA_BANCO', entidad: 'banco_cuenta', entidadId: id, antes: fila(antes), despues: c });
    return { id, ...c };
  });
}

/* ---------- extractos (Planeación) ---------- */
async function cuentaDe(t, id) {
  const c = (await t.query('SELECT * FROM banco_cuenta WHERE id = $1', [id])).rows[0];
  if (!c) falla(NO_ENCONTRADO, 'La cuenta no existe');
  return fila(c);
}

async function guardar(db, actor, cuentaId, anio, mes, x, origen) {
  return db.tx(async t => {
    const c = await cuentaDe(t, cuentaId);
    const antes = (await t.query('SELECT saldo_inicial, entradas, salidas, saldo_final, origen FROM extracto WHERE cuenta_id=$1 AND anio=$2 AND mes=$3', [cuentaId, anio, mes])).rows[0] || null;
    await t.query(`INSERT INTO extracto (cuenta_id, anio, mes, saldo_inicial, entradas, salidas, saldo_final, origen, movimientos, cargado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (cuenta_id, anio, mes) DO UPDATE SET saldo_inicial=EXCLUDED.saldo_inicial, entradas=EXCLUDED.entradas, salidas=EXCLUDED.salidas, saldo_final=EXCLUDED.saldo_final,
      origen=EXCLUDED.origen, movimientos=EXCLUDED.movimientos, cargado_por=EXCLUDED.cargado_por, cargado_en=now()`,
      [cuentaId, anio, mes, x.saldoInicial, x.entradas, x.salidas, x.saldoFinal, origen, x.movimientos ?? null, actor.id]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'SUBIR_EXTRACTO', entidad: 'extracto', entidadId: `${cuentaId}-${anio}-${mes}`, antes, despues: { cuenta: `${c.banco} · ${c.nombre}`, anio, mes, origen, ...x } });
    return { cuentaId, anio, mes, origen, ...x };
  });
}

/** Sube el extracto de una cuenta para un mes (reemplaza el anterior del mismo mes). */
export async function subirExtracto(db, actor, cuentaId, anio, mes, { nombre, contenido }) {
  exigir(actor, M, 'editar'); anioValido(anio); mesValido(mes);
  if (!contenido?.length) falla(DATOS_INVALIDOS, 'El archivo está vacío');
  const n = String(nombre || 'extracto').normalize('NFC').replace(/[\\/\x00-\x1f"<>|:*?]/g, '_').trim().slice(0, 180) || 'extracto';
  if (/\.pdf$/i.test(n)) falla(DATOS_INVALIDOS, 'Los extractos en PDF no se leen todavía: descargue el Excel o CSV del portal del banco, o registre los saldos a mano');
  const x = leerExtracto(await celdasDe(n, contenido), { anio, mes });
  if (x.saldoFinal == null) {
    const prev = (await db.query('SELECT saldo_final FROM extracto WHERE cuenta_id=$1 AND (anio*12+mes) = $2', [cuentaId, anio * 12 + mes - 1])).rows[0];
    if (!prev) falla(DATOS_INVALIDOS, 'El extracto no trae la columna de saldo y no hay saldo del mes anterior: registre los saldos a mano');
    x.saldoInicial = Number(prev.saldo_final); x.saldoFinal = x.saldoInicial + x.entradas - x.salidas;
  }
  return guardar(db, actor, cuentaId, anio, mes, x, n);
}

/** Registra a mano los saldos de un mes (para extractos en PDF o cuentas sin archivo). */
export async function registrarExtracto(db, actor, cuentaId, anio, mes, cuerpo) {
  exigir(actor, M, 'editar'); anioValido(anio); mesValido(mes);
  const n = (k, req) => { const v = cuerpo?.[k]; if (v == null || v === '') { if (req) falla(DATOS_INVALIDOS, `Falta ${k === 'saldoFinal' ? 'el saldo final' : 'el saldo inicial'}`); return null; } const x = Number(v); if (!Number.isFinite(x)) falla(DATOS_INVALIDOS, 'Valor inválido'); return x; };
  const saldoFinal = n('saldoFinal', true), saldoInicial = n('saldoInicial', true);
  let entradas = n('entradas') ?? null, salidas = n('salidas') ?? null;
  if (entradas == null && salidas == null) { const d = saldoFinal - saldoInicial; entradas = Math.max(0, d); salidas = Math.max(0, -d); }
  entradas = Math.abs(entradas || 0); salidas = Math.abs(salidas || 0);
  if (Math.abs(saldoInicial + entradas - salidas - saldoFinal) > 1) falla(DATOS_INVALIDOS, 'Saldo inicial + entradas − salidas no da el saldo final');
  return guardar(db, actor, cuentaId, anio, mes, { saldoInicial, entradas, salidas, saldoFinal, movimientos: null }, 'Registro manual');
}

export async function borrarExtracto(db, actor, cuentaId, anio, mes) {
  exigir(actor, M, 'editar');
  return db.tx(async t => {
    const r = (await t.query('DELETE FROM extracto WHERE cuenta_id=$1 AND anio=$2 AND mes=$3 RETURNING saldo_inicial, entradas, salidas, saldo_final, origen', [cuentaId, anio, mes])).rows[0];
    if (!r) falla(NO_ENCONTRADO, 'No hay extracto de esa cuenta en ese mes');
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'BORRAR_EXTRACTO', entidad: 'extracto', entidadId: `${cuentaId}-${anio}-${mes}`, antes: r });
  });
}

/* ---------- ajustes y caja del año ---------- */
export async function guardarAjustes(db, actor, anio, cuerpo) {
  exigir(actor, M, 'editar'); anioValido(anio);
  const lista = (Array.isArray(cuerpo?.ajustes) ? cuerpo.ajustes : []).slice(0, 60).map(a => {
    const mes = mesValido(Number(a.mes)), valor = Number(a.valor);
    if (!Number.isFinite(valor) || Math.abs(valor) > 1e15) falla(DATOS_INVALIDOS, 'Valor inválido en un ajuste');
    return { mes, concepto: String(a.concepto || '').trim().slice(0, 120) || 'Ajuste', valor };
  });
  await db.query(`INSERT INTO caja_ajuste (anio, contenido, actualizado_por) VALUES ($1,$2,$3)
    ON CONFLICT (anio) DO UPDATE SET contenido=EXCLUDED.contenido, actualizado_por=EXCLUDED.actualizado_por, actualizado_en=now()`, [anio, JSON.stringify(lista), actor.id]);
  await registrar(db, { usuarioId: actor.id, modulo: M, accion: 'EDITAR_AJUSTES_CAJA', entidad: 'caja_ajuste', entidadId: anio, despues: lista });
  return { ajustes: lista };
}

/** Flujo neto presupuestado por mes del año y de dónde sale. */
export async function flujoPresupuestado(db, anio) {
  const vs = (await db.query('SELECT id, numero, nombre, estado, escenario_oficial FROM version WHERE ejercicio = $1', [anio])).rows;
  const v = versionPorDefecto(vs);
  if (v) {
    const esc = v.escenario_oficial || 'Moderado';
    const r = (await db.query('SELECT resumen FROM resultado WHERE version_id = $1 AND escenario = $2', [v.id, esc])).rows[0];
    const res = r && (typeof r.resumen === 'string' ? JSON.parse(r.resumen) : r.resumen);
    if (res?.caja?.meses) return { flujo: res.caja.meses.map(x => x.FN), fuente: `Flujo de caja (método directo) del presupuesto ${anio}, V${v.numero} · ${v.nombre}, escenario ${esc}`, aproximado: false };
  }
  const b = await baseDelAnio(db, anio).catch(() => null);
  if (b) {
    const flujo = b.P.map(Pm => { const r = porRubro(b.datos.L, Pm.map(f => f.reduce((s, x) => s + x, 0))); return r.RN + r.DA; });
    return { flujo, fuente: `Resultado presupuestado más depreciación, del ${b.descripcion}`, aproximado: true };
  }
  return { flujo: Array(12).fill(0), fuente: 'Sin presupuesto del año: la proyección solo suma los ajustes', aproximado: true };
}

export async function cajaDelAnio(db, actor, anio) {
  exigir(actor, M, 'ver'); anioValido(anio);
  const cuentas = (await db.query('SELECT * FROM banco_cuenta ORDER BY destinacion DESC, banco, nombre')).rows.map(fila);
  const extractos = (await db.query('SELECT e.*, u.nombre AS por FROM extracto e JOIN usuario u ON u.id = e.cargado_por WHERE e.anio = $1 ORDER BY e.mes', [anio])).rows
    .map(e => ({ cuentaId: Number(e.cuenta_id), mes: e.mes, saldoInicial: num(e.saldo_inicial), entradas: num(e.entradas), salidas: num(e.salidas), saldoFinal: num(e.saldo_final), origen: e.origen, movimientos: e.movimientos, cargadoPor: e.por, cargadoEn: e.cargado_en }));
  const aj = (await db.query('SELECT contenido FROM caja_ajuste WHERE anio = $1', [anio])).rows[0];
  const ajustes = aj ? (typeof aj.contenido === 'string' ? JSON.parse(aj.contenido) : aj.contenido) : [];
  const { flujo, fuente, aproximado } = await flujoPresupuestado(db, anio);
  const cajaMinima = (await supuestosGuardados(db, anio)).sup.cajaMinima;
  const usadas = new Set(extractos.map(e => e.cuentaId));
  const visibles = cuentas.filter(c => c.activa || usadas.has(c.id));
  return { anio, cuentas: visibles, extractos, ajustes, fuente, aproximado, cajaMinima, flujo,
    caja: proyectarCaja({ cuentas: visibles, extractos, flujo, ajustes, cajaMinima }) };
}
