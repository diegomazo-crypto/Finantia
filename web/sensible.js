/*
 * Finantia 2.0 · pestañas con información sensible del presupuesto: nómina por cargo y
 * evaluación del presupuesto del equipo (solo 2027). Las ven solo quienes tienen el detalle
 * sensible del módulo Presupuesto; el servidor lo vuelve a revisar en cada llamada.
 */
import { $, M, Mn, accion, api, cls, esc, fecha, modulo, nf0, nf1 } from './comun.js';

const RUBROS_NOMINA = [['PRESTACION', '4.1 Prestación de servicios'], ['ADM_ACADEMICA', '4.2 Administración académica'], ['UNIDADES', '4.3 Unidades de negocio'], ['VENTAS', '4.4 Ventas'],
  ['TECNOLOGIA', '6.1 Tecnología'], ['CORPORATIVO', '6.2 Corporativo'], ['ADMINISTRATIVOS', '6.3 Administrativo'], ['DIRECCION', '6.4 Dirección institucional']];
const NOMBRE_RUBRO = Object.fromEntries(RUBROS_NOMINA);
const clsM = x => cls(Math.round(x / 1e6));
const n1 = x => (Number.isInteger(x) ? nf0 : nf1).format(x);
const descargarTexto = (nombre, texto, tipo) => {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo })), a = document.createElement('a');
  a.href = url; a.download = nombre; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const PLANTILLA = '﻿rubro;proceso;cargo;continuan;nuevos;vacantes;salario_2026;salario_2027;costo_anual\n4.1;Docentes Tiempo Completo Pregrado;Profesor tiempo completo;20;2;1;9.000.000;9.540.000;3.200.000.000\n';

/* =========================================================
   NÓMINA POR CARGO
   ========================================================= */
export async function vNomina(c, v, escenario) {
  const mod = modulo('PRESUPUESTO'), anio = v.ejercicio;
  let d;
  try { d = await api('GET', `/api/presupuesto/ejercicios/${anio}/nomina`); }
  catch (e) { c.innerHTML = `<div class="tarjeta"><h2>Nómina por cargo ${anio}</h2><p class="nota neg">${esc(e.message)}</p></div>`; return; }
  const filas = d.filas || [], R = v.resultados[escenario];
  /* La nómina del modelo en 4.1 incluye la cátedra, que no es nómina por cargo: se descuenta para comparar. */
  const nomModelo = k => (R.eerr['n_' + k] || 0) - (k === 'PRESTACION' ? R.tot.C || 0 : 0);
  const totModelo = RUBROS_NOMINA.reduce((s, [k]) => s + nomModelo(k), 0);
  const porRubro = RUBROS_NOMINA.map(([k, t]) => {
    const fs = filas.filter(f => f.rubro === k);
    const procesos = [...new Set(fs.map(f => f.proceso))].map(p => {
      const cs = fs.filter(f => f.proceso === p);
      return { proceso: p, cargos: cs, ...sumar(cs) };
    });
    return { k, t, procesos, ...sumar(fs) };
  });
  const tot = sumar(filas);
  const subir = mod.editar ? `<h3>${d.carga ? 'Reemplazar la nómina' : 'Subir la nómina'}</h3>
    <p class="nota">Un archivo CSV con una fila por cargo y las columnas rubro, proceso, cargo, continuan, nuevos, vacantes, salario_2026 y salario_2027 (salario mensual sumado de las personas del cargo) y costo_anual (pesos). El costo anual sigue la regla del modelo: el incremento rige desde el 1 de abril (enero a marzo con el salario 2026), salvo el salario mínimo y el integral, que se ajustan desde el 1 de enero. Sin nombres, documentos ni correos de las personas: el servidor rechaza el archivo si los trae. Se guarda cifrado; la carga anterior se retira y su contenido se borra.</p>
    <form class="formfila" id="subir-nomina"><label class="campo">Archivo CSV (máximo 2 MB)<input type="file" name="f" required accept=".csv,.txt"></label>
      <button class="btn primario" type="submit" ${d.activa ? '' : 'disabled'}>Subir</button> <button class="btn" type="button" id="plantilla">Descargar plantilla</button></form>` : '';
  c.innerHTML = `<div class="tarjeta"><h2>Nómina por cargo ${anio}</h2>
    <p class="nota">Información sensible: la ven solo quienes tienen el detalle de nómina en el módulo Presupuesto. Cada consulta queda en la bitácora. No se envía al asistente de Preguntas.</p>
    ${d.activa ? '' : '<p class="nota neg">La carga de nómina no está activa en este servidor: falta la llave de cifrado (FINANTIA_LLAVE_NOMINA).</p>'}
    ${d.carga ? `<p class="nota">Archivo vigente: <b>${esc(d.carga.nombre)}</b>, subido por ${esc(d.carga.subidoPor)} el ${fecha(d.carga.subidoEn)}. ${nf0.format(d.carga.filas)} cargos, ${n1(d.carga.personas)} personas, costo anual ${M(d.carga.costoTotal)}.
      ${mod.editar ? ` <button class="btn peligro" type="button" id="retirar-nomina" data-id="${d.carga.id}">Retirar</button>` : ''}</p>` : '<p class="nota">Todavía no hay nómina cargada para este ejercicio.</p>'}
    ${subir}</div>
    ${d.carga ? `<div class="tarjeta"><h3>Nómina cargada frente al modelo · ${escenario}</h3>
      <p class="nota">Millones de pesos. La nómina del modelo es la que lleva cada rubro del estado de resultados en esta versión; en 4.1 no incluye la cátedra (${Mn(R.tot.C)} M), que no se carga por cargo.</p>
      <div class="tabla-cont"><table><thead><tr><th>Rubro</th><th>Personas</th><th>Nómina cargada</th><th>Nómina del modelo</th><th>Diferencia</th></tr></thead><tbody>
      ${porRubro.filter(r => r.costo || nomModelo(r.k)).map(r => { const m = nomModelo(r.k); return `<tr><td>${esc(r.t)}</td><td>${n1(r.personas)}</td><td>${Mn(r.costo)}</td><td>${Mn(m)}</td><td class="${clsM(r.costo - m)}">${Mn(r.costo - m)}</td></tr>`; }).join('')}
      <tr class="total"><td>Total</td><td>${n1(tot.personas)}</td><td>${Mn(tot.costo)}</td><td>${Mn(totModelo)}</td><td class="${clsM(tot.costo - totModelo)}">${Mn(tot.costo - totModelo)}</td></tr>
      </tbody></table></div></div>
    <div class="tarjeta"><h3>Detalle por rubro, proceso y cargo</h3>
      <p class="nota">Pesos. Toque un proceso para ver sus cargos.</p>
      <div class="tabla-cont"><table id="t-nomina"><thead><tr><th>Rubro · proceso · cargo</th><th>Continúan</th><th>Nuevos</th><th>Vacantes</th><th>Salario mensual ${anio} (suma del cargo)</th><th>Costo anual</th></tr></thead><tbody>
      ${porRubro.filter(r => r.procesos.length).map(r => `<tr class="sub"><td>${esc(r.t)}</td><td>${n1(r.continuan)}</td><td>${n1(r.nuevos)}</td><td>${n1(r.vacantes)}</td><td></td><td>${nf0.format(r.costo)}</td></tr>
        ${r.procesos.map((p, j) => { const id = `${r.k}-${j}`; return `<tr class="det"><td><button type="button" class="enlace" data-abrir="${id}" aria-expanded="false">▸ ${esc(p.proceso)}</button></td><td>${n1(p.continuan)}</td><td>${n1(p.nuevos)}</td><td>${n1(p.vacantes)}</td><td></td><td>${nf0.format(p.costo)}</td></tr>
          ${p.cargos.map(x => `<tr class="cargo" data-de="${id}" hidden><td>${esc(x.cargo)}</td><td>${n1(x.continuan)}</td><td>${n1(x.nuevos)}</td><td>${n1(x.vacantes)}</td><td>${nf0.format(x.salario2027)}</td><td>${nf0.format(x.costoAnual)}</td></tr>`).join('')}`; }).join('')}`).join('')}
      <tr class="total"><td>Total</td><td>${n1(tot.continuan)}</td><td>${n1(tot.nuevos)}</td><td>${n1(tot.vacantes)}</td><td></td><td>${nf0.format(tot.costo)}</td></tr>
      </tbody></table></div></div>` : ''}`;
  $('#t-nomina')?.addEventListener('click', e => {
    const b = e.target.closest('[data-abrir]'); if (!b) return;
    const abierto = b.getAttribute('aria-expanded') === 'true';
    b.setAttribute('aria-expanded', String(!abierto)); b.textContent = (abierto ? '▸ ' : '▾ ') + b.textContent.slice(2);
    c.querySelectorAll(`tr[data-de="${b.dataset.abrir}"]`).forEach(tr => { tr.hidden = abierto; });
  });
  $('#plantilla')?.addEventListener('click', () => descargarTexto(`CEIPA_Plantilla_NominaPorCargo_${anio}.csv`, PLANTILLA, 'text/csv;charset=utf-8'));
  $('#retirar-nomina')?.addEventListener('click', async e => {
    const b = e.currentTarget;
    if (b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = '¿Retirar y borrar? Confirmar'; return; }
    try { await accion(() => api('DELETE', `/api/presupuesto/nomina/${b.dataset.id}`), 'Nómina retirada'); vNomina(c, v, escenario); } catch { /* aviso ya mostrado */ }
  });
  $('#subir-nomina')?.addEventListener('submit', async e => {
    e.preventDefault();
    const archivo = e.target.f.files[0]; if (!archivo) return;
    if (archivo.size > 2 * 1024 * 1024) return accion(() => Promise.reject(new Error('El archivo supera 2 MB'))).catch(() => {});
    try { await accion(() => api('POST', `/api/presupuesto/ejercicios/${anio}/nomina`, archivo, { cab: { 'X-Nombre': encodeURIComponent(archivo.name) } }), 'Nómina cargada y cifrada'); vNomina(c, v, escenario); } catch { /* aviso ya mostrado */ }
  });
}

function sumar(fs) {
  return fs.reduce((s, f) => ({ continuan: s.continuan + f.continuan, nuevos: s.nuevos + f.nuevos, vacantes: s.vacantes + f.vacantes, personas: s.personas + f.continuan + f.nuevos + f.vacantes, costo: s.costo + f.costoAnual }),
    { continuan: 0, nuevos: 0, vacantes: 0, personas: 0, costo: 0 });
}

/* =========================================================
   EVALUACIÓN DEL PRESUPUESTO DEL EQUIPO (solo 2027)
   ========================================================= */
const RUBROS_EV = {
  NET: ['3. Ingresos netos', 'total'], CD: ['4. Costos directos', 'sub'], PRESTACION: ['4.1 Prestación de servicios', 'det'], ADM_ACADEMICA: ['4.2 Administración académica', 'det'],
  UNIDADES: ['4.3 Unidades de negocio', 'det'], VENTAS: ['4.4 Ventas', 'det'], MB: ['5. Margen bruto', 'total'], GO: ['6. Gastos de operación', 'sub'],
  TECNOLOGIA: ['6.1 Tecnología', 'det'], CORPORATIVO: ['6.2 Corporativo', 'det'], ADMINISTRATIVOS: ['6.3 Administrativo', 'det'], DIRECCION: ['6.4 Dirección institucional', 'det'],
  RO: ['7. Resultado de operación', 'total'], OTROS_INGRESOS: ['8. Otros ingresos', 'det'], BANCARIOS: ['9. Gastos bancarios e impuestos asumidos', 'det'],
  DA: ['10. Depreciación y amortización', 'det'], OTROS_GASTOS: ['11. Otros gastos', 'det'], RN: ['12. Resultado neto', 'total']
};

export async function vEvaluacion(c, v, escenario) {
  const mod = modulo('PRESUPUESTO'), anio = v.ejercicio;
  let ev;
  try { ({ evaluacion: ev } = await api('GET', `/api/presupuesto/ejercicios/${anio}/evaluacion`)); }
  catch (e) { c.innerHTML = `<div class="tarjeta"><h2>Evaluación del presupuesto del equipo</h2><p class="nota neg">${esc(e.message)}</p></div>`; return; }
  const cargar = mod.editar ? `<h3>${ev ? 'Reemplazar la evaluación' : 'Cargar la evaluación'}</h3>
    <p class="nota">Archivo JSON con las cifras del equipo en pesos (rubros y unidades), las lecturas, las partidas por proceso, las observaciones y las conclusiones.</p>
    <form class="formfila" id="cargar-ev"><label class="campo">Archivo JSON<input type="file" name="f" required accept=".json"></label><button class="btn primario" type="submit">Cargar</button></form>` : '';
  if (!ev) {
    c.innerHTML = `<div class="tarjeta"><h2>Evaluación del presupuesto del equipo ${anio}</h2><p class="nota">Todavía no se ha cargado la evaluación de este ejercicio.</p>${cargar}</div>`;
  } else {
    const R = v.resultados[escenario], m = R.eerr, U = R.eerrUnidades, nombres = v.base.names, units = v.base.units || ['PRE', 'POS', 'MAE', 'PLUS', 'EXT', 'URE', 'BAQ'];
    const fila = (t, tipo, eq, mo, lectura) => `<tr class="${tipo}"><td>${esc(t)}</td><td class="${cls(eq)}">${Mn(eq)}</td><td class="${cls(mo)}">${Mn(mo)}</td><td class="${clsM(eq - mo)}">${Mn(eq - mo)}</td><td class="izq nota lectura">${esc(lectura || '')}</td></tr>`;
    const totEq = ev.unidades.reduce((s, u) => s + u.equipo, 0), totMo = ev.unidades.reduce((s, u) => s + (U[units.indexOf(u.unidad)]?.NET || 0), 0);
    c.innerHTML = `<div class="tarjeta"><h2>Presupuesto del equipo frente al modelo · ${anio}</h2>
      <p class="nota">Millones de pesos; diferencia = equipo − modelo. La columna Modelo es esta versión en el escenario ${escenario}.${ev.referencia ? ' ' + esc(ev.referencia) : ''}</p>
      <p class="nota">Cargada por ${esc(ev.cargadoPor)} el ${fecha(ev.cargadoEn)}</p>
      <div class="tabla-cont"><table><thead><tr><th>Concepto</th><th>Equipo</th><th>Modelo</th><th>Diferencia</th><th class="izq">Lectura</th></tr></thead><tbody>
        ${ev.rubros.map(r => fila(RUBROS_EV[r.clave][0], RUBROS_EV[r.clave][1], r.equipo, m[r.clave], r.lectura)).join('')}
      </tbody></table></div></div>
      ${ev.unidades.length ? `<div class="tarjeta"><h3>Ingresos netos por unidad</h3><div class="tabla-cont"><table><thead><tr><th>Unidad</th><th>Equipo</th><th>Modelo</th><th>Diferencia</th><th class="izq">Explicación</th></tr></thead><tbody>
        ${ev.unidades.map(u => fila(nombres[units.indexOf(u.unidad)] || u.unidad, '', u.equipo, U[units.indexOf(u.unidad)]?.NET, u.lectura)).join('')}
        ${fila('Total ingresos netos', 'total', totEq, totMo, '')}
      </tbody></table></div></div>` : ''}
      ${ev.partidas.length ? `<div class="tarjeta"><h3>Partidas por proceso con diferencia</h3>
        <p class="nota">Millones de pesos. El modelo no calcula a nivel de proceso: aquí la columna Modelo es la del momento del análisis.</p>
        <div class="tabla-cont"><table><thead><tr><th>Código</th><th class="izq">Rubro</th><th>Equipo</th><th>Modelo</th><th>Diferencia</th><th class="izq">Explicación</th></tr></thead><tbody>
        ${ev.partidas.map(p => `<tr><td>${esc(p.codigo)}</td><td class="izq">${esc(p.rubro)}</td><td>${Mn(p.equipo)}</td><td>${Mn(p.modelo)}</td><td class="${clsM(p.equipo - p.modelo)}">${Mn(p.equipo - p.modelo)}</td><td class="izq nota lectura">${esc(p.explicacion)}</td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      ${ev.observaciones.length ? `<div class="tarjeta"><h3>Observaciones de gobierno y control</h3><dl class="obs">${ev.observaciones.map(o => `<dt>${esc(o.titulo)}</dt><dd>${esc(o.texto)}</dd>`).join('')}</dl></div>` : ''}
      ${ev.conclusiones.length ? `<div class="tarjeta"><h3>Conclusiones</h3>${ev.conclusiones.map(t => `<p class="parrafo">${esc(t)}</p>`).join('')}</div>` : ''}
      ${cargar ? `<div class="tarjeta">${cargar}</div>` : ''}`;
  }
  $('#cargar-ev')?.addEventListener('submit', async e => {
    e.preventDefault();
    const archivo = e.target.f.files[0]; if (!archivo) return;
    let contenido;
    try { contenido = JSON.parse(await archivo.text()); } catch { return accion(() => Promise.reject(new Error('El archivo no es un JSON válido'))).catch(() => {}); }
    try { await accion(() => api('PUT', `/api/presupuesto/ejercicios/${anio}/evaluacion`, contenido), 'Evaluación cargada'); vEvaluacion(c, v, escenario); } catch { /* aviso ya mostrado */ }
  });
}

export { NOMBRE_RUBRO };
