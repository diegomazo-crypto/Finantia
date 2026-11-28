/*
 * Finantia 2.0 · módulo de Planeación financiera.
 *
 * Dos vistas sobre la versión del presupuesto del ejercicio (la aprobada o, si no hay, la última):
 *  - Proyección y valor: objetivo, estados proforma 2027–2031 hasta el flujo de caja libre,
 *    VPN, TIR, payback por escenario, sensibilidad y los supuestos de planeación editables.
 *  - Resultado mensual y caja: el mismo detalle de Finantia Admon 1.0.
 * Después: bancos y extractos mensuales para recalcular la caja hasta fin de año.
 */
import { $, EERR, ESCS, M, MESES, Mn, P, accion, almacen, api, app, cls, esc, fecha, kpi, modulo, nf1, ESTADOS, ROLES } from './comun.js';

const VISTAS = [['proforma', 'Proyección y valor'], ['mensual', 'Resultado mensual y caja']];
export const OBJETIVO = 'Traducir la estrategia operativa de CEIPA en cifras proyectadas para garantizar su solvencia, rentabilidad y sostenibilidad a corto, mediano y largo plazo. Permite anticipar necesidades de liquidez, asignar recursos de manera eficiente y medir el impacto financiero de las decisiones estratégicas antes de ejecutarlas.';

export async function pantallaPlaneacion(anio, versionId) {
  const v0 = almacen.leer('finantia.plVista'), vista = VISTAS.some(([k]) => k === v0) ? v0 : 'proforma';
  const esc0 = almacen.leer('finantia.escenario');
  const q = new URLSearchParams(); if (anio) q.set('ejercicio', anio); if (versionId) q.set('version', versionId);
  const d = await api('GET', '/api/planeacion/flujo' + (q.size ? '?' + q : ''));
  const mod = modulo('PLANEACION'), v = d.version;
  const escenario = ESCS.includes(esc0) ? esc0 : (v?.escenario_oficial || 'Moderado');
  app.innerHTML = `
    <div class="cabeza"><div><div class="miga">Planeación financiera</div><h1>${vista === 'proforma' ? 'Proyección financiera y creación de valor' : 'Resultado mensual y flujo de caja'}${d.ejercicio ? ' ' + d.ejercicio : ''}</h1>
      <p class="nota">Su rol: ${esc(ROLES[mod.rol] || 'Superusuario')}${v ? ` · Fuente: presupuesto ${d.ejercicio}, V${v.numero} · ${esc(v.nombre)} <span class="estado ${v.estado}">${ESTADOS[v.estado]}</span>${v.escenario_oficial ? ' · escenario oficial: ' + v.escenario_oficial : ''}` : ''}</p></div>
      ${v ? `<div class="acciones" role="group" aria-label="Escenario">${ESCS.map(e => `<button type="button" class="btn ${e === escenario ? 'primario' : ''}" data-esc="${e}" aria-pressed="${e === escenario}">${e}</button>`).join('')}</div>` : ''}
    </div>
    ${d.ejercicios.length ? `<nav class="pestanas" aria-label="Ejercicios">${d.ejercicios.map(a => `<a href="#/planeacion/${a}" ${a === d.ejercicio ? 'aria-current="page"' : ''}>${a}</a>`).join('')}</nav>` : ''}
    <div class="botonera" role="group" aria-label="Vista">${VISTAS.map(([k, t]) => `<button type="button" class="btn chico ${k === vista ? 'primario' : ''}" data-vista="${k}" aria-pressed="${k === vista}">${t}</button>`).join('')}</div>
    ${d.versiones.length > 1 ? `<div class="fila-drill"><label>Versión del presupuesto <select id="pl-version">${d.versiones.map(x => `<option value="${x.id}" ${x.id === v?.id ? 'selected' : ''}>V${x.numero} · ${esc(x.nombre)} (${ESTADOS[x.estado]})</option>`).join('')}</select></label>
      <span class="nota">Por defecto se usa la versión aprobada; si no hay, la última.</span></div>` : ''}
    <section id="pl-cuerpo"></section>`;
  const cuerpo = $('#pl-cuerpo');
  app.querySelectorAll('[data-esc]').forEach(b => b.onclick = () => { almacen.poner('finantia.escenario', b.dataset.esc); pantallaPlaneacion(d.ejercicio, v.id); });
  app.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => { almacen.poner('finantia.plVista', b.dataset.vista); pantallaPlaneacion(d.ejercicio, v?.id); });
  $('#pl-version')?.addEventListener('change', e => { location.hash = `#/planeacion/${d.ejercicio}/${e.target.value}`; });
  if (!d.ejercicios.length) { cuerpo.innerHTML = '<div class="tarjeta"><p class="nota">Todavía no hay ejercicios presupuestales.</p></div>'; return; }
  if (!v || !v.resultados[escenario]) { cuerpo.innerHTML = '<div class="tarjeta"><p class="nota">Este ejercicio todavía no tiene una versión del presupuesto calculada.</p></div>'; return; }
  if (vista === 'mensual') return vMensual(cuerpo, v, escenario);
  const qp = new URLSearchParams({ ejercicio: d.ejercicio, version: v.id, escenario });
  const pf = await api('GET', '/api/planeacion/proforma?' + qp);
  vProforma(cuerpo, pf, { editar: !!mod.editar, recargar: () => pantallaPlaneacion(d.ejercicio, v.id) });
}

/* ---------- Proyección proforma, flujo de caja libre, valor y sensibilidad ---------- */
const pb = x => x == null ? 'No se recupera' : nf1.format(x) + ' años';
const pp = x => (x > 0 ? '+' : x < 0 ? '−' : '') + nf1.format(Math.abs(x) * 100) + ' pp';

export function vProforma(c, pf, { editar = false, recargar = () => {} } = {}) {
  const e = pf.escenario, x = pf.escenarios[e], s = pf.supuestos, a = x.anios, mt = x.metricas, p = a.slice(1);
  const hayDeuda = s.deuda.length > 0, conImp = s.impuesto > 0;
  const fila = (t, f, tipo = '', ref = true) => `<tr class="${tipo}"><td>${t}</td>${a.map((y, i) => { const val = i === 0 && !ref ? null : f(y); return `<td class="${i === 0 ? 'ref ' : ''}${cls(val)}">${val == null ? (i === 0 ? '' : '—') : Mn(val)}</td>`; }).join('')}<td class="${cls(f.total ?? 0)}">${f.total == null ? '' : Mn(f.total)}</td></tr>`;
  const tot = f => Object.assign(f, { total: p.reduce((t, y) => t + (f(y) || 0), 0) });
  const neg = k => y => y[k] == null ? null : -y[k];
  const cab = `<thead><tr><th>Concepto</th>${a.map((y, i) => `<th>${y.anio}${i ? '' : 'E'}</th>`).join('')}<th>2027–2031</th></tr></thead>`;
  const tasaTxt = P(s.tasa);
  c.innerHTML = `
    <div class="tarjeta objetivo"><h2>Objetivo de la planeación financiera</h2><p>${esc(OBJETIVO)}</p>
      <p class="nota">Cómo lo hace Finantia: parte del presupuesto ${pf.ejercicio} (V${pf.version.numero}) y su proyección a 2031 por escenario, integra inversiones y servicio de la deuda, construye los estados proforma hasta el flujo de caja libre y mide la creación de valor con VPN, TIR y payback. Los supuestos de planeación son explícitos y se editan abajo.</p></div>

    <div class="kpis">
      ${kpi(`VPN (${tasaTxt}) · ${e}`, mt.vpn, '2027–2031, sin valor terminal')}
      ${kpi('VPN con valor terminal', mt.vpnVT, `crecimiento a perpetuidad ${P(s.gT)}`)}
      <div class="kpi"><small>TIR</small><b>${mt.tir == null ? 'No aplica' : P(mt.tir)}</b><small>${mt.sinInversion ? 'requiere una inversión inicial' : mt.tir == null ? 'el flujo no cambia de signo' : ''}</small></div>
      <div class="kpi"><small>Payback simple / descontado</small><b>${mt.sinInversion ? 'No aplica' : pb(mt.paybackSimple)}</b><small>${mt.sinInversion ? 'requiere una inversión inicial' : 'descontado: ' + pb(mt.paybackDescontado)}</small></div>
      ${kpi('Flujo de caja libre acumulado', mt.fclTotal, `EBITDA acumulado ${M(mt.ebitdaTotal)}`)}
      ${kpi('Caja mínima del horizonte', mt.cajaMinima, `${mt.anioCajaMinima}${mt.bajoMinimo.length ? ' · bajo el mínimo en ' + mt.bajoMinimo.join(', ') : ' · sobre el mínimo deseado'}`)}
    </div>

    <div class="tarjeta"><h2>Escenarios</h2><p class="nota">Las mismas métricas con los supuestos de planeación aplicados a los tres escenarios del presupuesto. Millones de pesos.</p>
      <div class="tabla-cont"><table><thead><tr><th>Métrica</th>${ESCS.filter(k => pf.escenarios[k]).map(k => `<th class="${k === e ? 'sel' : ''}">${k}</th>`).join('')}</tr></thead><tbody>
      ${[['VPN (' + tasaTxt + ')', m => M(m.vpn)], ['VPN con valor terminal', m => M(m.vpnVT)], ['TIR', m => m.tir == null ? 'No aplica' : P(m.tir)],
         ['Payback simple', m => m.sinInversion ? 'No aplica' : pb(m.paybackSimple)], ['Payback descontado', m => m.sinInversion ? 'No aplica' : pb(m.paybackDescontado)],
         ['Flujo de caja libre acumulado', m => M(m.fclTotal)], ['EBITDA acumulado', m => M(m.ebitdaTotal)], ['Margen EBITDA promedio', m => P(m.margenPromedio)],
         ['Caja mínima (año)', m => `${M(m.cajaMinima)} (${m.anioCajaMinima})`]]
        .map(([t, f]) => `<tr><td>${t}</td>${ESCS.filter(k => pf.escenarios[k]).map(k => `<td class="${k === e ? 'sel' : ''}">${f(pf.escenarios[k].metricas)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>

    <div class="tarjeta"><h2>Estado de resultados proforma · ${e}</h2><p class="nota">2026E es el estimado de cierre y sirve de referencia; la evaluación cubre 2027–2031. Millones de pesos.</p>
      <div class="tabla-cont"><table>${cab}<tbody>
      ${fila('Ingresos brutos', tot(y => y.IB, 'IB'))}
      ${fila('Descuentos y becas', tot(neg('DS'), 'DS'))}
      ${fila('Ingresos netos', tot(y => y.NET, 'NET'), 'sub')}
      ${fila('Otros ingresos', tot(y => y.OI, 'OI'))}
      ${fila('Nómina', tot(neg('N'), 'N'))}
      ${fila('Cátedra y costos variables', tot(neg('CV'), 'CV'))}
      ${fila('Gastos fijos y otros', tot(neg('FO'), 'FO'))}
      ${fila('EBITDA', tot(y => y.EBITDA, 'EBITDA'), 'sub')}
      <tr><td>Margen EBITDA</td>${a.map((y, i) => `<td class="${i === 0 ? 'ref' : ''}">${P(y.margen)}</td>`).join('')}<td>${P(mt.margenPromedio)}</td></tr>
      ${fila('Depreciación y amortización', tot(neg('DA'), 'DA'))}
      ${fila('Resultado operacional (EBIT)', tot(y => y.EBIT, 'EBIT'), 'sub')}
      ${hayDeuda ? fila('Intereses de la deuda', tot(neg('INT'), 'INT'), '', false) : ''}
      ${conImp ? fila('Impuesto de renta', tot(neg('IMP'), 'IMP'), '', false) : ''}
      ${fila('Resultado neto', tot(y => y.UN ?? (y.EBIT), 'UN'), 'total')}
      </tbody></table></div></div>

    <div class="tarjeta"><h2>Flujo de caja libre · ${e}</h2><p class="nota">Flujo de caja libre = EBITDA − impuesto operativo − capex − variación del capital de trabajo. El servicio de la deuda va después del flujo libre y afecta la caja, no el VPN. Caja anual simplificada; el detalle mensual de ${pf.ejercicio} está en «Resultado mensual y caja». Millones de pesos.</p>
      <div class="tabla-cont"><table>${cab}<tbody>
      ${fila('EBITDA', tot(y => y.EBITDA, 'EBITDA'), '', false)}
      ${conImp ? fila('Impuesto operativo', tot(neg('IMPOP'), 'IMPOP'), '', false) : ''}
      ${fila('Capex e inversiones', tot(neg('CAPEX'), 'CAPEX'), '', false)}
      ${fila('Variación del capital de trabajo', tot(neg('KT'), 'KT'), '', false)}
      ${fila('Flujo de caja libre', tot(y => y.FCL, 'FCL'), 'total', false)}
      <tr><td>Factor de descuento (${tasaTxt})</td>${a.map((y, i) => `<td class="${i === 0 ? 'ref' : ''}">${y.DF == null ? '' : nf3.format(y.DF)}</td>`).join('')}<td></td></tr>
      ${fila('Flujo de caja libre descontado', tot(y => y.DFCL, 'DFCL'), '', false)}
      ${hayDeuda ? fila('Servicio de la deuda (intereses + capital)', tot(neg('SD'), 'SD'), '', false) + (conImp ? fila('Escudo fiscal de los intereses', tot(y => y.ESC, 'ESC'), '', false) : '') : ''}
      ${hayDeuda || conImp ? fila('Flujo después de la deuda', tot(y => y.FCA, 'FCA'), 'sub', false) : ''}
      ${s.inversionInicial ? `<tr><td>Inversión inicial</td><td class="ref"></td>${p.map((y, k) => `<td class="${k ? '' : 'neg'}">${k ? '' : Mn(-s.inversionInicial)}</td>`).join('')}<td class="neg">${Mn(-s.inversionInicial)}</td></tr>` : ''}
      ${fila('Caja al inicio del año', y => y.cajaIni, '', false)}
      ${fila('Caja al final del año', y => y.cajaFin, 'total', false)}
      ${hayDeuda ? fila('Saldo de la deuda al cierre', y => y.DEUDA, '', false) : ''}
      </tbody></table></div></div>

    ${pf.sensibilidad ? vSensibilidad(pf, mt) : ''}
    <div class="tarjeta" id="pl-sup"></div>`;
  vSupuestos($('#pl-sup'), pf, { editar, recargar });
}

const nf3 = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

function vSensibilidad(pf, mt) {
  const S = pf.sensibilidad, s = pf.supuestos;
  const todos = [...S.vpnCrecDesc.flat(), ...S.vpnTasaCapex.flat()], mx = Math.max(...todos.map(Math.abs)) || 1;
  const celda = (v, base) => `<td class="calor ${v < 0 ? 'neg' : 'pos'}${base ? ' base' : ''}" data-i="${Math.min(4, Math.floor(Math.abs(v) / mx * 5))}">${Mn(v)}</td>`;
  const tabla = (titulo, filas, cols, M2, fT, cT, esBase) => `<div><h3>${titulo}</h3><div class="tabla-cont"><table class="sens"><thead><tr><th>${fT} ↓ · ${cT} →</th>${cols.map(c => `<th>${c.t}</th>`).join('')}</tr></thead><tbody>
    ${filas.map((f, i) => `<tr><th>${f.t}</th>${cols.map((c, j) => celda(M2[i][j], esBase(i, j))).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  const iT = S.tasas.findIndex(t => Math.abs(t - s.tasa) < 1e-9), iC = S.capex.findIndex(c => Math.abs(c - s.capexPct) < 1e-9);
  return `<div class="tarjeta"><h2>Análisis de sensibilidad del VPN · ${pf.escenario}</h2>
    <p class="nota">VPN 2027–2031 en millones de pesos (sin valor terminal). El recuadro marca el caso con los supuestos actuales (VPN ${M(mt.vpn)}). Izquierda: se recalcula la proyección moviendo el crecimiento anual de estudiantes de 2028 a 2031 y el porcentaje de descuento desde 2028, con la tasa de ${P(s.tasa)}. Derecha: tasa de descuento contra capex recurrente.</p>
    <div class="rejilla dos">
      ${tabla('Crecimiento de estudiantes × descuento', S.crecimiento.map(t => ({ t: pp(t) })), S.descuento.map(t => ({ t: pp(t) })), S.vpnCrecDesc, 'Crecimiento', 'Descuento', (i, j) => S.crecimiento[i] === 0 && S.descuento[j] === 0)}
      ${tabla('Tasa de descuento × capex', S.tasas.map(t => ({ t: P(t) })), S.capex.map(t => ({ t: P(t) })), S.vpnTasaCapex, 'Tasa', 'Capex (% del ingreso neto)', (i, j) => i === iT && j === iC)}
    </div></div>`;
}

/* Supuestos de planeación: explícitos y editables por quien tiene el rol de edición en Planeación */
function vSupuestos(c, pf, { editar, recargar }) {
  const s = JSON.parse(JSON.stringify(pf.supuestos)), dis = editar ? '' : 'disabled';
  const pct = (k, t, ayuda) => `<label>${t}<input type="number" step="0.1" data-pct="${k}" value="${+(s[k] * 100).toFixed(3)}" ${dis}><small class="nota">${ayuda}</small></label>`;
  const mill = (v, attr) => `<input type="number" step="1" ${attr} value="${Math.round((v || 0) / 1e6)}" ${dis}>`;
  const pintar = () => {
    c.innerHTML = `<h2>Supuestos de planeación ${pf.ejercicio}</h2>
      <p class="nota">Se aplican a los tres escenarios. ${pf.actualizadoEn ? 'Última edición: ' + fecha(pf.actualizadoEn) + '.' : 'Valores por defecto (no se han editado).'} ${editar ? '' : 'Solo lectura: su rol no edita Planeación.'} Cifras en millones de pesos; tasas en %.</p>
      <div class="formfila sup-pl">
        ${pct('tasa', 'Tasa de descuento', 'anual')}
        ${pct('gT', 'Crecimiento a perpetuidad', 'valor terminal')}
        ${pct('capexPct', 'Capex recurrente', '% del ingreso neto')}
        ${pct('ktPct', 'Capital de trabajo', '% del aumento del ingreso neto')}
        ${pct('impuesto', 'Impuesto de renta', 'CEIPA es régimen especial: 0%')}
        <label>Inversión inicial (año 0)${mill(s.inversionInicial, 'data-m="inversionInicial"')}<small class="nota">habilita TIR y payback</small></label>
        <label>Caja mínima deseada${mill(s.cajaMinima, 'data-m="cajaMinima"')}<small class="nota">alerta de liquidez</small></label>
      </div>
      <h3>Inversiones puntuales (además del capex recurrente)</h3>
      <div class="formfila sup-pl">${[0, 1, 2, 3, 4].map(k => `<label>${2027 + k}${mill(s.inversiones[k], `data-inv="${k}"`)}</label>`).join('')}</div>
      <h3>Deuda</h3>
      <p class="nota">Cuota fija anual desde 2027 (intereses + capital). ${s.deuda.length ? '' : 'Sin créditos registrados.'}</p>
      ${s.deuda.length ? `<div class="tabla-cont"><table><thead><tr><th>Crédito</th><th>Saldo (M)</th><th>Tasa anual %</th><th>Plazo (años)</th>${editar ? '<th></th>' : ''}</tr></thead><tbody>
        ${s.deuda.map((d, i) => `<tr><td><input type="text" data-d="${i}" data-k="nombre" value="${esc(d.nombre)}" ${dis}></td>
          <td><input type="number" step="1" data-d="${i}" data-k="saldo" value="${Math.round(d.saldo / 1e6)}" ${dis}></td>
          <td><input type="number" step="0.1" data-d="${i}" data-k="tasa" value="${+(d.tasa * 100).toFixed(3)}" ${dis}></td>
          <td><input type="number" step="1" min="1" max="30" data-d="${i}" data-k="anios" value="${d.anios}" ${dis}></td>
          ${editar ? `<td><button type="button" class="btn chico" data-quitar="${i}">Quitar</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>` : ''}
      ${editar ? `<div class="acciones"><button type="button" class="btn" id="pl-mas-deuda">Agregar crédito</button><button type="button" class="btn primario" id="pl-guardar">Guardar y recalcular</button></div>` : ''}`;
    if (!editar) return;
    $('#pl-mas-deuda').onclick = () => { leer(); s.deuda.push({ nombre: 'Crédito ' + (s.deuda.length + 1), saldo: 0, tasa: 0.12, anios: 5 }); pintar(); };
    c.querySelectorAll('[data-quitar]').forEach(b => b.onclick = () => { leer(); s.deuda.splice(Number(b.dataset.quitar), 1); pintar(); });
    $('#pl-guardar').onclick = () => accion(async () => { leer(); await api('PUT', `/api/planeacion/supuestos/${pf.ejercicio}`, s); await recargar(); }, 'Supuestos guardados');
  };
  const leer = () => {
    c.querySelectorAll('[data-pct]').forEach(i => { s[i.dataset.pct] = Number(i.value) / 100; });
    c.querySelectorAll('[data-m]').forEach(i => { s[i.dataset.m] = Number(i.value) * 1e6; });
    c.querySelectorAll('[data-inv]').forEach(i => { s.inversiones[Number(i.dataset.inv)] = Number(i.value) * 1e6; });
    c.querySelectorAll('[data-d]').forEach(i => { const d = s.deuda[Number(i.dataset.d)], k = i.dataset.k;
      d[k] = k === 'nombre' ? i.value : k === 'saldo' ? Number(i.value) * 1e6 : k === 'tasa' ? Number(i.value) / 100 : Number(i.value); });
  };
  pintar();
}

/* Gráfico mensual en SVG (sin estilos en línea, por la CSP): barras por mes, una línea y, si se da, una referencia. */
function graficoMensual({ barras, linea, ref, etiquetaFinal }) {
  const W = 760, H = 260, L = 62, R = 14, T = 16, B = 26, bw = (W - L - R) / 12;
  const vals = [...barras, ...linea, 0, ...(ref != null ? [ref] : [])];
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) hi = lo + 1;
  const paso = (() => { const r = (hi - lo) / 5, e = 10 ** Math.floor(Math.log10(r)), f = r / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; })();
  lo = Math.floor(lo / paso) * paso; hi = Math.ceil(hi / paso) * paso;
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B), x = m => L + m * bw + bw / 2;
  const marcas = []; for (let t = lo; t <= hi + paso / 2; t += paso) marcas.push(t);
  return `<div class="tabla-cont"><svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico mensual">
    ${marcas.map(t => `<line class="${Math.abs(t) < paso / 2 ? 'eje cero' : 'eje'}" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${Mn(t)}</text>`).join('')}
    ${ref != null ? `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(ref)}" y2="${y(ref)}"/>` : ''}
    ${barras.map((b, m) => `<rect class="${b < 0 ? 'neg' : 'pos'}" x="${L + m * bw + bw * 0.25}" y="${y(Math.max(0, b))}" width="${bw * 0.5}" height="${Math.max(1, Math.abs(y(b) - y(0)))}" rx="2"/><text class="tick" x="${x(m)}" y="${H - 8}" text-anchor="middle">${MESES[m]}</text>`).join('')}
    <polyline class="linea" points="${linea.map((v, m) => `${x(m)},${y(v)}`).join(' ')}"/>
    ${linea.map((v, m) => `<circle class="punto" cx="${x(m)}" cy="${y(v)}" r="3"/>`).join('')}
    ${etiquetaFinal ? `<text class="final" x="${x(11)}" y="${y(linea[11]) - 12}" text-anchor="middle">${Mn(linea[11])}</text>` : ''}
  </svg></div>`;
}
const leyenda = xs => `<div class="leyenda">${xs.map(([k, t]) => `<span><b class="${k}"></b>${t}</span>`).join('')}</div>`;

/* Supuestos del flujo de caja (motor/parametros.js, FIXED.cash y capex): los mismos de Finantia Admon 1.0 */
const CAJA_MINIMO = 2000e6;
export function vMensual(c, v, escenario) {
  const r = v.resultados[escenario], m = r.mensual, cj = r.caja.meses;
  const suma = k => m.reduce((s, x) => s + (x[k] || 0), 0), totNET = suma('NET');
  const filasPyG = [...EERR.filter(([k]) => k !== 'EBITDA'), ['ACC', 'Resultado neto acumulado', 'memo'], ['EBITDA', 'EBITDA', 'sub']];
  const caja = [['NETC', 'Ingresos netos causados (estado de resultados)', 'memo'], ['REC', 'Recaudo de matrículas y derechos'], ['OIN', 'Otros ingresos'], ['TE', 'Total entradas', 'sub'],
    ['NOM', 'Nómina y cátedra (pago mensual)'], ['PRI', 'Prima de servicios'], ['CES', 'Cesantías'], ['INT', 'Intereses de cesantías'], ['PROV', 'Proveedores, servicios y otros'],
    ['BAN', 'Gastos bancarios e impuestos'], ['CAP', 'Capex'], ['TS', 'Total salidas', 'sub'], ['FN', 'Flujo neto del mes', 'total'], ['SI', 'Saldo inicial'], ['SF', 'Saldo final de caja', 'total']];
  const totCaja = k => k === 'SI' ? cj[0].SI : k === 'SF' ? cj[11].SF : cj.reduce((s, x) => s + (x[k] || 0), 0);
  const fnAnio = cj[11].SF - cj[0].SI;
  c.innerHTML = `<div class="tarjeta"><h2>Resultado mensual ${v.ejercicio} · ${escenario}</h2>
    <p class="nota">Base de causación contable. Ingresos con la estacionalidad 2026 de cada unidad; nómina y cátedra con el patrón real de 2026; el resto lineal. Millones de pesos.</p>
    ${graficoMensual({ barras: m.map(x => x.RN), linea: m.map(x => x.ACC) })}
    ${leyenda([['pos', 'Excedente del mes'], ['neg', 'Déficit del mes'], ['linea', 'Acumulado']])}</div>
    <div class="tarjeta"><h3>Detalle mensual</h3><p class="nota">Estructura del estado de resultados CEIPA, escenario ${escenario}, total CEIPA. Millones de pesos; % sobre el ingreso neto del año.</p>
    <div class="tabla-cont"><table><thead><tr><th>Rubro</th>${MESES.map(x => `<th>${x}</th>`).join('')}<th>Año</th><th>%</th></tr></thead><tbody>
    ${filasPyG.map(([k, t, tipo]) => { const tt = suma(k); return `<tr class="${tipo || ''}"><td>${t}</td>${m.map(x => `<td class="${cls(x[k])}">${Mn(x[k])}</td>`).join('')}${k === 'ACC' ? '<td>—</td><td></td>' : `<td class="${cls(tt)}">${Mn(tt)}</td><td>${P(totNET ? tt / totNET : null)}</td>`}</tr>`; }).join('')}
    </tbody></table></div></div>
    <div class="tarjeta"><h2>Flujo de caja mensual ${v.ejercicio} · ${escenario}</h2>
    <p class="nota">Saldo final ${v.ejercicio}: ${M(r.caja.saldoFinal)}; flujo neto del año ${M(fnAnio)}; saldo mínimo ${M(r.caja.saldoMinimo)} en ${MESES[r.caja.mesMinimo]}; ${r.caja.mesesBajoMinimo ? r.caja.mesesBajoMinimo + (r.caja.mesesBajoMinimo === 1 ? ' mes' : ' meses') + ' por debajo' : 'ningún mes por debajo'} del saldo mínimo deseado (${M(CAJA_MINIMO)}).</p>
    ${graficoMensual({ barras: cj.map(x => x.FN), linea: cj.map(x => x.SF), ref: CAJA_MINIMO, etiquetaFinal: true })}
    ${leyenda([['pos', 'Flujo neto positivo'], ['neg', 'Flujo neto negativo'], ['linea', 'Saldo final de caja'], ['ref', `Saldo mínimo deseado (${M(CAJA_MINIMO)})`]])}</div>
    <div class="tarjeta"><h3>Detalle del flujo de caja</h3>
    <p class="nota">Método directo desde el estado de resultados mensual. Supuestos: recaudo 40% anticipado, 35% en el mes, 15% a 30 días y 10% a 60 días; prima en junio y diciembre; cesantías en febrero e intereses de cesantías en enero; proveedores 40% en el mes y 60% a 30 días; capex 4% del ingreso neto. Saldo inicial = efectivo a septiembre 2026. Millones de pesos.</p>
    <div class="tabla-cont"><table><thead><tr><th>Concepto</th>${MESES.map(x => `<th>${x}</th>`).join('')}<th>Año</th></tr></thead><tbody>
    ${caja.map(([k, t, tipo]) => `<tr class="${tipo || ''}"><td>${t}</td>${cj.map(x => `<td class="${cls(x[k])}">${Mn(x[k])}</td>`).join('')}<td class="${cls(totCaja(k))}">${Mn(totCaja(k))}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
