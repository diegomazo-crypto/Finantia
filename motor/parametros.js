/**
 * Parámetros del motor de Finantia (presupuesto CEIPA 2027–2031).
 *
 * Copiados sin cambios de Finantia Admon 1.0, que replica el Excel
 * CEIPA_Modelo_Presupuesto2027_v21_202611.xlsx. Cada constante indica la hoja
 * o sección del Excel de donde sale.
 *
 * FIXED    = supuestos que no cambian por escenario.
 * DEFAULTS = supuestos editables de cada escenario (hoja Supuestos, columnas C:E).
 */
export const ESCS = ['Pesimista', 'Moderado', 'Optimista'];

export const FIXED = {
  shareNew: [0.30, 0.55, 0.50, 0.50, 1.0, 1.0, 0.30],
  /* % del ingreso bruto al que se aplica el volumen de estudiantes (Supuestos 2.6b): Barranquilla solo pregrado */
  volShare: [1, 1, 1, 1, 1, 1, 0.6817577359],
  /* Ajuste del descuento 2027 por mezcla de programas, facturación 2026 (Supuestos 2.6c del Excel v19) */
  dMix: [0.022, 0, 0, 0, 0, 0, 0.00824926860439],
  /* Política de fundadores (Excel v20, Supuestos 5B): descuento de programas antiguos, de fundadores, peso de fundadores 2027 y entrada anual */
  fund: { S: { rA: 0.122, rN: 0.361, F: 0.353, e: 0.09 }, B: { rA: 0.268, rN: 0.458, F: 0.262, e: 0.074 } },
  fundDef: { fS: [0.30, 0.24, 0.18, 0.12], fB: [0.41, 0.36, 0.32, 0.27] },
  vertice: { hours: 10, rate: 35000 },
  /* Docencia 2027 desde la proyección de grupos (hoja Docencia2027), precios 2026 */
  doc: { catV_sab: 1767540801.173, catNV_sab: 2565775180.794, teams_sab: 1331, cat_baq: 339822663.581, catSab26: 2154530017, catBaq26: 220777557 },
  cintanaUSD: [200000, 200000, 0, 0, 0],
  /* Metas de nuevos 2027 por intake (Moderado). w = periodos que paga en 2027 quien entra en ese intake. Índice de unidad del modelo. */
  metas: {
    0: { label: 'Pregrado Sabaneta', w: [5, 4, 3, 2, 1], real: [554, 242, 248, 267, 145], meta: [685, 202, 248, 300, 169] },
    6: { label: 'Pregrado Barranquilla', w: [5, 4, 3, 2, 1], real: [94, 66, 38, 47, 43], meta: [140, 34, 42, 51, 29] },
    1: { label: 'Especializaciones', w: [2, 1], real: [230, 154], meta: [264, 201] },
    2: { label: 'Maestrías', w: [1], real: [100], meta: [57] }
  },
  /* Deserción de antiguos 2026 (referencia, a validar con Registro). Δ antiguos = (1 − deserción 2027) ÷ (1 − deserción 2026) − 1 */
  des26: [0.10, 0.08, 0.06, 0.10, 0, 0, 0.10],
  /* Maestrías por cohortes (Metas2027, sección I): ingreso bruto 2027 */
  mae: { coh: 1, pago: 4562419.5, c26: 121, v2: 580130746.4 / 121, v3: 417694137.6 / 121, c25: 16, v4: 0, amort: 128139386.1 + 69040306 },
  /* Incremento salarial desde abril (Supuestos: MES_INC, INC26). K = fracción del año con salario 2027; ARR = arrastre del incremento 2026 */
  nomInc: { mes: 4, inc26: 0.06 },
  capex: 0.04, kt: 0, tax: 0, rate: 0.12, gT: 0.03, inv: 0,
  /* Participación ESIC: % de las ventas de pregrado de ESIC (otros ingresos, Pregrado) */
  esic: { ventas: 10000000000, pct: 0.15 },
  /* URE: meta de ventas 2027 (ingreso bruto, COP) sobre ingreso bruto 2026E */
  ure: { ib26: 3992164540, meta: 5000e6 },
  /* Flujo de caja 2027 (hoja FlujoCaja2027) */
  cash: { si: 4061724688, ra: 0.40, rb: 0.35, rc: 0.15, pp: 0.043, pc: 0.043, pi: 0.005, pq: 0.40, sm: 2000000000 }
};

export const DEFAULTS = {
  Pesimista: {
    price: 0.063, ipc: 0.066, sm: 0.12, cump: 0.80, cumpURE: 0.80, vert: 1, dpp: 0.02, grp: {}, catAdj: [0, 0, 0, 0, 0, 0, 0],
    dNew: [-0.08, -0.10, -0.15, -0.10, -0.20, -0.30, -0.10],
    des: [0.186053369026599, 0.126, 0.107, 0.145, 0.0, 0.0, 0.159866101069716], descU: null,
    trm: [4300, 4400, 4500, 4600, 4700],
    lr: { ipc: [0.055, 0.05, 0.045, 0.04], sm: [0.10, 0.09, 0.08, 0.07], g: [-0.02, -0.01, 0, 0], dd: [0.005, 0.005, 0, 0] }
  },
  Moderado: {
    price: 0.063, ipc: 0.063, sm: 0.095, cump: 1.0, cumpURE: 1.0, vert: 1, dpp: 0, grp: {}, catAdj: [0, 0, 0, 0, 0, 0, 0],
    dNew: [0, 0, 0, 0, 0, 0.03, 0],
    des: [0.159053369026599, 0.0892, 0.06, 0.1, 0.0, 0.0, 0.132866101069716], descU: null,
    trm: [4000, 4100, 4200, 4300, 4400],
    lr: { ipc: [0.045, 0.04, 0.035, 0.035], sm: [0.075, 0.07, 0.065, 0.06], g: [0.02, 0.02, 0.02, 0.02], dd: [0, 0, 0, 0] }
  },
  Optimista: {
    price: 0.063, ipc: 0.060, sm: 0.07, cump: 1.10, cumpURE: 1.10, vert: 1, dpp: -0.02, grp: {}, catAdj: [0, 0, 0, 0, 0, 0, 0],
    dNew: [0.06, 0.08, 0.10, 0.08, 0.15, 0.20, 0.06],
    des: [0.141053369026599, 0.0708, 0.0412, 0.082, 0.0, 0.0, 0.114866101069716], descU: null,
    trm: [3800, 3850, 3900, 3950, 4000],
    lr: { ipc: [0.04, 0.035, 0.03, 0.03], sm: [0.06, 0.055, 0.05, 0.05], g: [0.05, 0.05, 0.04, 0.04], dd: [-0.005, -0.005, -0.005, 0] }
  }
};

/* Tamaño de grupo por segmento (hoja Docencia2027): [sede/modalidad, c = cursos comunes / e = específicos,
   grupos 2027, estudiantes 2027, % de grupos con planta 2026, cátedra con Vértice, cátedra sin Vértice].
   Medellín presencial = PD, PN, HN y HV de Sabaneta; virtual = V. Tope por grupo (GMAX): presencial 40, virtual 60, Barranquilla 30. */
export const SEGS = [["pres", "c", 123, 3981, 0.430894, 0, 465607940], ["pres", "e", 142, 2111, 0.301205, 445142900, 445142900], ["pres", "c", 23, 439, 0, 0, 141817034], ["pres", "e", 21, 196, 0, 102777591, 102777591], ["pres", "e", 197, 2350, 0.138462, 775839487, 775839487], ["pres", "e", 16, 160, 0.472222, 45809633, 45809633], ["virt", "c", 84, 4751, 0.663793, 0, 190809406], ["virt", "e", 139, 1912, 0.472222, 397971190, 397971190], ["baq", "c", 21, 223, 0, 127395009, 127395009], ["baq", "c", 38, 746, 0.193548, 196465823, 196465823], ["baq", "e", 4, 59, 0.333333, 15961832, 15961832]];
export const GMAX = { pres: 40, virt: 60, baq: 30 };
