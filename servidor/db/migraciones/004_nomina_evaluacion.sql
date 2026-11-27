-- Finantia 2.0 · Presupuesto: nómina por cargo (cifrada) y evaluación del presupuesto del equipo.

-- Nómina por cargo de un ejercicio. El contenido (filas por rubro, proceso y cargo) se guarda
-- cifrado con AES-256-GCM; la llave vive solo en el servidor (FINANTIA_LLAVE_NOMINA), nunca en
-- la base ni en el repositorio. Al retirar una carga se borra el contenido cifrado.
CREATE TABLE nomina_carga (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejercicio     integer NOT NULL REFERENCES ejercicio(anio),
  nombre        text NOT NULL,
  filas         integer NOT NULL,
  personas      numeric NOT NULL,
  costo_total   numeric NOT NULL,
  huella        text NOT NULL,          -- SHA-256 del archivo subido
  cifrado       bytea,                  -- null cuando se retira
  iv            bytea,
  etiqueta      bytea,
  subido_por    bigint NOT NULL REFERENCES usuario(id),
  subido_en     timestamptz NOT NULL DEFAULT now(),
  retirado_por  bigint REFERENCES usuario(id),
  retirado_en   timestamptz,
  CONSTRAINT retirada_sin_contenido CHECK (retirado_en IS NULL OR cifrado IS NULL)
);
CREATE INDEX nomina_carga_ejercicio ON nomina_carga (ejercicio) WHERE retirado_en IS NULL;

-- Evaluación del presupuesto que propone el equipo financiero frente al modelo (una por ejercicio).
CREATE TABLE evaluacion_equipo (
  ejercicio    integer PRIMARY KEY REFERENCES ejercicio(anio),
  contenido    jsonb NOT NULL,
  cargado_por  bigint NOT NULL REFERENCES usuario(id),
  cargado_en   timestamptz NOT NULL DEFAULT now()
);
