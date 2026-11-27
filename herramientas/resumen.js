/* Imprime las cifras clave de los tres escenarios (millones de COP). Uso: npm run resumen */
import { readFileSync } from 'node:fs';
import { crearModelo, ESCS } from '../motor/index.js';

const datos = JSON.parse(readFileSync(new URL('../datos/base2026.json', import.meta.url)));
const M = crearModelo(datos);
const f = v => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(v / 1e6).padStart(9);
console.log('Millones COP      ' + ['Ingreso neto', '   EBITDA', 'Resultado', '      NPV', ' NPV + VT'].join('  '));
for (const e of ESCS) {
  const x = M.escenario(e), t = x.presupuesto.tot;
  console.log(e.padEnd(12) + [t.NET, t.EBITDA, t.RN, x.metricas.npv, x.metricas.npvTV].map(f).join('    '));
}
