-- Finantia 2.0 · Ejecución presupuestal: base de comparación y balances de prueba mensuales.

-- Base de comparación de un año cuando no viene de una versión aprobada en Finantia
-- (por ejemplo 2026, que se presupuestó fuera): el informe comparativo del equipo, ya leído
-- por línea del informe y unidad. Con una versión aprobada no hace falta: se usan sus líneas.
CREATE TABLE ejecucion_base (
  anio         integer PRIMARY KEY CHECK (anio BETWEEN 2000 AND 2100),
  nombre       text NOT NULL,
  huella       text NOT NULL,
  contenido    jsonb NOT NULL,          -- { anual, aLaFecha, real, hasta, datosBaseId }
  cargado_por  bigint NOT NULL REFERENCES usuario(id),
  cargado_en   timestamptz NOT NULL DEFAULT now()
);

-- Balance de prueba de un mes (filas de resultados: cuenta, centro de costos, movimiento del mes).
-- Una carga nueva del mismo mes reemplaza la anterior; la bitácora guarda quién y cuándo.
CREATE TABLE ejecucion_mes (
  anio         integer NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  mes          integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  nombre       text NOT NULL,
  huella       text NOT NULL,
  forma        text NOT NULL,           -- movimiento | débitos − créditos | saldo final − saldo anterior
  con_cc       boolean NOT NULL DEFAULT true,  -- false: el balance no trae centro de costos (p. ej. por NIT de Contai)
  filas        jsonb NOT NULL,          -- [[cuenta, cc, movimiento, nombre, nombreCC, saldoAnterior|null]] sin terceros
  cargado_por  bigint NOT NULL REFERENCES usuario(id),
  cargado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (anio, mes)
);
