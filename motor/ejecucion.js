/**
 * Ejecución presupuestal: clasifica el balance de prueba en las líneas y unidades del informe
 * CEIPA y lo compara con el presupuesto mes a mes.
 *
 * Convención de signos (la de datos/base2026.json → L): ingresos, descuentos, costos y gastos en
 * positivo. En el balance de prueba los ingresos son créditos (negativos), así que las líneas de
 * ingreso (IB, OI, PI) cambian de signo; los descuentos y los costos son débitos y quedan igual.
 *
 * Clasificación de una fila del balance (cuenta × centro de costos × movimiento):
 *  1. El par centro de costos + cuenta se busca en el reparto del auxiliar contable 2026
 *     (DD, CCN y CTN de los datos base): da las líneas a las que fue ese par y su unidad;
 *  2. si el par no está, se usa la cuenta sola (cómo se repartió esa cuenta en todos los centros);
 *  3. si tampoco, queda "sin clasificar" y se muestra aparte.
 * Lo que en el auxiliar se repartía por inductor (unidad −1) se reparte con la participación de
 * cada unidad en el presupuesto de esa línea (o en la base 2026 si la línea no tiene presupuesto).
 * Los ingresos y descuentos del convenio ESIC van aparte, como en el informe CEIPA (columna ESIC).
 */
export const UNIDADES = ['PRE', 'POS', 'MAE', 'PLUS', 'EXT', 'URE', 'BAQ'];
const INGRESO = new Set(['IB', 'OI', 'PI']);
export const signoBalance = codigo => (INGRESO.has(codigo) ? -1 : 1);

/** Rubros del estado de resultados CEIPA y cómo se arman con los bloques de las líneas. */
export const RUBROS = [
  ['IB', 'Ingresos brutos', 'ingreso'], ['DS', 'Descuentos', 'gasto'], ['NET', 'Ingresos netos', 'ingreso', 'total'],
  ['PRESTACION', '4.1 Prestación de servicios', 'gasto'], ['ADM_ACADEMICA', '4.2 Administración académica', 'gasto'],
  ['UNIDADES', '4.3 Unidades de negocio', 'gasto'], ['VENTAS', '4.4 Ventas', 'gasto'], ['CD', '4. Costos directos', 'gasto', 'sub'],
  ['MB', '5. Margen bruto', 'ingreso', 'total'],
  ['TECNOLOGIA', '6.1 Tecnología', 'gasto'], ['CORPORATIVO', '6.2 Corporativo', 'gasto'], ['ADMINISTRATIVOS', '6.3 Administrativo', 'gasto'],
  ['DIRECCION', '6.4 Dirección institucional', 'gasto'], ['GO', '6. Gastos de operación', 'gasto', 'sub'],
  ['RO', '7. Resultado de operación', 'ingreso', 'total'],
  ['OTROS_INGRESOS', '8. Otros ingresos', 'ingreso'], ['BANCARIOS', '9. Gastos bancarios e impuestos asumidos', 'gasto'],
  ['DA', '10. Depreciación y amortización', 'gasto'], ['OTROS_GASTOS', '11. Otros gastos', 'gasto'],
  ['RN', '12. Resultado neto', 'ingreso', 'total']
];
const CD = ['PRESTACION', 'ADM_ACADEMICA', 'UNIDADES', 'VENTAS'], GO = ['TECNOLOGIA', 'CORPORATIVO', 'ADMINISTRATIVOS', 'DIRECCION'];

/** Rubro de una línea: los ingresos brutos y descuentos van aparte; el resto por su bloque. */
export const rubroDeLinea = ([bloque, codigo]) => (bloque === 'INGRESOS' ? codigo : bloque);

/** Suma por rubro (y totales) un vector de líneas `v[li]`. */
export function porRubro(L, v) {
  const r = Object.fromEntries(RUBROS.map(([k]) => [k, 0]));
  L.forEach((l, li) => { r[rubroDeLinea(l)] += v[li] || 0; });
  r.NET = r.IB - r.DS;
  r.CD = CD.reduce((s, k) => s + r[k], 0);
  r.MB = r.NET - r.CD;
  r.GO = GO.reduce((s, k) => s + r[k], 0);
  r.RO = r.MB - r.GO;
  r.RN = r.RO + r.OTROS_INGRESOS - r.BANCARIOS - r.DA - r.OTROS_GASTOS;
  return r;
}

/**
 * Reparto del auxiliar: par "cc|cuenta" (y cuenta sola) → [[línea, unidad (−1 = por inductor), peso]].
 * El peso de cada destino es su valor 2026 (participación DD × total de la línea), normalizado en el par.
 */
export function mapaDesdeBase(datos) {
  const { DD, CCN, CTN, L } = datos;
  if (!DD || !CCN || !CTN) return null;
  const par = new Map(), cta = new Map();
  const sumar = (m, k, li, u, w, e = 0) => { let a = m.get(k); if (!a) m.set(k, (a = new Map())); const kk = `${li}|${u}|${e}`; a.set(kk, (a.get(kk) || 0) + w); };
  for (const [li, filas] of Object.entries(DD)) {
    const tot = Math.abs(L[li][3].reduce((s, x) => s + x, 0)) || 1;
    for (const [u, ci, ti, sh] of filas) {
      const w = Math.abs(sh * tot), cc = CCN[ci][0], ct = CTN[ti][0];
      sumar(par, `${cc}|${ct}`, Number(li), u, w);
      /* Sin centro de costos (balance por tercero) se sabe por la cuenta qué parte fue de ESIC */
      sumar(cta, ct, Number(li), u, w, /esic/i.test(CCN[ci][1] || '') ? 1 : 0);
    }
  }
  const norm = m => new Map([...m].map(([k, a]) => {
    const t = [...a.values()].reduce((s, x) => s + x, 0) || 1;
    return [k, [...a].map(([kk, w]) => { const [li, u, e] = kk.split('|').map(Number); return [li, u, w / t, e]; })];
  }));
  return { par: norm(par), cuenta: norm(cta), nombresCC: new Map(CCN), nombresCuenta: new Map(CTN), esicCuenta: new Map() };
}

/** El mapa guardado en datos/ejecucion_mapa.json (sin valores) → la misma forma de mapaDesdeBase, si sirve para estos datos. */
export function mapaDesdeArchivo(archivo, datos) {
  if (!archivo || archivo.lineas !== datos.L.length || (archivo.LN && datos.LN && archivo.LN.some((n, i) => n !== datos.LN[i]))) return null;
  return { par: new Map(archivo.par), cuenta: new Map(archivo.cuenta), nombresCC: new Map(archivo.nombresCC), nombresCuenta: new Map(archivo.nombresCuenta), esicCuenta: new Map(archivo.esicCuenta || []) };
}

/** ¿La cuenta es de resultados? (clases 4, 5, 6 y 7 del PUC) */
export const esDeResultados = cuenta => /^[4-7]/.test(String(cuenta));

/**
 * Clasifica las filas del balance de un mes.
 * @param {{cuenta: string, cc: string, movimiento: number, nombre?: string}[]} filas  movimiento = débitos − créditos del mes
 * @param {object} datos   datos base (L, DD, CCN, CTN)
 * @param {object} mapa    mapaDesdeBase(datos)
 * @param {number[][]} part participación de cada unidad por línea (part[li][u], suma 1)
 * @returns {{ real: number[][], detalle: object[], sinClasificar: object[], total: number, totalSinClasificar: number }}
 */
export function clasificarBalance(filas, datos, mapa, part) {
  const nL = datos.L.length, real = Array.from({ length: nL }, () => Array(7).fill(0));
  const det = new Map(), sin = new Map(), aparte = { IB: 0, DS: 0 };
  let total = 0, totalSin = 0;
  for (const f of filas) {
    if (!esDeResultados(f.cuenta) || !f.movimiento) continue;
    total += f.movimiento;
    const destinos = mapa.par.get(`${f.cc}|${f.cuenta}`) || mapa.cuenta.get(String(f.cuenta));
    if (!destinos) {
      const k = `${f.cc}|${f.cuenta}`, s = sin.get(k) || { cuenta: f.cuenta, cc: f.cc, nombre: f.nombre || mapa.nombresCuenta.get(String(f.cuenta)) || '', nombreCC: f.nombreCC || mapa.nombresCC.get(String(f.cc)) || '', valor: 0 };
      s.valor += f.movimiento; sin.set(k, s); totalSin += f.movimiento; continue;
    }
    const esicCC = /esic/i.test(mapa.nombresCC.get(String(f.cc)) || f.nombreCC || '');
    /* Sin centro de costos: la parte de ESIC de la cuenta según el auxiliar del año base */
    const sE = !f.cc && !esicCC ? mapa.esicCuenta?.get(String(f.cuenta)) || 0 : 0;
    for (const [li, u, w, e] of destinos) {
      const cod = datos.L[li][1];
      let v = f.movimiento * w * signoBalance(cod);
      if ((esicCC || e) && (cod === 'IB' || cod === 'DS')) { aparte[cod] += v; continue; }
      if (sE && (cod === 'IB' || cod === 'DS')) { aparte[cod] += v * sE; v *= 1 - sE; }
      const reparto = u >= 0 ? [[u, 1]] : part[li].map((p, j) => [j, p]).filter(([, p]) => p);
      for (const [j, p] of reparto) {
        real[li][j] += v * p;
        const k = `${li}|${j}|${f.cc}|${f.cuenta}`, d = det.get(k);
        if (d) d.valor += v * p; else det.set(k, { li, u: j, cc: f.cc, cuenta: f.cuenta, valor: v * p });
      }
    }
  }
  return {
    real, aparte, detalle: [...det.values()].filter(d => Math.abs(d.valor) >= 0.5),
    sinClasificar: [...sin.values()].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)), total, totalSinClasificar: totalSin
  };
}

/** Participación de cada unidad en cada línea, a partir de una matriz línea × unidad (si la línea está en cero, la base 2026). */
export function participacion(M, datos) {
  return M.map((fila, li) => {
    const usar = fila.some(x => x) ? fila : datos.L[li][3];
    const t = usar.reduce((s, x) => s + Math.abs(x), 0);
    return t ? usar.map(x => Math.abs(x) / t) : Array(7).fill(0).map((_, j) => (j === 0 ? 1 : 0));
  });
}

/** Estacionalidad de una línea (las reglas de motor/mensual.js): ingresos por unidad, nómina S.NOM, el resto S.COS. */
export function pesosMes(datos, codigo, u) {
  const S = datos.seas;
  return codigo === 'IB' || codigo === 'DS' ? S[UNIDADES[u]] : codigo === 'N' || codigo === 'C' ? S.NOM : S.COS;
}

/**
 * Presupuesto mensual P[m][li][u] desde un presupuesto anual por línea y unidad, con un corte
 * opcional: el acumulado "a la fecha" hasta el mes `hasta` (como el informe comparativo).
 */
export function mensualizar(datos, anual, { aLaFecha = null, hasta = null } = {}) {
  const P = Array.from({ length: 12 }, () => datos.L.map(() => Array(7).fill(0)));
  datos.L.forEach(([, codigo], li) => {
    for (let u = 0; u < 7; u++) {
      const w = pesosMes(datos, codigo, u), A = anual[li][u];
      if (!A && !(aLaFecha && aLaFecha[li][u])) continue;
      if (aLaFecha && hasta) {
        const F = aLaFecha[li][u], w1 = w.slice(0, hasta).reduce((s, x) => s + x, 0), w2 = w.slice(hasta).reduce((s, x) => s + x, 0);
        for (let m = 0; m < 12; m++) P[m][li][u] = m < hasta ? (w1 ? F * w[m] / w1 : F / hasta) : (w2 ? (A - F) * w[m] / w2 : (A - F) / Math.max(1, 12 - hasta));
      } else for (let m = 0; m < 12; m++) P[m][li][u] = A * w[m];
    }
  });
  return P;
}

/**
 * Completa meses sin balance con el saldo anterior de un mes cargado. En las cuentas de resultados el
 * saldo anterior es lo acumulado desde enero: lo que falta (saldo anterior − meses ya cargados) se reparte
 * entre los meses vacíos según el presupuesto mensual de cada línea y unidad (o por igual si no hay).
 * @param {(number[][]|null)[]} R      real por mes (se modifica)
 * @param {{mes: number, previo: number[][]}[]} saldos  meses cargados con su saldo anterior clasificado
 * @returns {number[]} meses (1–12) que quedaron estimados
 */
export function completarConSaldoAnterior(R, saldos, P = null) {
  const estimados = [];
  for (const { mes, previo } of saldos.sort((a, b) => a.mes - b.mes)) {
    const vacios = []; for (let m = 0; m < mes - 1; m++) if (!R[m]) vacios.push(m);
    if (!vacios.length) continue;
    const nL = previo.length;
    for (const m of vacios) R[m] = Array.from({ length: nL }, () => Array(7).fill(0));
    for (let li = 0; li < nL; li++) for (let u = 0; u < 7; u++) {
      let falta = previo[li][u];
      for (let m = 0; m < mes - 1; m++) if (!vacios.includes(m)) falta -= R[m][li][u];
      if (Math.abs(falta) < 0.5) continue;
      const w = vacios.map(m => Math.abs(P?.[m]?.[li]?.[u] || 0)), t = w.reduce((s, x) => s + x, 0);
      vacios.forEach((m, k) => { R[m][li][u] += falta * (t ? w[k] / t : 1 / vacios.length); });
    }
    estimados.push(...vacios.map(m => m + 1));
  }
  return estimados;
}

/** Suma meses [0, hasta) de una serie P[m][li][u], filtrando unidad (null = todas) → vector por línea. */
export function acumular(P, hasta, unidad = null) {
  const nL = P[0]?.length || 0, v = Array(nL).fill(0);
  for (let m = 0; m < hasta; m++) for (let li = 0; li < nL; li++) {
    const f = P[m]?.[li]; if (!f) continue;
    v[li] += unidad == null ? f.reduce((s, x) => s + x, 0) : f[unidad];
  }
  return v;
}

/**
 * Semáforo de un rubro o línea según su ejecución a la fecha.
 * Ingresos (y totales de resultado): verde ≥ 98 %, amarillo 90–98 %, rojo < 90 %.
 * Costos y gastos: verde hasta 102 %, amarillo 102–110 %, rojo > 110 %; por debajo de 75 % "baja ejecución".
 * Con presupuesto cero: rojo si se gastó (o se dejó de recibir) más de $5 M.
 */
export const UMBRAL = { ingVerde: 0.98, ingAmarillo: 0.90, gasVerde: 1.02, gasAmarillo: 1.10, baja: 0.75, sinPpto: 5e6 };
export function semaforo(tipo, ppto, real, U = UMBRAL) {
  if (Math.abs(ppto) < 1) {
    if (Math.abs(real) < U.sinPpto) return { color: 'gris', pct: null };
    return { color: tipo === 'ingreso' ? (real > 0 ? 'verde' : 'rojo') : (real > 0 ? 'rojo' : 'verde'), pct: null, sinPpto: true };
  }
  const pct = real / ppto;
  if (tipo === 'ingreso') {
    /* resultado o ingreso con presupuesto negativo: mejor si la cifra sube */
    const ok = ppto > 0 ? pct : 2 - pct;
    return { color: ok >= U.ingVerde ? 'verde' : ok >= U.ingAmarillo ? 'amarillo' : 'rojo', pct };
  }
  if (pct > U.gasAmarillo) return { color: 'rojo', pct, sobre: true };
  if (pct > U.gasVerde) return { color: 'amarillo', pct, sobre: true };
  if (pct < U.baja) return { color: 'azul', pct, baja: true };
  return { color: 'verde', pct };
}

/**
 * Análisis a la fecha: por rubro y por línea, presupuesto acumulado, real acumulado, diferencia,
 * % de ejecución y semáforo, más la serie mensual de ingresos netos y resultado neto.
 * @param {object} datos  datos base (L, LN)
 * @param {number[][][]} P presupuesto mensual P[m][li][u]
 * @param {(number[][]|null)[]} R real mensual R[m][li][u] (null si el mes no se ha cargado)
 * @param {{ hasta: number, unidad?: number|null }} op
 */
export function analizar(datos, P, R, { hasta, unidad = null }) {
  const { L, LN } = datos;
  const Rm = Array.from({ length: 12 }, (_, m) => R[m] || null);
  const pV = acumular(P, hasta, unidad), rV = acumular(Rm.map(x => x || L.map(() => Array(7).fill(0))), hasta, unidad);
  const anualV = acumular(P, 12, unidad);
  const pr = porRubro(L, pV), rr = porRubro(L, rV), ar = porRubro(L, anualV);
  const rubros = RUBROS.map(([k, t, tipo, nivel]) => ({ k, t, tipo, nivel: nivel || 'det', ppto: pr[k], real: rr[k], anual: ar[k], dif: rr[k] - pr[k], ...semaforo(tipo, pr[k], rr[k]) }));
  const lineas = L.map((l, li) => {
    const tipo = INGRESO.has(l[1]) ? 'ingreso' : 'gasto';
    return { li, nombre: LN[li], rubro: rubroDeLinea(l), codigo: l[1], tipo, ppto: pV[li], real: rV[li], anual: anualV[li], dif: rV[li] - pV[li], ...semaforo(tipo, pV[li], rV[li]) };
  }).filter(x => Math.abs(x.ppto) >= 1 || Math.abs(x.real) >= 1 || Math.abs(x.anual) >= 1);
  const serie = Array.from({ length: 12 }, (_, m) => {
    const p = porRubro(L, acumular(P.slice(m, m + 1), 1, unidad));
    const r = Rm[m] ? porRubro(L, acumular([Rm[m]], 1, unidad)) : null;
    return { mes: m + 1, pNET: p.NET, pRN: p.RN, rNET: r?.NET ?? null, rRN: r?.RN ?? null, cargado: !!Rm[m] };
  });
  return { hasta, unidad, rubros, lineas, serie };
}

/** Lecturas automáticas (texto) del análisis: avance, desviaciones grandes y unidades. */
export function interpretar(a, { meses, nombreUnidad = null, porUnidad = null } = {}) {
  const r = Object.fromEntries(a.rubros.map(x => [x.k, x]));
  const M = x => `$${Math.round(x / 1e6).toLocaleString('es-CO')} M`;
  const pct = x => (x == null ? '—' : `${(x * 100).toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`);
  const ambito = nombreUnidad ? ` en ${nombreUnidad}` : '';
  const out = [];
  out.push(`A ${meses[a.hasta - 1]}${ambito}, los ingresos netos van en ${M(r.NET.real)} frente a ${M(r.NET.ppto)} presupuestados (${pct(r.NET.pct)}; ${r.NET.dif >= 0 ? 'por encima' : 'por debajo'} en ${M(Math.abs(r.NET.dif))}).`);
  out.push(`Los costos directos van en ${pct(r.CD.pct)} de lo presupuestado y los gastos de operación en ${pct(r.GO.pct)}. El resultado neto acumulado es ${M(r.RN.real)} frente a ${M(r.RN.ppto)} (${r.RN.dif >= 0 ? 'mejor' : 'peor'} en ${M(Math.abs(r.RN.dif))}).`);
  const sobre = a.lineas.filter(l => l.tipo === 'gasto' && l.dif > 0).sort((x, y) => y.dif - x.dif).slice(0, 3);
  if (sobre.length) out.push(`Lo que más se pasa del presupuesto (costos, gastos y descuentos): ${sobre.map(l => `${l.nombre} (+${M(l.dif)}${l.pct != null ? ', ' + pct(l.pct) : ''})`).join('; ')}.`);
  const bajas = a.lineas.filter(l => l.tipo === 'gasto' && l.baja && l.ppto > 20e6).sort((x, y) => x.dif - y.dif).slice(0, 3);
  if (bajas.length) out.push(`Con baja ejecución (menos de 75 %): ${bajas.map(l => `${l.nombre} (${pct(l.pct)}, ${M(-l.dif)} sin ejecutar)`).join('; ')}. Conviene revisar si es ahorro o un gasto que se va a concentrar al final del año.`);
  if (porUnidad?.length) {
    const peor = [...porUnidad].sort((x, y) => x.difRN - y.difRN)[0], mejor = [...porUnidad].sort((x, y) => y.difRN - x.difRN)[0];
    if (peor && peor.difRN < 0) out.push(`Por unidad, la que más se aleja del presupuesto en resultado es ${peor.nombre} (${M(peor.difRN)}); la que mejor va, ${mejor.nombre} (${mejor.difRN >= 0 ? '+' : ''}${M(mejor.difRN)}).`);
  }
  return out;
}
