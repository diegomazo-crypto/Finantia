/**
 * Lector mínimo de Excel (.xlsx) para las cargas: devuelve las filas de una hoja (la pedida por nombre o la primera).
 *
 * Un .xlsx es un ZIP con XML adentro. Aquí se lee el directorio del ZIP, se descomprimen solo
 * los archivos que hacen falta (libro, relaciones, textos compartidos y la primera hoja) y se
 * toman los valores de las celdas: números como número, textos como texto y, si la celda tiene
 * fórmula, el último valor que Excel calculó. Sin dependencias, para que funcione igual en el
 * servidor y en la demostración del navegador: quien llama pasa la función que descomprime
 * (deflate sin encabezado).
 *
 * Límites contra archivos malformados o "bombas": 20 MB descomprimidos por archivo interno,
 * 200.000 celdas y la columna XFD como máximo.
 */
import { falla, DATOS_INVALIDOS } from '../errores.js';

export const MAX_DESCOMPRIMIDO = 20 * 1024 * 1024;
const MAX_CELDAS = 200000;

/** Celda con fórmula sin valor calculado: se lee como texto vacío. */
export const sinValor = ref => ({ sinValor: true, ref, toString: () => '' });

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const malo = msg => falla(DATOS_INVALIDOS, `El archivo Excel no se pudo leer (${msg}). Guárdelo de nuevo como "Libro de Excel (.xlsx)".`);

/** ¿Empieza como ZIP? (sirve para distinguir un .xlsx de un CSV renombrado) */
export const esZip = b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

function directorio(b) {
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (u32(b, i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) malo('no es un ZIP');
  const n = u16(b, fin + 10); let p = u32(b, fin + 16);
  const archivos = new Map(), dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) malo('directorio dañado');
    const metodo = u16(b, p + 10), comprimido = u32(b, p + 20), largo = u32(b, p + 24);
    const ln = u16(b, p + 28), le = u16(b, p + 30), lc = u16(b, p + 32), local = u32(b, p + 42);
    archivos.set(dec.decode(b.subarray(p + 46, p + 46 + ln)), { metodo, comprimido, largo, local });
    p += 46 + ln + le + lc;
  }
  return archivos;
}

async function extraer(b, archivos, nombre, inflar) {
  const a = archivos.get(nombre);
  if (!a) return null;
  if (a.largo > MAX_DESCOMPRIMIDO) malo('demasiado grande');
  const h = a.local;
  if (h + 30 > b.length || u32(b, h) !== 0x04034b50) malo('archivo interno dañado');
  const ini = h + 30 + u16(b, h + 26) + u16(b, h + 28), datos = b.subarray(ini, ini + a.comprimido);
  let out;
  if (a.metodo === 0) out = datos;
  else if (a.metodo === 8) { try { out = await inflar(datos, MAX_DESCOMPRIMIDO); } catch { malo('compresión dañada'); } }
  else malo('compresión no soportada');
  if (out.length > MAX_DESCOMPRIMIDO) malo('demasiado grande');
  return new TextDecoder().decode(out);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const texto = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()]);
/** Junta los <t> de un nodo (texto con formato enriquecido viene en varios). Omite la guía fonética <rPh>. */
const tes = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map(m => texto(m[1] || '')).join('');
const attr = (tag, n) => { const m = tag.match(new RegExp(`\\s${n}="([^"]*)"`)); return m ? texto(m[1]) : null; };

function columna(ref) {
  const m = /^([A-Z]{1,3})\d+$/.exec(ref || '');
  if (!m) return null;
  let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
  return c - 1;
}

/**
 * @param {Uint8Array} b         contenido del .xlsx
 * @param {(datos: Uint8Array, max: number) => Promise<Uint8Array>|Uint8Array} inflar
 * @param {{ hojas?: string[] }} [op]  hojas preferidas por nombre (sin tildes ni mayúsculas); si no está ninguna, la primera
 * @returns {Promise<Array<Array<string|number>>>} filas de la hoja (sin filas vacías)
 */
export async function leerXlsx(b, inflar, { hojas = [] } = {}) {
  if (!esZip(b)) malo('no es un .xlsx');
  const archivos = directorio(b);
  const libro = await extraer(b, archivos, 'xl/workbook.xml', inflar);
  if (!libro) malo('no trae xl/workbook.xml; ¿es un .xls antiguo?');
  const hojasLibro = [...libro.matchAll(/<sheet\b[^>]*>/g)].map(m => m[0]);
  if (!hojasLibro.length) malo('el libro no tiene hojas');
  const norm = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pedida = hojas.map(norm);
  const hoja1 = [hojasLibro.find(t => pedida.includes(norm(attr(t, 'name')))) || hojasLibro[0]];
  const rid = attr(hoja1[0], 'r:id');
  const rels = (await extraer(b, archivos, 'xl/_rels/workbook.xml.rels', inflar)) || '';
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(t => attr(t, 'Id') === rid);
  let ruta = rel ? attr(rel, 'Target') : 'worksheets/sheet1.xml';
  ruta = ruta.startsWith('/') ? ruta.slice(1) : 'xl/' + ruta.replace(/^\.\//, '');
  const hoja = await extraer(b, archivos, ruta, inflar);
  if (!hoja) malo('no se encontró la primera hoja');
  const sst = await extraer(b, archivos, 'xl/sharedStrings.xml', inflar);
  const compartidos = sst ? [...sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)].map(m => tes(m[1] || '')) : [];

  const filas = []; let celdas = 0;
  for (const fm of hoja.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const fila = [];
    let siguiente = 0;
    for (const cm of (fm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (++celdas > MAX_CELDAS) malo('demasiadas celdas');
      const tag = ' ' + cm[1], cuerpo = cm[2] || '';
      const i = columna(attr(tag, 'r')) ?? siguiente;
      if (i > 16383) malo('columna fuera de rango');
      siguiente = i + 1;
      const t = attr(tag, 't'), v = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      /* Fórmula sin valor calculado: se marca y solo es error si se usa como número (numero() en nomina.js) */
      if ((v == null || v === '') && t !== 'str' && /<f\b/.test(cuerpo)) { fila[i] = sinValor(attr(tag, 'r') || ''); continue; }
      if (t === 's') val = compartidos[Number(v)] ?? '';
      else if (t === 'inlineStr') val = tes((cuerpo.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || '');
      else if (t === 'str' || t === 'e') val = v == null ? '' : texto(v);
      else if (t === 'b') val = v === '1' ? 'VERDADERO' : 'FALSO';
      else if (v != null && v !== '') { const n = Number(v); val = Number.isFinite(n) ? n : texto(v); }
      fila[i] = val;
    }
    for (let k = 0; k < fila.length; k++) if (fila[k] === undefined) fila[k] = '';
    if (fila.some(x => String(x).trim() !== '')) filas.push(fila);
  }
  return filas;
}
