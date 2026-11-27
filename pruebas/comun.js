import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export const leerJSON = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url)));
export const datos = leerJSON('../datos/base2026.json');

/** Tolerancia de cuadre acordada: ±1 millón de COP por cifra. */
export const TOL_COP = 1e6;
/** Para porcentajes y factores. */
export const TOL_PCT = 1e-6;

/** Compara una cifra del motor con la referencia y explica la diferencia si no cuadra. */
export const estadistica = { n: 0, maxCOP: 0, donde: '' };
export function cuadra(real, esperado, tol, donde) {
  assert.ok(Number.isFinite(real), `${donde}: el motor no devolvió un número (${real})`);
  const d = Math.abs(real - esperado);
  estadistica.n++;
  if (tol >= 1 && d > estadistica.maxCOP) { estadistica.maxCOP = d; estadistica.donde = donde; }
  assert.ok(d <= tol, `${donde}: motor ${real} vs referencia ${esperado} (diferencia ${d.toFixed(2)})`);
}

export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
