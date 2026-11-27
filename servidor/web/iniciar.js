/**
 * Arranca Finantia 2.0.
 *
 *   DATABASE_URL=postgres://...  ENTRA_TENANT_ID=...  ENTRA_CLIENT_ID=...  node servidor/web/iniciar.js
 *
 * Para probar en un computador sin PostgreSQL ni Microsoft 365:
 *
 *   npm run demo
 *
 * levanta una base en memoria con usuarios de ejemplo y el modo de desarrollo.
 */
import { conectar, desdePGlite, migrar } from '../db/conexion.js';
import { crearServidor } from './servidor.js';

const puerto = Number(process.env.PORT || 3000);
let db;
if (process.env.FINANTIA_DEMO === '1') {
  process.env.FINANTIA_MODO_DESARROLLO = '1';
  const { PGlite } = await import('@electric-sql/pglite');
  db = desdePGlite(new PGlite());
  await migrar(db);
  const { sembrarDemo } = await import('./demo.js');
  await sembrarDemo(db);
  /* La demo no guarda nada en disco: una llave de nómina de un solo uso basta. */
  process.env.FINANTIA_LLAVE_NOMINA ||= (await import('node:crypto')).randomBytes(32).toString('base64');
} else {
  db = await conectar();
  await migrar(db);
}
crearServidor(db).listen(puerto, () => console.log(`Finantia 2.0 en http://localhost:${puerto}`));
