# Finantia 2.0

Plataforma financiera de la Institución Universitaria CEIPA. Repositorio privado y confidencial.

Este primer paso contiene el **motor de cálculo del módulo Presupuesto**, separado de las pantallas: el mismo cálculo de Finantia Admon 1.0, convertido en un componente sin dependencias y verificado con pruebas contra el Excel `CEIPA_Modelo_Presupuesto2027_v21_202611.xlsx` en los tres escenarios. La base de datos, el módulo de Administración (usuarios, módulos y roles) y las pantallas vienen después.

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

Requiere Node.js 20 o superior. No hay dependencias que instalar.

```bash
npm test          # cuadre con el Excel v21 y equivalencia con el simulador 1.0
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

## Cifras de referencia (millones de COP)

| Escenario | Ingreso neto 2027 | EBITDA 2027 | Resultado 2027 | NPV 2027–2031 | NPV con valor terminal |
|---|---:|---:|---:|---:|---:|
| Pesimista | 50.764 | (2.286) | (4.713) | (25.133) | (84.850) |
| Moderado | 57.974 | 2.706 | 279 | 3.547 | 17.698 |
| Optimista | 62.683 | 6.228 | 3.801 | 28.044 | 112.684 |

## Pruebas

- `pruebas/cuadre_excel.test.js`: compara 2.727 cifras con el Excel v21 recalculado en cada escenario (presupuesto por rubro, estado de resultados por unidad, proyección y FCF 2026E–2031, métricas, mensual, flujo de caja y sensibilidad). Tolerancia ±1 millón por cifra; la diferencia máxima observada es menor a 1 peso.
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
