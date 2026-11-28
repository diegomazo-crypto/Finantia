-- Finantia 2.0 · Sitio de pruebas: clave personal de cada usuario (sin Microsoft 365).
-- Solo se guarda el resumen scrypt con su sal; la clave se muestra una vez al generarla.
CREATE TABLE clave_pruebas (
  usuario_id   bigint PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  resumen      text NOT NULL,           -- scrypt (hex)
  sal          text NOT NULL,           -- hex
  creada_por   bigint NOT NULL REFERENCES usuario(id),
  creada_en    timestamptz NOT NULL DEFAULT now()
);
