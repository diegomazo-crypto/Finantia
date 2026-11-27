-- Finantia 2.0 · Módulo de Administración: usuarios, módulos, accesos por rol,
-- configuración de aprobaciones y bitácora. PostgreSQL 14 o superior.

CREATE TABLE modulo (
  codigo      text PRIMARY KEY,                -- ADMINISTRACION, PRESUPUESTO, EJECUCION, AUDITORIA, PLANEACION
  nombre      text NOT NULL,
  activo      boolean NOT NULL DEFAULT true,   -- un módulo en pausa no admite accesos nuevos
  orden       integer NOT NULL
);

INSERT INTO modulo (codigo, nombre, activo, orden) VALUES
  ('ADMINISTRACION', 'Administración', true, 0),
  ('PRESUPUESTO', 'Presupuesto', true, 1),
  ('EJECUCION', 'Ejecución presupuestal', true, 2),
  ('AUDITORIA', 'Auditoría contable', false, 3),   -- en pausa por decisión de Diego (2026-11-27)
  ('PLANEACION', 'Planeación financiera', true, 4);

-- Microsoft 365 (Entra ID) solo verifica la identidad; los permisos viven aquí.
CREATE TABLE usuario (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correo           text NOT NULL,
  nombre           text NOT NULL,
  entra_oid        text UNIQUE,                 -- se fija en el primer ingreso
  activo           boolean NOT NULL DEFAULT true,
  es_superusuario  boolean NOT NULL DEFAULT false,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  creado_por       bigint REFERENCES usuario(id),
  ultimo_ingreso   timestamptz,
  CONSTRAINT correo_minusculas CHECK (correo = lower(correo))
);
CREATE UNIQUE INDEX usuario_correo ON usuario (correo);

CREATE TABLE acceso (
  usuario_id        bigint NOT NULL REFERENCES usuario(id),
  modulo            text NOT NULL REFERENCES modulo(codigo),
  rol               text NOT NULL CHECK (rol IN ('VISUALIZACION', 'ADMINISTRACION', 'APROBACION')),
  detalle_sensible  boolean NOT NULL DEFAULT false,   -- ve la nómina por cargo
  asignado_en       timestamptz NOT NULL DEFAULT now(),
  asignado_por      bigint NOT NULL REFERENCES usuario(id),
  PRIMARY KEY (usuario_id, modulo),
  CONSTRAINT admin_solo_superusuario CHECK (modulo <> 'ADMINISTRACION')
);

-- Cuántas aprobaciones necesita una versión y, si se fija, en qué orden.
CREATE TABLE config_aprobacion (
  modulo                  text PRIMARY KEY REFERENCES modulo(codigo),
  aprobaciones_requeridas integer NOT NULL DEFAULT 1 CHECK (aprobaciones_requeridas BETWEEN 1 AND 5),
  en_orden                boolean NOT NULL DEFAULT false,
  actualizado_en          timestamptz NOT NULL DEFAULT now(),
  actualizado_por         bigint REFERENCES usuario(id)
);
INSERT INTO config_aprobacion (modulo) VALUES ('PRESUPUESTO'), ('EJECUCION'), ('PLANEACION');

-- Orden de aprobadores cuando en_orden = true (posición 1 aprueba primero).
CREATE TABLE aprobador_orden (
  modulo      text NOT NULL REFERENCES config_aprobacion(modulo),
  posicion    integer NOT NULL CHECK (posicion >= 1),
  usuario_id  bigint NOT NULL REFERENCES usuario(id),
  PRIMARY KEY (modulo, posicion),
  UNIQUE (modulo, usuario_id)
);

-- Quién hizo qué y cuándo. Solo se inserta; nunca se modifica ni se borra.
CREATE TABLE bitacora (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha       timestamptz NOT NULL DEFAULT now(),
  usuario_id  bigint REFERENCES usuario(id),
  modulo      text NOT NULL REFERENCES modulo(codigo),
  accion      text NOT NULL,
  entidad     text,
  entidad_id  text,
  antes       jsonb,
  despues     jsonb,
  detalle     text
);
CREATE INDEX bitacora_modulo_fecha ON bitacora (modulo, fecha DESC);
CREATE INDEX bitacora_usuario_fecha ON bitacora (usuario_id, fecha DESC);

CREATE FUNCTION bitacora_inmutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La bitácora no se puede modificar ni borrar';
END $$;
CREATE TRIGGER bitacora_sin_cambios BEFORE UPDATE OR DELETE ON bitacora
  FOR EACH ROW EXECUTE FUNCTION bitacora_inmutable();
