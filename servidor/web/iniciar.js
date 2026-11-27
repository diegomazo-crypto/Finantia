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
 *
 * Servidor de pruebas en internet (sin Microsoft 365, todo el sitio detrás de una clave):
 *
 *   FINANTIA_MODO_PRUEBAS=1  FINANTIA_CLAVE_PRUEBAS=...  [DATABASE_URL=...]  node servidor/web/iniciar.js
 *
 * Usa PostgreSQL si hay DATABASE_URL; si no, una base PGlite guardada en FINANTIA_DIR_DATOS
 * (por defecto ./datos-servidor). La primera vez siembra los usuarios de ejemplo y la versión 1
 * del presupuesto 2027. No activa la nómina por cargo, y el auxiliar contable por centro de
 * costos y cuenta y la evaluación del equipo solo se cargan con FINANTIA_PRUEBAS_DETALLE=1.
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
} else if (process.env.FINANTIA_MODO_PRUEBAS === '1') {
  delete process.env.FINANTIA_LLAVE_NOMINA; /* sin nómina por cargo en el sitio de pruebas */
  if (process.env.DATABASE_URL) db = await conectar();
  else {
    const { PGlite } = await import('@electric-sql/pglite');
    db = desdePGlite(new PGlite(process.env.FINANTIA_DIR_DATOS || './datos-servidor'));
  }
  await migrar(db);
  const hay = (await db.query('SELECT count(*)::int AS n FROM usuario')).rows[0].n;
  if (!hay) {
    const { sembrarDemo } = await import('./demo.js');
    await sembrarDemo(db, { detalle: process.env.FINANTIA_PRUEBAS_DETALLE === '1' });
    console.log('Base de pruebas sembrada con los usuarios de ejemplo');
  }
} else {
  db = await conectar();
  await migrar(db);
}
crearServidor(db).listen(puerto, () => console.log(`Finantia 2.0 en http://localhost:${puerto}`));
