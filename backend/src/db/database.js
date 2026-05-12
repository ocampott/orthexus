import pkg from "pg";
const { Pool, types } = pkg;

// Forzar que DATE (OID 1082) siempre se devuelva como string 'YYYY-MM-DD'
// y no como objeto Date. Sin esto, el timezone de la sesión hace que pg
// parsee las fechas como objetos y String() da "Mon May 12 2026...".
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // requerido por Supabase
});

// Forzar timezone Argentina en cada conexión para que fecha::date siempre
// use la hora local (UTC-3) y no UTC del servidor.
pool.on('connect', (client) => {
  client.query("SET timezone = 'America/Argentina/Buenos_Aires'");
});

// ── Inicializar schema ───────────────────────────────
async function initSchema() {
  await pool.query(`
    -- Auth
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      nombre        TEXT NOT NULL,
      password_hash TEXT,
      google_id     TEXT UNIQUE,
      avatar_url    TEXT,
      rol           TEXT NOT NULL DEFAULT 'user',
      activo        BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );

    -- Config por usuario
    CREATE TABLE IF NOT EXISTS configuracion (
      id      SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clave   TEXT NOT NULL,
      valor   TEXT,
      UNIQUE(user_id, clave)
    );

    -- Marcas por usuario
    CREATE TABLE IF NOT EXISTS marcas (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nombre     TEXT NOT NULL,
      activo     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, nombre)
    );

    -- Productos por usuario
    CREATE TABLE IF NOT EXISTS productos (
      id              SERIAL PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      codigo_barras   TEXT,
      sku             TEXT,
      nombre          TEXT NOT NULL,
      descripcion     TEXT,
      marca_id        INTEGER REFERENCES marcas(id),
      categoria       TEXT DEFAULT 'General',
      unidad          TEXT DEFAULT 'unidad',
      tiene_variantes BOOLEAN NOT NULL DEFAULT false,
      precio_costo    NUMERIC NOT NULL DEFAULT 0,
      margen_ganancia NUMERIC,
      precio_con_iva  NUMERIC NOT NULL DEFAULT 0,
      precio_venta    NUMERIC NOT NULL DEFAULT 0,
      stock_actual    INTEGER NOT NULL DEFAULT 0,
      stock_minimo    INTEGER NOT NULL DEFAULT 0,
      activo          BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS producto_variantes (
      id              SERIAL PRIMARY KEY,
      producto_id     INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      nombre          TEXT NOT NULL,
      sku             TEXT,
      codigo_barras   TEXT,
      precio_costo    NUMERIC,
      margen_ganancia NUMERIC,
      precio_con_iva  NUMERIC NOT NULL DEFAULT 0,
      precio_venta    NUMERIC NOT NULL DEFAULT 0,
      stock_actual    INTEGER NOT NULL DEFAULT 0,
      stock_minimo    INTEGER NOT NULL DEFAULT 0,
      activo          BOOLEAN NOT NULL DEFAULT true,
      orden           INTEGER NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- Ventas por usuario
    CREATE TABLE IF NOT EXISTS ventas (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      fecha      TIMESTAMPTZ DEFAULT NOW(),
      total      NUMERIC NOT NULL DEFAULT 0,
      medio_pago TEXT NOT NULL DEFAULT 'efectivo',
      notas      TEXT,
      anulada    BOOLEAN NOT NULL DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS venta_items (
      id              SERIAL PRIMARY KEY,
      venta_id        INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
      producto_id     INTEGER REFERENCES productos(id),
      variante_id     INTEGER REFERENCES producto_variantes(id),
      nombre_snapshot TEXT NOT NULL,
      cantidad        NUMERIC NOT NULL DEFAULT 1,
      precio_unitario NUMERIC NOT NULL,
      subtotal        NUMERIC NOT NULL
    );

    -- Alquileres por usuario
    CREATE TABLE IF NOT EXISTS alquileres (
      id                SERIAL PRIMARY KEY,
      user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      numero_alquiler   TEXT,
      cliente_nombre    TEXT NOT NULL,
      cliente_telefono  TEXT,
      cliente_direccion TEXT,
      cliente_dni       TEXT,
      fecha_inicio      DATE NOT NULL,
      fecha_devolucion  DATE NOT NULL,
      periodo_tipo      TEXT NOT NULL DEFAULT 'semana',
      precio_total      NUMERIC NOT NULL DEFAULT 0,
      estado            TEXT NOT NULL DEFAULT 'activo',
      notas             TEXT,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS productos_alquiler (
      id              SERIAL PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nombre          TEXT NOT NULL,
      descripcion     TEXT,
      precio_semana   NUMERIC NOT NULL DEFAULT 0,
      precio_2semanas NUMERIC NOT NULL DEFAULT 0,
      precio_3semanas NUMERIC NOT NULL DEFAULT 0,
      precio_mes      NUMERIC NOT NULL DEFAULT 0,
      activo          BOOLEAN NOT NULL DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alquiler_items (
      id                   SERIAL PRIMARY KEY,
      alquiler_id          INTEGER NOT NULL REFERENCES alquileres(id) ON DELETE CASCADE,
      producto_alquiler_id INTEGER REFERENCES productos_alquiler(id),
      nombre_snapshot      TEXT NOT NULL,
      periodo_tipo         TEXT NOT NULL DEFAULT 'semana',
      precio_acordado      NUMERIC NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pagos_alquiler (
      id          SERIAL PRIMARY KEY,
      alquiler_id INTEGER NOT NULL REFERENCES alquileres(id) ON DELETE CASCADE,
      fecha_pago  TIMESTAMPTZ DEFAULT NOW(),
      monto       NUMERIC NOT NULL,
      periodo     TEXT NOT NULL,
      notas       TEXT
    );

    -- Proveedores por usuario
    CREATE TABLE IF NOT EXISTS proveedores (
      id                   SERIAL PRIMARY KEY,
      user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nombre               TEXT NOT NULL,
      contacto             TEXT,
      email                TEXT,
      telefono             TEXT,
      notas                TEXT,
      lista_precios_nombre TEXT,
      lista_precios_url    TEXT,
      lista_precios_fecha  TIMESTAMPTZ,
      lista_precios_html   TEXT,
      activo               BOOLEAN NOT NULL DEFAULT true,
      created_at           TIMESTAMPTZ DEFAULT NOW()
    );

    -- Integraciones por usuario (WhatsApp, facturación, etc)
    CREATE TABLE IF NOT EXISTS tenant_integraciones (
      id           SERIAL PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      servicio     TEXT NOT NULL,
      phone_id     TEXT,
      access_token TEXT,
      config       JSONB DEFAULT '{}',
      activo       BOOLEAN DEFAULT true,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, servicio)
    );

    -- WhatsApp log
    CREATE TABLE IF NOT EXISTS wa_notificaciones (
      id          SERIAL PRIMARY KEY,
      alquiler_id INTEGER NOT NULL,
      tipo        TEXT NOT NULL,
      enviado_at  TIMESTAMPTZ DEFAULT NOW(),
      ok          BOOLEAN DEFAULT true,
      error       TEXT
    );
  `);

  // Trigger updated_at en productos
  await pool.query(`
    CREATE OR REPLACE FUNCTION update_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS productos_updated_at ON productos;
    CREATE TRIGGER productos_updated_at
      BEFORE UPDATE ON productos
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  `);

  console.log("[DB] Schema PostgreSQL listo ✓");
}

initSchema().catch((e) => {
  console.error("[DB] Error inicializando schema:", e.message);
  process.exit(1);
});

export default pool;