/**
 * Genera datos/ejecucion_mapa.json: a qué línea del informe y unidad va cada par centro de costos | cuenta
 * (y cada cuenta sola, para balances sin centro de costos), con la fracción que le toca. Sale del reparto
 * del auxiliar 2026 (DD, CCN, CTN de datos/base2026.json) pero sin valores: solo fracciones, para que el
 * módulo de Ejecución funcione también donde los datos base se cargan sin el auxiliar (sitio de pruebas).
 * Con el auxiliar agregado del año ([mes, cuenta, cc, concepto, costo/nómina, movimiento]) agrega, por
 * cuenta de ingresos, la fracción que fue de ESIC (centros de costos "Esic"): sirve para separar ESIC
 * cuando el balance no trae centro de costos (balance por NIT de Contai).
 *   node herramientas/mapa_ejecucion.mjs [auxiliar_agregado.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mapaDesdeBase } from '../motor/ejecucion.js';
const datos = JSON.parse(readFileSync(new URL('../datos/base2026.json', import.meta.url)));
const m = mapaDesdeBase(datos);
const r4 = x => Math.round(x * 1e4) / 1e4;
const esic = {};
if (process.argv[2]) {
  const ccEsic = new Set(datos.CCN.filter(([, n]) => /esic/i.test(n)).map(([c]) => c)), tot = {}, es = {};
  for (const [, cuenta, cc, , , v] of JSON.parse(readFileSync(process.argv[2]))) {
    if (!cuenta || !/^4/.test(cuenta)) continue;
    tot[cuenta] = (tot[cuenta] || 0) + Math.abs(v); if (ccEsic.has(String(cc))) es[cuenta] = (es[cuenta] || 0) + Math.abs(v);
  }
  for (const c in es) if (tot[c] && es[c] / tot[c] >= 0.001) esic[c] = r4(es[c] / tot[c]);
}
const lista = M => [...M].map(([k, d]) => [k, d.map(([li, u, w, e]) => [li, u, r4(w), e])]);
writeFileSync(new URL('../datos/ejecucion_mapa.json', import.meta.url), JSON.stringify({
  lineas: datos.LN.length, LN: datos.LN, par: lista(m.par), cuenta: lista(m.cuenta), nombresCC: [...m.nombresCC], nombresCuenta: [...m.nombresCuenta], esicCuenta: Object.entries(esic)
}));
console.log('pares', m.par.size, 'cuentas', m.cuenta.size, 'ESIC', esic);
