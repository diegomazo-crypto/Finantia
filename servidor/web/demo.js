/** Datos de ejemplo para `npm run demo`: un usuario por rol y la versión 1 del presupuesto 2027. */
import { readFileSync } from 'node:fs';
import * as A from '../admin/admin.js';
import { cargarActor } from '../admin/permisos.js';
import * as P from '../presupuesto/servicio.js';

export async function sembrarDemo(db) {
  const su = await cargarActor(db, await A.inicializarSuperusuario(db, { correo: 'superusuario@demo.finantia', nombre: 'Superusuario (demo)' }, []));
  const crea = async (correo, nombre, rol) => { const id = await A.crearUsuario(db, su, { correo, nombre }, []); await A.asignarAcceso(db, su, id, 'PRESUPUESTO', rol); return id; };
  const adm = await cargarActor(db, await crea('administracion@demo.finantia', 'Equipo financiero (demo)', 'ADMINISTRACION'));
  await crea('aprobacion@demo.finantia', 'Aprobador (demo)', 'APROBACION');
  await crea('consulta@demo.finantia', 'Consulta (demo)', 'VISUALIZACION');
  const datos = JSON.parse(readFileSync(new URL('../../datos/base2026.json', import.meta.url)));
  const base = await P.cargarDatosBase(db, adm, { anioBase: 2026, descripcion: 'Base 2026E (Excel v21)', contenido: datos });
  await P.crearEjercicio(db, adm, 2027);
  await P.crearVersion(db, adm, { ejercicio: 2027, nombre: 'Presupuesto 2027 · propuesta inicial', datosBaseId: base });
}
