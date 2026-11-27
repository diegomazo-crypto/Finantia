/**
 * Arma la demostración sin servidor de Finantia 2.0 (las mismas pantallas, con la API
 * respondida en el navegador por demo-enlace/api.js) en una carpeta lista para publicar
 * como página estática.
 *
 *   node herramientas/demo_enlace.mjs CARPETA_DESTINO
 *
 * Lleva la base 2026E (datos/base2026.json) y la evaluación del equipo 2027 (datos/evaluacion2027.json);
 * no lleva la nómina por cargo: esa se carga desde la pantalla y no sale del navegador.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEST = process.argv[2];
if (!DEST) { console.error('Uso: node herramientas/demo_enlace.mjs CARPETA_DESTINO'); process.exit(1); }

const leer = r => readFileSync(join(RAIZ, r), 'utf8');
const escribir = (r, s) => { mkdirSync(dirname(join(DEST, r)), { recursive: true }); writeFileSync(join(DEST, r), s); };
const copiar = (r, d = r) => { mkdirSync(dirname(join(DEST, d)), { recursive: true }); copyFileSync(join(RAIZ, r), join(DEST, d)); };
const cambiar = (s, de, a, donde) => { if (!s.includes(de)) throw new Error(`No se encontró en ${donde}: ${de}`); return s.split(de).join(a); };

/* Pantallas: rutas relativas y la API de la demostración */
let comun = leer('web/comun.js');
comun = cambiar(comun, "export async function api(metodo, ruta, cuerpo, { binario = false, cab = {} } = {}) {\n",
  "export async function api(metodo, ruta, cuerpo, { binario = false, cab = {} } = {}) {\n  if (window.FINANTIA_DEMO) return (await import('./demo/api.js')).apiDemo(metodo, ruta, cuerpo, { binario, cab, correo: sesion.correo });\n", 'comun.js');
escribir('comun.js', comun);
escribir('analisis.js', cambiar(leer('web/analisis.js'), "import('/motor/index.js')", "import('./motor/index.js')", 'analisis.js'));
let app = leer('web/app.js');
app = cambiar(app, 'src="/marca/finantia.png"', 'src="marca/finantia.png"', 'app.js');
app = cambiar(app, "  if (recargar) location.replace('/#/');\n  location.reload();",
  "  /* En la demostración los datos viven en la página: salir no recarga, para no perderlos. */\n  if (window.FINANTIA_DEMO) { sesion.correo = null; sesion.perfil = null; window.removeEventListener('hashchange', enrutar); history.replaceState(null, '', '#/'); return pantallaIngreso(); }\n  if (recargar) location.replace('/#/');\n  location.reload();", 'app.js');
escribir('app.js', app);
escribir('sensible.js', leer('web/sensible.js').replaceAll("from '/motor/", "from './motor/"));
copiar('web/planeacion.js', 'planeacion.js');
copiar('web/xlsx.js', 'xlsx.js');
copiar('web/marca/finantia.png', 'marca/finantia.png');
escribir('estilos.css', leer('web/estilos.css') + `
/* Demostración */
.demo-aviso { margin: 24px auto 32px; max-width: 1240px; padding: 0 max(5vw, 16px); color: var(--muted); font-size: 13px }
`);

/* Motor, datos agregados y las reglas del servidor que usa la demostración */
for (const f of readdirSync(join(RAIZ, 'motor'))) if (f.endsWith('.js')) copiar(`motor/${f}`);
copiar('datos/base2026.json');
copiar('datos/evaluacion2027.json');
copiar('servidor/errores.js');
copiar('servidor/admin/permisos.js');
copiar('servidor/admin/bitacora.js');
copiar('servidor/presupuesto/evaluacion.js');
copiar('servidor/planeacion/servicio.js');
copiar('servidor/presupuesto/xlsx.js');
let servicio = leer('servidor/presupuesto/servicio.js');
servicio = cambiar(servicio, "import { createHash } from 'node:crypto';\n", "const createHash = () => { throw new Error('no disponible en la demostración'); };\n", 'servicio.js');
servicio = cambiar(servicio, "import { readFileSync } from 'node:fs';\n", '', 'servicio.js');
servicio = cambiar(servicio, "JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version", "'demo'", 'servicio.js');
escribir('servidor/presupuesto/servicio.js', servicio);
escribir('servidor/presupuesto/nomina.js', cambiar(leer('servidor/presupuesto/nomina.js'),
  "import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';\n", '/* En la demostración no hay cifrado: la nómina no sale del navegador. */\n', 'nomina.js').replace("import { inflateRawSync } from 'node:zlib';\n", ''));
copiar('demo-enlace/api.js', 'demo/api.js');

/* Página */
escribir('index.html', `<title>Finantia 2.0</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@600&display=swap">
<link rel="stylesheet" href="estilos.css">
<script>window.FINANTIA_DEMO = 1;</script>
<script type="module" src="app.js"></script>
<header class="top" id="cabecera" hidden>
  <div class="wrap fila">
    <a class="marca" href="#/">
      <img src="marca/finantia.png" alt="" width="36" height="36">
      <span><small>CEIPA</small><b>Finantia</b></span>
    </a>
    <nav id="menu" aria-label="Módulos"></nav>
    <div class="usuario"><span id="quien"></span><button class="btn" id="salir" type="button">Salir</button></div>
  </div>
</header>
<main class="wrap" id="app" aria-live="polite"><p class="nota">Cargando…</p></main>
<div id="aviso" role="status" hidden></div>
<p class="demo-aviso">Demostración de Finantia 2.0 con las cifras del presupuesto 2027 (Excel v21). Los cambios viven solo en esta pestaña y se pierden al recargar. Sin Microsoft 365, cifrado ni asistente: eso llega con el servidor.</p>
`);
console.log('Demostración armada en', DEST);
