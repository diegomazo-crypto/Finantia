// Texto de un PDF por líneas, para leer el resumen de los extractos bancarios.
// Se usa pdfjs-dist (sin dependencias del sistema). Los PDF escaneados (imagen)
// no tienen texto: se devuelve vacío y quien llama pide el registro manual.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function lineasPdf(buf, { maxPaginas = 3 } = {}) {
  const datos = new Uint8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  const doc = await getDocument({ data: datos, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const lineas = [];
  try {
    const n = Math.min(doc.numPages, maxPaginas);
    for (let p = 1; p <= n; p++) {
      const pag = await doc.getPage(p);
      const tc = await pag.getTextContent();
      const filas = new Map();
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 2) * 2;
        const x = it.transform[4];
        let k = [...filas.keys()].find(v => Math.abs(v - y) <= 2);
        if (k === undefined) { k = y; filas.set(k, []); }
        filas.get(k).push({ x, s: it.str });
      }
      [...filas.entries()].sort((a, b) => b[0] - a[0]).forEach(([, its]) => {
        lineas.push(its.sort((a, b) => a.x - b.x).map(i => i.s.trim()).join(' ').replace(/\s+/g, ' ').trim());
      });
    }
  } finally { await doc.destroy(); }
  return lineas;
}
