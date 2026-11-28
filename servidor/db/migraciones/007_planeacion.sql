-- Finantia 2.0 · Planeación financiera: supuestos de la proyección proforma por ejercicio
-- (tasa de descuento, crecimiento a perpetuidad, capex, capital de trabajo, impuesto,
-- inversión inicial, inversiones puntuales, deuda y caja mínima). Un registro por ejercicio.
CREATE TABLE planeacion_supuestos (
  ejercicio       integer PRIMARY KEY,
  contenido       jsonb NOT NULL,
  actualizado_por bigint NOT NULL REFERENCES usuario(id),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);
