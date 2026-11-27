/**
 * Acceso a PostgreSQL. El resto del servidor solo usa esta interfaz:
 *   db.query(sql, params) → { rows }
 *   db.tx(async t => { ... t.query(...) ... })  transacción (COMMIT al terminar, ROLLBACK si falla);
 *   t.exec(sql) ejecuta un script de varias sentencias sin parámetros
 *
 * En producción se conecta con `pg` (Azure Database for PostgreSQL u otro);
 * en las pruebas, con PGlite (PostgreSQL en memoria), sin servidor.
 */
import { readdirSync, readFileSync } from 'node:fs';

/** Envuelve un pg.Pool. */
export function desdePool(pool) {
  return {
    query: (sql, params) => pool.query(sql, params),
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn({ query: (s, p) => c.query(s, p), exec: s => c.query(s) });
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    },
    cerrar: () => pool.end()
  };
}

/** Envuelve una instancia de PGlite. */
export function desdePGlite(pg) {
  const q = cli => (sql, params) => cli.query(sql, params);
  return {
    query: q(pg),
    tx: fn => pg.transaction(t => fn({ query: q(t), exec: s => t.exec(s) })),
    cerrar: () => pg.close()
  };
}

/** Conecta a PostgreSQL con la variable de entorno DATABASE_URL. */
export async function conectar(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('Falta DATABASE_URL');
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, v => Number(v));      /* bigint → número (los id caben) */
  pg.types.setTypeParser(1700, v => Number(v));    /* numeric → número */
  return desdePool(new pg.Pool({ connectionString: url, ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: true } }));
}

const DIR = new URL('./migraciones/', import.meta.url);

/** Aplica en orden las migraciones que falten (servidor/db/migraciones/NNN_*.sql). */
export async function migrar(db) {
  await db.query('CREATE TABLE IF NOT EXISTS migracion (nombre text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())');
  const hechas = new Set((await db.query('SELECT nombre FROM migracion')).rows.map(r => r.nombre));
  const pendientes = readdirSync(DIR).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort().filter(f => !hechas.has(f));
  for (const f of pendientes) {
    const sql = readFileSync(new URL(f, DIR), 'utf8');
    await db.tx(async t => {
      await t.exec(sql);
      await t.query('INSERT INTO migracion (nombre) VALUES ($1)', [f]);
    });
  }
  return pendientes;
}
