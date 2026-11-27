/*
 * Finantia 2.0 · módulo de Planeación financiera.
 *
 * Por ahora: el resultado mensual y el flujo de caja del presupuesto (la versión aprobada del
 * ejercicio o, si no hay, la última), con el mismo detalle de Finantia Admon 1.0.
 * Después: saldos de bancos semanales y proyección del mes por semana.
 */
import { $, EERR, ESCS, M, MESES, Mn, P, almacen, api, app, cls, esc, fecha, modulo, ESTADOS, ROLES } from './comun.js';

export async function pantallaPlaneacion(anio, versionId) {
  const q = new URLSearchParams(); if (anio) q.set('ejercicio', anio); if (versionId) q.set('version', versionId);
  const d = await api('GET', '/api/planeacion/flujo' + (q.size ? '?' + q : ''));
  const mod = modulo('PLANEACION'), v = d.version;
  const esc0 = almacen.leer('finantia.escenario');
  const escenario = ESCS.includes(esc0) ? esc0 : (v?.escenario_oficial || 'Moderado');
  app.innerHTML = `
    <div class="cabeza"><div><div class="miga">Planeación financiera</div><h1>Resultado mensual y flujo de caja${d.ejercicio ? ' ' + d.ejercicio : ''}</h1>
      <p class="nota">Su rol: ${esc(ROLES[mod.rol] || 'Superusuario')}${v ? ` · Fuente: presupuesto ${d.ejercicio}, V${v.numero} · ${esc(v.nombre)} <span class="estado ${v.estado}">${ESTADOS[v.estado]}</span>${v.escenario_oficial ? ' · escenario oficial: ' + v.escenario_oficial : ''}` : ''}</p></div>
      ${v ? `<div class="acciones" role="group" aria-label="Escenario">${ESCS.map(e => `<button type="button" class="btn ${e === escenario ? 'primario' : ''}" data-esc="${e}" aria-pressed="${e === escenario}">${e}</button>`).join('')}</div>` : ''}
    </div>
    ${d.ejercicios.length ? `<nav class="pestanas" aria-label="Ejercicios">${d.ejercicios.map(a => `<a href="#/planeacion/${a}" ${a === d.ejercicio ? 'aria-current="page"' : ''}>${a}</a>`).join('')}</nav>` : ''}
    ${d.versiones.length > 1 ? `<div class="fila-drill"><label>Versión del presupuesto <select id="pl-version">${d.versiones.map(x => `<option value="${x.id}" ${x.id === v?.id ? 'selected' : ''}>V${x.numero} · ${esc(x.nombre)} (${ESTADOS[x.estado]})</option>`).join('')}</select></label>
      <span class="nota">Por defecto se usa la versión aprobada; si no hay, la última.</span></div>` : ''}
    <section id="pl-cuerpo"></section>
    <div class="tarjeta"><h3>Lo que sigue en este módulo</h3><p class="nota">Saldos de bancos semanales y proyección del mes por semana. Se definirán con usted antes de construirlos.</p></div>`;
  const cuerpo = $('#pl-cuerpo');
  if (!d.ejercicios.length) cuerpo.innerHTML = '<div class="tarjeta"><p class="nota">Todavía no hay ejercicios presupuestales.</p></div>';
  else if (!v || !v.resultados[escenario]) cuerpo.innerHTML = '<div class="tarjeta"><p class="nota">Este ejercicio todavía no tiene una versión del presupuesto calculada.</p></div>';
  else vMensual(cuerpo, v, escenario);
  app.querySelectorAll('[data-esc]').forEach(b => b.onclick = () => { almacen.poner('finantia.escenario', b.dataset.esc); pantallaPlaneacion(d.ejercicio, v.id); });
  $('#pl-version')?.addEventListener('change', e => { location.hash = `#/planeacion/${d.ejercicio}/${e.target.value}`; });
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
