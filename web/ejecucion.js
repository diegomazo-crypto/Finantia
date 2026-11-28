/*
 * Finantia 2.0 · módulo de Ejecución presupuestal.
 *
 * Base de comparación: la versión aprobada del año (sus líneas mensuales) o, para un año que no se
 * presupuestó en Finantia (2026), el informe comparativo del equipo. Cada mes se sube el balance de
 * prueba (Excel o CSV) y el tablero muestra la ejecución a la fecha con semáforos, gráficos, lectura
 * automática, análisis por unidad y drill down rubro → línea → centro de costos y cuenta.
 */
import { $, M, Mn, P, accion, api, app, esc, fecha, modulo, nf0 } from './comun.js';
import { vPreguntasModulo } from './preguntas.js';
import { analizar, interpretar, RUBROS, UMBRAL } from '/motor/ejecucion.js';

const MESES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_C = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const COLOR = { verde: 'En línea', amarillo: 'Alerta', rojo: 'Desviación', azul: 'Baja ejecución', gris: 'Sin movimiento' };
const sem = (c, txt = true) => `<span class="sem ${c}" title="${COLOR[c] || ''}"></span>${txt ? `<span class="sem-t">${COLOR[c] || ''}</span>` : ''}`;
const TOTALES = new Set(['NET', 'MB', 'RO', 'RN']);
/** % de ejecución, salvo en resultados con presupuesto negativo o cero (ahí se lee la diferencia). */
const pctTxt = r => (r.pct == null || (r.tipo === 'ingreso' && (r.ppto <= 0 || r.real < 0)) ? '—' : P(r.pct));

const est = { anio: null, hasta: null, unidad: null, abiertos: new Set(), serie: 'NET', modo: 'mes', vista: 'tablero' };

export async function pantallaEjecucion(anio) {
  const anios = await api('GET', '/api/ejecucion');
  const hoy = new Date().getFullYear();
  if (!anio) anio = anios.includes(hoy) ? hoy : anios[0] || hoy;
  if (est.anio !== anio) Object.assign(est, { anio, hasta: null, unidad: null, abiertos: new Set() });
  const t = await api('GET', `/api/ejecucion/${anio}`);
  const mod = modulo('EJECUCION'), lista = [...new Set([anio, ...anios])].sort((a, b) => a - b);
  app.innerHTML = `
    <div class="cabeza"><div><div class="miga">Ejecución presupuestal</div><h1>Seguimiento a la ejecución ${anio}</h1>
      <p class="nota">${t.base ? 'Base de comparación: ' + esc(t.base.descripcion) : 'Todavía no hay base de comparación para este año.'}</p></div></div>
    ${lista.length > 1 ? `<nav class="pestanas" aria-label="Años">${lista.map(a => `<a href="#/ejecucion/${a}" ${a === anio ? 'aria-current="page"' : ''}>${a}</a>`).join('')}</nav>` : ''}
    ${mod.preguntas ? `<div class="botonera" role="group" aria-label="Vista">${[['tablero', 'Tablero'], ['preguntas', 'Preguntas']].map(([k, tt]) => `<button type="button" class="btn chico ${k === est.vista ? 'primario' : ''}" data-vista="${k}" aria-pressed="${k === est.vista}">${tt}</button>`).join('')}</div>` : ''}
    <section id="ej-cuerpo"></section>
    <section id="ej-archivos"></section>`;
  app.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => { est.vista = b.dataset.vista; pantallaEjecucion(anio); });
  if (mod.preguntas && est.vista === 'preguntas') return vPreguntasModulo($('#ej-cuerpo'), {
    titulo: `Preguntas sobre la ejecución ${anio}`,
    nota: 'El asistente (Claude) responde con lo que muestra el tablero: real contra presupuesto a la fecha por rubro, por mes y por unidad, con sus semáforos. No recibe centros de costos, cuentas, terceros ni nómina por persona.',
    historial: `/api/preguntas/EJECUCION/${anio}`, enviar: `/api/preguntas/EJECUCION/${anio}`,
    sugerencias: ['¿Qué rubros se están pasando del presupuesto y por cuánto?', '¿Qué unidad va peor frente al presupuesto y por qué?', '¿Cómo vamos en ingresos netos a la fecha?', '¿Cuál fue el peor mes y qué lo explica?']
  });
  vArchivos($('#ej-archivos'), t, mod);
  vTablero($('#ej-cuerpo'), t, mod);
}

/* ------------------------------------------------------------------ tablero */
function vTablero(c, t, mod) {
  const cargados = t.meses.map(m => m.mes);
  if (!t.base || !cargados.length) {
    c.innerHTML = `<div class="tarjeta"><h2>Cómo empezar</h2><ol class="pasos">
      <li${t.base ? ' class="hecho"' : ''}>Base de comparación: ${t.base ? 'lista.' : `cuando se apruebe el presupuesto del año en Finantia, esa versión queda como base. Para ${t.anio}, que se presupuestó fuera, suba abajo el Excel del informe mensual (hoja "Informe Finan comparativo").`}</li>
      <li${cargados.length ? ' class="hecho"' : ''}>Balance de prueba del mes en Excel o CSV (el de Contai sirve tal cual). Si sube solo el último mes, los meses anteriores se completan con su saldo anterior.</li></ol></div>`;
    return;
  }
  const ultimo = Math.max(...cargados);
  if (!est.hasta || est.hasta > ultimo) est.hasta = ultimo;
  const d = { L: t.lineas.L, LN: t.lineas.LN };
  const u = est.unidad, nombres = t.lineas.names;
  const a = analizar(d, t.P, t.R, { hasta: est.hasta, unidad: u });
  const porUnidad = nombres.map((nombre, j) => { const x = analizar(d, t.P, t.R, { hasta: est.hasta, unidad: j }); const r = Object.fromEntries(x.rubros.map(y => [y.k, y])); return { j, nombre, r, difRN: r.RN.dif }; });
  const r = Object.fromEntries(a.rubros.map(x => [x.k, x]));
  const lectura = interpretar(a, { meses: MESES_L, nombreUnidad: u == null ? null : nombres[u], porUnidad: u == null ? porUnidad : null });
  const sinCC = t.meses.filter(m => !m.conCC && m.mes <= est.hasta), estim = (t.estimados || []).filter(m => m <= est.hasta);
  const sinClas = t.meses.filter(m => m.mes <= est.hasta).reduce((s, m) => s + (m.sinClasificar || 0), 0);
  const avisos = [];
  if (estim.length) avisos.push(`${rango(estim)} se completó con el saldo anterior del balance de ${MESES_L[Math.min(...cargados.filter(m => m > Math.max(...estim)))- 1]}: el acumulado es exacto; la distribución mes a mes de esos meses sigue la estacionalidad del presupuesto.`);
  if (sinCC.length) avisos.push(`El balance ${sinCC.length > 1 ? 'de algunos meses' : 'de ' + MESES_L[sinCC[0].mes - 1]} no trae centro de costos (es por tercero): los totales son exactos, pero el reparto por unidad se estima con la participación de cada cuenta en el auxiliar 2026 y ESIC queda dentro de Pregrado (sus ingresos y descuentos se compensan; el neto casi no cambia). Para el análisis exacto por unidad, suba el balance de prueba por centro de costos.`);
  if (Math.abs(sinClas) >= 1e6) avisos.push(`${M(Math.abs(sinClas))} de movimiento quedó sin clasificar (cuentas o centros de costos que no estaban en el reparto 2026)${t.sensible ? '; ver la lista al final' : ''}.`);

  c.innerHTML = `
    <div class="tarjeta filtros"><div class="formfila">
      <label class="campo">Acumulado a <select id="ej-hasta">${cargados.concat(estim).sort((x, y) => x - y).filter((m, i, s) => s.indexOf(m) === i).map(m => `<option value="${m}" ${m === est.hasta ? 'selected' : ''}>${MESES_L[m - 1]}</option>`).join('')}</select></label>
      <label class="campo">Unidad <select id="ej-unidad"><option value="">Toda la institución</option>${nombres.map((n, j) => `<option value="${j}" ${j === u ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <span class="nota leyenda-sem">${['verde', 'amarillo', 'rojo', 'azul'].map(k => sem(k)).join(' ')}</span>
    </div>${avisos.length ? `<ul class="avisos">${avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>

    <div class="kpis">${[['NET', 'Ingresos netos'], ['CD', 'Costos directos'], ['GO', 'Gastos de operación'], ['RO', 'Resultado de operación'], ['RN', 'Resultado neto']].map(([k, tt]) => {
      const x = r[k];
      return `<div class="kpi sem-borde ${x.color}"><small>${sem(x.color, false)} ${tt} a ${MESES_L[est.hasta - 1]}</small><b class="${x.real < 0 ? 'neg' : ''}">${M(x.real)}</b>
        <small>Presupuesto ${M(x.ppto)} · ${TOTALES.has(k) || x.tipo === 'ingreso' ? (x.dif >= 0 ? 'mejor' : 'peor') : (x.dif > 0 ? 'por encima' : 'por debajo')} en ${M(Math.abs(x.dif))}${pctTxt(x) !== '—' ? ' · ' + pctTxt(x) : ''}</small></div>`;
    }).join('')}</div>

    <div class="tarjeta"><h2>Lectura del resultado${u == null ? '' : ' · ' + esc(nombres[u])}</h2>${u != null && sinCC.length ? '<p class="alerta-est"><b>Estimado.</b> Sin centro de costos en el balance, las cifras de una unidad son una aproximación.</p>' : ''}${lectura.map(p => `<p class="parrafo">${esc(p)}</p>`).join('')}</div>

    <div class="rejilla dos">
      <div class="tarjeta"><h3>Ejecución por rubro a ${MESES_L[est.hasta - 1]}</h3>${graficoRubros(a.rubros)}
        <p class="nota">Barra: real sobre presupuesto a la fecha. Línea: 100 %. En costos y gastos, por encima de ${Math.round(UMBRAL.gasVerde * 100)} % es alerta y de ${Math.round(UMBRAL.gasAmarillo * 100)} % desviación; por debajo de ${Math.round(UMBRAL.baja * 100)} %, baja ejecución. En ingresos, por debajo de ${Math.round(UMBRAL.ingVerde * 100)} % es alerta y de ${Math.round(UMBRAL.ingAmarillo * 100)} % desviación.</p></div>
      <div class="tarjeta"><h3>Mes a mes</h3>
        <div class="botonera"><div role="group" aria-label="Cifra">${[['NET', 'Ingresos netos'], ['RN', 'Resultado neto']].map(([k, tt]) => `<button type="button" class="btn chico ${est.serie === k ? 'primario' : ''}" data-serie="${k}" aria-pressed="${est.serie === k}">${tt}</button>`).join('')}</div>
          <div role="group" aria-label="Vista">${[['mes', 'Cada mes'], ['acum', 'Acumulado']].map(([k, tt]) => `<button type="button" class="btn chico ${est.modo === k ? 'primario' : ''}" data-modo="${k}" aria-pressed="${est.modo === k}">${tt}</button>`).join('')}</div></div>
        ${graficoMeses(a.serie, est.serie, t.estimados || [], est.modo)}
        <div class="leyenda">${est.modo === 'acum' ? '<span><b class="l-ppto"></b>Presupuesto acumulado</span><span><b class="real"></b>Real acumulado</span>' : `<span><b class="ppto"></b>Presupuesto del mes</span><span><b class="real"></b>Real del mes</span>${(t.estimados || []).length ? '<span><b class="estimado"></b>Real estimado (saldo anterior)</span>' : ''}`}</div>
        <p class="nota">Pase el mouse (o toque) un mes para ver las cifras. En millones de pesos.</p></div>
    </div>

    ${u == null ? `<div class="tarjeta"><h2>Semáforo por unidad</h2>${sinCC.length ? '<p class="alerta-est"><b>Estimado.</b> El balance no trae centro de costos: el reparto entre unidades (sobre todo Barranquilla, que usa las mismas cuentas que Sabaneta) puede alejarse bastante del real. Úselo como referencia hasta tener el balance por centro de costos.</p>' : ''}<p class="nota">Toque una unidad para ver su análisis.</p>
      <div class="tabla-cont"><table id="ej-unidades"><thead><tr><th>Unidad</th><th>Ingresos netos</th><th>% ejec.</th><th>Costos directos</th><th>% ejec.</th><th>Gastos de operación</th><th>% ejec.</th><th>Resultado neto</th><th>Ppto. a la fecha</th><th>Diferencia</th></tr></thead><tbody>
      ${porUnidad.map(({ j, nombre, r: x }) => `<tr><td><button type="button" class="enlace" data-unidad="${j}">${esc(nombre)}</button></td>
        <td>${M(x.NET.real)}</td><td>${sem(x.NET.color, false)} ${pctTxt(x.NET)}</td><td>${M(x.CD.real)}</td><td>${sem(x.CD.color, false)} ${pctTxt(x.CD)}</td>
        <td>${M(x.GO.real)}</td><td>${sem(x.GO.color, false)} ${pctTxt(x.GO)}</td><td class="${x.RN.real < 0 ? 'neg' : ''}">${M(x.RN.real)}</td><td>${M(x.RN.ppto)}</td>
        <td class="${x.RN.dif < 0 ? 'neg' : 'pos'}">${sem(x.RN.color, false)} ${x.RN.dif >= 0 ? '+' : ''}${M(x.RN.dif)}</td></tr>`).join('')}
      </tbody></table></div><p class="nota">Lo que no se asigna a una unidad (gastos institucionales sin centro de costos de unidad) se reparte con la participación de cada unidad en el presupuesto de la línea, como en el informe.</p></div>` : ''}

    <div class="rejilla">
      ${lista('Se pasan del presupuesto', 'Costos, gastos y descuentos por encima de lo presupuestado a la fecha.', a.lineas.filter(l => l.tipo === 'gasto' && l.dif > 0 && (l.sobre || l.sinPpto) && Math.abs(l.dif) >= 5e6).sort((x, y) => y.dif - x.dif), l => `+${M(l.dif)}`)}
      ${lista('Ingresos por debajo', 'Líneas de ingreso con menos de lo presupuestado.', a.lineas.filter(l => l.tipo === 'ingreso' && l.dif < 0 && (l.color === 'rojo' || l.color === 'amarillo') && Math.abs(l.dif) >= 5e6).sort((x, y) => x.dif - y.dif), l => M(l.dif))}
      ${lista('Baja ejecución', `Costos y gastos por debajo de ${Math.round(UMBRAL.baja * 100)} %: ¿ahorro o gasto que se concentrará al final del año?`, a.lineas.filter(l => l.tipo === 'gasto' && l.baja && l.ppto > 20e6).sort((x, y) => x.dif - y.dif), l => `${M(-l.dif)} sin ejecutar`)}
    </div>

    <div class="tarjeta"><h2>Estado de resultados: presupuesto frente a real${u == null ? '' : ' · ' + esc(nombres[u])}</h2>
      <p class="nota">Toque un rubro para ver sus líneas${t.sensible ? ' y una línea para ver los centros de costos y las cuentas' : ''}.</p>
      <div class="tabla-cont"><table id="ej-eerr"><thead><tr><th>Rubro</th><th>Ppto. a ${MES_C[est.hasta - 1]}</th><th>Real a ${MES_C[est.hasta - 1]}</th><th>Diferencia</th><th>% ejec.</th><th>Semáforo</th><th>Ppto. anual</th><th>% del anual</th></tr></thead><tbody>
      ${filasEerr(a, t.sensible)}</tbody></table></div></div>

    ${t.sensible && Math.abs(sinClas) >= 1 ? `<div class="tarjeta"><h3>Sin clasificar</h3><p class="nota">Movimiento de cuentas de resultados que no estaba en el reparto 2026. No entra en el análisis hasta que se asigne.</p><div id="ej-sin"><button type="button" class="btn" id="ej-ver-sin">Ver la lista</button></div></div>` : ''}`;

  $('#ej-hasta').onchange = e => { est.hasta = Number(e.target.value); vTablero(c, t, mod); };
  $('#ej-unidad').onchange = e => { est.unidad = e.target.value === '' ? null : Number(e.target.value); est.abiertos.clear(); vTablero(c, t, mod); };
  c.querySelectorAll('[data-unidad]').forEach(b => b.onclick = () => { est.unidad = Number(b.dataset.unidad); est.abiertos.clear(); vTablero(c, t, mod); c.scrollIntoView({ behavior: 'smooth' }); });
  c.querySelectorAll('[data-serie]').forEach(b => b.onclick = () => { est.serie = b.dataset.serie; vTablero(c, t, mod); });
  c.querySelectorAll('[data-modo]').forEach(b => b.onclick = () => { est.modo = b.dataset.modo; vTablero(c, t, mod); });
  activarTip(c, a.serie, est.serie, t.estimados || []);
  c.querySelectorAll('[data-rubro]').forEach(b => b.onclick = () => { const k = 'r:' + b.dataset.rubro; est.abiertos.has(k) ? est.abiertos.delete(k) : est.abiertos.add(k); vTablero(c, t, mod); });
  c.querySelectorAll('[data-linea]').forEach(b => b.onclick = () => abrirLinea(b, t));
  $('#ej-ver-sin')?.addEventListener('click', async () => {
    const xs = await accion(() => api('GET', `/api/ejecucion/${t.anio}/sin-clasificar?hasta=${est.hasta}`));
    $('#ej-sin').innerHTML = xs.length ? `<div class="tabla-cont"><table><thead><tr><th>Cuenta</th><th class="izq">Nombre</th><th>Centro de costos</th><th>Movimiento</th></tr></thead><tbody>
      ${xs.slice(0, 200).map(s => `<tr><td>${esc(s.cuenta)}</td><td class="izq">${esc(s.nombre)}</td><td>${esc(s.cc ? s.cc + ' ' + (s.nombreCC || '') : '—')}</td><td>${M(s.valor)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="nota">Nada.</p>';
  });
}

const rango = ms => (ms.length === 1 ? MESES_L[ms[0] - 1] : `${MESES_L[Math.min(...ms) - 1]} a ${MESES_L[Math.max(...ms) - 1]}`).replace(/^./, x => x.toUpperCase());

function lista(titulo, nota, xs, valor) {
  return `<div class="tarjeta"><h3>${titulo}</h3><p class="nota">${nota}</p>${xs.length ? `<ul class="lista-v alertas">${xs.slice(0, 8).map(l => `<li>${sem(l.color, false)}<span class="nombre">${esc(l.nombre)}</span><span class="der">${valor(l)}${l.pct != null && l.ppto > 0 ? ' · ' + P(l.pct) : l.sinPpto ? ' · sin presupuesto' : ''}</span></li>`).join('')}</ul>` : '<p class="nota">Ninguna.</p>'}</div>`;
}

function filasEerr(a, sensible) {
  const out = [];
  const lineasDe = k => a.lineas.filter(l => l.rubro === k || (k === 'IB' && l.codigo === 'IB') || (k === 'DS' && l.codigo === 'DS'));
  for (const x of a.rubros) {
    const tot = x.nivel === 'total' || x.nivel === 'sub', abierto = est.abiertos.has('r:' + x.k), hijos = tot ? [] : lineasDe(x.k);
    out.push(`<tr class="${x.nivel === 'total' ? 'total' : x.nivel === 'sub' ? 'sub' : ''}"><td>${hijos.length ? `<button type="button" class="enlace" data-rubro="${x.k}" aria-expanded="${abierto}">${abierto ? '▾' : '▸'} ${esc(x.t)}</button>` : esc(x.t)}</td>${celdas(x)}</tr>`);
    if (abierto) for (const l of hijos.sort((p, q) => Math.abs(q.ppto) + Math.abs(q.real) - Math.abs(p.ppto) - Math.abs(p.real)))
      out.push(`<tr class="hijo n1"><td>${sensible ? `<button type="button" class="enlace" data-linea="${l.li}" aria-expanded="false">${esc(l.nombre)}</button>` : esc(l.nombre)}</td>${celdas(l)}</tr>`);
  }
  return out.join('');
}
const celdas = x => `<td>${M(x.ppto)}</td><td>${M(x.real)}</td><td class="${(x.tipo === 'gasto' ? -x.dif : x.dif) < 0 ? 'neg' : ''}">${x.dif >= 0 ? '+' : ''}${M(x.dif)}</td><td>${pctTxt(x)}</td><td class="izq">${sem(x.color)}</td><td>${M(x.anual)}</td><td>${x.anual && !(x.tipo === 'ingreso' && x.anual <= 0) ? P(x.real / x.anual) : '—'}</td>`;

/* Drill down de una línea: centros de costos y cuentas (detalle sensible) */
function abrirLinea(b, t) {
  const tr = b.closest('tr'), li = Number(b.dataset.linea), sig = tr.nextElementSibling;
  if (sig?.classList.contains('det-cc')) { sig.remove(); b.setAttribute('aria-expanded', 'false'); return; }
  b.setAttribute('aria-expanded', 'true');
  const fila = document.createElement('tr'); fila.className = 'hijo n2 det-cc'; fila.innerHTML = `<td colspan="8" class="izq">Cargando…</td>`; tr.after(fila);
  const q = new URLSearchParams({ hasta: est.hasta }); if (est.unidad != null) q.set('unidad', est.unidad);
  api('GET', `/api/ejecucion/${t.anio}/lineas/${li}?${q}`).then(xs => {
    fila.innerHTML = `<td colspan="8" class="izq">${xs.length ? `<table class="interna"><thead><tr><th>Centro de costos</th><th class="izq">Cuenta</th>${MES_C.slice(0, est.hasta).map(m => `<th>${m}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${xs.slice(0, 60).map(x => `<tr><td class="izq">${x.cc ? esc(x.cc + ' · ' + x.nombreCC) : '<i>sin centro de costos</i>'}</td><td class="izq">${esc(x.cuenta + ' · ' + x.nombreCuenta)}</td>${x.meses.slice(0, est.hasta).map(v => `<td>${Mn(v)}</td>`).join('')}<td><b>${Mn(x.valor)}</b></td></tr>`).join('')}
      </tbody></table>${xs.length > 60 ? `<p class="nota">Se muestran 60 de ${nf0.format(xs.length)}.</p>` : ''}<p class="nota">Cifras en millones, solo los meses con balance cargado (los estimados con saldo anterior no tienen detalle).</p>` : '<span class="nota">Sin movimiento en el balance.</span>'}</td>`;
  }).catch(e => { fila.innerHTML = `<td colspan="8" class="izq neg">${esc(e.message)}</td>`; });
}

/* ------------------------------------------------------------------ gráficos (SVG, sin estilos en línea por la CSP) */
function graficoRubros(rubros) {
  const xs = rubros.filter(x => x.nivel === 'det' && (Math.abs(x.ppto) >= 1e6 || Math.abs(x.real) >= 1e6));
  const W = 560, fila = 26, T = 8, L = 210, R = 70, H = T + xs.length * fila + 22, MAX = 1.6;
  const X = p => L + Math.max(0, Math.min(MAX, p)) / MAX * (W - L - R);
  return `<div class="tabla-cont"><svg class="grafico barras-h" viewBox="0 0 ${W} ${H}" role="img" aria-label="Porcentaje de ejecución por rubro">
    ${[0, 0.5, 1, 1.5].map(p => `<line class="${p === 1 ? 'ref' : 'eje'}" x1="${X(p)}" x2="${X(p)}" y1="${T - 4}" y2="${H - 18}"/><text class="tick" x="${X(p)}" y="${H - 4}" text-anchor="middle">${p * 100} %</text>`).join('')}
    ${xs.map((x, i) => {
      const y = T + i * fila, p = x.pct ?? (x.sinPpto ? MAX : 0);
      return `<text class="et" x="${L - 8}" y="${y + 16}" text-anchor="end">${esc(x.t.length > 30 ? x.t.slice(0, 29) + '…' : x.t)}</text>
        <rect class="b ${x.color}" x="${L}" y="${y + 5}" width="${Math.max(1, X(p) - L)}" height="15" rx="3"><title>${esc(x.t)}: ${M(x.real)} de ${M(x.ppto)}</title></rect>
        <text class="v" x="${Math.min(X(p), W - R) + 6}" y="${y + 16}">${x.pct == null ? (x.sinPpto ? 'sin ppto.' : '—') : Math.round(x.pct * 100) + ' %'}${p > MAX ? ' ›' : ''}</text>`;
    }).join('')}</svg></div>`;
}

/**
 * Mes a mes: presupuesto (gris) y real (color) de cada mes, o las dos curvas acumuladas.
 * Al pasar el mouse (o tocar) un mes se ven sus cifras.
 */
function datosMeses(serie, k, estimados) {
  let ap = 0, ar = 0;
  return serie.map((s, m) => {
    const p = s['p' + k], r = s['r' + k];
    ap += p; if (r != null) ar += r;
    return { m, p, r, ap, ar: r != null ? ar : null, est: estimados.includes(m + 1) };
  });
}
function graficoMeses(serie, k, estimados, modo) {
  const d = datosMeses(serie, k, estimados);
  const W = 640, H = 270, L = 58, R = 12, T = 14, B = 28, bw = (W - L - R) / 12;
  const vals = modo === 'acum' ? [0, ...d.map(x => x.ap), ...d.filter(x => x.ar != null).map(x => x.ar)] : [0, ...d.map(x => x.p), ...d.filter(x => x.r != null).map(x => x.r)];
  let lo = Math.min(...vals), hi = Math.max(...vals); if (hi === lo) hi = lo + 1;
  const paso = (() => { const r = (hi - lo) / 4, e = 10 ** Math.floor(Math.log10(r)), f = r / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; })();
  lo = Math.floor(lo / paso) * paso; hi = Math.ceil(hi / paso) * paso;
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B), px = m => L + m * bw, cx = m => px(m) + bw / 2;
  const marcas = []; for (let v = lo; v <= hi + paso / 2; v += paso) marcas.push(v);
  const barra = (v, x0, w, c) => `<rect class="${c}${v < 0 ? ' neg' : ''}" x="${x0}" y="${y(Math.max(0, v))}" width="${w}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" rx="2"/>`;
  const reales = d.filter(x => x.ar != null);
  const cuerpo = modo === 'acum'
    ? `<polyline class="l-ppto" points="${d.map(x => `${cx(x.m)},${y(x.ap)}`).join(' ')}"/>
       <polyline class="l-real" points="${reales.map(x => `${cx(x.m)},${y(x.ar)}`).join(' ')}"/>
       ${reales.map(x => `<circle class="p-real${x.est ? ' est' : ''}" cx="${cx(x.m)}" cy="${y(x.ar)}" r="3.5"/>`).join('')}
       ${reales.length ? (() => { const u = reales[reales.length - 1]; return `<text class="final" x="${cx(u.m)}" y="${y(u.ar) - 10}" text-anchor="middle">${Mn(u.ar)}</text>`; })() : ''}`
    : d.map(x => barra(x.p, px(x.m) + bw * 0.14, bw * 0.34, 'ppto') + (x.r == null ? '' : barra(x.r, px(x.m) + bw * 0.52, bw * 0.34, x.est ? 'estimado' : 'real'))).join('');
  return `<div class="tabla-cont mes-graf"><svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="${k === 'NET' ? 'Ingresos netos' : 'Resultado neto'} ${modo === 'acum' ? 'acumulado' : 'por mes'}, presupuesto y real">
    ${marcas.map(v => `<line class="eje${Math.abs(v) < paso / 2 ? ' cero' : ''}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Mn(v)}</text>`).join('')}
    ${cuerpo}
    ${MES_C.map((t, m) => `<text class="tick" x="${cx(m)}" y="${H - 9}" text-anchor="middle">${t}</text>`).join('')}
    ${d.map(x => `<rect class="zona" data-mes="${x.m}" x="${px(x.m)}" y="${T}" width="${bw}" height="${H - T - B}" tabindex="0" aria-label="${MESES_L[x.m]}"/>`).join('')}
  </svg><div class="tip" hidden></div></div>`;
}
/** Cuadro con las cifras del mes bajo el mouse o el dedo. */
function activarTip(c, serie, k, estimados) {
  const cont = c.querySelector('.mes-graf'); if (!cont) return;
  const d = datosMeses(serie, k, estimados), tip = cont.querySelector('.tip');
  const fila = (t, v, cl = '') => `<div><span>${t}</span><b class="${cl}">${M(v)}</b></div>`;
  const mostrar = z => {
    const x = d[Number(z.dataset.mes)], dif = x.r == null ? null : x.r - x.p, difA = x.ar == null ? null : x.ar - x.ap;
    const bien = v => (v == null ? '' : v >= 0 ? 'pos' : 'neg');
    tip.innerHTML = `<h4>${MESES_L[x.m].replace(/^./, l => l.toUpperCase())}${x.est ? ' <small>(estimado)</small>' : ''}</h4>
      <p>Del mes</p>${fila('Presupuesto', x.p)}${x.r == null ? '<div><span>Real</span><b>sin balance</b></div>' : fila('Real', x.r) + fila('Diferencia', dif, bien(dif))}
      <p>Acumulado</p>${fila('Presupuesto', x.ap)}${x.ar == null ? '' : fila('Real', x.ar) + fila('Diferencia', difA, bien(difA))}`;
    tip.hidden = false;
    cont.querySelectorAll('.zona').forEach(o => o.classList.toggle('activa', o === z));
    const cr = cont.getBoundingClientRect(), zr = z.getBoundingClientRect();
    const izq = zr.left - cr.left + cont.scrollLeft + zr.width / 2, ancho = tip.offsetWidth;
    tip.style.left = Math.max(4, Math.min(izq - ancho / 2, cont.scrollWidth - ancho - 4)) + 'px';
  };
  cont.querySelectorAll('.zona').forEach(z => {
    z.addEventListener('mouseenter', () => mostrar(z)); z.addEventListener('focus', () => mostrar(z)); z.addEventListener('click', () => mostrar(z));
  });
  cont.addEventListener('mouseleave', () => { tip.hidden = true; cont.querySelectorAll('.zona').forEach(o => o.classList.remove('activa')); });
}

/* ------------------------------------------------------------------ archivos del año */
function vArchivos(c, t, mod) {
  const edita = mod?.editar, porMes = new Map(t.meses.map(m => [m.mes, m]));
  const sig = Math.min(12, (t.meses.length ? Math.max(...t.meses.map(m => m.mes)) : 0) + 1);
  c.innerHTML = `<div class="tarjeta"><h2>Archivos de ${t.anio}</h2>
    <h3>Base de comparación</h3>
    <p class="nota">${t.base ? esc(t.base.descripcion) : 'Sin base.'} ${t.base?.origen === 'version' ? '' : 'Cuando el presupuesto del año se apruebe en Finantia, esa versión reemplaza al informe como base.'}</p>
    ${edita && t.base?.origen !== 'version' ? `<div class="formfila"><label class="campo">Informe mensual del equipo (Excel con la hoja "Informe Finan comparativo")<input type="file" id="ej-base" accept=".xlsx"></label>
      ${t.base ? '<button type="button" class="btn peligro" id="ej-quitar-base">Quitar el informe</button>' : ''}</div>` : ''}
    <h3>Balances de prueba</h3>
    <div class="meses-rej">${MES_C.map((m, i) => {
      const x = porMes.get(i + 1), e = (t.estimados || []).includes(i + 1);
      return `<div class="mes-c ${x ? 'cargado' : e ? 'estimado' : ''}"><b>${m}</b><small>${x ? `${esc(x.nombre)}<br>${fecha(x.cargadoEn)}${x.conCC ? '' : '<br>sin centro de costos'}` : e ? 'estimado con saldo anterior' : 'sin balance'}</small>
        ${x && edita ? `<button type="button" class="btn chico peligro" data-borrar-mes="${i + 1}">Quitar</button>` : ''}</div>`;
    }).join('')}</div>
    ${edita ? `<div class="formfila"><label class="campo">Mes <select id="ej-mes">${MESES_L.map((m, i) => `<option value="${i + 1}" ${i + 1 === sig ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="campo">Balance de prueba (Excel o CSV)<input type="file" id="ej-balance" accept=".xlsx,.csv,.txt"></label></div>
      <p class="nota">Sirve el balance de prueba de Contai (por NIT o por centro de costos) o cualquier archivo con Cuenta y Movimiento, o Débitos y Créditos, o Saldo anterior y Saldo final. Solo se guardan las cuentas de resultados (clases 4 a 7) sin terceros. Un balance nuevo del mismo mes reemplaza al anterior.</p>` : ''}
  </div>`;
  const subir = async (input, ruta, ok) => {
    const f = input.files[0]; if (!f) return;
    input.disabled = true;
    try { await accion(() => api('POST', ruta(), f, { cab: { 'X-Nombre': encodeURIComponent(f.name) } }), ok); await pantallaEjecucion(t.anio); }
    catch { input.disabled = false; input.value = ''; }
  };
  $('#ej-base')?.addEventListener('change', e => subir(e.target, () => `/api/ejecucion/${t.anio}/base`, 'Informe cargado como base de comparación'));
  $('#ej-balance')?.addEventListener('change', e => subir(e.target, () => `/api/ejecucion/${t.anio}/meses/${$('#ej-mes').value}`, 'Balance cargado'));
  $('#ej-quitar-base')?.addEventListener('click', confirmar(() => api('DELETE', `/api/ejecucion/${t.anio}/base`), 'Informe retirado', t));
  c.querySelectorAll('[data-borrar-mes]').forEach(b => b.addEventListener('click', confirmar(() => api('DELETE', `/api/ejecucion/${t.anio}/meses/${b.dataset.borrarMes}`), 'Balance retirado', t)));
}
/** Dos toques: el primero pide confirmar. */
const confirmar = (fn, ok, t) => async e => {
  const b = e.currentTarget;
  if (!b.dataset.seguro) { b.dataset.seguro = '1'; b.dataset.txt = b.textContent; b.textContent = '¿Seguro? Toque de nuevo'; setTimeout(() => { delete b.dataset.seguro; b.textContent = b.dataset.txt; }, 4000); return; }
  try { await accion(fn, ok); await pantallaEjecucion(t.anio); } catch { /* aviso ya mostrado */ }
};
