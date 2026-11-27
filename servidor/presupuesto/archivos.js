/**
 * Archivos de soporte de un ejercicio presupuestal (matrículas, programación, nómina,
 * contratos…). Suben quienes editan el presupuesto; los ven todos los del módulo.
 * Un archivo no se borra: se retira, y la bitácora lo registra.
 */
import { createHash } from 'node:crypto';
import { exigir } from '../admin/permisos.js';
import { registrar } from '../admin/bitacora.js';
import { falla, DATOS_INVALIDOS, NO_ENCONTRADO } from '../errores.js';

const M = 'PRESUPUESTO';
export const TAMANO_MAXIMO = 15 * 1024 * 1024;
/* Tipos que se aceptan; el contenido se descarga siempre como adjunto, nunca se muestra en el navegador. */
const TIPOS = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.txt': 'text/plain', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.zip': 'application/zip'
};
export const EXTENSIONES = Object.keys(TIPOS);

function limpiarNombre(n) {
  const s = String(n || '').normalize('NFC').replace(/[\\/\x00-\x1f"<>|:*?]/g, '_').replace(/^\.+/, '').trim().slice(0, 180);
  if (!s) falla(DATOS_INVALIDOS, 'Falta el nombre del archivo');
  return s;
}

export async function subirArchivo(db, actor, anio, { nombre, descripcion = null, contenido }) {
  exigir(actor, M, 'editar');
  const n = limpiarNombre(nombre);
  const ext = (n.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!TIPOS[ext]) falla(DATOS_INVALIDOS, `Tipo de archivo no permitido (${ext || 'sin extensión'}). Se aceptan: ${EXTENSIONES.join(', ')}`);
  if (!Buffer.isBuffer(contenido) || !contenido.length) falla(DATOS_INVALIDOS, 'El archivo está vacío');
  if (contenido.length > TAMANO_MAXIMO) falla(DATOS_INVALIDOS, 'El archivo supera 15 MB');
  const d = descripcion == null ? null : String(descripcion).trim().slice(0, 500) || null;
  const huella = createHash('sha256').update(contenido).digest('hex');
  return db.tx(async t => {
    if (!(await t.query('SELECT 1 FROM ejercicio WHERE anio = $1', [anio])).rows.length) falla(NO_ENCONTRADO, `No existe el ejercicio ${anio}`);
    const id = Number((await t.query(
      'INSERT INTO archivo (ejercicio, nombre, tipo, tamano, descripcion, huella, contenido, subido_por) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
      [anio, n, TIPOS[ext], contenido.length, d, huella, contenido, actor.id])).rows[0].id);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'SUBIR_ARCHIVO', entidad: 'archivo', entidadId: id, despues: { ejercicio: anio, nombre: n, tamano: contenido.length, huella } });
    return id;
  });
}

export async function listarArchivos(db, actor, anio) {
  exigir(actor, M, 'ver');
  return (await db.query(`SELECT a.id, a.nombre, a.tipo, a.tamano, a.descripcion, a.huella, a.subido_en, u.nombre AS subido_por
      FROM archivo a JOIN usuario u ON u.id = a.subido_por WHERE a.ejercicio = $1 AND a.retirado_en IS NULL ORDER BY a.subido_en DESC, a.id DESC`, [anio]))
    .rows.map(r => ({ ...r, id: Number(r.id) }));
}

export async function descargarArchivo(db, actor, id) {
  exigir(actor, M, 'ver');
  const r = (await db.query('SELECT nombre, tipo, contenido FROM archivo WHERE id = $1 AND retirado_en IS NULL', [id])).rows[0];
  if (!r) falla(NO_ENCONTRADO, 'El archivo no existe o fue retirado');
  return { nombre: r.nombre, tipo: r.tipo, contenido: Buffer.from(r.contenido) };
}

export async function retirarArchivo(db, actor, id) {
  exigir(actor, M, 'editar');
  return db.tx(async t => {
    const r = (await t.query('SELECT nombre, ejercicio FROM archivo WHERE id = $1 AND retirado_en IS NULL FOR UPDATE', [id])).rows[0];
    if (!r) falla(NO_ENCONTRADO, 'El archivo no existe o ya fue retirado');
    await t.query('UPDATE archivo SET retirado_en = now(), retirado_por = $2 WHERE id = $1', [id, actor.id]);
    await registrar(t, { usuarioId: actor.id, modulo: M, accion: 'RETIRAR_ARCHIVO', entidad: 'archivo', entidadId: id, antes: { nombre: r.nombre, ejercicio: r.ejercicio } });
  });
}
