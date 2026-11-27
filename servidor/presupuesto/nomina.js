/**
 * Nómina por cargo de un ejercicio: costo por rubro del estado de resultados, proceso y cargo.
 *
 * Es información sensible (un cargo con una sola persona deja ver su salario), así que:
 *  - solo la suben y la ven quienes tienen en el módulo Presupuesto el permiso de detalle
 *    sensible (lo asigna el Superusuario en Administración);
 *  - se guarda cifrada con AES-256-GCM. La llave de 32 bytes vive solo en el servidor
 *    (variable FINANTIA_LLAVE_NOMINA, en base64), nunca en la base ni en el repositorio;
 *  - puede traer el nombre y la cédula de cada persona (decisión de Diego, 2026-11-27: se necesitan
 *    para la auditoría contable). Van solo dentro del contenido cifrado, nunca en la bitácora;
 *    correos y teléfonos se ignoran y no se guardan;
 *  - cada consulta queda en la bitácora; al retirar una carga se borra su contenido cifrado;
 *  - no se envía al asistente de Preguntas ni aparece en las versiones.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { exigir, veDetalleSensible } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, DATOS_INVALIDOS, ESTADO_INVALIDO, NO_AUTORIZADO, NO_DISPONIBLE, NO_ENCONTRADO } from '../errores.js';
/* Datos base de la instalación (asignación REPARTO por línea); se cargan al primer uso para que este módulo sirva también en el navegador */
let base0 = null;
const baseDatos = async () => (base0 ??= JSON.parse((await import('node:fs')).readFileSync(new URL('../../datos/base2026.json', import.meta.url))));
let mapa0 = null;
const mapaDatos = async () => (mapa0 ??= JSON.parse((await import('node:fs')).readFileSync(new URL('../../datos/nomina_mapa.json', import.meta.url))));
import { esZip, leerXlsx } from './xlsx.js';
import { planNomina, revisarAsignacion, smmlv2027, MODOS } from '../../motor/nomina.js';
import { DEFAULTS } from '../../motor/index.js';
import { fijarNominaVersion, datosDeVersion } from './servicio.js';

const M = 'PRESUPUESTO';
export const TAMANO_MAXIMO = 15 * 1024 * 1024; /* el Excel del modelo completo pesa unos 3 MB */
const MAX_FILAS = 3000;

/** Rubros del estado de resultados que llevan nómina, con su numeral en el EERR de CEIPA. */
export const RUBROS = {
  PRESTACION: '4.1', ADM_ACADEMICA: '4.2', UNIDADES: '4.3', VENTAS: '4.4',
  TECNOLOGIA: '6.1', CORPORATIVO: '6.2', ADMINISTRATIVOS: '6.3', DIRECCION: '6.4'
};
const POR_NUMERAL = Object.fromEntries(Object.entries(RUBROS).map(([k, n]) => [n, k]));

/* Columnas del archivo (encabezados sin tildes ni mayúsculas) */
const COLUMNAS = {
  rubro: ['rubro', 'rubro_eerr', 'area'],
  proceso: ['proceso', 'centro_de_costos', 'centro_costos'],
  cargo: ['cargo'],
  continuan: ['continuan', 'personas_que_continuan', 'cont'],
  nuevos: ['nuevos', 'cargos_nuevos'],
  vacantes: ['vacantes', 'vac'],
  salario2026: ['salario_2026', 'salario_mensual_2026'],
  salario2027: ['salario_2027', 'salario_mensual_2027'],
  costoAnual: ['costo_anual', 'costo_anual_2027', 'costo'],
  cedula: ['cedula', 'documento', 'numero_de_documento', 'no_documento', 'identificacion', 'cc', 'nit'],
  nombre: ['nombre', 'nombres', 'nombre_completo', 'empleado', 'nombre_del_empleado', 'apellidos_y_nombres', 'nombres_y_apellidos'],
  apellidos: ['apellidos', 'apellido']
};
const OBLIGATORIAS = ['rubro', 'proceso', 'cargo', 'continuan', 'nuevos', 'vacantes', 'salario2027', 'costoAnual'];

const normal = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Separa un CSV (coma, punto y coma o tabulador; comillas dobles). */
export function leerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].map(s => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') comillas = false; else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(x => x.trim() !== ''));
}

/** Número en formato colombiano ($1.234.567,5) o con punto decimal (1234567.5). */
export function numero(s) {
  if (typeof s === 'number') return s; /* celda numérica de Excel */
  if (s && s.sinValor) falla(DATOS_INVALIDOS, `La celda ${s.ref} tiene una fórmula sin valor calculado. Abra el archivo en Excel, guárdelo y vuelva a subirlo.`);
  let x = String(s ?? '').replace(/[$\s ]/g, '');
  if (!x || x === '-') return 0;
  const neg = /^\(.*\)$/.test(x); if (neg) x = x.slice(1, -1);
  if (x.includes('.') && x.includes(',')) x = x.lastIndexOf(',') > x.lastIndexOf('.') ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (x.includes(',')) x = /^-?\d{1,3}(,\d{3})+$/.test(x) ? x.replace(/,/g, '') : x.replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, ''); /* 1.500 o 28.762.034: miles */
  const n = Number(x);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

const AREAS = {
  costos_de_prestacion_del_servicio: 'PRESTACION', costos_de_prestacion_de_servicios: 'PRESTACION', prestacion: 'PRESTACION',
  administracion_academica: 'ADM_ACADEMICA', unidades_de_negocio: 'UNIDADES', ventas: 'VENTAS', tecnologia: 'TECNOLOGIA',
  corporativo: 'CORPORATIVO', administrativos: 'ADMINISTRATIVOS', direccion_institucional: 'DIRECCION'
};
function rubroDe(v) {
  const s = String(v ?? '').trim();
  if (AREAS[normal(s)]) return AREAS[normal(s)];
  const num = s.match(/^(\d\.\d)\b/);
  if (num && POR_NUMERAL[num[1]]) return POR_NUMERAL[num[1]];
  const k = normal(s).toUpperCase();
  return RUBROS[k] ? k : null;
}

/**
 * Lee el archivo subido (Excel .xlsx o CSV) y devuelve sus filas de celdas.
 * `inflar` descomprime deflate sin encabezado (en el servidor, node:zlib; en la demostración, el navegador).
 */
export async function filasDelArchivo(nombre, bytes, inflar) {
  if (/\.xlsx$/i.test(nombre)) return leerXlsx(bytes, inflar, { hojas: ['Nomina2027', 'Nomina', 'Nomina por persona', 'Plan por persona'] });
  if (!/\.(csv|txt)$/i.test(nombre)) falla(DATOS_INVALIDOS, 'Suba la nómina como Excel (.xlsx) o CSV');
  if (esZip(bytes)) falla(DATOS_INVALIDOS, 'El archivo parece un Excel con otra extensión: guárdelo como .xlsx');
  const texto = new TextDecoder().decode(bytes);
  if (texto.includes('\uFFFD')) falla(DATOS_INVALIDOS, 'El archivo no está en UTF-8. En Excel use "CSV UTF-8 (delimitado por comas)", o suba el .xlsx.');
  return leerCsv(texto);
}

/* Plan por persona: columnas de la hoja Nomina2027 del Excel v21 (fila 59) */
const COL_PERSONA = {
  cedula: COLUMNAS.cedula, nombre: COLUMNAS.nombre, apellidos: COLUMNAS.apellidos,
  centro: ['centro_de_costos', 'centro_costos'], area: ['area', 'rubro'], proceso: ['proceso_item_informe', 'proceso'],
  nodo: ['nodo', 'sede'], cargo: ['cargo_agrupado', 'cargo'], cargoBdd: ['cargo_bdd'],
  s26: ['salario_mensual_2026', 'salario_2026'], s27: ['salario_mensual_2027', 'salario_2027'],
  factor: ['factor_prestac', 'factor_prestacional'], bolsa: ['bolsa_costo_sin_salario', 'bolsa'],
  fila: ['fila_modelo'], unidad: ['unidad_modelo'], peso: ['peso_persona', 'peso']
};
const OBLIG_PERSONA = ['area', 'proceso', 's27', 'factor', 'fila', 'unidad'];

/** ¿Las filas traen el plan por persona? Devuelve el índice de la fila de encabezados o -1. */
export function encabezadoPersonas(filas) {
  return filas.slice(0, 120).findIndex(f => f.some(x => normal(x) === 'fila_modelo') && f.some(x => COL_PERSONA.s27.includes(normal(x))));
}

/** Plan por persona → personas validadas. Se detiene en la primera fila sin área (notas al pie). */
export function interpretarPersonas(filas, nLineas = null) {
  const h = encabezadoPersonas(filas);
  if (h < 0) falla(DATOS_INVALIDOS, 'No se encontró el encabezado del plan por persona (columnas "Fila modelo" y "Salario mensual 2027")');
  const enc = filas[h].map(normal), col = {};
  for (const [k, alias] of Object.entries(COL_PERSONA)) { const i = enc.findIndex(x => alias.includes(x)); if (i >= 0) col[k] = i; }
  const faltan = OBLIG_PERSONA.filter(k => col[k] == null);
  if (faltan.length) falla(DATOS_INVALIDOS, `Faltan columnas del plan por persona: ${faltan.map(k => COL_PERSONA[k][0]).join(', ')}`);
  const out = [];
  for (let i = h + 1; i < filas.length; i++) {
    const f = filas[i], r = i + 1, val = k => (col[k] == null ? '' : f[col[k]] ?? '');
    const txt = k => String(val(k)).trim();
    if (!txt('area')) break;
    if (out.length >= MAX_FILAS) falla(DATOS_INVALIDOS, `El archivo supera ${MAX_FILAS} personas`);
    const rubro = rubroDe(val('area'));
    if (!rubro) falla(DATOS_INVALIDOS, `Fila ${r}: área "${txt('area')}" desconocida`);
    const num = (k, opcional) => {
      if (opcional && txt(k) === '' && !val(k)?.sinValor) return null;
      const x = numero(val(k));
      if (!Number.isFinite(x) || x < 0) falla(DATOS_INVALIDOS, `Fila ${r}: valor inválido en ${COL_PERSONA[k][0]} ("${val(k)}")`);
      return x;
    };
    const p = {
      rubro, area: txt('area').slice(0, 80), proceso: txt('proceso').slice(0, 120), centro: txt('centro').slice(0, 120), nodo: txt('nodo').slice(0, 60),
      cargo: (txt('cargo') || txt('cargoBdd') || 'Sin cargo').slice(0, 120),
      s26: num('s26', true), s27: num('s27', true) ?? 0, factor: num('factor'), bolsa: num('bolsa', true),
      fila: num('fila'), unidad: txt('unidad').toUpperCase(), peso: num('peso', true) ?? 1
    };
    if (!p.proceso) falla(DATOS_INVALIDOS, `Fila ${r}: falta el proceso`);
    const ced = txt('cedula').replace(/[.\s]/g, '');
    if (ced && !/^[0-9A-Za-z-]{3,20}$/.test(ced)) falla(DATOS_INVALIDOS, `Fila ${r}: cédula inválida ("${txt('cedula')}")`);
    if (ced) p.cedula = ced;
    const nom = [txt('nombre'), txt('apellidos')].filter(Boolean).join(' ').slice(0, 160);
    if (nom) p.nombre = nom;
    out.push(p);
  }
  if (!out.length) falla(DATOS_INVALIDOS, 'El plan por persona no tiene filas');
  if (nLineas) { const e = revisarAsignacion(out, nLineas); if (e) falla(DATOS_INVALIDOS, e); }
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * Plan del equipo financiero tal como lo envía (hoja Nomina de PRESUPUESTO_2027_ENVIADO) más la
 * base de datos de nómina (BDD), cruzados por cédula, como se armó la hoja Nomina2027 de la 1.0:
 *  - del plan: cédula, nombre, centro de costos, salario 2027, costo anual, área, ítem informe, nodo;
 *  - de la BDD: cargo y salario actual (= salario 2026). Quien no está en la BDD queda como nuevo;
 *  - factor prestacional = costo anual ÷ (12 × salario 2027), con 4 decimales;
 *  - sin salario 2027: con costo es una bolsa (comisiones, escalafón, metas); sin costo, una vacante;
 *  - quien aparece en varias filas (dos procesos) pesa 1 ÷ número de filas en cada una;
 *  - fila del modelo y unidad: datos/nomina_mapa.json (tomado del Excel v21).
 * Los dos archivos se suben por separado, en cualquier orden; cada carga conserva el otro.
 * ------------------------------------------------------------------------------------------- */
const COL_EQUIPO = {
  cedula: COLUMNAS.cedula, nombre: [...COLUMNAS.nombre, 'nombre_colaborador', 'colaborador'], centro: ['centro_de_costos', 'centro_costos', 'centro_de_costo'],
  s27: ['salario_2027', 'salario_mensual_2027'], s27o: ['salario_ordinario_2027'], costo: ['costo_anual', 'costo_anual_2027'],
  area: ['area'], proceso: ['item_informe', 'item_del_informe'], nodo: ['nodo', 'sede']
};
const COL_BDD = {
  cedula: [...COLUMNAS.cedula, 'numero_identificacion', 'no_identificacion', 'numero_de_identificacion', 'identificacion_empleado', 'cedula_empleado', 'documento_identidad'],
  nombre: COLUMNAS.nombre, cargo: ['cargo', 'nombre_cargo', 'cargo_actual', 'descripcion_cargo', 'nombre_del_cargo'],
  salario: ['salario', 'salario_basico', 'sueldo', 'sueldo_basico', 'salario_actual', 'salario_mensual', 'basico', 'asignacion_basica', 'salario_2026', 'salario_mensual_2026', 'salario_base']
};
const columnas = (fila, def) => { const enc = fila.map(normal), col = {}; for (const [k, a] of Object.entries(def)) { const i = enc.findIndex(x => a.includes(x)); if (i >= 0) col[k] = i; } return col; };
const buscarEnc = (filas, ok) => filas.slice(0, 60).findIndex(ok);

/** Plan del equipo: fila de encabezados con "Item informe", "Costo anual" y "Salario 2027" (o -1). */
export const encabezadoEquipo = filas => buscarEnc(filas, f => { const c = columnas(f, COL_EQUIPO); return c.proceso != null && c.costo != null && (c.s27 != null || c.s27o != null) && !f.some(x => normal(x) === 'fila_modelo'); });
/** Base de nómina: cédula y salario, sin columnas del plan (o -1). */
export const encabezadoBdd = filas => buscarEnc(filas, f => { const c = columnas(f, COL_BDD); return c.cedula != null && c.salario != null && !f.some(x => ['item_informe', 'fila_modelo', 'costo_anual'].includes(normal(x))); });

const cedulaDe = (v, r) => {
  const ced = String(v ?? '').replace(/[.\s]/g, '').replace(/\.0$/, '').trim();
  if (ced && !/^[0-9A-Za-z-]{3,20}$/.test(ced)) falla(DATOS_INVALIDOS, `Fila ${r}: cédula inválida ("${v}")`);
  return ced;
};

/** Filas del plan del equipo → registros validados (sin cruzar todavía con la BDD). */
export function interpretarEquipo(filas, mapa) {
  const h = encabezadoEquipo(filas);
  if (h < 0) falla(DATOS_INVALIDOS, 'No se encontró el encabezado del plan del equipo (Item informe, Costo anual, Salario 2027)');
  const col = columnas(filas[h], COL_EQUIPO), out = [], excluidos = {}, desconocidos = {}, ajustes = {};
  for (let i = h + 1; i < filas.length; i++) {
    const f = filas[i], r = i + 1, val = k => (col[k] == null ? '' : f[col[k]] ?? ''), txt = k => String(val(k)).trim();
    if (!txt('proceso')) continue; /* totales o notas */
    if (out.length >= MAX_FILAS) falla(DATOS_INVALIDOS, `El archivo supera ${MAX_FILAS} personas`);
    const m = mapa.procesos[normal(txt('proceso'))];
    const num = (k, neg = false) => { if (col[k] == null) return 0; const x = numero(val(k)); if (!Number.isFinite(x) || (x < 0 && !neg)) falla(DATOS_INVALIDOS, `Fila ${r}: valor inválido en ${COL_EQUIPO[k][0]} ("${val(k)}")`); return x; };
    if (!m) {
      /* Docentes ocasionales y de cátedra: no son planta; el modelo los costea en CPS con la programación académica (como la 1.0) */
      if (FUERA_DE_PLANTA.test(normal(txt('proceso')))) { const x = excluidos[txt('proceso')] ??= { filas: 0, costo: 0 }; x.filas++; x.costo += num('costo', true); }
      else (desconocidos[txt('proceso')] ??= []).push(r);
      continue;
    }
    /* Costo negativo: ajuste del equipo (reintegro, menor valor); la 1.0 no lo llevaba al plan por persona */
    if (num('costo', true) < 0) { const x = ajustes[m.proceso] ??= { filas: 0, costo: 0 }; x.filas++; x.costo += num('costo', true); continue; }
    const rubro = rubroDe(txt('area')) || rubroDe(m.area);
    const s27 = col.s27 != null ? num('s27') : num('s27o');
    const e = { rubro, area: (rubroDe(txt('area')) ? txt('area') : m.area).slice(0, 80), proceso: m.proceso, centro: txt('centro').slice(0, 120), nodo: txt('nodo').slice(0, 60), s27, costo: num('costo') };
    const ced = cedulaDe(val('cedula'), r); if (ced) e.cedula = ced;
    const nom = txt('nombre').slice(0, 160); if (nom) e.nombre = nom;
    out.push(e);
  }
  const d = Object.entries(desconocidos);
  if (d.length) falla(DATOS_INVALIDOS, `Ítems informe que no están en la asignación del modelo: ${d.map(([k, f]) => `"${k}" (fila${f.length > 1 ? 's' : ''} ${f.slice(0, 5).join(', ')}${f.length > 5 ? '…' : ''})`).join('; ')}. `
    + `Ítems conocidos: ${Object.values(mapa.procesos).map(x => x.proceso).join(', ')}. Los docentes ocasionales y de cátedra se excluyen solos (van en CPS).`);
  if (!out.length) falla(DATOS_INVALIDOS, 'El plan del equipo no tiene filas');
  return { equipo: out, excluidos, ajustes };
}
const FUERA_DE_PLANTA = /(^|_)(ocasional(es)?|catedra)(_|$)/;

/** Base de nómina → { cédula: { s26, cargo } }. */
export function interpretarBdd(filas) {
  const h = encabezadoBdd(filas);
  if (h < 0) falla(DATOS_INVALIDOS, 'No se encontró el encabezado de la base de nómina (cédula y salario)');
  const col = columnas(filas[h], COL_BDD), out = {};
  let n = 0;
  for (let i = h + 1; i < filas.length; i++) {
    const f = filas[i], r = i + 1, val = k => (col[k] == null ? '' : f[col[k]] ?? '');
    const ced = cedulaDe(val('cedula'), r);
    if (!ced) continue;
    if (++n > MAX_FILAS) falla(DATOS_INVALIDOS, `El archivo supera ${MAX_FILAS} personas`);
    const s = numero(val('salario'));
    if (!Number.isFinite(s) || s < 0) falla(DATOS_INVALIDOS, `Fila ${r}: salario inválido ("${val('salario')}")`);
    const cargo = String(val('cargo')).trim().slice(0, 120);
    if (!out[ced]) out[ced] = { s26: s, cargo }; /* si figura dos veces, vale la primera fila */
  }
  if (!n) falla(DATOS_INVALIDOS, 'La base de nómina no tiene personas con cédula');
  return out;
}

const capital = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;

/** Plan del equipo + BDD → personas del plan (mismo formato que la hoja Nomina2027). */
export function combinarEquipo(equipo, bdd = {}, mapa) {
  const veces = {};
  for (const e of equipo) if (e.cedula) veces[e.cedula] = (veces[e.cedula] || 0) + 1;
  return equipo.map(e => {
    const b = e.cedula ? bdd[e.cedula] : null, n = normal;
    const unidad = mapa.unidad[`${n(e.nodo)}|${n(e.centro)}|${n(e.proceso)}`] || mapa.unidadNodo[`${n(e.nodo)}|${n(e.proceso)}`] || (/barranquilla/i.test(e.nodo) ? 'BAQ' : 'REPARTO');
    const p = {
      rubro: e.rubro, area: e.area, proceso: e.proceso, centro: e.centro, nodo: e.nodo,
      cargo: capital(b?.cargo) || 'Sin cargo', s26: b ? b.s26 : null, s27: e.s27,
      factor: e.s27 > 0 ? Math.round(e.costo / (12 * e.s27) * 1e4) / 1e4 : 0, bolsa: e.s27 > 0 ? null : (e.costo || null),
      fila: mapa.procesos[n(e.proceso)].fila, unidad, peso: e.cedula ? 1 / veces[e.cedula] : 1
    };
    if (e.cedula) p.cedula = e.cedula;
    if (e.nombre) p.nombre = e.nombre;
    return p;
  });
}

/**
 * Contenido a guardar para un archivo subido, conservando lo que ya estaba (el otro de los dos archivos).
 * @returns {{ formato:'personas', personas, equipo?, bdd? } | { formato:'bdd', bdd } | object[]}  (lo último: nómina por cargo)
 */
export function contenidoDeArchivo(celdas, previo, { mapa, nLineas }) {
  if (encabezadoPersonas(celdas) >= 0) return { formato: 'personas', personas: interpretarPersonas(celdas, nLineas) };
  const bddPrevio = previo?.bdd || null, equipoPrevio = previo?.equipo || null;
  if (encabezadoEquipo(celdas) >= 0) {
    const { equipo, excluidos, ajustes } = interpretarEquipo(celdas, mapa), personas = combinarEquipo(equipo, bddPrevio || {}, mapa);
    const e = revisarAsignacion(personas, nLineas); if (e) falla(DATOS_INVALIDOS, e);
    return { formato: 'personas', personas, equipo, excluidos, ajustes, ...(bddPrevio ? { bdd: bddPrevio } : {}) };
  }
  if (encabezadoBdd(celdas) >= 0) {
    const bdd = interpretarBdd(celdas);
    if (!equipoPrevio) return { formato: 'bdd', bdd };
    return { formato: 'personas', personas: combinarEquipo(equipoPrevio, bdd, mapa), equipo: equipoPrevio, excluidos: previo.excluidos || {}, ajustes: previo.ajustes || {}, bdd };
  }
  return interpretarNomina(celdas);
}

/** Avisos sobre el cruce de los dos archivos, para la pantalla. */
export function avisosCarga(contenido) {
  if (contenido?.formato === 'bdd') return [`Base de nómina cargada (${Object.keys(contenido.bdd).length} personas). Falta el plan por persona del equipo: súbalo y se cruzan por cédula.`];
  if (!contenido?.equipo) return [];
  const av = [], ex = Object.entries(contenido.excluidos || {});
  if (ex.length) {
    const f = ex.reduce((s, [, x]) => s + x.filas, 0), c = ex.reduce((s, [, x]) => s + x.costo, 0);
    av.push(`No entran al plan ${f} fila${f === 1 ? '' : 's'} de docentes ocasionales y de cátedra (${ex.map(([k]) => k).join(', ')}; $${Math.round(c / 1e6).toLocaleString('es-CO')} M en el archivo): no son planta y el modelo los costea en Costo de prestación con la programación académica, como en la 1.0.`);
  }
  const aj = Object.entries(contenido.ajustes || {});
  if (aj.length) {
    const f = aj.reduce((s, [, x]) => s + x.filas, 0), c = aj.reduce((s, [, x]) => s + x.costo, 0);
    av.push(`No entran al plan ${f} fila${f === 1 ? '' : 's'} con costo negativo (ajustes: ${aj.map(([k]) => k).join(', ')}; −$${Math.round(-c / 1e6).toLocaleString('es-CO')} M), como en la 1.0. Si deben restar en la nómina, avíseme.`);
  }
  return [...av, ...avisosCruce(contenido)];
}
function avisosCruce(contenido) {
  if (!contenido.bdd) return ['Falta la base de nómina (cargo y salario actual). Mientras no se suba, todos los que tienen salario 2027 cuentan como cargos nuevos y sin incremento desde abril.'];
  const fuera = new Set(contenido.equipo.filter(e => e.cedula && e.s27 > 0 && !contenido.bdd[e.cedula]).map(e => e.cedula)).size;
  return fuera ? [`${fuera} persona${fuera === 1 ? '' : 's'} del plan con salario 2027 no está${fuera === 1 ? '' : 'n'} en la base de nómina: cuenta${fuera === 1 ? '' : 'n'} como cargo nuevo.`] : [];
}

/** Vista por cargo (la de la pantalla) del plan por persona, con su clase y costo. */
export function filasDePersonas(plan) {
  return plan.personas.map(p => ({
    rubro: p.rubro, proceso: p.proceso, cargo: p.cargo, clase: p.clase,
    continuan: p.clase === 'Continúa' ? p.peso : 0, nuevos: p.clase === 'Nuevo' ? p.peso : 0, vacantes: p.clase === 'Vacante' ? 1 : 0,
    salario2026: p.s26 ?? 0, salario2027: p.s27, costoAnual: p.costoAjustado,
    ...(p.cedula ? { cedula: p.cedula } : {}), ...(p.nombre ? { nombre: p.nombre } : {})
  }));
}

/** Convierte el archivo (texto CSV o filas ya leídas) en filas validadas. Lanza DATOS_INVALIDOS con el renglón que falla. */
export function interpretarNomina(entrada) {
  const filas = Array.isArray(entrada) ? entrada : leerCsv(entrada);
  if (filas.length < 2) falla(DATOS_INVALIDOS, 'El archivo no tiene filas de nómina');
  const enc = filas[0].map(normal);
  const col = {};
  for (const [k, alias] of Object.entries(COLUMNAS)) { const i = enc.findIndex(h => alias.includes(h)); if (i >= 0) col[k] = i; }
  const faltan = OBLIGATORIAS.filter(k => col[k] == null);
  if (faltan.length) {
    const vistas = filas[0].map(x => String(x).trim()).filter(Boolean).slice(0, 30).join(', ');
    falla(DATOS_INVALIDOS, `No se reconoce el formato del archivo. Columnas encontradas: ${vistas || '(ninguna)'}. `
      + 'Para el plan por persona, como en la 1.0, suba dos archivos: el plan del equipo (Cedula, Nombre colaborador, Centro de costos, Salario 2027, Costo anual, Area, Item informe, Nodo) '
      + 'y la base de nómina (Documento, Nombre, Cargo, Salario); o el Excel del modelo con la hoja Nomina2027. '
      + `Para la nómina por cargo faltan: ${faltan.map(k => COLUMNAS[k][0]).join(', ')}.`);
  }
  if (filas.length - 1 > MAX_FILAS) falla(DATOS_INVALIDOS, `El archivo supera ${MAX_FILAS} filas`);
  return filas.slice(1).map((f, i) => {
    const r = i + 2, val = k => (col[k] == null ? '' : f[col[k]] ?? '');
    const rubro = rubroDe(val('rubro'));
    if (!rubro) falla(DATOS_INVALIDOS, `Fila ${r}: rubro "${val('rubro')}" desconocido. Use el numeral del estado de resultados (4.1, 4.2, 4.3, 4.4, 6.1, 6.2, 6.3, 6.4) o su código.`);
    const proceso = String(val('proceso')).trim().slice(0, 120), cargo = String(val('cargo')).trim().slice(0, 120);
    if (!proceso || !cargo) falla(DATOS_INVALIDOS, `Fila ${r}: falta el proceso o el cargo`);
    const n = {};
    for (const k of ['continuan', 'nuevos', 'vacantes', 'salario2026', 'salario2027', 'costoAnual']) {
      const x = numero(val(k));
      if (!Number.isFinite(x) || x < 0) falla(DATOS_INVALIDOS, `Fila ${r}: valor inválido en ${COLUMNAS[k][0]} ("${val(k)}")`);
      n[k] = x;
    }
    const persona = {};
    if (col.cedula != null) {
      const ced = String(val('cedula')).replace(/[.\s]/g, '').trim();
      if (ced && !/^[0-9A-Za-z-]{3,20}$/.test(ced)) falla(DATOS_INVALIDOS, `Fila ${r}: cédula inválida ("${val('cedula')}")`);
      if (ced) persona.cedula = ced;
    }
    const nom = [val('nombre'), val('apellidos')].map(x => String(x).trim()).filter(Boolean).join(' ').slice(0, 160);
    if (nom) persona.nombre = nom;
    return { rubro, proceso, cargo, ...n, ...persona };
  });
}

/**
 * @param {object} [op]
 * @param {Buffer} [op.llave]  32 bytes (por defecto, FINANTIA_LLAVE_NOMINA en base64)
 */
export function crearNomina({ llave = null, env = process.env } = {}) {
  let k = llave;
  if (!k && env.FINANTIA_LLAVE_NOMINA) k = Buffer.from(env.FINANTIA_LLAVE_NOMINA, 'base64');
  const activa = !!k && k.length === 32;
  const exigirLlave = () => { if (!activa) falla(NO_DISPONIBLE, 'La carga de nómina no está configurada en este servidor (falta FINANTIA_LLAVE_NOMINA, una llave de 32 bytes en base64).'); };
  const exigirSensible = (actor, accion) => {
    exigir(actor, M, accion);
    if (!veDetalleSensible(actor, M)) falla(NO_AUTORIZADO, 'Sin permiso para ver la nómina por cargo (requiere el detalle sensible del módulo Presupuesto)');
  };
  const aad = (anio, id) => Buffer.from(`finantia:nomina:${anio}:${id}`);
  /* Vista de la carga: con los supuestos del Excel (SMMLV 2027 Moderado, solo cargos nuevos) y la asignación de los datos base */
  const opPlan = async () => { const b = await baseDatos(); return { REP: b.REP, nLineas: b.LP.length, sm27: smmlv2027(DEFAULTS.Moderado.sm) }; };

  async function subir(db, actor, anio, { nombre, contenido }) {
    exigirSensible(actor, 'editar');
    exigirLlave();
    const n = String(nombre || '').normalize('NFC').replace(/[\\/\x00-\x1f"<>|:*?]/g, '_').trim().slice(0, 180);
    if (!Buffer.isBuffer(contenido) || !contenido.length) falla(DATOS_INVALIDOS, 'El archivo está vacío');
    const celdas = await filasDelArchivo(n, contenido, (d, max) => inflateRawSync(d, { maxOutputLength: max }));
    const op = await opPlan();
    let previo = null;
    try { previo = (await cargaVigente(db, anio))?.contenido || null; } catch { /* otra llave: se empieza de cero */ }
    const guardar = contenidoDeArchivo(celdas, previo, { mapa: await mapaDatos(), nLineas: op.nLineas });
    const filas = guardar.formato === 'personas' ? filasDePersonas(planNomina(guardar.personas, op)) : guardar.formato === 'bdd' ? [] : guardar;
    const personas = filas.reduce((s, f) => s + f.continuan + f.nuevos + f.vacantes, 0);
    const costo = filas.reduce((s, f) => s + f.costoAnual, 0);
    const huella = createHash('sha256').update(contenido).digest('hex');
    return db.tx(async t => {
      if (!(await t.query('SELECT 1 FROM ejercicio WHERE anio = $1', [anio])).rows.length) falla(NO_ENCONTRADO, `No existe el ejercicio ${anio}`);
      const anteriores = (await t.query('SELECT id FROM nomina_carga WHERE ejercicio = $1 AND retirado_en IS NULL FOR UPDATE', [anio])).rows.map(x => Number(x.id));
      if (anteriores.length) await t.query('UPDATE nomina_carga SET retirado_en = now(), retirado_por = $2, cifrado = NULL, iv = NULL, etiqueta = NULL WHERE id = ANY($1::bigint[])', [anteriores, actor.id]);
      const id = Number((await t.query(
        'INSERT INTO nomina_carga (ejercicio, nombre, filas, personas, costo_total, huella, subido_por) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [anio, n, guardar.formato === 'personas' ? guardar.personas.length : guardar.formato === 'bdd' ? Object.keys(guardar.bdd).length : filas.length, personas, costo, huella, actor.id])).rows[0].id);
      const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', k, iv);
      c.setAAD(aad(anio, id));
      const cifrado = Buffer.concat([c.update(JSON.stringify(guardar), 'utf8'), c.final()]);
      await t.query('UPDATE nomina_carga SET cifrado = $2, iv = $3, etiqueta = $4 WHERE id = $1', [id, cifrado, iv, c.getAuthTag()]);
      await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'SUBIR_NOMINA', entidad: 'nomina', entidadId: id,
        despues: { ejercicio: anio, nombre: n, filas: filas.length, personas, costoTotal: costo, huella, reemplaza: anteriores } });
      return id;
    });
  }

  /** Carga vigente del ejercicio, descifrada (o null si no hay). */
  async function cargaVigente(db, anio) {
    const r = (await db.query(`SELECT n.id, n.nombre, n.filas, n.personas, n.costo_total, n.huella, n.subido_en, n.cifrado, n.iv, n.etiqueta, u.nombre AS subido_por
        FROM nomina_carga n JOIN usuario u ON u.id = n.subido_por WHERE n.ejercicio = $1 AND n.retirado_en IS NULL ORDER BY n.id DESC LIMIT 1`, [anio])).rows[0];
    if (!r) return null;
    exigirLlave();
    let contenido;
    try {
      const d = createDecipheriv('aes-256-gcm', k, Buffer.from(r.iv));
      d.setAAD(aad(anio, Number(r.id))); d.setAuthTag(Buffer.from(r.etiqueta));
      contenido = JSON.parse(Buffer.concat([d.update(Buffer.from(r.cifrado)), d.final()]).toString('utf8'));
    } catch { falla(NO_DISPONIBLE, 'No se pudo descifrar la nómina: la llave del servidor cambió o el contenido fue alterado.'); }
    return { r, contenido };
  }

  /** Carga vigente del ejercicio con sus filas descifradas (o null si no hay). Con el plan por persona trae también las personas. */
  async function ver(db, actor, anio) {
    exigirSensible(actor, 'ver');
    let c;
    try { c = await cargaVigente(db, anio); }
    catch (e) {
      /* Sin llave o con otra llave: se informa y se deja retirar o reemplazar la carga */
      const r = (await db.query(`SELECT n.id, n.nombre, n.filas, n.personas, n.costo_total, n.huella, n.subido_en, u.nombre AS subido_por
          FROM nomina_carga n JOIN usuario u ON u.id = n.subido_por WHERE n.ejercicio = $1 AND n.retirado_en IS NULL ORDER BY n.id DESC LIMIT 1`, [anio])).rows[0];
      return { activa, carga: { id: Number(r.id), nombre: r.nombre, filas: r.filas, personas: Number(r.personas), costoTotal: Number(r.costo_total), huella: r.huella, subidoEn: r.subido_en, subidoPor: r.subido_por }, filas: [], error: e.message };
    }
    if (!c) return { activa, carga: null, filas: [] };
    const { r, contenido } = c;
    await registrar(db, { usuarioId: actor.id, modulo: M, accion: 'VER_NOMINA', entidad: 'nomina', entidadId: Number(r.id), detalle: `ejercicio ${anio}` });
    const carga = { id: Number(r.id), nombre: r.nombre, filas: r.filas, personas: Number(r.personas), costoTotal: Number(r.costo_total), huella: r.huella, subidoEn: r.subido_en, subidoPor: r.subido_por, formato: contenido.formato || 'cargos' };
    const avisos = avisosCarga(contenido);
    if (contenido.formato === 'personas') return { activa, carga, avisos, filas: filasDePersonas(planNomina(contenido.personas, await opPlan())), personas: contenido.personas };
    if (contenido.formato === 'bdd') return { activa, carga, avisos, filas: [] };
    return { activa, carga, avisos, filas: contenido };
  }

  /**
   * Aplica el plan por persona a una versión en borrador: calcula la nómina por línea y unidad con
   * los cargos a costear y las personas por proceso, y la versión se recalcula con ella.
   * modo = null quita el plan y la versión vuelve a la nómina de los datos base.
   */
  async function aplicar(db, actor, versionId, { modo = 'plan', personas = {} } = {}) {
    exigirSensible(actor, 'editar');
    if (modo !== null && !MODOS.some(([m]) => m === modo)) falla(DATOS_INVALIDOS, `Modo desconocido: ${modo}`);
    if (!personas || typeof personas !== 'object' || Array.isArray(personas)) falla(DATOS_INVALIDOS, 'personas debe ser un objeto { proceso: total }');
    for (const [p, n] of Object.entries(personas)) if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10000) falla(DATOS_INVALIDOS, `Total de personas inválido en ${p}`);
    const { version, datos } = await datosDeVersion(db, versionId);
    if (modo === null) return fijarNominaVersion(db, actor, versionId, null);
    const c = await cargaVigente(db, version.ejercicio);
    if (!c || c.contenido.formato !== 'personas') falla(ESTADO_INVALIDO, 'Para aplicar la nómina a la versión, suba primero el plan por persona del ejercicio');
    const procesos = new Set(c.contenido.personas.map(p => p.proceso));
    for (const p of Object.keys(personas)) if (!procesos.has(p)) falla(DATOS_INVALIDOS, `Proceso desconocido: ${p}`);
    const sm = version.supuestos?.params?.Moderado?.sm ?? DEFAULTS.Moderado.sm;
    const plan = planNomina(c.contenido.personas, { REP: datos.REP, nLineas: datos.LP.length, sm27: smmlv2027(sm), modo, personasPorProceso: personas });
    return fijarNominaVersion(db, actor, versionId, { LP: plan.LP, nominaPlan: { cargaId: Number(c.r.id), huella: c.r.huella, modo, personas, total: plan.total } });
  }

  /** Retira la carga y borra su contenido cifrado (solo quedan los totales en la bitácora). */
  async function retirar(db, actor, id) {
    exigirSensible(actor, 'editar');
    return db.tx(async t => {
      const r = (await t.query('SELECT ejercicio, nombre FROM nomina_carga WHERE id = $1 AND retirado_en IS NULL FOR UPDATE', [id])).rows[0];
      if (!r) falla(NO_ENCONTRADO, 'La carga de nómina no existe o ya fue retirada');
      await t.query('UPDATE nomina_carga SET retirado_en = now(), retirado_por = $2, cifrado = NULL, iv = NULL, etiqueta = NULL WHERE id = $1', [id, actor.id]);
      await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'RETIRAR_NOMINA', entidad: 'nomina', entidadId: id, antes: { ejercicio: r.ejercicio, nombre: r.nombre } });
    });
  }

  return { activa, subir, ver, retirar, aplicar };
}
