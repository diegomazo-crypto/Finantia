/* Finantia 2.0 · pantallas (JavaScript sin dependencias). Rutas con #/… */

import { vIngresos, vCosto, vSensibilidad, vPreguntas, vArchivos, detalleLineas } from './analisis.js';
import { vNomina, vEvaluacion } from './sensible.js';
import { pantallaPlaneacion } from './planeacion.js';
import { $, ACCIONES, EERR, ESCS, ESTADOS, M, MESES, Mn, P, ROLES, accion, almacen, anchos, api, app, aviso, cls, esc, fecha, ganchos, kpi, modulo, nf0, nf1, sesion } from './comun.js';

async function iniciar() {
  sesion.config = await api('GET', '/api/config');
  if (sesion.config.modo === 'entra') {
    await cargarScript('https://alcdn.msauth.net/browser/2.38.3/js/msal-browser.min.js');
    sesion.msal = new window.msal.PublicClientApplication({
      auth: { clientId: sesion.config.clientId, authority: `https://login.microsoftonline.com/${sesion.config.tenant}`, redirectUri: location.origin + '/' },
      cache: { cacheLocation: 'sessionStorage' }
    });
    const vuelta = await sesion.msal.handleRedirectPromise();
    const cuenta = vuelta?.account || sesion.msal.getAllAccounts()[0];
    if (cuenta) {
      const t = vuelta?.idToken ? vuelta : await sesion.msal.acquireTokenSilent({ account: cuenta, scopes: ['openid', 'profile', 'email'] }).catch(() => null);
      if (t?.idToken) { sesion.token = t.idToken; return entrar(); }
    }
    return pantallaIngreso();
  }
  sesion.correo = almacen.leer('finantia.correo');
  return sesion.correo ? entrar() : pantallaIngreso();
}

function cargarScript(src) {
  return new Promise((ok, mal) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => mal(new Error('No se pudo cargar el inicio de sesión de Microsoft')); document.head.append(s); });
}

async function entrar() {
  try { sesion.perfil = await api('POST', '/api/ingreso', {}); }
  catch (e) { sesion.correo = null; almacen.poner('finantia.correo', null); return pantallaIngreso(e.message); }
  $('#cabecera').hidden = false;
  $('#quien').textContent = sesion.perfil.nombre;
  window.addEventListener('hashchange', enrutar);
  enrutar();
}

function salir(recargar = true) {
  almacen.poner('finantia.correo', null);
  if (sesion.msal) { sesion.msal.logoutRedirect(); return; }
  if (recargar) location.replace('/#/');
  location.reload();
}
$('#salir').addEventListener('click', () => salir());
ganchos.sinSesion = () => salir(false);

async function pantallaIngreso(error) {
  $('#cabecera').hidden = true;
  const dev = sesion.config.modo === 'desarrollo';
  app.innerHTML = `<div class="ingreso">
    <img src="/marca/finantia.png" alt="Finantia" width="88" height="88">
    <h1>Finantia</h1><p class="nota">Plataforma financiera de la Institución Universitaria CEIPA</p>
    <div class="tarjeta">
      ${error ? `<p class="nota neg">${esc(error)}</p>` : ''}
      ${dev ? `<h3>Modo de desarrollo</h3><p class="nota">Sin Microsoft 365. Elija con qué usuario entrar.</p><div class="usuarios-demo" id="lista-dev">Cargando…</div>`
            : `<p>Ingrese con su cuenta institucional de Microsoft 365.</p><button class="btn primario" id="entrar-ms" type="button">Ingresar con Microsoft</button>`}
    </div></div>`;
  if (!dev) { $('#entrar-ms').onclick = () => sesion.msal.loginRedirect({ scopes: ['openid', 'profile', 'email'] }); return; }
  const us = await api('GET', '/api/desarrollo/usuarios');
  $('#lista-dev').innerHTML = us.map(u => `<button class="btn" type="button" data-correo="${esc(u.correo)}"><b>${esc(u.nombre)}</b><small>${esc(u.correo)}</small></button>`).join('') || '<p class="nota">No hay usuarios.</p>';
  $('#lista-dev').onclick = e => {
    const b = e.target.closest('button[data-correo]'); if (!b) return;
    sesion.correo = b.dataset.correo; almacen.poner('finantia.correo', sesion.correo); entrar();
  };
}

/* ---------- enrutador ---------- */

function pintarMenu(actual) {
  const items = [];
  if (modulo('PRESUPUESTO')) items.push(['presupuesto', 'Presupuesto']);
  if (modulo('PLANEACION')) items.push(['planeacion', 'Planeación financiera']);
  if (sesion.perfil.admin.ver) items.push(['admin', 'Administración']);
  $('#menu').innerHTML = items.map(([k, t]) => `<a href="#/${k}" ${actual === k ? 'aria-current="page"' : ''}>${t}</a>`).join('');
}

async function enrutar() {
  const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [mod, ...resto] = partes;
  pintarMenu(mod);
  try {
    if (!mod) {
      if (modulo('PRESUPUESTO')) return (location.hash = '#/presupuesto');
      if (modulo('PLANEACION')) return (location.hash = '#/planeacion');
      if (sesion.perfil.admin.ver) return (location.hash = '#/admin');
      return sinModulos();
    }
    if (mod === 'presupuesto' && modulo('PRESUPUESTO')) {
      if (resto[0] === 'v') return await pantallaVersion(Number(resto[1]), resto[2] || 'resumen');
      return await pantallaEjercicios(resto[0] ? Number(resto[0]) : null);
    }
    if (mod === 'planeacion' && modulo('PLANEACION')) return await pantallaPlaneacion(resto[0] ? Number(resto[0]) : null, resto[1] ? Number(resto[1]) : null);
    if (mod === 'admin' && sesion.perfil.admin.ver) return await pantallaAdmin(resto[0] || 'usuarios');
    app.innerHTML = '<div class="tarjeta"><h2>No disponible</h2><p class="nota">No tiene acceso a esta sección.</p></div>';
  } catch (e) {
    app.innerHTML = `<div class="tarjeta"><h2>No se pudo cargar</h2><p class="nota">${esc(e.message)}</p></div>`;
  }
}

function sinModulos() {
  app.innerHTML = `<div class="tarjeta"><h2>Bienvenido a Finantia</h2><p class="nota">Su usuario está activo pero todavía no tiene módulos asignados. Pida acceso al superusuario.</p></div>`;
}

/* =========================================================
   PRESUPUESTO · ejercicios y versiones
   ========================================================= */
async function pantallaEjercicios(anio) {
  const mod = modulo('PRESUPUESTO');
  const ejercicios = await api('GET', '/api/presupuesto/ejercicios');
  if (!anio && ejercicios.length) anio = ejercicios[0].anio;
  const versiones = anio ? await api('GET', `/api/presupuesto/ejercicios/${anio}/versiones`) : [];
  const ej = ejercicios.find(e => e.anio === anio);
  const sig = (ejercicios[0]?.anio || new Date().getFullYear()) + 1;

  app.innerHTML = `
    <div class="cabeza"><div><div class="miga">Presupuesto</div><h1>Ejercicios presupuestales</h1>
      <p class="nota">Su rol: ${esc(ROLES[mod.rol] || 'Superusuario')}${mod.aprobar ? ' · puede aprobar' : ''}</p></div>
      <div class="acciones">${mod.editar ? `<button class="btn" id="nuevo-ej" type="button">Abrir ejercicio ${sig}</button>` : ''}</div></div>
    ${ejercicios.length ? `<nav class="pestanas" aria-label="Ejercicios">${ejercicios.map(e => `<a href="#/presupuesto/${e.anio}" ${e.anio === anio ? 'aria-current="page"' : ''}>${e.anio}</a>`).join('')}</nav>` : ''}
    ${ej ? `<div class="tarjeta">
      <div class="cabeza"><h2>Versiones del presupuesto ${anio}</h2><span class="nota">${ej.aprobada ? 'Tiene una versión aprobada' : 'Sin versión aprobada todavía'}</span></div>
      ${versiones.length ? `<ul class="lista-v">${versiones.map(v => `<li>
          <span class="estado ${v.estado}">${ESTADOS[v.estado]}</span>
          <a class="nombre" href="#/presupuesto/v/${v.id}">V${v.numero} · ${esc(v.nombre)}</a>
          ${v.ronda > 1 ? `<span class="nota">ronda ${v.ronda}</span>` : ''}
          <span class="der">Creada ${fecha(v.creada_en)}${v.aprobada_en ? ' · aprobada ' + fecha(v.aprobada_en) : ''}</span></li>`).join('')}</ul>`
        : '<p class="nota">Este ejercicio todavía no tiene versiones.</p>'}
      ${mod.editar ? `<form class="formfila" id="nueva-v">
          <label class="campo">Nombre de la versión<input name="nombre" required maxlength="120" placeholder="Ej.: Presupuesto ${anio} · ajuste de nómina"></label>
          <label class="campo">Partir de<select name="copiaDe"><option value="">Supuestos por defecto</option>${versiones.map(v => `<option value="${v.id}">Copia de V${v.numero}</option>`).join('')}</select></label>
          <button class="btn primario" type="submit">Crear versión</button></form>` : ''}
    </div><section id="archivos"></section>` : '<div class="tarjeta"><p class="nota">Todavía no hay ejercicios abiertos.</p></div>'}`;
  if (ej) vArchivos($('#archivos'), anio).catch(e => { $('#archivos').innerHTML = `<div class="tarjeta"><p class="nota">${esc(e.message)}</p></div>`; });

  $('#nuevo-ej')?.addEventListener('click', () => accion(() => api('POST', '/api/presupuesto/ejercicios', { anio: sig }), `Ejercicio ${sig} abierto`).then(() => { location.hash = '#/presupuesto/' + sig; }));
  $('#nueva-v')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const r = await accion(() => api('POST', '/api/presupuesto/versiones', { ejercicio: anio, nombre: f.get('nombre'), copiaDe: f.get('copiaDe') || null }), 'Versión creada');
    location.hash = '#/presupuesto/v/' + r.id;
  });
}

/* =========================================================
   PRESUPUESTO · una versión
   ========================================================= */
const PESTANAS = [['resumen', 'Estado de resultados'], ['ingresos', 'Ingresos'], ['unidades', 'Por unidad'], ['costo', 'Costo de prestación'], ['nomina', 'Nómina por cargo', 'sensible'], ['proyeccion', 'Proyección y NPV'], ['sensibilidad', 'Sensibilidad'], ['evaluacion', 'Evaluación del equipo', 'sensible', 2027], ['supuestos', 'Supuestos'], ['preguntas', 'Preguntas'], ['aprobacion', 'Aprobación']];
/* Nómina por cargo y evaluación: solo con el detalle sensible; la evaluación del equipo existe solo para 2027. */
const pestanasDe = v => PESTANAS.filter(([, , sens, anio]) => (!sens || modulo('PRESUPUESTO')?.detalleSensible) && (!anio || anio === v.ejercicio));
let cacheVersion = null;

async function pantallaVersion(id, pestana) {
  const v = cacheVersion?.id === id && cacheVersion.t > Date.now() - 2000 ? cacheVersion.v : await api('GET', `/api/presupuesto/versiones/${id}`);
  cacheVersion = { id, v, t: Date.now() };
  const esc0 = almacen.leer('finantia.escenario');
  const escenario = ESCS.includes(esc0) ? esc0 : (v.escenario_oficial || 'Moderado');
  const r = v.resultados[escenario];
  const pestanas = pestanasDe(v);
  if (!pestanas.some(([k]) => k === pestana)) pestana = 'resumen';
  app.innerHTML = `
    <div class="cabeza"><div>
      <div class="miga"><a href="#/presupuesto/${v.ejercicio}">Presupuesto ${v.ejercicio}</a></div>
      <h1>V${v.numero} · ${esc(v.nombre)}</h1>
      <p class="nota"><span class="estado ${v.estado}">${ESTADOS[v.estado]}</span> Ronda ${v.ronda} · calculada ${fecha(r?.calculadoEn)}${v.escenario_oficial ? ' · escenario oficial: ' + v.escenario_oficial : ''}</p></div>
      ${['resumen', 'supuestos'].includes(pestana) ? '' : `<div class="acciones" role="group" aria-label="Escenario">${ESCS.map(e => `<button type="button" class="btn ${e === escenario ? 'primario' : ''}" data-esc="${e}" aria-pressed="${e === escenario}">${e}</button>`).join('')}</div>`}
    </div>
    <div class="kpis">
      ${kpi('Ingreso neto', r.tot.NET)} ${kpi('EBITDA', r.tot.EBITDA, P(r.tot.EBITDA / r.tot.NET) + ' del neto')}
      ${kpi('Resultado neto', r.tot.RN)} ${kpi('NPV 2027–2031', r.metricas.npv, 'tasa 12%')} ${kpi('Caja mínima', r.caja.saldoMinimo, 'mes ' + MESES[r.caja.mesMinimo])}
    </div>
    <p class="nota">Cifras del escenario ${escenario}.</p>
    <nav class="pestanas" aria-label="Secciones">${pestanas.map(([k, t]) => `<a href="#/presupuesto/v/${id}/${k}" ${k === pestana ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <section id="cuerpo"></section>`;
  app.querySelectorAll('[data-esc]').forEach(b => b.onclick = () => { almacen.poner('finantia.escenario', b.dataset.esc); pantallaVersion(id, pestana); });
  app.querySelector('.pestanas [aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const cuerpo = $('#cuerpo');
  const fn = {
    resumen: vResumen, ingresos: vIngresos, unidades: vUnidades, costo: vCosto, proyeccion: vProyeccion,
    sensibilidad: vSensibilidad, supuestos: vSupuestos, preguntas: vPreguntas, aprobacion: vAprobacion, nomina: vNomina, evaluacion: vEvaluacion
  }[pestana] || vResumen;
  if (['ingresos', 'costo', 'sensibilidad'].includes(pestana)) cuerpo.innerHTML = '<p class="nota">Calculando…</p>';
  await fn(cuerpo, v, escenario, { recargar: () => { cacheVersion = null; pantallaVersion(id, pestana); } });
  anchos(cuerpo);
}



/* ---------- Drill down del estado de resultados (el de tres niveles de Finantia Admon 1.0) ----------
   Rubro → línea del presupuesto → centro de costos → cuenta, con el reparto del auxiliar contable 2026.
   El centro de costos y la cuenta solo llegan a quien tiene el detalle sensible; sin él, las líneas de
   nómina de cada rubro se ven agrupadas, como en el simulador de la Junta. Los subtotales se abren por unidad.
   Arriba se escoge Total CEIPA o una unidad, y toda la tabla pasa a esa unidad. */
/** Líneas de un renglón: ingreso bruto y descuentos son las suyas; los rubros, las de su bloque. */
const lineasDe = (D, k) => !D ? [] : D.L.map(([b, c], li) => (k === 'IB' || k === 'DS' ? c === k : b === k && c !== 'IB' && c !== 'DS') ? li : -1).filter(li => li >= 0);
const hayValor = (xs, min = 5e5) => xs.some(x => Math.abs(x || 0) >= min);
const botonAbrir = (id, t) => `<button type="button" class="enlace" data-abrir="${id}" aria-expanded="false">▸ ${t}</button>`;
const marcar = (b, a) => { b.setAttribute('aria-expanded', String(a)); b.textContent = (a ? '▾ ' : '▸ ') + b.textContent.slice(2); };
/** Abre y cierra las filas de un árbol: al cerrar un renglón se cierran también sus hijos. */
function arbol(tabla) {
  const cerrar = id => tabla.querySelectorAll(`tr[data-de="${id}"]`).forEach(tr => {
    tr.hidden = true; const h = tr.querySelector('[data-abrir]'); if (h && h.getAttribute('aria-expanded') === 'true') { marcar(h, false); cerrar(h.dataset.abrir); }
  });
  tabla.addEventListener('click', e => {
    const b = e.target.closest('[data-abrir]'); if (!b) return;
    const abrir = b.getAttribute('aria-expanded') !== 'true';
    marcar(b, abrir);
    if (abrir) tabla.querySelectorAll(`tr[data-de="${b.dataset.abrir}"]`).forEach(tr => { tr.hidden = false; }); else cerrar(b.dataset.abrir);
  });
  return () => tabla.querySelectorAll('[data-abrir][aria-expanded="true"]').forEach(b => { if (!b.closest('tr[data-de]')) { marcar(b, false); cerrar(b.dataset.abrir); } });
}
async function detalleSeguro(v) { try { return await detalleLineas(v); } catch { return null; } }

async function vResumen(c, v) {
  const b0 = v.base.eerr2026, R = v.resultados, BU = v.base.eerr2026Unidades, n = v.base.names;
  const D = await detalleSeguro(v), aux = !!D?.DD;
  const u0 = Number(almacen.leer('finantia.eerrUnidad') ?? -1), ui = Number.isInteger(u0) && u0 >= 0 && u0 < n.length ? u0 : -1;
  const b = ui < 0 ? b0 : BU[ui], eerr = e => ui < 0 ? R[e].eerr : R[e].eerrUnidades[ui];
  const G = D ? [D.g26, ...ESCS.map(e => D.esc[e])] : [];
  const lin = (g, li) => (ui < 0 ? g.tot : g.units[ui]).ln[li] || 0;
  /* Una entrada del auxiliar es [unidad (−1 = sobre el total de la línea), centro de costos, cuenta, participación] */
  const aux1 = (g, li, [uu, , , sh]) => uu < 0 ? lin(g, li) * sh : ui >= 0 && ui !== uu ? 0 : (g.units[uu].ln[li] || 0) * sh;
  const celdas = xs => xs.map(x => `<td class="${cls(x)}">${Mn(x)}</td>`).join('') + `<td>${P(xs[0] ? xs[2] / xs[0] - 1 : null)}</td>`;
  const fila = (nivel, de, t, xs, id, hijos) => `<tr class="hijo n${nivel}" data-de="${de}" hidden><td>${id && hijos ? botonAbrir(id, t) : t}</td>${celdas(xs)}</tr>${id && hijos ? hijos : ''}`;
  const porMod = (a, z) => Math.abs(z.xs[2]) - Math.abs(a.xs[2]);
  const nombre = ([cod, nom]) => `${esc(nom)} <i>${esc(cod)}</i>`;
  function cuentas(li, id, ens) {
    return ens.map(en => ({ en, xs: G.map(g => aux1(g, li, en)) })).filter(x => hayValor(x.xs, 5e4)).sort(porMod)
      .map(({ en, xs }) => fila(3, id, nombre(D.CTN[en[2]]), xs)).join('');
  }
  function centros(li, id) {
    const por = new Map(); (D.DD[li] || []).forEach(en => { if (!por.has(en[1])) por.set(en[1], []); por.get(en[1]).push(en); });
    return [...por].map(([cc, ens]) => ({ cc, ens, xs: G.map(g => ens.reduce((s, en) => s + aux1(g, li, en), 0)) })).filter(x => hayValor(x.xs)).sort(porMod)
      .map(({ cc, ens, xs }) => { const idc = `${id}-c${cc}`; return fila(2, id, nombre(D.CCN[cc]), xs, idc, cuentas(li, idc, ens)); }).join('');
  }
  function hijosDe(k, tipo) {
    if (tipo !== 'det' && k !== 'IB') return ui < 0 ? n.map((t, i) => ({ t, xs: [BU[i][k], ...ESCS.map(e => R[e].eerrUnidades[i][k])] })).filter(x => hayValor(x.xs)).map(x => fila(1, k, esc(x.t), x.xs)).join('') : '';
    let ls = lineasDe(D, k), html = '';
    if (!aux && ls.length < 2) return '';
    if (!aux) {
      const nom = ls.filter(li => D.L[li][1] === 'N'), xs = G.map(g => nom.reduce((s, li) => s + lin(g, li), 0));
      if (nom.length && hayValor(xs)) html += fila(1, k, 'Nómina (todas las líneas del rubro)', xs);
      ls = ls.filter(li => D.L[li][1] !== 'N');
    }
    return html + ls.map(li => ({ li, xs: G.map(g => lin(g, li)) })).filter(x => hayValor(x.xs)).sort(porMod)
      .map(({ li, xs }) => { const id = `${k}-l${li}`; return fila(1, k, esc(D.LN[li]), xs, id, aux ? centros(li, id) : ''); }).join('');
  }
  c.innerHTML = `${D && !D.cuadra ? '<p class="nota neg">El detalle se calculó de nuevo en el navegador y no coincide del todo con lo guardado (el motor cambió). Edite y guarde un supuesto para recalcular la versión.</p>' : ''}
    <div class="tarjeta"><h2>Estado de resultados ${v.ejercicio} · tres escenarios frente a 2026E</h2>
    <p class="nota">Millones de pesos. La variación es la del escenario Moderado frente a 2026E. ${!D ? 'El detalle por línea no está disponible en este momento.' : aux ? 'Toque un rubro (▸) para abrirlo en tres niveles: línea, centro de costos y cuenta (reparto según el auxiliar contable 2026).' : 'Toque un rubro (▸) para ver sus líneas.'}${ui < 0 ? ' Los subtotales se abren por unidad.' : ''}</p>
    <div class="fila-drill">
      <label>Ver <select id="ver-unidad">${['Total CEIPA', ...n].map((t, i) => `<option value="${i - 1}" ${i - 1 === ui ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <button type="button" class="btn" id="cerrar-todo">Cerrar todo</button>
    </div>
    <div class="tabla-cont"><table id="t-eerr"><thead><tr><th>Rubro${ui < 0 ? '' : ' · ' + esc(n[ui])}</th><th>2026E</th>${ESCS.map(e => `<th>${e}</th>`).join('')}<th>Var. Mod.</th></tr></thead><tbody>
    ${EERR.map(([k, t, tipo]) => {
      const m = eerr('Moderado')[k], var_ = b[k] ? m / b[k] - 1 : null, hijos = D ? hijosDe(k, tipo) : '';
      return `<tr class="${tipo}"><td>${hijos ? botonAbrir(k, t) : t}</td><td class="${cls(b[k])}">${Mn(b[k])}</td>${ESCS.map(e => `<td class="${cls(eerr(e)[k])}">${Mn(eerr(e)[k])}</td>`).join('')}<td>${P(var_)}</td></tr>${hijos}`;
    }).join('')}
    <tr><td>Margen EBITDA</td><td>${P(b.NET ? b.EBITDA / b.NET : null)}</td>${ESCS.map(e => `<td>${P(eerr(e).NET ? eerr(e).EBITDA / eerr(e).NET : null)}</td>`).join('')}<td></td></tr>
    </tbody></table></div></div>
    <div class="tarjeta"><h3>Nómina dentro de cada rubro (escenario Moderado${ui < 0 ? '' : ' · ' + esc(n[ui])})</h3>
    <div class="tabla-cont"><table><thead><tr><th>Rubro</th><th>Nómina 2026E</th><th>Nómina ${v.ejercicio}</th><th>% del rubro ${v.ejercicio}</th></tr></thead><tbody>
    ${EERR.filter(x => x[2] === 'det' && eerr('Moderado')['n_' + x[0]]).map(([k, t]) => { const e = eerr('Moderado'); return `<tr><td>${t}</td><td>${Mn(b['n_' + k])}</td><td>${Mn(e['n_' + k])}</td><td>${P(e[k] ? e['n_' + k] / e[k] : null)}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  $('#cerrar-todo').onclick = arbol($('#t-eerr'));
  $('#ver-unidad').onchange = e => { almacen.poner('finantia.eerrUnidad', e.target.value); vResumen(c, v); };
}

async function vUnidades(c, v, escenario) {
  const r = v.resultados[escenario], U = r.eerrUnidades, B = v.base.eerr2026Unidades, n = v.base.names;
  const D = await detalleSeguro(v), G = D?.esc[escenario];
  const max = Math.max(...U.map(u => Math.abs(u.EBITDA)), 1);
  const lineas = (k, tipo) => (tipo === 'det' && k !== 'DS' ? lineasDe(D, k) : []).map(li => ({ li, xs: [...G.units.map(u => u.ln[li]), G.tot.ln[li]] })).filter(x => hayValor(x.xs))
    .sort((a, z) => Math.abs(z.xs[7]) - Math.abs(a.xs[7]))
    .map(({ li, xs }) => `<tr class="hijo n1" data-de="${k}" hidden><td>${esc(D.LN[li])}</td>${xs.map(x => `<td class="${cls(x)}">${Mn(x)}</td>`).join('')}</tr>`).join('');
  c.innerHTML = `<div class="tarjeta"><h2>Estado de resultados por unidad · ${escenario}</h2><p class="nota">Millones de pesos.${D ? ' Toque un rubro para ver sus líneas del presupuesto en cada unidad.' : ''}</p>
    <div class="tabla-cont"><table id="t-unidades"><thead><tr><th>Rubro</th>${n.map(x => `<th>${esc(x)}</th>`).join('')}<th>Total</th></tr></thead><tbody>
    ${EERR.map(([k, t, tipo]) => { const h = lineas(k, tipo); return `<tr class="${tipo}"><td>${h ? botonAbrir(k, t) : t}</td>${U.map(u => `<td class="${cls(u[k])}">${Mn(u[k])}</td>`).join('')}<td class="${cls(r.eerr[k])}">${Mn(r.eerr[k])}</td></tr>${h}`; }).join('')}
    <tr><td>Margen EBITDA</td>${U.map(u => `<td>${P(u.NET ? u.EBITDA / u.NET : null)}</td>`).join('')}<td>${P(r.eerr.EBITDA / r.eerr.NET)}</td></tr>
    </tbody></table></div></div>
    <div class="rejilla">
    <div class="tarjeta"><h3>EBITDA por unidad</h3><div class="barras">
      ${U.map((u, i) => { const w = Math.abs(u.EBITDA) / max * 50; return `<div class="barra"><span>${esc(n[i])}</span><span class="pista"><span class="llenado ${u.EBITDA < 0 ? 'neg' : ''}" data-w="${w.toFixed(2)}" data-l="${(u.EBITDA < 0 ? 50 - w : 50).toFixed(2)}"></span></span><span>${M(u.EBITDA)}</span></div>`; }).join('')}
    </div><p class="nota">El centro de la barra es cero.</p></div>
    <div class="tarjeta"><h3>Ingreso neto frente a 2026E</h3><div class="tabla-cont"><table><thead><tr><th>Unidad</th><th>2026E</th><th>${v.ejercicio}</th><th>Var.</th></tr></thead><tbody>
      ${U.map((u, i) => `<tr><td>${esc(n[i])}</td><td>${Mn(B[i].IB - B[i].DS)}</td><td>${Mn(u.NET)}</td><td>${P((B[i].IB - B[i].DS) ? u.NET / (B[i].IB - B[i].DS) - 1 : null)}</td></tr>`).join('')}
    </tbody></table></div></div></div>`;
  arbol($('#t-unidades'));
}

function vProyeccion(c, v, escenario) {
  const r = v.resultados[escenario], p = r.proyeccion, mt = r.metricas, a0 = v.ejercicio - 1;
  const filas = [['IB', 'Ingreso bruto'], ['NET', 'Ingreso neto'], ['TC', 'Costos y gastos'], ['EBITDA', 'EBITDA'], ['RN', 'Resultado neto'], ['FCF', 'Flujo libre de caja'], ['DFCF', 'Flujo descontado']];
  const pb = x => x == null ? 'No se recupera en el horizonte' : nf1.format(x) + ' años';
  c.innerHTML = `<div class="kpis">
      ${kpi('NPV (12%)', mt.npv)} ${kpi('NPV con valor terminal', mt.npvTV)}
      <div class="kpi"><small>TIR</small><b>${mt.irr == null ? 'No aplica' : P(mt.irr)}</b><small>${mt.irr == null ? 'sin cambio de signo en el flujo' : ''}</small></div>
      <div class="kpi"><small>Payback simple</small><b>${pb(mt.paybackSimple)}</b></div>
      <div class="kpi"><small>Payback descontado</small><b>${pb(mt.paybackDescontado)}</b></div>
    </div>
    <div class="tarjeta"><h2>Proyección ${v.ejercicio}–${a0 + 5} · ${escenario}</h2><p class="nota">Millones de pesos; ${a0} es el estimado de cierre.</p>
    <div class="tabla-cont"><table><thead><tr><th>Concepto</th>${p.map((_, i) => `<th>${a0 + i}${i ? '' : 'E'}</th>`).join('')}</tr></thead><tbody>
    ${filas.map(([k, t]) => `<tr class="${['EBITDA', 'FCF'].includes(k) ? 'sub' : ''}"><td>${t}</td>${p.map(x => `<td class="${cls(x[k])}">${Mn(x[k])}</td>`).join('')}</tr>`).join('')}
    <tr><td>Margen EBITDA</td>${p.map(x => `<td>${P(x.NET ? x.EBITDA / x.NET : null)}</td>`).join('')}</tr>
    </tbody></table></div></div>`;
}

/* ---------- supuestos ---------- */
const SUP_ESC = [
  ['price', 'Incremento de matrícula', 'p'], ['ipc', 'IPC', 'p'], ['sm', 'Incremento del SMMLV', 'p'],
  ['cump', 'Cumplimiento de metas de nuevos', 'p'], ['cumpURE', 'Cumplimiento meta URE', 'p'], ['dpp', 'Ajuste del descuento (pp)', 'p']
];
const SUP_UNI = [['des', 'Deserción de antiguos'], ['dNew', 'Variación de estudiantes nuevos (unidades sin metas por intake)'], ['catAdj', 'Ajuste de cátedra']];

function vSupuestos(c, v) {
  const mod = modulo('PRESUPUESTO'), editable = mod.editar && v.estado === 'BORRADOR';
  const val = (e, k) => v.supuestos?.params?.[e]?.[k] ?? v.porDefecto[e][k];
  const cambiado = (e, k) => v.supuestos?.params?.[e]?.[k] !== undefined;
  const inp = (e, k, x, i) => {
    const id = `${e}.${k}${i == null ? '' : '.' + i}`, num = (x * 100).toFixed(2).replace(/\.?0+$/, '');
    return editable ? `<input class="inp-num" type="number" step="0.01" inputmode="decimal" data-k="${id}" value="${num}" aria-label="${esc(id)}">` : P(x);
  };
  c.innerHTML = `<div class="tarjeta"><div class="cabeza"><h2>Supuestos por escenario</h2>
      <div class="acciones">${editable ? '<button class="btn primario" id="guardar" type="button" disabled>Guardar y recalcular</button>' : ''}</div></div>
    <p class="nota">${editable ? 'Valores en porcentaje. Los cambios quedan en la bitácora con el valor anterior.' : v.estado === 'BORRADOR' ? 'Solo lectura: su rol no edita supuestos.' : 'Solo lectura: la versión ya no es un borrador. Para cambiarla, cree una copia.'} Marcados con • los que difieren del valor por defecto.</p>
    <div class="tabla-cont"><table><thead><tr><th>Supuesto</th>${ESCS.map(e => `<th>${e}</th>`).join('')}</tr></thead><tbody>
    ${SUP_ESC.map(([k, t]) => `<tr><td>${t}</td>${ESCS.map(e => `<td>${cambiado(e, k) ? '• ' : ''}${inp(e, k, val(e, k))}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></div>
    ${SUP_UNI.map(([k, t]) => `<div class="tarjeta"><h3>${t} por unidad</h3><div class="tabla-cont"><table><thead><tr><th>Escenario</th>${v.base.names.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>
      ${ESCS.map(e => `<tr><td>${cambiado(e, k) ? '• ' : ''}${e}</td>${val(e, k).map((x, i) => `<td>${inp(e, k, x, i)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div></div>`).join('')}`;
  if (!editable) return;
  const pend = {};
  c.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    pend[k] = Number(e.target.value) / 100; $('#guardar').disabled = !Object.keys(pend).length;
  });
  $('#guardar').onclick = async () => {
    const params = {};
    for (const [k, x] of Object.entries(pend)) {
      if (!isFinite(x)) return aviso('Hay un valor que no es un número', true);
      const [e, campo, i] = k.split('.');
      params[e] ??= {};
      if (i == null) params[e][campo] = x;
      else { params[e][campo] ??= [...val(e, campo)]; params[e][campo][Number(i)] = x; }
    }
    await accion(() => api('PATCH', `/api/presupuesto/versiones/${v.id}/supuestos`, { params }), 'Supuestos guardados y versión recalculada');
    cacheVersion = null; pantallaVersion(v.id, 'supuestos');
  };
}

/* ---------- aprobación ---------- */
async function vAprobacion(c, v) {
  const mod = modulo('PRESUPUESTO');
  const historial = await api('GET', `/api/presupuesto/versiones/${v.id}/bitacora`);
  const yoEnvie = historial.some(h => h.accion === 'ENVIAR_REVISION' && h.nombre === sesion.perfil.nombre) && v.enviada_por === sesion.perfil.id;
  const puedeEnviar = mod.editar && v.estado === 'BORRADOR';
  const puedeDecidir = mod.aprobar && v.estado === 'EN_REVISION';
  let lineas = null;
  if (v.estado === 'APROBADA' || v.estado === 'REEMPLAZADA') lineas = await api('GET', `/api/presupuesto/versiones/${v.id}/lineas`);

  c.innerHTML = `<div class="rejilla">
    <div class="tarjeta"><h2>Estado de la versión</h2>
      <p><span class="estado ${v.estado}">${ESTADOS[v.estado]}</span> · ronda ${v.ronda}</p>
      <ul class="historial">
        <li>Creada ${fecha(v.creada_en)}</li>
        ${v.enviada_en ? `<li>Enviada a revisión ${fecha(v.enviada_en)}</li>` : ''}
        ${v.aprobada_en ? `<li>Aprobada ${fecha(v.aprobada_en)} · escenario oficial ${esc(v.escenario_oficial)}</li>` : ''}
        ${v.reemplazada_en ? `<li>Reemplazada ${fecha(v.reemplazada_en)}</li>` : ''}
      </ul>
      ${puedeEnviar ? `<p class="nota">Al enviarla, la versión queda bloqueada para edición hasta que la aprueben o la devuelvan.</p><button class="btn primario" id="enviar" type="button">Enviar a revisión</button>` : ''}
      ${puedeDecidir ? (yoEnvie ? '<p class="nota">Usted envió esta versión, así que no puede aprobarla. La decide otro aprobador.</p>' : `
        <form id="decidir">
          <label class="campo">Observaciones<textarea name="obs" maxlength="2000" placeholder="Obligatorias para devolver"></textarea></label>
          <div class="formfila">
            <label class="campo">Escenario oficial<select name="esc">${ESCS.map(e => `<option ${e === 'Moderado' ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
            <button class="btn primario" type="submit" value="aprobar">Aprobar</button>
            <button class="btn peligro" type="submit" value="devolver">Devolver con observaciones</button>
          </div></form>`) : ''}
      ${v.estado === 'EN_REVISION' && !mod.aprobar ? '<p class="nota">Esperando la decisión de los aprobadores.</p>' : ''}
    </div>
    <div class="tarjeta"><h2>Decisiones</h2>
      ${v.decisiones.length ? `<ul class="historial">${v.decisiones.map(d => `<li><time>${fecha(d.fecha)}</time><b>${esc(d.nombre)}</b> ${d.decision === 'APROBAR' ? 'aprobó' : 'devolvió'} (ronda ${d.ronda})${d.observaciones ? `<div class="nota">${esc(d.observaciones)}</div>` : ''}</li>`).join('')}</ul>` : '<p class="nota">Todavía no hay decisiones.</p>'}
    </div></div>
    ${lineas ? vLineas(lineas, v) : ''}
    <div class="tarjeta"><h2>Historial de la versión</h2>
      <ul class="historial">${historial.map(h => `<li><time>${fecha(h.fecha)}</time><b>${esc(h.nombre || 'Sistema')}</b> · ${esc(ACCIONES[h.accion] || h.accion)}${resumenCambio(h)}</li>`).join('')}</ul></div>`;

  $('#enviar')?.addEventListener('click', async () => {
    await accion(() => api('POST', `/api/presupuesto/versiones/${v.id}/enviar`), 'Versión enviada a revisión');
    cacheVersion = null; pantallaVersion(v.id, 'aprobacion');
  });
  $('#decidir')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target), que = e.submitter?.value;
    if (que === 'devolver' && !String(f.get('obs')).trim()) return aviso('Para devolver la versión escriba las observaciones', true);
    const r = await accion(() => que === 'devolver'
      ? api('POST', `/api/presupuesto/versiones/${v.id}/devolver`, { observaciones: f.get('obs') })
      : api('POST', `/api/presupuesto/versiones/${v.id}/aprobar`, { observaciones: f.get('obs') || null, escenarioOficial: f.get('esc') }));
    aviso(que === 'devolver' ? 'Versión devuelta al borrador' : r?.estado === 'APROBADA' ? 'Versión aprobada' : `Aprobación registrada (${r.aprobaciones} de ${r.requeridas})`);
    cacheVersion = null; pantallaVersion(v.id, 'aprobacion');
  });
}

function resumenCambio(h) {
  if (h.accion !== 'EDITAR_SUPUESTOS' || !h.despues?.params) return '';
  const partes = [];
  for (const [e, o] of Object.entries(h.despues.params)) for (const [k, x] of Object.entries(o)) {
    const antes = h.antes?.params?.[e]?.[k];
    const f = y => Array.isArray(y) ? y.map(P).join(' / ') : typeof y === 'number' ? P(y) : 'por defecto';
    partes.push(`${e} · ${k}: ${f(antes)} → ${f(x)}`);
  }
  return `<div class="nota">${esc(partes.join('; '))}</div>`;
}

function vLineas(lineas, v) {
  const nombres = Object.fromEntries(EERR.map(([k, t]) => [k, t]));
  const grupos = {};
  for (const l of lineas) {
    const k = l.bloque === 'INGRESOS' ? l.codigo : l.bloque;
    grupos[k] ??= { total: 0, n: new Set() }; grupos[k].total += l.valor; grupos[k].n.add(l.linea);
  }
  return `<div class="tarjeta"><h2>Líneas presupuestales aprobadas</h2>
    <p class="nota">${nf0.format(lineas.length)} registros (línea × unidad × mes) del escenario ${esc(v.escenario_oficial)}. Son la base del seguimiento a la ejecución.</p>
    <div class="tabla-cont"><table><thead><tr><th>Rubro</th><th>Líneas</th><th>Total año</th></tr></thead><tbody>
    ${Object.entries(grupos).map(([b, x]) => `<tr><td>${esc(nombres[b] || b)}</td><td>${x.n.size}</td><td>${M(x.total)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

/* =========================================================
   ADMINISTRACIÓN
   ========================================================= */
const ADM = [['usuarios', 'Usuarios y accesos'], ['aprobacion', 'Aprobaciones'], ['bitacora', 'Bitácora']];

async function pantallaAdmin(seccion) {
  app.innerHTML = `<div class="cabeza"><div><div class="miga">Administración</div><h1>${esc((ADM.find(a => a[0] === seccion) || ADM[0])[1])}</h1></div></div>
    <nav class="pestanas" aria-label="Secciones">${ADM.map(([k, t]) => `<a href="#/admin/${k}" ${k === seccion ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
    <section id="cuerpo"></section>`;
  const fn = { usuarios: aUsuarios, aprobacion: aAprobacion, bitacora: aBitacora }[seccion] || aUsuarios;
  await fn($('#cuerpo'));
}

async function aUsuarios(c) {
  const [us, mods] = await Promise.all([api('GET', '/api/admin/usuarios'), api('GET', '/api/admin/modulos')]);
  const edita = sesion.perfil.admin.editar, su = sesion.perfil.superusuario;
  const modsAcc = mods.filter(m => m.codigo !== 'ADMINISTRACION' || su);
  const celda = (u, m) => {
    const a = u.accesos.find(x => x.modulo === m.codigo);
    if (!edita) return a ? `${ROLES[a.rol]}${a.detalle_sensible ? ' · detalle' : ''}` : '—';
    return `<select data-u="${u.id}" data-m="${m.codigo}" aria-label="Rol de ${esc(u.nombre)} en ${esc(m.nombre)}"><option value="">Sin acceso</option>
      ${Object.entries(ROLES).map(([k, t]) => `<option value="${k}" ${a?.rol === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${m.codigo === 'PRESUPUESTO' && a ? `<label class="nota"><input type="checkbox" data-sens="${u.id}" data-m="${m.codigo}" data-rol="${a.rol}" ${a.detalle_sensible ? 'checked' : ''}> detalle sensible (nómina por cargo y evaluación del equipo)</label>` : ''}`;
  };
  c.innerHTML = `<div class="tarjeta">
    <p class="nota">Cada persona tiene un rol por módulo. Visualización consulta; Administración edita; Aprobación aprueba o devuelve. El detalle de nómina por cargo solo lo ve quien tenga la casilla marcada. Por ahora solo Presupuesto y Administración tienen pantallas; los demás accesos quedan listos para cuando se construyan.</p>
    <div class="tabla-cont"><table><thead><tr><th>Persona</th><th class="izq">Estado</th>${modsAcc.map(m => `<th class="izq">${esc(m.nombre)}${m.activo ? '' : ' (en pausa)'}</th>`).join('')}<th class="izq">Último ingreso</th></tr></thead><tbody>
    ${us.map(u => `<tr><td><b>${esc(u.nombre)}</b>${u.es_superusuario ? ' <span class="estado APROBADA">Superusuario</span>' : ''}<div class="nota">${esc(u.correo)}</div></td>
      <td class="izq">${u.activo ? '<span class="estado">Activo</span>' : '<span class="estado inactivo">Inactivo</span>'}
        <div class="acciones-celda">${edita && u.id !== sesion.perfil.id ? `<button class="btn" type="button" data-activo="${u.id}" data-v="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button>` : ''}
        ${su && u.id !== sesion.perfil.id ? `<button class="btn" type="button" data-super="${u.id}" data-v="${u.es_superusuario ? 0 : 1}">${u.es_superusuario ? 'Quitar superusuario' : 'Hacer superusuario'}</button>` : ''}</div></td>
      ${modsAcc.map(m => `<td class="izq">${celda(u, m)}</td>`).join('')}
      <td class="izq nota">${fecha(u.ultimo_ingreso)}</td></tr>`).join('')}
    </tbody></table></div></div>
    ${edita ? `<div class="tarjeta"><h2>Agregar persona</h2><p class="nota">Use el correo institucional de Microsoft 365. La persona entra sin módulos; luego asígnele un rol.</p>
      <form class="formfila" id="nuevo-u"><label class="campo">Nombre<input name="nombre" required maxlength="120"></label>
      <label class="campo">Correo<input name="correo" type="email" required maxlength="200" placeholder="nombre@ceipa.edu.co"></label>
      <button class="btn primario" type="submit">Agregar</button></form></div>` : ''}`;
  const recargar = () => aUsuarios(c);
  c.onchange = async e => {
    const t = e.target;
    try {
      if (t.matches('select[data-u]')) {
        await accion(() => t.value ? api('PUT', `/api/admin/usuarios/${t.dataset.u}/accesos/${t.dataset.m}`, { rol: t.value, detalleSensible: false })
          : api('DELETE', `/api/admin/usuarios/${t.dataset.u}/accesos/${t.dataset.m}`), 'Acceso actualizado');
      } else if (t.matches('input[data-sens]')) {
        await accion(() => api('PUT', `/api/admin/usuarios/${t.dataset.sens}/accesos/${t.dataset.m}`, { rol: t.dataset.rol, detalleSensible: t.checked }), 'Acceso actualizado');
      } else return;
    } catch { /* aviso ya mostrado */ }
    recargar();
  };
  c.onclick = async e => {
    const b = e.target.closest('button[data-activo], button[data-super]'); if (!b) return;
    const cuerpo = b.dataset.activo ? { activo: b.dataset.v === '1' } : { superusuario: b.dataset.v === '1' };
    try { await accion(() => api('PATCH', `/api/admin/usuarios/${b.dataset.activo || b.dataset.super}`, cuerpo), 'Usuario actualizado'); } catch { /* */ }
    recargar();
  };
  $('#nuevo-u')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await accion(() => api('POST', '/api/admin/usuarios', { nombre: f.get('nombre'), correo: f.get('correo') }), 'Persona agregada'); recargar(); } catch { /* */ }
  });
}

async function aAprobacion(c) {
  const [cfg, us] = await Promise.all([api('GET', '/api/admin/aprobacion/PRESUPUESTO'), api('GET', '/api/admin/usuarios')]);
  const edita = sesion.perfil.admin.editar;
  const aprobadores = us.filter(u => u.activo && u.accesos.some(a => a.modulo === 'PRESUPUESTO' && a.rol === 'APROBACION'));
  const nombre = id => us.find(u => u.id === id)?.nombre || `Usuario ${id}`;
  c.innerHTML = `<div class="tarjeta"><h2>Aprobación del presupuesto</h2>
    <p class="nota">Cuántas aprobaciones necesita una versión y, si se quiere, en qué orden. Quien envía una versión no puede aprobarla. Un superusuario aprueba solo si además tiene el rol de Aprobación.</p>
    <form id="cfg">
      <div class="formfila"><label class="campo">Aprobaciones requeridas<select name="n" ${edita ? '' : 'disabled'}>${[1, 2, 3, 4, 5].map(n => `<option ${n === cfg.aprobaciones_requeridas ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="campo"><span><input type="checkbox" name="orden" ${cfg.en_orden ? 'checked' : ''} ${edita ? '' : 'disabled'}> Aprobar en un orden fijo</span></label></div>
      <div id="orden"></div>
      ${edita ? '<button class="btn primario" type="submit">Guardar</button>' : ''}
      <p class="nota">Personas con rol de Aprobación: ${aprobadores.map(u => esc(u.nombre)).join(', ') || 'ninguna todavía'}. Última modificación ${fecha(cfg.actualizado_en)}.</p>
    </form></div>`;
  const f = $('#cfg');
  const pintarOrden = () => {
    const n = Number(f.n.value), orden = f.orden.checked;
    $('#orden').innerHTML = !orden ? '' : `<div class="formfila">${Array.from({ length: n }, (_, i) => `<label class="campo">${i + 1}.º aprobador<select name="ap${i}" ${edita ? '' : 'disabled'}>
      <option value="">Elegir…</option>${aprobadores.map(u => `<option value="${u.id}" ${cfg.aprobadores[i] === u.id ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}
      ${cfg.aprobadores[i] && !aprobadores.some(u => u.id === cfg.aprobadores[i]) ? `<option value="${cfg.aprobadores[i]}" selected>${esc(nombre(cfg.aprobadores[i]))}</option>` : ''}</select></label>`).join('')}</div>`;
  };
  pintarOrden(); f.n.onchange = pintarOrden; f.orden.onchange = pintarOrden;
  f.onsubmit = async e => {
    e.preventDefault();
    const n = Number(f.n.value), orden = f.orden.checked;
    const lista = orden ? Array.from({ length: n }, (_, i) => Number(f['ap' + i].value)).filter(Boolean) : [];
    try { await accion(() => api('PUT', '/api/admin/aprobacion/PRESUPUESTO', { aprobacionesRequeridas: n, enOrden: orden, aprobadores: lista }), 'Configuración guardada'); aAprobacion(c); } catch { /* */ }
  };
}

async function aBitacora(c) {
  const [us, mods] = await Promise.all([api('GET', '/api/admin/usuarios'), api('GET', '/api/admin/modulos')]);
  c.innerHTML = `<div class="tarjeta"><form class="formfila" id="filtro">
      <label class="campo">Módulo<select name="modulo"><option value="">Todos</option>${mods.map(m => `<option value="${m.codigo}">${esc(m.nombre)}</option>`).join('')}</select></label>
      <label class="campo">Persona<select name="usuario"><option value="">Todas</option>${us.map(u => `<option value="${u.id}">${esc(u.nombre)}</option>`).join('')}</select></label>
      <label class="campo">Desde<input type="date" name="desde"></label><label class="campo">Hasta<input type="date" name="hasta"></label>
      <button class="btn primario" type="submit">Filtrar</button></form>
    <p class="nota">La bitácora no se puede editar ni borrar. Muestra los últimos 200 registros del filtro.</p>
    <div id="registros"></div></div>`;
  const cargar = async () => {
    const f = new FormData($('#filtro')), q = new URLSearchParams();
    for (const k of ['modulo', 'usuario', 'desde', 'hasta']) if (f.get(k)) q.set(k, f.get(k));
    if (q.get('hasta')) q.set('hasta', q.get('hasta') + 'T23:59:59');
    const rs = await api('GET', '/api/admin/bitacora?' + q);
    $('#registros').innerHTML = rs.length ? `<div class="tabla-cont"><table><thead><tr><th>Fecha</th><th class="izq">Persona</th><th class="izq">Módulo</th><th class="izq">Acción</th><th class="izq">Detalle</th></tr></thead><tbody>
      ${rs.map(r => `<tr><td>${fecha(r.fecha)}</td><td class="izq">${esc(r.correo || 'Sistema')}</td><td class="izq">${esc(r.modulo || '')}</td><td class="izq">${esc(ACCIONES[r.accion] || r.accion)}</td>
        <td class="izq nota">${esc(detalleBitacora(r))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="nota">Sin registros para este filtro.</p>';
  };
  $('#filtro').onsubmit = e => { e.preventDefault(); accion(cargar); };
  await cargar();
}

function detalleBitacora(r) {
  const partes = [];
  if (r.entidad) partes.push(`${r.entidad}${r.entidad_id ? ' ' + r.entidad_id : ''}`);
  if (r.detalle) partes.push(typeof r.detalle === 'string' ? r.detalle : JSON.stringify(r.detalle));
  if (r.despues && r.accion !== 'EDITAR_SUPUESTOS') partes.push(JSON.stringify(r.despues).slice(0, 160));
  return partes.join(' · ');
}

iniciar().catch(e => { app.innerHTML = `<div class="tarjeta"><h2>Finantia no pudo iniciar</h2><p class="nota">${esc(e.message)}</p></div>`; });
