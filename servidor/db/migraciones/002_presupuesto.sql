-- Finantia 2.0 · Módulo Presupuesto: catálogos comunes, ejercicios, versiones,
-- aprobaciones, resultados y líneas presupuestales.

-- Catálogos comunes (los comparten Presupuesto y Ejecución presupuestal)
CREATE TABLE unidad (
  codigo  text PRIMARY KEY,          -- PRE, POS, MAE, PLUS, EXT, URE, BAQ
  nombre  text NOT NULL,
  orden   integer NOT NULL,
  activa  boolean NOT NULL DEFAULT true
);
INSERT INTO unidad (codigo, nombre, orden) VALUES
  ('PRE', 'Pregrado', 0), ('POS', 'Especializaciones', 1), ('MAE', 'Maestrías', 2), ('PLUS', 'Plus', 3),
  ('EXT', 'Extensión', 4), ('URE', 'URE / Isolution', 5), ('BAQ', 'Barranquilla', 6);

CREATE TABLE cuenta (               -- plan de cuentas (se carga en la Fase 0)
  codigo  text PRIMARY KEY,
  nombre  text NOT NULL,
  activa  boolean NOT NULL DEFAULT true
);

CREATE TABLE centro_costo (
  codigo  text PRIMARY KEY,
  nombre  text NOT NULL,
  unidad  text REFERENCES unidad(codigo),
  activo  boolean NOT NULL DEFAULT true
);

CREATE TABLE programa (
  codigo  text PRIMARY KEY,
  nombre  text NOT NULL,
  unidad  text NOT NULL REFERENCES unidad(codigo),
  sede    text NOT NULL,
  activo  boolean NOT NULL DEFAULT true
);

-- Base del año en curso (2026E) de la que parte un ejercicio: datos/base2026.json
CREATE TABLE datos_base (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anio_base   integer NOT NULL,
  descripcion text NOT NULL,
  contenido   jsonb NOT NULL,
  huella      text NOT NULL,          -- SHA-256 del contenido
  cargado_en  timestamptz NOT NULL DEFAULT now(),
  cargado_por bigint NOT NULL REFERENCES usuario(id)
);

CREATE TABLE ejercicio (
  anio        integer PRIMARY KEY,    -- año que se presupuesta (2027)
  estado      text NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO', 'CERRADO')),
  creado_en   timestamptz NOT NULL DEFAULT now(),
  creado_por  bigint NOT NULL REFERENCES usuario(id)
);

-- Borrador → En revisión → Aprobada → Reemplazada (y En revisión → Borrador al devolver)
CREATE TABLE version (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ejercicio          integer NOT NULL REFERENCES ejercicio(anio),
  numero             integer NOT NULL,
  nombre             text NOT NULL,
  estado             text NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR', 'EN_REVISION', 'APROBADA', 'REEMPLAZADA')),
  datos_base_id      bigint NOT NULL REFERENCES datos_base(id),
  supuestos          jsonb NOT NULL DEFAULT '{}',   -- entradas de crearModelo(): params por escenario, metas, esic
  escenario_oficial  text CHECK (escenario_oficial IN ('Pesimista', 'Moderado', 'Optimista')),
  copia_de           bigint REFERENCES version(id),
  ronda              integer NOT NULL DEFAULT 1,    -- sube cada vez que se devuelve y se reenvía
  creada_en          timestamptz NOT NULL DEFAULT now(),
  creada_por         bigint NOT NULL REFERENCES usuario(id),
  enviada_en         timestamptz,
  enviada_por        bigint REFERENCES usuario(id),
  aprobada_en        timestamptz,
  reemplazada_en     timestamptz,
  reemplazada_por    bigint REFERENCES version(id),
  UNIQUE (ejercicio, numero)
);
-- A lo sumo una versión aprobada por ejercicio
CREATE UNIQUE INDEX version_una_aprobada ON version (ejercicio) WHERE estado = 'APROBADA';

CREATE TABLE decision_aprobacion (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id     bigint NOT NULL REFERENCES version(id),
  ronda          integer NOT NULL,
  usuario_id     bigint NOT NULL REFERENCES usuario(id),
  decision       text NOT NULL CHECK (decision IN ('APROBAR', 'DEVOLVER')),
  observaciones  text,
  fecha          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, ronda, usuario_id)
);

-- Resultado del motor guardado por versión y escenario (se recalcula al cambiar supuestos)
CREATE TABLE resultado (
  version_id     bigint NOT NULL REFERENCES version(id),
  escenario      text NOT NULL CHECK (escenario IN ('Pesimista', 'Moderado', 'Optimista')),
  resumen        jsonb NOT NULL,
  motor_version  text NOT NULL,
  calculado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, escenario)
);

-- Línea presupuestal de la versión aprobada (escenario oficial): la pieza que
-- Ejecución presupuestal compara contra el balance de prueba.
CREATE TABLE linea_presupuestal (
  version_id    bigint NOT NULL REFERENCES version(id),
  linea         integer NOT NULL,          -- renglón de Base2026 (datos/base2026.json → LN)
  codigo        text NOT NULL,             -- IB, DS, N, C, F, V, VN, VI, FX, OI, DA, PI, X
  bloque        text NOT NULL,             -- bloque del estado de resultados CEIPA
  unidad        text NOT NULL REFERENCES unidad(codigo),
  mes           integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  valor         numeric(18, 2) NOT NULL,
  cuenta        text REFERENCES cuenta(codigo),          -- se asocia cuando exista el plan de cuentas
  centro_costo  text REFERENCES centro_costo(codigo),
  PRIMARY KEY (version_id, linea, unidad, mes)
);
