/**
 * Genera pruebas/referencias/simulador_v1.json a partir del HTML de Finantia Admon 1.0.
 *
 * 1. Casos aleatorios: carga el motor original del HTML (sin modificarlo) y calcula
 *    presupuesto, estado de resultados y proyección para 25 combinaciones de supuestos.
 * 2. Pantallas: abre el HTML en Chromium (Playwright) y lee, para cada escenario, el
 *    tornado, el punto de equilibrio y la programación optimizada tal como los muestra.
 *
 * Uso: node herramientas/extraer_referencias_simulador.cjs RUTA/Finantia_Admon_v1.0.html
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

const html = fs.readFileSync(process.argv[2], 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(scripts[0], ctx);                                  /* datos */
vm.runInContext(scripts[1] + ';this.E={compute,pyg,project,DEFAULTS,FIXED,ESCS};', ctx); /* motor 1.0 */
const { E } = ctx, D = ctx.window.CEIPA_DATA, H = D.H;
const clone = o => JSON.parse(JSON.stringify(o));

/* generador reproducible */
let seed = 20261127; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const jit = (v, a) => v + (rnd() * 2 - 1) * a;

const META0 = {}; Object.keys(E.FIXED.metas).forEach(k => (META0[k] = E.FIXED.metas[k].meta.slice())); META0.ure = E.FIXED.ure.meta;
const PLANU = [0, 1, 2, 3, 4, 5, 6].map(i => D.LP.reduce((s, v) => s + v[i], 0));
const casos = [];
for (let n = 0; n < 25; n++) {
  const esc = E.ESCS[n % 3], p = clone(E.DEFAULTS[esc]);
  p.price = jit(p.price, 0.03); p.ipc = jit(p.ipc, 0.02); p.sm = jit(p.sm, 0.04); p.cump = jit(p.cump, 0.2); p.cumpURE = jit(p.cumpURE, 0.2);
  p.vert = rnd() < 0.3 ? 0 : 1; p.dpp = jit(p.dpp, 0.02);
  p.dNew = p.dNew.map(v => jit(v, 0.1)); p.des = p.des.map((v, i) => (E.FIXED.des26[i] > 0 ? Math.max(0, jit(v, 0.04)) : v));
  p.trm = p.trm.map(v => jit(v, 300)); p.catAdj = p.catAdj.map(() => (rnd() < 0.5 ? 0 : jit(0, 0.1)));
  if (rnd() < 0.5) p.grp = { pres_c: jit(32, 6), virt_c: jit(55, 6), baq_c: jit(20, 5), pres_e: jit(18, 4), virt_e: jit(22, 4), baq_e: jit(16, 4) };
  if (rnd() < 0.3) p.tope = { pres: 35, virt: 0, baq: 25 };
  p.lr = { ipc: p.lr.ipc.map(v => jit(v, 0.01)), sm: p.lr.sm.map(v => jit(v, 0.02)), g: p.lr.g.map(v => jit(v, 0.02)), dd: p.lr.dd.map(v => jit(v, 0.005)),
    fS: rnd() < 0.5 ? [0.28, 0.2, 0.15, 0.1] : undefined, fB: rnd() < 0.5 ? [0.4, 0.35, 0.3, 0.25] : undefined };
  if (rnd() < 0.3) p.descU = p.des.map(() => Math.max(0, jit(0.2, 0.1)));
  const metas = clone(META0); if (rnd() < 0.5) { metas[0] = metas[0].map(v => Math.round(jit(v, 50))); metas.ure = jit(metas.ure, 5e8); }
  const kN = rnd() < 0.5 ? 1 : jit(1, 0.05), esic = jit(1.5e9, 3e8);
  const opts = { metas, planUnits: PLANU.map(v => v * kN), esic };
  if (rnd() < 0.4) Object.assign(opts, { dVol: jit(0, 0.08), dDesc: jit(0, 0.02) });
  if (rnd() < 0.2) opts.smOverride = jit(0.1, 0.03);
  const LPk = D.LP.map(v => v.map(x => x * kN));
  const r = E.compute(p, H, opts), g = E.pyg(p, H, D.L, r, { metas, LP: LPk, esic, smOverride: opts.smOverride }), pj = E.project(p, H, r.tot, r.units);
  casos.push({ p, opts, kN, out: {
    tot: r.tot, unitsRN: r.units.map(u => u.RN), unitsC: r.units.map(u => u.C),
    pyg: Object.fromEntries(Object.entries(g.tot)), pygUnitsRN: g.units.map(u => u.RN),
    rows: pj.rows.map(x => ({ NET: x.NET, PD: x.PD, TC: x.TC, EBITDA: x.EBITDA, RN: x.RN, FCF: x.FCF, DFCF: x.DFCF })), npv: pj.npv, npvTV: pj.npvTV } });
}

/* Pantallas del simulador */
const num = t => { const s = t.replace(/[$\sM]/g, ''); const neg = /^\(.*\)$/.test(s) || s.startsWith('-') || s.startsWith('−'); const v = parseFloat(s.replace(/[()+\-−]/g, '').replace(/\./g, '').replace(',', '.')); return (neg ? -v : v); };
(async () => {
  const { chromium } = require('playwright');
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto('file://' + path.resolve(process.argv[2])); await pg.waitForTimeout(2000);
  const pantallas = {};
  for (const esc of E.ESCS) {
    await pg.click(`#seg button[data-e="${esc}"]`); await pg.waitForTimeout(800);
    const raw = await pg.evaluate(() => ({
      tornado: [...document.querySelectorAll('#tornado g > title')].map(t => t.textContent),
      be: [...document.querySelectorAll('#tBE tbody tr')].map(tr => [...tr.cells].map(c => c.innerText)),
      opt: [...document.querySelectorAll('#tOpt tbody tr')].map(tr => [...tr.cells].map(c => c.innerText)),
      kpis: document.getElementById('kpis').innerText
    }));
    pantallas[esc] = {
      tornado: raw.tornado.map(t => { const [h, a, bb] = t.split('\n'); return { l: h.replace(/ \(.*\)$/, ''), a: num(a.split(':')[1]) * 1e6, b: num(bb.split(':')[1]) * 1e6 }; }),
      equilibrio: raw.be.map(([l, act, obj]) => ({ l, actual: act, objetivo: obj })),
      optimizacion: raw.opt.map(([l, ah, cat]) => ({ l, ahorro: ah === '–' ? null : num(ah) * 1e6, catedra: num(cat) * 1e6 })),
      kpis: raw.kpis
    };
  }
  await b.close();
  const dest = path.join(__dirname, '..', 'pruebas', 'referencias', 'simulador_v1.json');
  fs.writeFileSync(dest, JSON.stringify({ _fuente: path.basename(process.argv[2]), _nota: 'Casos aleatorios calculados con el motor original de Finantia Admon 1.0 y cifras leídas de sus pantallas (millones redondeados).', casos, pantallas }, null, 1));
  console.log('escrito', dest, casos.length, 'casos');
})();
