-- Finantia 2.0 · Planeación financiera: bancos y cuentas con su destinación, extractos mensuales
-- (solo saldos y totales: no se guardan los movimientos ni los terceros) y ajustes a la proyección de caja.
CREATE TABLE banco_cuenta (
  id            bigserial PRIMARY KEY,
  banco         text NOT NULL,
  tipo          text NOT NULL DEFAULT 'AHORROS' CHECK (tipo IN ('AHORROS', 'CORRIENTE', 'FIDUCIA', 'INVERSION', 'OTRA')),
  terminacion   text NOT NULL DEFAULT '',          -- últimos 4 dígitos; el número completo no se guarda
  nombre        text NOT NULL,                     -- cómo la llama el equipo
  destinacion   text NOT NULL DEFAULT 'LIBRE' CHECK (destinacion IN ('LIBRE', 'ESPECIFICA')),
  detalle       text NOT NULL DEFAULT '',          -- para qué está destinada
  activa        boolean NOT NULL DEFAULT true,
  creada_por    bigint NOT NULL REFERENCES usuario(id),
  creada_en     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE extracto (
  cuenta_id      bigint NOT NULL REFERENCES banco_cuenta(id),
  anio           integer NOT NULL,
  mes            integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  saldo_inicial  numeric NOT NULL,
  entradas       numeric NOT NULL DEFAULT 0,
  salidas        numeric NOT NULL DEFAULT 0,
  saldo_final    numeric NOT NULL,
  origen         text NOT NULL,                     -- nombre del archivo o 'Registro manual'
  movimientos    integer,
  cargado_por    bigint NOT NULL REFERENCES usuario(id),
  cargado_en     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cuenta_id, anio, mes)
);
CREATE TABLE caja_ajuste (
  anio            integer PRIMARY KEY,
  contenido       jsonb NOT NULL,                   -- [{ mes, concepto, valor }] entradas (+) o salidas (−) esperadas
  actualizado_por bigint NOT NULL REFERENCES usuario(id),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
