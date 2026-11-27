/**
 * Prepara una base de datos nueva de Finantia: aplica las migraciones, crea el primer
 * Superusuario y carga la base 2026E del Excel v21 con el ejercicio 2027 y la evaluación del equipo 2027.
 *
 * Uso:
 *   DATABASE_URL=postgres://... FINANTIA_DOMINIOS=ceipa.edu.co \
 *     node herramientas/inicializar.js correo@ceipa.edu.co "Nombre Apellido"
 *
 * El correo del Superusuario se pasa al ejecutar; no se guarda en el repositorio.
 */
import { readFileSync } from 'node:fs';
import { conectar, migrar } from '../servidor/db/conexion.js';
import { inicializarSuperusuario } from '../servidor/admin/admin.js';
import { cargarActor } from '../servidor/admin/permisos.js';
import { cargarDatosBase, crearEjercicio } from '../servidor/presupuesto/servicio.js';
import { cargarEvaluacion } from '../servidor/presupuesto/evaluacion.js';

const [correo, nombre] = process.argv.slice(2);
if (!correo || !nombre) { console.error('Uso: node herramientas/inicializar.js <correo> "<nombre>"'); process.exit(1); }
const db = await conectar();
try {
  console.log('Migraciones aplicadas:', (await migrar(db)).join(', ') || 'ninguna (ya estaba al día)');
  const id = await inicializarSuperusuario(db, { correo, nombre });
  const su = await cargarActor(db, id);
  const datos = JSON.parse(readFileSync(new URL('../datos/base2026.json', import.meta.url)));
  const base = await cargarDatosBase(db, su, { anioBase: 2026, descripcion: 'Base 2026E (Excel v21)', contenido: datos });
  await crearEjercicio(db, su, 2027);
  /* Evaluación del presupuesto del equipo 2027 (modelo frente al Excel del equipo): queda cargada; solo la ve quien tiene el detalle sensible */
  await cargarEvaluacion(db, su, 2027, JSON.parse(readFileSync(new URL('../datos/evaluacion2027.json', import.meta.url))));
  console.log(`Superusuario ${correo} creado (id ${id}); datos base ${base}; ejercicio 2027 abierto con la evaluación del equipo cargada.`);
} finally {
  await db.cerrar();
}
