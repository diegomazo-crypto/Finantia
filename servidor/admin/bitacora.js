/** Registro en la bitácora (solo inserción; la tabla rechaza cambios y borrados). */
export async function registrar(db, { usuarioId = null, modulo, accion, entidad = null, entidadId = null, antes = null, despues = null, detalle = null }) {
  await db.query(
    'INSERT INTO bitacora (usuario_id, modulo, accion, entidad, entidad_id, antes, despues, detalle) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [usuarioId, modulo, accion, entidad, entidadId == null ? null : String(entidadId), antes == null ? null : JSON.stringify(antes), despues == null ? null : JSON.stringify(despues), detalle]
  );
}
