/**
 * Equivalencia con Finantia Admon 1.0 (referencias en pruebas/referencias/simulador_v1.json,
 * generadas con herramientas/extraer_referencias_simulador.cjs):
 *  - 25 combinaciones aleatorias de supuestos calculadas con el motor original;
 *  - tornado, punto de equilibrio y programación optimizada leídos de las pantallas
 *    del simulador (millones redondeados, por eso la tolerancia es de ±1 M).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, pyg, project, crearModelo, tornado, equilibrio, optimizarProgramacion, ESCS } from '../motor/index.js';
import { datos, leerJSON, cuadra, TOL_COP } from './comun.js';

const REF = leerJSON('./referencias/simulador_v1.json');
const H = datos.H;

describe('Casos aleatorios: mismo resultado que el motor 1.0', () => {
  REF.casos.forEach((c, n) => test(`caso ${n + 1}`, () => {
    const LP = datos.LP.map(v => v.map(x => x * c.kN));
    const r = compute(c.p, H, c.opts), g = pyg(c.p, H, datos.L, r, { metas: c.opts.metas, LP, esic: c.opts.esic, smOverride: c.opts.smOverride });
    const pj = project(c.p, H, r.tot, r.units);
    for (const [k, v] of Object.entries(c.out.tot)) cuadra(r.tot[k], v, 1, `caso ${n + 1} · ${k}`);
    c.out.unitsRN.forEach((v, i) => cuadra(r.units[i].RN, v, 1, `caso ${n + 1} · RN ${datos.names[i]}`));
    c.out.unitsC.forEach((v, i) => cuadra(r.units[i].C, v, 1, `caso ${n + 1} · cátedra ${datos.names[i]}`));
    for (const [k, v] of Object.entries(c.out.pyg)) cuadra(g.tot[k], v, 1, `caso ${n + 1} · EERR ${k}`);
    c.out.rows.forEach((row, i) => Object.entries(row).forEach(([k, v]) => v != null && cuadra(pj.rows[i][k], v, k === 'PD' ? 1e-12 : 1, `caso ${n + 1} · ${k} año ${i}`)));
    cuadra(pj.npv, c.out.npv, 1, `caso ${n + 1} · NPV`); cuadra(pj.npvTV, c.out.npvTV, 1, `caso ${n + 1} · NPV+VT`);
  }));
});

const modelo = crearModelo(datos);
const pctTxt = t => parseFloat(t.replace('%', '').replace(',', '.')) / 100;
const copTxt = t => parseFloat(t.replace(/[$\sM.]/g, '').replace(',', '.')) * 1e6;

for (const esc of ESCS) {
  describe(`Pantallas del simulador 1.0 · ${esc}`, () => {
    const P = REF.pantallas[esc], p = modelo.params[esc];

    test('tornado', () => {
      const t = tornado(modelo.run, p, H, modelo.esic);
      assert.equal(t.length, P.tornado.length);
      P.tornado.forEach((ref, k) => {
        assert.ok(t[k].l.startsWith(ref.l), `orden del tornado: ${t[k].l} vs ${ref.l}`);
        cuadra(t[k].a, ref.a, TOL_COP, `${esc} · tornado ${ref.l} desfavorable`);
        cuadra(t[k].b, ref.b, TOL_COP, `${esc} · tornado ${ref.l} favorable`);
      });
    });

    test('punto de equilibrio (excedente objetivo $0)', () => {
      const e = equilibrio(modelo.run, p, H, 0), R = Object.fromEntries(P.equilibrio.map(x => [x.l, x]));
      const pp = (v, t, l) => { if (t === 'Fuera de rango') return assert.equal(v, null, l); cuadra(v, pctTxt(t), 0.0005, l); };
      pp(e.cumplimiento.objetivo, R['Cumplimiento de la meta de nuevos'].objetivo, 'cumplimiento');
      pp(e.descuento.actual, R['Descuentos y becas (promedio ponderado)'].actual, 'descuento actual');
      pp(e.descuento.objetivo, R['Descuentos y becas (promedio ponderado)'].objetivo, 'descuento objetivo');
      cuadra(e.nomina.actual, copTxt(R['Nómina de planta'].actual), TOL_COP, 'nómina actual');
      if (R['Nómina de planta'].objetivo === 'Fuera de rango') assert.equal(e.nomina.objetivo, null); else cuadra(e.nomina.objetivo, copTxt(R['Nómina de planta'].objetivo), TOL_COP, 'nómina objetivo');
      pp(e.matricula.objetivo, R['Incremento de matrículas'].objetivo, 'matrícula');
      pp(e.desercion.actual, R['Deserción de antiguos (promedio ponderado)'].actual, 'deserción actual');
      pp(e.desercion.objetivo, R['Deserción de antiguos (promedio ponderado)'].objetivo, 'deserción objetivo');
    });

    test('programación académica optimizada (3 palancas)', () => {
      const o = optimizarProgramacion(modelo.run, p), R = P.optimizacion;
      cuadra(o.catedra[0], R[0].catedra, TOL_COP, 'cátedra actual');
      cuadra(o.ahorro.vertice, R[1].ahorro, TOL_COP, 'Vértice'); cuadra(o.catedra[1], R[1].catedra, TOL_COP, 'cátedra tras Vértice');
      cuadra(o.ahorro.comunes, R[2].ahorro, TOL_COP, 'comunes'); cuadra(o.catedra[2], R[2].catedra, TOL_COP, 'cátedra tras comunes');
      cuadra(o.ahorro.especificos, R[3].ahorro, TOL_COP, 'específicos'); cuadra(o.catedra[3], R[3].catedra, TOL_COP, 'cátedra tras específicos');
      cuadra(o.ahorro.total, R[4].ahorro, TOL_COP, 'ahorro total');
    });
  });
}
