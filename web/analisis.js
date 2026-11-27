/*
 * Finantia 2.0 · pestañas de análisis de una versión: ingresos, costo de prestación,
 * sensibilidad y preguntas; y los archivos del ejercicio.
 *
 * Ingresos, costo de prestación y sensibilidad corren en el navegador el mismo motor
 * que usa el servidor (/motor/index.js) con los datos base y los supuestos de la
 * versión, porque necesitan muchos cálculos (tornado, punto de equilibrio, tablas).
 */
import { $, ESCS, M, Mn, P, accion, anchos, api, cls, esc, fecha, modulo, nf0, nf1 } from './comun.js';

let motor = null;
const datosBase = new Map();

/** Modelo de la versión en el navegador. Comprueba que coincida con lo que guardó el servidor. */
async function modeloDe(v) {
  motor ??= await import('/motor/index.js');
  if (!datosBase.has(v.datos_base_id)) datosBase.set(v.datos_base_id, await api('GET', `/api/presupuesto/datos-base/${v.datos_base_id}`));
  const datos = datosBase.get(v.datos_base_id);
  const modelo = motor.crearModelo(datos, v.supuestos || {});
  const dif = Math.max(...ESCS.map(e => Math.abs(modelo.run(modelo.params[e]).tot.RN - v.resultados[e].tot.RN)));
  return { modelo, datos, H: datos.H, cuadra: dif < 1e6 };
}

/**
 * Detalle del estado de resultados por línea presupuestal (Base2026) y unidad, para el drill down.
 * g26 = 2026E; esc[e] = cada escenario. ln[li] es el total de la línea y units[i].ln[li] el de la unidad.
 */
export async function detalleLineas(v) {
  const { modelo, datos, cuadra } = await modeloDe(v);
  const g26 = modelo.pyg2026();
  const escs = Object.fromEntries(ESCS.map(e => [e, modelo.escenario(e).pyg]));
  return { L: datos.L, LN: datos.LN, g26, esc: escs, cuadra };
}

const editable = v => modulo('PRESUPUESTO').editar && v.estado === 'BORRADOR';
const avisoCuadre = c => c ? '' : '<p class="nota neg">El cálculo de esta pantalla no coincide con el guardado de la versión (el motor cambió). Edite y guarde un supuesto para recalcularla.</p>';
const guardar = async (v, cambios, ok, ctx) => {
  try { await accion(() => api('PATCH', `/api/presupuesto/versiones/${v.id}/supuestos`, cambios), ok); ctx.recargar(); } catch { /* aviso ya mostrado */ }
};
const pctInput = (k, x, extra = '') => `<input class="inp-num" type="number" step="0.1" inputmode="decimal" data-k="${esc(k)}" value="${+(x * 100).toFixed(2)}" ${extra}>`;

/* =========================================================
   INGRESOS
   ========================================================= */
export async function vIngresos(c, v, escenario, ctx) {
  const { modelo, H, cuadra } = await modeloDe(v);
  const { FIXED, effNew, maeIB, sum } = motor;
  const p = modelo.params[escenario], r = modelo.run(p), n = v.base.names;
  const ed = editable(v);
  const ib26 = sum(H.IB), ds26 = sum(H.DS);

  const puente = ESCS.map(e => {
    const q = modelo.params[e], x = modelo.run(q).tot;
    return { e, precio: ib26 * q.price, volumen: x.IB - ib26 * (1 + q.price), IB: x.IB, DS: x.DS, NET: x.NET, OI: x.OI };
  });
  const metas = modelo.metas;
  const dN = Object.fromEntries(ESCS.map(e => [e, effNew(modelo.params[e], metas)]));
  const mae = maeIB(p, metas);

  c.innerHTML = `${avisoCuadre(cuadra)}
    <div class="tarjeta"><h2>Puente del ingreso por unidad · ${escenario}</h2>
      <p class="nota">Ingreso bruto ${v.ejercicio} = ingreso bruto 2026E × (1 + incremento de matrícula) × factor de volumen. El factor combina estudiantes nuevos y antiguos (deserción); en Maestrías sale de las cohortes. Millones de pesos.</p>
      <div class="tabla-cont"><table><thead><tr><th>Unidad</th><th>Bruto 2026E</th><th>Matrícula</th><th>Volumen</th><th>Bruto ${v.ejercicio}</th><th>Descuento</th><th>Descuentos</th><th>Neto ${v.ejercicio}</th><th>Var. neto</th></tr></thead><tbody>
      ${r.units.map((u, i) => { const n26 = H.IB[i] - H.DS[i]; return `<tr><td>${esc(n[i])}</td><td>${Mn(H.IB[i])}</td><td>${P(p.price)}</td><td>${nf1.format(u.vol * 100)}%</td><td>${Mn(u.IB)}</td><td>${P(u.desc)}</td><td>${Mn(u.DS)}</td><td>${Mn(u.NET)}</td><td class="${cls(u.NET - n26)}">${P(n26 ? u.NET / n26 - 1 : null)}</td></tr>`; }).join('')}
      <tr class="total"><td>Total</td><td>${Mn(ib26)}</td><td></td><td>${nf1.format(r.tot.IB / ib26 / (1 + p.price) * 100)}%</td><td>${Mn(r.tot.IB)}</td><td>${P(r.tot.DS / r.tot.IB)}</td><td>${Mn(r.tot.DS)}</td><td>${Mn(r.tot.NET)}</td><td>${P(r.tot.NET / (ib26 - ds26) - 1)}</td></tr>
      </tbody></table></div></div>

    <div class="tarjeta"><h2>De dónde sale el ingreso en cada escenario</h2>
      <p class="nota">Total CEIPA, millones de pesos. Efecto precio = bruto 2026E × incremento de matrícula; efecto volumen = el resto del cambio en el bruto.</p>
      <div class="tabla-cont"><table><thead><tr><th>Concepto</th><th>2026E</th>${puente.map(x => `<th>${x.e}</th>`).join('')}</tr></thead><tbody>
        <tr><td>Ingreso bruto 2026E</td><td>${Mn(ib26)}</td>${puente.map(() => `<td>${Mn(ib26)}</td>`).join('')}</tr>
        <tr class="det"><td>+ Efecto precio</td><td></td>${puente.map(x => `<td>${Mn(x.precio)}</td>`).join('')}</tr>
        <tr class="det"><td>+ Efecto volumen</td><td></td>${puente.map(x => `<td class="${cls(x.volumen)}">${Mn(x.volumen)}</td>`).join('')}</tr>
        <tr class="sub"><td>Ingreso bruto</td><td>${Mn(ib26)}</td>${puente.map(x => `<td>${Mn(x.IB)}</td>`).join('')}</tr>
        <tr class="det"><td>− Descuentos y becas</td><td>${Mn(ds26)}</td>${puente.map(x => `<td>${Mn(x.DS)}</td>`).join('')}</tr>
        <tr class="sub"><td>Ingreso neto</td><td>${Mn(ib26 - ds26)}</td>${puente.map(x => `<td>${Mn(x.NET)}</td>`).join('')}</tr>
        <tr class="det"><td>+ Otros ingresos (con ESIC)</td><td>${Mn(sum(H.OI))}</td>${puente.map(x => `<td>${Mn(x.OI)}</td>`).join('')}</tr>
        <tr class="total"><td>Ingreso total</td><td>${Mn(ib26 - ds26 + sum(H.OI))}</td>${puente.map(x => `<td>${Mn(x.NET + x.OI)}</td>`).join('')}</tr>
      </tbody></table></div></div>

    <div class="tarjeta"><div class="cabeza"><h2>Metas de estudiantes nuevos por intake</h2>
      <div class="acciones">${ed ? '<button class="btn primario" id="guardar-metas" type="button" disabled>Guardar metas</button>' : ''}</div></div>
      <p class="nota">Cantidad de estudiantes nuevos por intake, frente a lo real del año anterior. Cada intake pesa por los periodos que paga en el año. La variación de nuevos de cada escenario = metas ponderadas × cumplimiento ÷ real ponderado − 1. ${ed ? 'Las metas son comunes a los tres escenarios.' : ''}</p>
      ${Object.entries(FIXED.metas).map(([k, m]) => `
        <h3>${esc(m.label)}</h3>
        <div class="tabla-cont"><table><thead><tr><th>Intake</th>${m.w.map((_, j) => `<th>${j + 1}</th>`).join('')}<th>Total</th></tr></thead><tbody>
          <tr><td>Periodos que paga</td>${m.w.map(w => `<td>${w}</td>`).join('')}<td></td></tr>
          <tr><td>Real año anterior</td>${m.real.map(x => `<td>${nf0.format(x)}</td>`).join('')}<td>${nf0.format(sum(m.real))}</td></tr>
          <tr class="sub"><td>Meta ${v.ejercicio}</td>${(metas[k] || m.meta).map((x, j) => `<td>${ed ? `<input class="inp-num" type="number" min="0" step="1" data-meta="${k}.${j}" value="${x}" aria-label="Meta intake ${j + 1}">` : nf0.format(x)}</td>`).join('')}<td>${nf0.format(sum(metas[k] || m.meta))}</td></tr>
          <tr><td>Variación de nuevos</td><td class="izq" colspan="${m.w.length + 1}">${ESCS.map(e => `${e} ${P(dN[e][k])}`).join(' · ')}</td></tr>
        </tbody></table></div>`).join('')}
      <h3>URE / Isolution</h3>
      <div class="formfila"><label class="campo">Meta de ventas ${v.ejercicio} (millones)${ed ? `<input class="inp-num" type="number" min="0" step="10" data-meta="ure" value="${Math.round((metas.ure ?? FIXED.ure.meta) / 1e6)}">` : `<b>${M(metas.ure ?? FIXED.ure.meta)}</b>`}</label>
        <span class="nota">Bruto 2026E ${M(FIXED.ure.ib26)}. Variación: ${ESCS.map(e => `${e} ${P(dN[e][5])}`).join(' · ')}</span></div>
    </div>

    <div class="rejilla">
    <div class="tarjeta"><h2>Maestrías por cohortes · ${escenario}</h2>
      <p class="nota">El ingreso de maestrías no se escala con la meta: la cohorte nueva paga el primer pago, la cohorte anterior los pagos II y III con la deserción del escenario, más los ingresos diferidos.</p>
      <div class="tabla-cont"><table><tbody>
        <tr><td>Cohorte ${v.ejercicio} (pago I)</td><td>${M(mae.coh27)}</td></tr>
        <tr><td>Cohorte ${v.ejercicio - 1} (pagos II y III)</td><td>${M(mae.c26)}</td></tr>
        <tr><td>Cohortes anteriores</td><td>${M(mae.c25)}</td></tr>
        <tr><td>Ingresos diferidos (amortización)</td><td>${M(mae.amort)}</td></tr>
        <tr class="total"><td>Ingreso bruto Maestrías</td><td>${M(mae.tot)}</td></tr>
      </tbody></table></div></div>
    <div class="tarjeta"><h2>Barranquilla · ${escenario}</h2>
      <p class="nota">El volumen de estudiantes solo mueve el ${P(FIXED.volShare[6])} del ingreso que viene de pregrado; el resto se mantiene. El descuento incluye el ajuste por mezcla de programas (+${P(FIXED.dMix[6])}).</p>
      <div class="tabla-cont"><table><tbody>
        <tr><td>Bruto 2026E</td><td>${M(H.IB[6])}</td></tr>
        <tr><td>Factor de volumen</td><td>${nf1.format(r.units[6].vol * 100)}%</td></tr>
        <tr><td>Variación de nuevos</td><td>${P(dN[escenario][6])}</td></tr>
        <tr><td>Descuento</td><td>${P(r.units[6].desc)}</td></tr>
        <tr><td>Bruto ${v.ejercicio}</td><td>${M(r.units[6].IB)}</td></tr>
        <tr class="total"><td>Neto ${v.ejercicio}</td><td>${M(r.units[6].NET)}</td></tr>
      </tbody></table></div></div>
    </div>`;

  if (!ed) return;
  const pend = {};
  c.addEventListener('input', e => { const k = e.target.dataset.meta; if (!k) return; pend[k] = Number(e.target.value); $('#guardar-metas').disabled = false; });
  $('#guardar-metas').onclick = () => {
    const out = {};
    for (const [k, x] of Object.entries(pend)) {
      if (!isFinite(x) || x < 0) return accion(() => Promise.reject(new Error('Las metas deben ser cantidades positivas')));
      if (k === 'ure') { out.ure = x * 1e6; continue; }
      const [u, j] = k.split('.');
      out[u] ??= [...(metas[u] || FIXED.metas[u].meta)];
      out[u][Number(j)] = Math.round(x);
    }
    guardar(v, { metas: out }, 'Metas guardadas y versión recalculada', ctx);
  };
}

/* =========================================================
   COSTO DE PRESTACIÓN
   ========================================================= */
const SEG = { pres_c: 'Presencial · comunes', pres_e: 'Presencial · específicos', virt_c: 'Virtual · comunes', virt_e: 'Virtual · específicos', baq_c: 'Barranquilla · comunes', baq_e: 'Barranquilla · específicos' };

export async function vCosto(c, v, escenario, ctx) {
  const { modelo, cuadra } = await modeloDe(v);
  const { optimizarProgramacion, TOPE, OPT0 } = motor;
  const p = modelo.params[escenario], R = v.resultados[escenario], n = v.base.names;
  const ed = editable(v);
  const U = R.eerrUnidades, B = v.base.eerr2026Unidades;
  const r0 = modelo.run({ ...p, vert: 0 }), r1 = modelo.run({ ...p, vert: 1 });
  const o = optimizarProgramacion(modelo.run, p);
  const tope = TOPE(p);
  const aplicada = Object.values(p.grp || {}).some(x => x);

  c.innerHTML = `${avisoCuadre(cuadra)}
    <div class="tarjeta"><h2>Costo de prestación por unidad · ${escenario}</h2>
      <p class="nota">Rubro 4.1 del estado de resultados: docencia de planta (nómina) y cátedra y demás costos de prestación. Millones de pesos. Un valor negativo en «cátedra y otros» viene de los repartos del informe 2026 entre unidades.</p>
      <div class="tabla-cont"><table><thead><tr><th>Unidad</th><th>2026E</th><th>${v.ejercicio}</th><th>Nómina</th><th>Cátedra y otros</th><th>% del neto</th><th>Var.</th></tr></thead><tbody>
      ${U.map((u, i) => `<tr><td>${esc(n[i])}</td><td>${Mn(B[i].PRESTACION)}</td><td>${Mn(u.PRESTACION)}</td><td>${Mn(u.n_PRESTACION)}</td><td>${Mn(u.PRESTACION - u.n_PRESTACION)}</td><td>${P(u.NET ? u.PRESTACION / u.NET : null)}</td><td>${P(B[i].PRESTACION ? u.PRESTACION / B[i].PRESTACION - 1 : null)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td>${Mn(v.base.eerr2026.PRESTACION)}</td><td>${Mn(R.eerr.PRESTACION)}</td><td>${Mn(R.eerr.n_PRESTACION)}</td><td>${Mn(R.eerr.PRESTACION - R.eerr.n_PRESTACION)}</td><td>${P(R.eerr.PRESTACION / R.eerr.NET)}</td><td>${P(R.eerr.PRESTACION / v.base.eerr2026.PRESTACION - 1)}</td></tr>
      </tbody></table></div></div>

    <div class="rejilla">
    <div class="tarjeta"><h2>Pregrado Sabaneta: tradicional frente a Vértice</h2>
      <p class="nota">Tradicional: cada grupo con su profesor. Vértice: comunes con profesores de planta y núcleos fusionados con mentores. ${p.vert ? 'El escenario usa Vértice.' : 'El escenario usa el sistema tradicional.'}</p>
      <div class="tabla-cont"><table><tbody>
        <tr><td>Costo de prestación con sistema tradicional</td><td>${M(r0.units[0].C)}</td></tr>
        <tr><td>Costo de prestación con Vértice</td><td>${M(r1.units[0].C)}</td></tr>
        <tr class="det"><td>de los cuales, mentores</td><td>${M(r1.tot.mentors)}</td></tr>
        <tr class="total"><td>Ahorro de Vértice</td><td class="${cls(r0.units[0].C - r1.units[0].C)}">${M(r0.units[0].C - r1.units[0].C)}</td></tr>
      </tbody></table></div></div>

    <div class="tarjeta"><h2>Tope de estudiantes por grupo</h2>
      <p class="nota">Máximo por grupo en cada sede; aplica a los tres escenarios. Referencia de la Rectoría: presencial 40, virtual 60, Barranquilla 30.</p>
      <form class="formfila" id="topes">
        ${[['pres', 'Presencial'], ['virt', 'Virtual'], ['baq', 'Barranquilla']].map(([k, t]) => `<label class="campo">${t}${ed ? `<input class="inp-num" type="number" min="5" max="200" step="1" name="${k}" value="${tope[k]}">` : `<b>${tope[k]}</b>`}</label>`).join('')}
        ${ed ? '<button class="btn" type="submit">Guardar topes</button>' : ''}
      </form></div>
    </div>

    <div class="tarjeta"><div class="cabeza"><h2>Programación académica optimizada · ${escenario}</h2>
      <div class="acciones">${ed ? (aplicada ? '<button class="btn" id="quitar-opt" type="button">Volver a la programación actual</button>' : '<button class="btn primario" id="aplicar-opt" type="button">Aplicar las tres palancas</button>') : ''}</div></div>
      <p class="nota">Tres palancas sobre la cátedra de Sabaneta y Barranquilla: (1) Vértice, (2) cursos comunes al tope por grupo, (3) cursos específicos al tamaño mínimo (${OPT0.pres_e} / ${OPT0.virt_e} / ${OPT0.baq_e}, por validar con la Vicerrectoría Académica). Los profesores de planta dictan los mismos grupos; cambia cuántos van a cátedra.${aplicada ? ' <b>Este escenario ya tiene la programación optimizada.</b>' : ''}</p>
      <div class="kpis">
        <div class="kpi"><small>Cátedra actual</small><b>${M(o.catedra[0])}</b></div>
        <div class="kpi"><small>Con las tres palancas</small><b>${M(o.catedra[3])}</b></div>
        <div class="kpi"><small>Ahorro total</small><b class="pos">${M(o.ahorro.total)}</b><small>Vértice ${M(o.ahorro.vertice)} · comunes ${M(o.ahorro.comunes)} · específicos ${M(o.ahorro.especificos)}</small></div>
      </div>
      <div class="tabla-cont"><table><thead><tr><th>Sede y tipo de curso</th><th>Estudiantes</th><th>Grupos hoy</th><th>Tamaño hoy</th><th>Tamaño optimizado</th><th>Grupos optimizados</th></tr></thead><tbody>
      ${o.segmentos.map(s => `<tr><td>${SEG[s.k]}</td><td>${nf0.format(s.estudiantes)}</td><td>${nf0.format(s.gruposHoy)}</td><td>${nf1.format(s.tamanoHoy)}</td><td>${nf1.format(s.tamanoOpt)}</td><td>${nf0.format(s.gruposOpt)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td>${nf0.format(o.segmentos.reduce((a, s) => a + s.estudiantes, 0))}</td><td>${nf0.format(o.segmentos.reduce((a, s) => a + s.gruposHoy, 0))}</td><td></td><td></td><td>${nf0.format(o.segmentos.reduce((a, s) => a + s.gruposOpt, 0))}</td></tr>
      </tbody></table></div></div>`;

  if (!ed) return;
  $('#topes').onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.target), t = {};
    for (const k of ['pres', 'virt', 'baq']) { const x = Number(f.get(k)); if (!Number.isInteger(x) || x < 5 || x > 200) return accion(() => Promise.reject(new Error('Los topes van de 5 a 200 estudiantes'))); t[k] = x; }
    guardar(v, { params: Object.fromEntries(ESCS.map(x => [x, { tope: t }])) }, 'Topes guardados y versión recalculada', ctx);
  };
  $('#aplicar-opt')?.addEventListener('click', () => guardar(v, { params: { [escenario]: { vert: 1, grp: o.grp } } }, `Programación optimizada aplicada al escenario ${escenario}`, ctx));
  $('#quitar-opt')?.addEventListener('click', () => guardar(v, { params: { [escenario]: { grp: Object.fromEntries(Object.keys(SEG).map(k => [k, 0])) } } }, 'Se volvió a la programación actual', ctx));
}

/* =========================================================
   SENSIBILIDAD
   ========================================================= */
export async function vSensibilidad(c, v, escenario) {
  const { modelo, H, cuadra } = await modeloDe(v);
  const { tornado, equilibrio, tablaVolumenDescuento, tablaVolumenSMMLV, EJES } = motor;
  const p = modelo.params[escenario], base = modelo.run(p), RN0 = base.tot.RN;
  const t = tornado(modelo.run, p, H, modelo.esic);
  const max = Math.max(...t.map(x => x.w), 1);
  const t1 = tablaVolumenDescuento(modelo.run, p), t2 = tablaVolumenSMMLV(modelo.run, p), sm = EJES.sm(p);
  const tabla = (filas, cols, datos, fc, cc) => `<div class="tabla-cont"><table><thead><tr><th>Volumen \\ ${cc}</th>${cols.map(x => `<th>${fc(x)}</th>`).join('')}</tr></thead><tbody>
    ${filas.map((a, i) => `<tr><td>${a > 0 ? '+' : ''}${P(a)}</td>${datos[i].map((x, j) => `<td class="${cls(x)} ${a === 0 && (cols[j] === 0 || Math.abs(cols[j] - p.sm) < 1e-9) ? 'marca' : ''}">${Mn(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  c.innerHTML = `${avisoCuadre(cuadra)}
    <div class="tarjeta"><h2>Qué mueve más el resultado · ${escenario}</h2>
      <p class="nota">Cambio en el resultado neto ${v.ejercicio} (base ${M(RN0)}) al mover cada supuesto por sí solo. Ordenado de mayor a menor efecto. A la izquierda, el choque desfavorable; a la derecha, el favorable.</p>
      <div class="tornado">${t.map(x => {
        const wa = Math.abs(x.a) / max * 50, wb = Math.abs(x.b) / max * 50;
        return `<div class="fila-t"><span class="et">${esc(x.l)}<small>${esc(x.r)}</small></span>
          <span class="pista"><span class="llenado ${x.a < 0 ? 'neg' : ''}" data-w="${wa.toFixed(2)}" data-l="${(x.a < 0 ? 50 - wa : 50).toFixed(2)}"></span><span class="llenado ${x.b < 0 ? 'neg' : ''}" data-w="${wb.toFixed(2)}" data-l="${(x.b < 0 ? 50 - wb : 50).toFixed(2)}"></span><span class="cero"></span></span>
          <span class="vals">${M(x.a)} / ${M(x.b)}</span></div>`;
      }).join('')}</div></div>

    <div class="tarjeta"><h2>Punto de equilibrio y metas inversas</h2>
      <p class="nota">Cuánto tendría que moverse cada palanca, sola y con todo lo demás igual, para que el resultado neto llegue al objetivo.</p>
      <form class="formfila" id="objetivo"><label class="campo">Objetivo de resultado neto (millones)<input class="inp-num" type="number" step="50" name="tgt" value="0"></label>
        <button class="btn" type="button" data-pct="0">Equilibrio ($0)</button><button class="btn" type="button" data-pct="0.03">3% del ingreso neto</button><button class="btn" type="button" data-pct="0.05">5% del ingreso neto</button>
        <button class="btn primario" type="submit">Calcular</button></form>
      <div id="equilibrio"></div></div>

    <div class="rejilla">
      <div class="tarjeta"><h3>Volumen de estudiantes × descuento</h3><p class="nota">Resultado neto (millones) con choques sobre el escenario ${escenario}. Resaltado, sin choque.</p>${tabla(EJES.dVol, EJES.dDesc, t1, x => (x > 0 ? '+' : '') + nf1.format(x * 100) + ' pp', 'descuento')}</div>
      <div class="tarjeta"><h3>Volumen de estudiantes × incremento del SMMLV</h3><p class="nota">Resultado neto (millones). El SMMLV mueve la nómina de quienes ganan hasta 2 salarios mínimos.${t2.every(f => f.every(x => Math.abs(x - f[0]) < 1)) ? ' Con el plan de nómina por persona (base vigente), el SMMLV no cambia la nómina y la tabla no varía entre columnas.' : ''}</p>${tabla(EJES.dVol, sm, t2, x => P(x), 'SMMLV')}</div>
    </div>`;
  anchos(c);

  const pintar = tgt => {
    const q = equilibrio(modelo.run, p, H, tgt);
    const fila = (t_, actual, obj, f, mejor) => {
      const holg = obj == null ? null : mejor(obj, actual);
      return `<tr><td>${t_}</td><td>${f(actual)}</td><td>${obj == null ? 'Fuera de rango' : f(obj)}</td><td class="izq ${holg == null ? '' : holg ? 'pos' : 'neg'}">${obj == null ? 'Esa palanca sola no alcanza el objetivo' : holg ? 'Holgura: se cumple aun empeorando hasta ese valor' : 'Debe moverse hasta ese valor'}</td></tr>`;
    };
    $('#equilibrio').innerHTML = `<p class="nota">Objetivo: ${M(tgt)} · resultado actual ${M(RN0)}.</p><div class="tabla-cont"><table><thead><tr><th>Palanca</th><th>Actual</th><th>Valor para el objetivo</th><th class="izq">Lectura</th></tr></thead><tbody>
      ${fila('Cumplimiento de la meta de nuevos', q.cumplimiento.actual, q.cumplimiento.objetivo, P, (o, a) => o <= a)}
      ${fila('Descuento promedio', q.descuento.actual, q.descuento.objetivo, P, (o, a) => o >= a)}
      ${fila('Nómina total', q.nomina.actual, q.nomina.objetivo, M, (o, a) => o >= a)}
      ${fila('Incremento de matrícula', q.matricula.actual, q.matricula.objetivo, P, (o, a) => o <= a)}
      ${fila('Deserción de antiguos (promedio)', q.desercion.actual, q.desercion.objetivo, P, (o, a) => o >= a)}
    </tbody></table></div>`;
  };
  const f = $('#objetivo');
  f.onsubmit = e => { e.preventDefault(); pintar(Number(f.tgt.value) * 1e6 || 0); };
  f.querySelectorAll('[data-pct]').forEach(b => b.onclick = () => { const x = Math.round(base.tot.NET * Number(b.dataset.pct) / 1e6); f.tgt.value = x; pintar(x * 1e6); });
  pintar(0);
}

/* =========================================================
   PREGUNTAS
   ========================================================= */
const SUGERENCIAS = ['¿Por qué cambia el EBITDA frente a 2026E?', '¿Qué unidades pierden plata y por qué?', '¿Cuál es el mes más apretado de caja y qué lo explica?', '¿Qué pasa con el resultado en el escenario Pesimista?'];

export async function vPreguntas(c, v, escenario) {
  const { activo, preguntas } = await api('GET', `/api/presupuesto/versiones/${v.id}/preguntas`);
  const pintarLista = lista => lista.map(q => `<div class="qa"><div class="qa-msg u"><span class="who">${esc(q.nombre)} · ${fecha(q.fecha)} · ${esc(q.escenario)}</span>${esc(q.pregunta)}</div>
      <div class="qa-msg"><span class="who">Asistente</span>${esc(q.respuesta)}</div></div>`).join('');
  c.innerHTML = `<div class="tarjeta"><h2>Preguntas sobre esta versión</h2>
    <p class="nota">El asistente (Claude) responde con los supuestos y resultados de esta versión: estado de resultados total y por unidad, proyección, mensual y caja de los tres escenarios. No recibe nómina por persona. Las preguntas quedan guardadas y las ve todo el equipo del módulo.</p>
    ${activo ? '' : '<p class="nota neg">El asistente no está activo en este servidor. Para activarlo, el administrador del servidor debe configurar la llave de la API de Anthropic (ANTHROPIC_API_KEY).</p>'}
    <div class="qa-log" id="qa-log">${pintarLista(preguntas) || '<p class="nota">Todavía no hay preguntas.</p>'}</div>
    <form class="qa-form" id="qa-form"><textarea name="q" maxlength="4000" placeholder="Escriba su pregunta" ${activo ? '' : 'disabled'}></textarea><button class="btn primario" type="submit" ${activo ? '' : 'disabled'}>Preguntar</button></form>
    <div class="qa-sug">${SUGERENCIAS.map(s => `<button class="btn" type="button" ${activo ? '' : 'disabled'}>${esc(s)}</button>`).join('')}</div>
    <p class="nota">Escenario de la pregunta: ${escenario} (cámbielo arriba).</p></div>`;
  const f = $('#qa-form');
  c.querySelectorAll('.qa-sug button').forEach(b => b.onclick = () => { f.q.value = b.textContent; f.q.focus(); });
  f.onsubmit = async e => {
    e.preventDefault();
    const q = f.q.value.trim(); if (!q) return;
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Pensando…';
    try {
      const r = await accion(() => api('POST', `/api/presupuesto/versiones/${v.id}/preguntas`, { pregunta: q, escenario }));
      const log = $('#qa-log'); if (log.querySelector('p.nota')) log.innerHTML = '';
      log.insertAdjacentHTML('beforeend', pintarLista([{ ...r, nombre: 'Usted', fecha: new Date().toISOString() }]));
      f.q.value = '';
    } catch { /* aviso ya mostrado */ } finally { btn.disabled = false; btn.textContent = 'Preguntar'; }
  };
}

/* =========================================================
   ARCHIVOS DEL EJERCICIO
   ========================================================= */
const tamano = b => b < 1024 ? `${b} B` : b < 1048576 ? `${nf0.format(b / 1024)} KB` : `${nf1.format(b / 1048576)} MB`;

export async function vArchivos(c, anio) {
  const mod = modulo('PRESUPUESTO');
  const lista = await api('GET', `/api/presupuesto/ejercicios/${anio}/archivos`);
  c.innerHTML = `<div class="tarjeta"><h2>Archivos del presupuesto ${anio}</h2>
    <p class="nota">Soportes para elaborar el presupuesto: matrículas, programación académica, contratos, cotizaciones. Los ve todo el equipo del módulo y no se cifran: la nómina por persona o por cargo no va aquí, sino en la pestaña Nómina por cargo de una versión. Un archivo retirado deja de verse pero queda en la bitácora.</p>
    ${lista.length ? `<div class="tabla-cont"><table><thead><tr><th>Archivo</th><th class="izq">Descripción</th><th>Tamaño</th><th class="izq">Subido por</th><th></th></tr></thead><tbody>
      ${lista.map(a => `<tr><td>${esc(a.nombre)}</td><td class="izq nota">${esc(a.descripcion || '')}</td><td>${tamano(a.tamano)}</td><td class="izq">${esc(a.subido_por)}<div class="nota">${fecha(a.subido_en)}</div></td>
        <td><button class="btn" type="button" data-bajar="${a.id}" data-nombre="${esc(a.nombre)}">Descargar</button>${mod.editar ? ` <button class="btn peligro" type="button" data-retirar="${a.id}">Retirar</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="nota">Todavía no hay archivos.</p>'}
    ${mod.editar ? `<h3>Subir un archivo</h3><form class="formfila" id="subir">
      <label class="campo">Archivo (máximo 15 MB)<input type="file" name="f" required accept=".xlsx,.xls,.csv,.pdf,.docx,.pptx,.txt,.json,.png,.jpg,.jpeg,.zip"></label>
      <label class="campo">Descripción<input name="d" maxlength="500" placeholder="Ej.: matriculados 2026-2 por programa"></label>
      <button class="btn primario" type="submit">Subir</button></form>` : ''}</div>`;
  c.onclick = async e => {
    const b = e.target.closest('[data-bajar], [data-retirar]'); if (!b) return;
    if (b.dataset.bajar) {
      try {
        const blob = await accion(() => api('GET', `/api/presupuesto/archivos/${b.dataset.bajar}`, undefined, { binario: true }));
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = b.dataset.nombre; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch { /* aviso ya mostrado */ }
      return;
    }
    if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = '¿Retirar? Confirmar'; return; }
    try { await accion(() => api('DELETE', `/api/presupuesto/archivos/${b.dataset.retirar}`), 'Archivo retirado'); vArchivos(c, anio); } catch { /* */ }
  };
  $('#subir')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, archivo = f.f.files[0]; if (!archivo) return;
    if (archivo.size > 15 * 1024 * 1024) return accion(() => Promise.reject(new Error('El archivo supera 15 MB'))).catch(() => {});
    const cab = { 'X-Nombre': encodeURIComponent(archivo.name) };
    if (f.d.value.trim()) cab['X-Descripcion'] = encodeURIComponent(f.d.value.trim());
    try { await accion(() => api('POST', `/api/presupuesto/ejercicios/${anio}/archivos`, archivo, { cab }), 'Archivo subido'); vArchivos(c, anio); } catch { /* */ }
  });
}
