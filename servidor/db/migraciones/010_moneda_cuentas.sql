-- Finantia 2.0 · Planeación: cuentas en moneda extranjera y cuentas creadas al leer un extracto en PDF.
-- Los extractos se guardan en la moneda de la cuenta; la caja se convierte a pesos con la tasa de cierre de cada mes.
ALTER TABLE banco_cuenta ADD COLUMN moneda text NOT NULL DEFAULT 'COP' CHECK (moneda IN ('COP', 'USD', 'EUR'));
ALTER TABLE banco_cuenta ADD COLUMN por_confirmar boolean NOT NULL DEFAULT false;  -- creada desde un extracto: falta confirmar la destinación
CREATE TABLE tasa_cambio (
  anio            integer NOT NULL,
  mes             integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  moneda          text NOT NULL CHECK (moneda IN ('USD', 'EUR')),
  valor           numeric NOT NULL CHECK (valor > 0),   -- pesos por unidad, al cierre del mes
  actualizado_por bigint NOT NULL REFERENCES usuario(id),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (anio, mes, moneda)
);
