-- Finantia 2.0 · Presupuesto: archivos de soporte del ejercicio y preguntas al asistente.

-- Archivos que el equipo sube para elaborar el presupuesto (matrículas, nómina, programación…).
-- No se borran: se retiran, y la bitácora guarda quién y cuándo.
CREATE TABLE archivo (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejercicio     integer NOT NULL REFERENCES ejercicio(anio),
  nombre        text NOT NULL,
  tipo          text NOT NULL,
  tamano        integer NOT NULL,
  descripcion   text,
  huella        text NOT NULL,          -- SHA-256 del contenido
  contenido     bytea NOT NULL,
  subido_por    bigint NOT NULL REFERENCES usuario(id),
  subido_en     timestamptz NOT NULL DEFAULT now(),
  retirado_por  bigint REFERENCES usuario(id),
  retirado_en   timestamptz
);
CREATE INDEX archivo_ejercicio ON archivo (ejercicio) WHERE retirado_en IS NULL;

-- Preguntas al asistente sobre una versión: quedan guardadas para el equipo.
CREATE TABLE pregunta (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id     bigint NOT NULL REFERENCES version(id),
  usuario_id     bigint NOT NULL REFERENCES usuario(id),
  escenario      text NOT NULL,
  pregunta       text NOT NULL,
  respuesta      text,
  modelo         text,
  tokens_entrada integer,
  tokens_salida  integer,
  fecha          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pregunta_version ON pregunta (version_id, id);
