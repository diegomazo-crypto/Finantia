/*
 * Pestaña Preguntas (asistente Claude) de cada módulo. Responde solo sobre el módulo y con sus
 * cifras agregadas. La ve quien tenga el permiso de Preguntas del módulo (Administración › Usuarios).
 */
import { $, accion, api, esc, fecha } from './comun.js';

/**
 * @param {HTMLElement} c
 * @param {{ titulo, nota, historial: string, enviar: string, cuerpo: object, sugerencias: string[], pie?: string }} op
 */
export async function vPreguntasModulo(c, { titulo, nota, historial, enviar, cuerpo = {}, sugerencias = [], pie = '' }) {
  const { activo, preguntas } = await api('GET', historial);
  const lista = xs => xs.map(q => `<div class="qa"><div class="qa-msg u"><span class="who">${esc(q.nombre)} · ${fecha(q.fecha)}${q.escenario ? ' · ' + esc(q.escenario) : ''}</span>${esc(q.pregunta)}</div>
      <div class="qa-msg"><span class="who">Asistente</span>${esc(q.respuesta)}</div></div>`).join('');
  c.innerHTML = `<div class="tarjeta"><h2>${esc(titulo)}</h2>
    <p class="nota">${nota} Responde solo sobre este módulo. Las preguntas quedan guardadas y las ve quien tenga Preguntas en el módulo.</p>
    ${activo ? '' : '<p class="nota neg">El asistente no está activo en este servidor. Para activarlo, el administrador del servidor debe configurar la llave de la API de Anthropic (ANTHROPIC_API_KEY).</p>'}
    <div class="qa-log" id="qa-log">${lista(preguntas) || '<p class="nota">Todavía no hay preguntas.</p>'}</div>
    <form class="qa-form" id="qa-form"><textarea name="q" maxlength="4000" placeholder="Escriba su pregunta" ${activo ? '' : 'disabled'}></textarea><button class="btn primario" type="submit" ${activo ? '' : 'disabled'}>Preguntar</button></form>
    <div class="qa-sug">${sugerencias.map(s => `<button class="btn" type="button" ${activo ? '' : 'disabled'}>${esc(s)}</button>`).join('')}</div>
    ${pie ? `<p class="nota">${pie}</p>` : ''}</div>`;
  const f = $('#qa-form');
  c.querySelectorAll('.qa-sug button').forEach(b => b.onclick = () => { f.q.value = b.textContent; f.q.focus(); });
  f.onsubmit = async e => {
    e.preventDefault();
    const q = f.q.value.trim(); if (!q) return;
    const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Pensando…';
    try {
      const r = await accion(() => api('POST', enviar, { ...cuerpo, pregunta: q }));
      const log = $('#qa-log'); if (log.querySelector('p.nota')) log.innerHTML = '';
      log.insertAdjacentHTML('beforeend', lista([{ ...r, nombre: 'Usted', fecha: new Date().toISOString() }]));
      f.q.value = '';
    } catch { /* aviso ya mostrado */ } finally { btn.disabled = false; btn.textContent = 'Preguntar'; }
  };
}
