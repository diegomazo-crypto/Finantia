# Finantia 2.0

Plataforma financiera de la Institución Universitaria CEIPA. Repositorio privado y confidencial.

Contiene:

1. El **motor de cálculo del módulo Presupuesto**: el mismo cálculo de Finantia Admon 1.0, verificado contra el Excel `CEIPA_Modelo_Presupuesto2027_v21_202611.xlsx` en los tres escenarios.
2. La **base de datos** (PostgreSQL) y la lógica del servidor: el **módulo de Administración** (usuarios, accesos por módulo y rol, aprobaciones configurables, bitácora) y el **ciclo de una versión del presupuesto** (Borrador → En revisión → Aprobada → Reemplazada).

3. El **servidor web y las pantallas** de Presupuesto y Administración, con ingreso por Microsoft 365.

## Probarlo en un computador

```bash
npm install
npm run demo        # http://localhost:3000
```

Levanta una base en memoria (se borra al cerrar) con cuatro usuarios de ejemplo, uno por rol, y la versión 1 del presupuesto 2027. En modo de desarrollo no se usa Microsoft 365: la pantalla de ingreso deja elegir el usuario.

## Pantallas

| Sección | Qué muestra |
|---|---|
| Presupuesto › Ejercicios | Ejercicios abiertos, sus versiones y su estado; crear una versión desde cero o como copia de otra |
| Versión › Estado de resultados | Tres escenarios frente a 2026E, margen EBITDA y nómina dentro de cada rubro |
| Versión › Por unidad | Estado de resultados de las siete unidades, EBITDA por unidad e ingreso neto frente a 2026E |
| Versión › Mensual y caja | Resultado mes a mes y flujo de caja con el saldo mínimo |
| Versión › Proyección y NPV | 2026E–2031, FCF, NPV al 12%, TIR y payback simple y descontado |
| Versión › Supuestos | Supuestos por escenario y por unidad; editables solo en borrador y por el rol Administración |
| Versión › Aprobación | Enviar, aprobar o devolver con observaciones, decisiones, líneas presupuestales aprobadas e historial |
| Administración | Usuarios y su rol en cada módulo, número y orden de aprobaciones, bitácora con filtros |

Las pantallas usan la misma paleta y tipografía de Finantia 1.0, funcionan en teléfono y tienen modo oscuro. Faltan, para una siguiente etapa, las pestañas de 1.0 de ingresos, costo de prestación, sensibilidad, evaluación del equipo, archivos y preguntas.

## Qué calcula

| Archivo | Contenido | Hoja del Excel v21 |
|---|---|---|
| `motor/parametros.js` | Supuestos fijos y de cada escenario | Supuestos, Metas2027, Docencia2027 |
| `motor/presupuesto.js` | Presupuesto 2027 por unidad y estado de resultados CEIPA | Escenarios (B), EERR2027, PyG_Unidad |
| `motor/proyeccion.js` | Proyección 2028–2031, FCF, NPV, valor terminal, TIR y payback | Proyeccion_2027_2031 |
| `motor/mensual.js` | Presupuesto mensual y flujo de caja 2027 | Ppto2027_Mensual, FlujoCaja2027 |
| `motor/sensibilidad.js` | Tablas de sensibilidad, tornado y punto de equilibrio | Sensibilidad, Tornado_Equilibrio |
| `motor/programacion.js` | Programación académica optimizada (3 palancas) | Solo en el simulador |
| `motor/index.js` | `crearModelo()`: punto de entrada | |
| `datos/base2026.json` | Base 2026E por código, línea y unidad, estacionalidad y plan de nómina por línea | Base2026, Estacionalidad, Nomina_Rubros |

Las fórmulas se copiaron de Finantia Admon 1.0 sin cambios; solo se reorganizaron en módulos.

## Uso

Requiere Node.js 20 o superior.

```bash
npm install
npm test          # motor (cuadre con el Excel v21 y el simulador 1.0) y servidor (sobre PostgreSQL en memoria)
npm run resumen   # cifras clave de los tres escenarios
```

```js
import { crearModelo } from './motor/index.js';
const modelo = crearModelo(datos, { params: { Moderado: { price: 0.07 } } });
const m = modelo.escenario('Moderado');
m.presupuesto.tot.RN;   // resultado neto 2027
m.metricas.npv;         // NPV 2027–2031 al 12 %
m.caja.saldoFinal;      // saldo de caja a diciembre 2027
```

## Base de datos y servidor

| Archivo | Contenido |
|---|---|
| `servidor/db/migraciones/001_administracion.sql` | Módulos, usuarios, accesos, configuración de aprobaciones y bitácora (inmutable) |
| `servidor/db/migraciones/002_presupuesto.sql` | Unidades, plan de cuentas, centros de costo, programas, datos base, ejercicios, versiones, decisiones, resultados y líneas presupuestales |
| `servidor/db/conexion.js` | Conexión a PostgreSQL (`DATABASE_URL`) y migraciones |
| `servidor/admin/permisos.js` | Quién puede ver, editar o aprobar en cada módulo |
| `servidor/admin/admin.js` | Módulo de Administración (solo Superusuario) |
| `servidor/admin/identidad.js` | Ingreso con Microsoft 365: solo entra quien esté registrado |
| `servidor/presupuesto/servicio.js` | Ejercicios, versiones, supuestos, aprobación y líneas presupuestales |
| `servidor/web/` | Servidor HTTP (sin framework), API, ingreso con Microsoft 365 y datos de la demo |
| `web/` | Pantallas: `index.html`, `app.js`, `estilos.css` |

### Reglas de permisos

| Rol (por módulo) | Ver | Editar supuestos y enviar | Aprobar o devolver |
|---|:-:|:-:|:-:|
| Visualización | Sí | No | No |
| Administración | Sí | Sí | No |
| Aprobación | Sí | No | Sí |
| Superusuario | Sí | Sí | Solo si además tiene el rol Aprobación |

- Microsoft 365 solo verifica la identidad. Los permisos se asignan en el módulo de Administración, que es solo del Superusuario.
- Cada usuario tiene un rol por módulo. El permiso de detalle sensible (nómina por cargo) se marca aparte.
- Auditoría contable está en pausa: no admite accesos.
- Debe quedar siempre al menos un Superusuario activo.

### Ciclo de una versión

1. **Borrador.** Administración crea la versión desde los datos base o copiando otra versión y edita los supuestos. Cada cambio recalcula los tres escenarios y queda en la bitácora con el valor anterior.
2. **En revisión.** Administración la envía. Ya no se puede editar.
3. **Aprobada.** Se necesitan las aprobaciones que fije el Superusuario (una por defecto), en orden fijo si así se configura. Quien envió la versión no puede aprobarla. Al completarse, el aprobador elige el escenario oficial (Moderado por defecto) y se generan las líneas presupuestales: renglón × unidad × mes, la base que usará Ejecución presupuestal.
4. **Reemplazada.** Cuando se aprueba otra versión del mismo ejercicio. Solo hay una aprobada por ejercicio.

Si un aprobador la **devuelve** (con observaciones obligatorias), vuelve a Borrador y la ronda de aprobaciones empieza de nuevo.

### Instalar en un servidor

```bash
DATABASE_URL=postgres://usuario:clave@servidor/finantia FINANTIA_DOMINIOS=ceipa.edu.co \
  npm run inicializar -- correo.superusuario@ceipa.edu.co "Nombre Apellido"
```

Aplica las migraciones, crea el primer Superusuario, carga la base 2026E y abre el ejercicio 2027. El correo del Superusuario se pasa al ejecutar y no queda en el repositorio.

Luego, para arrancar:

```bash
DATABASE_URL=... ENTRA_TENANT_ID=<id del inquilino de CEIPA> ENTRA_CLIENT_ID=<id de la aplicación> PORT=3000 npm run iniciar
```

La aplicación se registra en Microsoft Entra ID como aplicación de una sola página (SPA) con la dirección del servidor como URI de redirección. El navegador inicia sesión con MSAL y envía el token de identidad; el servidor verifica la firma, el emisor y la audiencia con las llaves públicas de Microsoft. Toda llamada a la API exige además la cabecera `X-Finantia`, que un sitio ajeno no puede enviar. `FINANTIA_MODO_DESARROLLO=1` se niega a arrancar con `NODE_ENV=production`.

## Cifras de referencia (millones de COP)

| Escenario | Ingreso neto 2027 | EBITDA 2027 | Resultado 2027 | NPV 2027–2031 | NPV con valor terminal |
|---|---:|---:|---:|---:|---:|
| Pesimista | 50.764 | (2.286) | (4.713) | (25.133) | (84.850) |
| Moderado | 57.974 | 2.706 | 279 | 3.547 | 17.698 |
| Optimista | 62.683 | 6.228 | 3.801 | 28.044 | 112.684 |

## Pruebas

- `pruebas/cuadre_excel.test.js`: compara 2.727 cifras con el Excel v21 recalculado en cada escenario (presupuesto por rubro, estado de resultados por unidad, proyección y FCF 2026E–2031, métricas, mensual, flujo de caja y sensibilidad). Tolerancia ±1 millón por cifra; la diferencia máxima observada es menor a 1 peso.
- `pruebas/servidor.test.js`: permisos, ingreso, Administración, ciclo completo de una versión con una y dos aprobaciones, y bitácora. Corre sobre PGlite (PostgreSQL en memoria); en GitHub también corre contra PostgreSQL 16.
- `pruebas/api.test.js`: el servidor por HTTP: cabeceras de seguridad, archivos fuera de `web/`, sesión, permisos de cada rol, ciclo completo de una versión, Administración e ingreso con Microsoft 365 (con un verificador de prueba).
- `pruebas/equivalencia_simulador.test.js`: 25 combinaciones aleatorias de supuestos contra el motor original de Finantia Admon 1.0, más el tornado, el punto de equilibrio y la programación optimizada tal como los muestran sus pantallas.

Las referencias se regeneran con:

```bash
python3 herramientas/extraer_referencias_excel.py RUTA/CEIPA_Modelo_Presupuesto2027_v21_202611.xlsx   # requiere LibreOffice
node herramientas/extraer_referencias_simulador.cjs RUTA/Finantia_Admon_v1.0.html                      # requiere Playwright
```

El Excel no se modifica: se abre una copia, se cambia el escenario activo (`Supuestos!B4`) y se recalcula.

## Diferencias encontradas en el Excel v21

Las pruebas revelaron tres hojas del Excel que no siguen al resto del libro. El motor sigue la hoja principal (`Proyeccion_2027_2031`) y el simulador 1.0.

1. **Escenarios, secciones C y D (proyección por escenario y resumen comparativo).** No incluyen la política de fundadores de la versión v20 (Supuestos 5B); el descuento de 2028–2031 queda plano. Por eso su NPV del Moderado es 7.748 M, mientras que `Proyeccion_2027_2031` y el simulador dan 3.547 M. Lo mismo pasa en Pesimista (−21.486 frente a −25.133) y Optimista (32.687 frente a 28.044). Las cifras de 2027 sí coinciden.
2. **Tornado_Equilibrio.** Son valores fijos generados el 25/11/2026 con una versión anterior (excedente base del Moderado 2.993 M, frente a 279 M hoy). El motor los recalcula.
3. **Sensibilidad, tabla 1.** El choque de descuento también se aplica a Extensión, que no tiene descuentos; el motor y el simulador solo mueven las unidades con descuento. La diferencia va de 1,6 a 6 millones en los bordes de la tabla. La prueba la descuenta explícitamente.

## Qué no está en el repositorio

Por confidencialidad no se subieron la nómina por cargo ni los datos de profesores del simulador interno (`CEIPA_INT`: detalle por cargo, carga académica y centros de costo por persona). La nómina entra al motor como el plan del equipo agregado por línea presupuestal y unidad (`datos/base2026.json` → `LP`). El ajuste de la nómina por número de personas por cargo del simulador interno queda para cuando se defina cómo guardar esos datos en la base de datos con control de acceso.

Tampoco están el Excel ni los simuladores 1.0; su respaldo está en la carpeta del proyecto `finantia_1.0/`.
