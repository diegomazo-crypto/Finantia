"""Genera pruebas/referencias/excel_v21.json a partir del Excel del presupuesto.

Para cada escenario (Pesimista, Moderado, Optimista) abre una copia del libro en
LibreOffice, cambia el escenario activo (Supuestos!B4), recalcula todo y lee las
cifras que las pruebas comparan con el motor. El libro original no se modifica.

Uso (requiere LibreOffice con Python UNO y openpyxl):
    python3 herramientas/extraer_referencias_excel.py RUTA/CEIPA_Modelo_Presupuesto2027_v21_202611.xlsx
"""
import json, os, subprocess, sys, tempfile, time

import openpyxl

ESCS = ['Pesimista', 'Moderado', 'Optimista']
COLS6 = 'CDEFGH'          # 2026E, 2027, 2028..2031
MESES = 'CDEFGHIJKLMN'    # Ene..Dic
UNIDADES = 'GIKMOQS'      # EERR2027: Pregrado .. Barranquilla


def recalcular(src, outdir, port='2099'):
    """Guarda en outdir un .xlsx recalculado por escenario."""
    script = r'''
import uno, sys, time, subprocess, os
from com.sun.star.beans import PropertyValue
def pv(n, v):
    p = PropertyValue(); p.Name = n; p.Value = v; return p
src, outdir, port = sys.argv[1], sys.argv[2], sys.argv[3]
proc = subprocess.Popen(['soffice', '-env:UserInstallation=file://' + outdir + '/lo', '--headless', '--invisible', '--norestore',
                         '--accept=socket,host=localhost,port=%s;urp;' % port])
ctx = None
for _ in range(90):
    try:
        local = uno.getComponentContext()
        res = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        ctx = res.resolve('uno:socket,host=localhost,port=%s;urp;StarOffice.ComponentContext' % port); break
    except Exception:
        time.sleep(1)
desk = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
for esc in ['Pesimista', 'Moderado', 'Optimista']:
    doc = desk.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(src)), '_blank', 0, (pv('Hidden', True),))
    doc.Sheets.getByName('Supuestos').getCellRangeByName('B4').setString(esc)
    doc.calculateAll()
    doc.storeToURL(uno.systemPathToFileUrl(os.path.join(outdir, esc + '.xlsx')), (pv('FilterName', 'Calc MS Excel 2007 XML'),))
    doc.close(True)
try:
    desk.terminate()
except Exception:
    pass
proc.wait(timeout=60)
'''
    f = os.path.join(outdir, 'recalc_uno.py')
    open(f, 'w').write(script)
    subprocess.run([sys.executable, f, src, outdir, port], check=True)


def filas(ws, rows, cols):
    return {ws['B%d' % r].value: [ws['%s%d' % (c, r)].value for c in cols] for r in rows if ws['B%d' % r].value}


def leer(path, esc):
    wb = openpyxl.load_workbook(path, read_only=False, data_only=True)
    assert wb['Supuestos']['B4'].value == esc
    out = {}
    # Escenarios!B30:E43 — presupuesto 2027 por rubro (columna del escenario)
    ws = wb['Escenarios']
    col = 'CDE'[ESCS.index(esc)]
    out['rubros2027'] = {ws['B%d' % r].value: ws['%s%d' % (col, r)].value for r in range(30, 44)}
    # Proyeccion_2027_2031 — escenario activo (incluye política de fundadores)
    ws = wb['Proyeccion_2027_2031']
    out['proyeccion'] = filas(ws, list(range(6, 23)) + list(range(24, 33)), COLS6)
    out['metricas'] = {ws['B%d' % r].value: ws['C%d' % r].value for r in (35, 36, 37, 38, 39, 40, 41, 42)}
    # EERR2027 — estado de resultados 2027 por unidad
    ws = wb['EERR2027']
    rows = [r for r in range(6, 31) if ws['B%d' % r].value and not str(ws['B%d' % r].value).startswith('Control')]
    out['eerr2027'] = {ws['B%d' % r].value.strip(): {'total': ws['E%d' % r].value, 'unidades': [ws['%s%d' % (c, r)].value for c in UNIDADES]} for r in rows}
    # Ppto2027_Mensual
    ws = wb['Ppto2027_Mensual']
    out['mensual'] = {k.strip(): v for k, v in filas(ws, range(5, 30), MESES).items()}
    # FlujoCaja2027
    ws = wb['FlujoCaja2027']
    out['caja'] = {k.strip(): v for k, v in filas(ws, [18, 20, 21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34], MESES).items()}
    out['cajaIndicadores'] = {'saldoMinimo': ws['C38'].value, 'mesMinimo': ws['C39'].value, 'mesesBajoMinimo': ws['C40'].value}
    # Sensibilidad — tablas 1 y 2
    ws = wb['Sensibilidad']
    out['sensibilidad'] = {
        'volumenDescuento': {'filas': [ws['B%d' % r].value for r in range(7, 14)], 'cols': [ws['%s6' % c].value for c in 'CDEFGHI'],
                             'valores': [[ws['%s%d' % (c, r)].value for c in 'CDEFGHI'] for r in range(7, 14)]},
        'volumenSMMLV': {'filas': [ws['B%d' % r].value for r in range(18, 25)], 'cols': [ws['%s17' % c].value for c in 'CDEFGHI'],
                         'valores': [[ws['%s%d' % (c, r)].value for c in 'CDEFGHI'] for r in range(18, 25)]},
    }
    return out


def main():
    src = os.path.abspath(sys.argv[1])
    dest = os.path.join(os.path.dirname(__file__), '..', 'pruebas', 'referencias', 'excel_v21.json')
    with tempfile.TemporaryDirectory() as tmp:
        recalcular(src, tmp)
        ref = {'_fuente': os.path.basename(src), '_nota': 'Valores recalculados con LibreOffice cambiando Supuestos!B4. COP.',
               'escenarios': {e: leer(os.path.join(tmp, e + '.xlsx'), e) for e in ESCS}}
    json.dump(ref, open(dest, 'w'), ensure_ascii=False, indent=1)
    print('escrito', os.path.normpath(dest))


if __name__ == '__main__':
    main()
