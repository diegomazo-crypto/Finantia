/* Ingreso al sitio de pruebas de Finantia (correo y clave personal; sin Microsoft 365). */
const $ = s => document.querySelector(s);
const error = t => { const e = $('#error'); e.textContent = t; e.hidden = !t; };
try { const m = sessionStorage.getItem('finantia.motivo'); if (m) { error(m); sessionStorage.removeItem('finantia.motivo'); } } catch { /* sin almacenamiento */ }
$('#f').addEventListener('submit', async ev => {
  ev.preventDefault(); error('');
  const b = $('#entrar'); b.disabled = true;
  try {
    const r = await fetch('/api/pruebas/ingreso', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Finantia': '1' }, body: JSON.stringify({ correo: $('#correo').value, clave: $('#clave').value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { error(d.error || 'No se pudo entrar'); $('#clave').value = ''; return; }
    location.reload();
  } catch { error('No hay conexión con el servidor'); }
  finally { b.disabled = false; }
});
