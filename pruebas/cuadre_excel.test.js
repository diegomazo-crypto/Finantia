/**
 * Cuadre del motor contra el Excel CEIPA_Modelo_Presupuesto2027_v21_202611
 * en los tres escenarios. Referencias: pruebas/referencias/excel_v21.json
 * (generado con herramientas/extraer_referencias_excel.py).
 */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { crearModelo, ESCS, tablaVolumenDescuento, tablaVolumenSMMLV } from '../motor/index.js';
import { datos, leerJSON, cuadra, TOL_COP, TOL_PCT, MESES, estadistica } from './comun.js';

const REF = leerJSON('./referencias/excel_v21.json').escenarios;
const modelo = crearModelo(datos);

const RUBROS = {
  'Ingresos brutos': 'IB', 'Descuentos y becas': 'DS', 'INGRESOS NETOS': 'NET', 'Otros ingresos': 'OI', 'Nómina': 'N',
  'Cátedra + mentores': 'C', 'Costos variables': 'V', 'Costos ligados al ingreso': 'VI', 'CINTANA (acuerdo)': 'FX',
  'Costos y gastos fijos': 'F', 'Total costos y gastos (sin D&A)': 'TC', 'EBITDA': 'EBITDA', 'D&A': 'DA', 'RESULTADO NETO': 'RN'
};
const PROY = {
  'Ingresos brutos': ['IB'], '% descuento': ['PD', 'pct'], 'Descuentos y becas': ['DS'], 'INGRESOS NETOS': ['NET'], 'Otros ingresos': ['OI'],
  'Nómina (regla salarial)': ['N'], 'Cátedra + mentores Vértice': ['C'], 'Costos variables (volumen y nuevos)': ['V'],
  'Costos ligados al ingreso (bancarios, Isolution, Extensión)': ['VI'], 'CINTANA (acuerdo USD × TRM)': ['FX'],
  'Costos y gastos fijos (IPC) [2026E incluye ESIC y no recurrentes]': ['F'], 'Total costos y gastos (sin D&A)': ['TC'], 'EBITDA': ['EBITDA'],
  'Margen EBITDA %': [r => r.EBITDA / r.NET, 'pct'], 'Depreciación y amortización': ['DA'], 'RESULTADO NETO (excedente)': ['RN'],
  'Margen neto %': [r => r.RN / r.NET, 'pct'], 'Impuestos': ['TAX'], 'Capex': ['CAPEX'], 'Δ Capital de trabajo': ['KT'],
  'FLUJO DE CAJA LIBRE (FCF)  [2026E = −inversión inicial]': ['FCF'], 'Factor de descuento': ['DF', 'pct'], 'FCF descontado': ['DFCF'],
  'FCF acumulado (con inversión inicial)': ['CUM'], 'FCF descontado acumulado (con inversión)': ['DCUM']
};
/* Código del estado de resultados CEIPA según el número del renglón */
const EERR = {
  '1.': 'IB', '2.': 'DS', '3.': 'NET', '4.': 'CD', '4.1': 'PRESTACION', '4.2': 'ADM_ACADEMICA', '4.3': 'UNIDADES', '4.4': 'VENTAS', '5.': 'MB',
  '6.': 'GO', '6.1': 'TECNOLOGIA', '6.2': 'CORPORATIVO', '6.3': 'ADMINISTRATIVOS', '6.4': 'DIRECCION', '7.': 'RO', '8.': 'OTROS_INGRESOS',
  '9.': 'BANCARIOS', '10.': 'DA', '11.': 'OTROS_GASTOS', '12.': 'RN', 'Memo:': 'EBITDA', 'Resultado neto acumulado': 'ACC'
};
const codEERR = l => EERR[l.startsWith('Resultado neto acumulado') ? 'Resultado neto acumulado' : l.split(' ')[0]];
const CAJA = {
  'Ingresos netos causados (P&G)': 'NETC', 'Recaudo de matrículas y derechos pecuniarios': 'REC', 'Otros ingresos': 'OIN', 'Total entradas': 'TE',
  'Nómina y cátedra (pago mensual)': 'NOM', 'Prima de servicios': 'PRI', 'Cesantías': 'CES', 'Intereses de cesantías': 'INT',
  'Proveedores, servicios, CINTANA y otros gastos': 'PROV', 'Gastos bancarios e impuestos asumidos': 'BAN', 'Inversiones de capital (capex)': 'CAP',
  'Total salidas': 'TS', 'FLUJO NETO DEL MES': 'FN', 'Saldo inicial': 'SI', 'SALDO FINAL DE CAJA': 'SF'
};

for (const esc of ESCS) {
  describe(`Escenario ${esc}`, () => {
    const ref = REF[esc], x = modelo.escenario(esc);

    test('presupuesto 2027 por rubro (Escenarios!B30:E43)', () => {
      for (const [l, k] of Object.entries(RUBROS)) cuadra(x.presupuesto.tot[k], ref.rubros2027[l], TOL_COP, `${esc} · ${l}`);
      assert.equal(Object.keys(ref.rubros2027).length, Object.keys(RUBROS).length);
    });

    test('estado de resultados 2027 total y por unidad (EERR2027)', () => {
      for (const [l, v] of Object.entries(ref.eerr2027)) {
        const k = codEERR(l); assert.ok(k, `renglón sin mapear: ${l}`);
        cuadra(x.pyg.tot[k], v.total, TOL_COP, `${esc} · ${l} · total`);
        v.unidades.forEach((u, i) => cuadra(x.pyg.units[i][k], u, TOL_COP, `${esc} · ${l} · ${datos.names[i]}`));
      }
    });

    test('proyección 2026E–2031 y FCF (Proyeccion_2027_2031)', () => {
      const rows = x.proyeccion.rows; let acc = 0;
      rows.forEach(r => { acc += r.DFCF; r.DCUM = acc; });
      for (const [l, vals] of Object.entries(ref.proyeccion)) {
        if (l === 'Periodo (años)') continue;
        const m = PROY[l]; assert.ok(m, `renglón sin mapear: ${l}`);
        const [k, tipo] = m;
        vals.forEach((v, i) => {
          if (v == null) return;                       /* 2026E no tiene impuestos, capex ni KT */
          const real = typeof k === 'function' ? k(rows[i]) : (rows[i][k] ?? (i === 0 ? (k === 'DF' ? 1 : 0) : undefined));
          cuadra(real, v, tipo === 'pct' ? TOL_PCT : TOL_COP, `${esc} · ${l} · ${['2026E', 2027, 2028, 2029, 2030, 2031][i]}`);
        });
      }
    });

    test('métricas: NPV, valor terminal, TIR y payback', () => {
      const m = ref.metricas, e = x.metricas;
      cuadra(e.npv, m['NPV FCF 2027–2031 @ tasa de descuento (incluye −inversión inicial)'], TOL_COP, `${esc} · NPV`);
      cuadra(e.tv, m['Valor terminal (Gordon) descontado'], TOL_COP, `${esc} · valor terminal`);
      cuadra(e.npvTV, m['NPV incluyendo valor terminal'], TOL_COP, `${esc} · NPV con valor terminal`);
      cuadra(e.ebitdaAcc, m['EBITDA acumulado 2027–2031'], TOL_COP, `${esc} · EBITDA acumulado`);
      cuadra(e.rnAcc, m['Excedente neto acumulado 2027–2031'], TOL_COP, `${esc} · excedente acumulado`);
      /* Sin inversión inicial el Excel dice "N/A"; el motor devuelve null */
      for (const [k, l] of [['irr', 'TIR (IRR)'], ['paybackSimple', 'Payback simple (años)'], ['paybackDescontado', 'Payback descontado (años)']]) {
        assert.match(String(m[l]), /^N\/A/); assert.equal(e[k], null, `${esc} · ${l}`);
      }
    });

    test('presupuesto mensual (Ppto2027_Mensual)', () => {
      for (const [l, vals] of Object.entries(ref.mensual)) {
        const k = codEERR(l); assert.ok(k, `renglón sin mapear: ${l}`);
        vals.forEach((v, m) => cuadra(x.mensualPyG[m][k], v, TOL_COP, `${esc} · ${l} · ${MESES[m]}`));
      }
      /* el resumen mensual del simulador (gráfico) da el mismo ingreso neto y resultado */
      x.mensual.forEach((o, m) => { cuadra(o.NET, x.mensualPyG[m].NET, 1, `${esc} · resumen NET ${MESES[m]}`); cuadra(o.RN, x.mensualPyG[m].RN, 1, `${esc} · resumen RN ${MESES[m]}`); });
    });

    test('flujo de caja mensual (FlujoCaja2027)', () => {
      for (const [l, vals] of Object.entries(ref.caja)) {
        const k = CAJA[l]; assert.ok(k, `renglón sin mapear: ${l}`);
        vals.forEach((v, m) => cuadra(x.caja.meses[m][k], v, TOL_COP, `${esc} · ${l} · ${MESES[m]}`));
      }
      const I = ref.cajaIndicadores;
      cuadra(x.caja.saldoMinimo, I.saldoMinimo, TOL_COP, `${esc} · saldo mínimo`);
      assert.equal(MESES[x.caja.mesMinimo], I.mesMinimo);
      assert.equal(x.caja.mesesBajoMinimo, I.mesesBajoMinimo);
    });

    test('sensibilidad: volumen × SMMLV (Sensibilidad, tabla 2)', () => {
      const t = ref.sensibilidad.volumenSMMLV, v = tablaVolumenSMMLV(modelo.run, modelo.params[esc], t.filas, t.cols);
      t.valores.forEach((fila, i) => fila.forEach((e, j) => cuadra(v[i][j], e, TOL_COP, `${esc} · volumenSMMLV [${t.filas[i]}, ${t.cols[j]}]`)));
    });

    test('sensibilidad: volumen × descuento (Sensibilidad, tabla 1)', () => {
      /* El Excel aplica el choque de descuento también a Extensión, que no tiene descuentos (su
         ingreso neto baja y sus costos ligados al ingreso bajan en la misma proporción). El motor,
         como el simulador 1.0, solo mueve las unidades que tienen descuento. La diferencia es
         exactamente (1 + Δvol) × Δdesc × (ingreso bruto − costos ligados) de Extensión, entre
         1,6 y 6 millones en los bordes de la tabla; se descuenta aquí y el resto debe cuadrar. */
      const t = ref.sensibilidad.volumenDescuento, v = tablaVolumenDescuento(modelo.run, modelo.params[esc], t.filas, t.cols);
      const ext = x.presupuesto.units[4], efectoExt = (dv, dd) => (1 + dv) * dd * (ext.IB - ext.VI);
      t.valores.forEach((fila, i) => fila.forEach((e, j) =>
        cuadra(v[i][j], e + efectoExt(t.filas[i], t.cols[j]), TOL_COP, `${esc} · volumenDescuento [${t.filas[i]}, ${t.cols[j]}]`)));
      /* sin choque de descuento la tabla cuadra directamente */
      t.valores.forEach((fila, i) => cuadra(v[i][t.cols.indexOf(0)], fila[t.cols.indexOf(0)], TOL_COP, `${esc} · Δdesc 0 · Δvol ${t.filas[i]}`));
    });
  });
}

describe('Base 2026E', () => {
  test('el estado de resultados 2026E cuadra con EERR2027 columna Total 2026E', () => {
    const g26 = modelo.pyg2026(), b26 = modelo.base2026;
    cuadra(g26.tot.RN, b26.RN, 1, 'RN 2026E pyg vs base');
    cuadra(b26.RN, REF.Moderado.proyeccion['RESULTADO NETO (excedente)'][0], TOL_COP, 'RN 2026E');
    cuadra(b26.EBITDA, REF.Moderado.proyeccion['EBITDA'][0], TOL_COP, 'EBITDA 2026E');
  });
});

after(() => {
  console.log(`# Cuadre con el Excel v21: ${estadistica.n} cifras comparadas; diferencia máxima ${estadistica.maxCOP.toFixed(2)} COP (${estadistica.donde})`);
});
