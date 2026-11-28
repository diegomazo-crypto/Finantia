-- Finantia 2.0 · Preguntas al asistente en cada módulo, con permiso por persona y módulo
-- (lo asigna el Superusuario en Administración; apagado por defecto).
ALTER TABLE acceso ADD COLUMN preguntas boolean NOT NULL DEFAULT false;
ALTER TABLE pregunta ALTER COLUMN version_id DROP NOT NULL;
ALTER TABLE pregunta ALTER COLUMN escenario DROP NOT NULL;
ALTER TABLE pregunta ADD COLUMN modulo text NOT NULL DEFAULT 'PRESUPUESTO';
ALTER TABLE pregunta ADD COLUMN anio integer;
CREATE INDEX pregunta_modulo ON pregunta (modulo, anio, id);
