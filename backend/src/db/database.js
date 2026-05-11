import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "../../data/local.db");
mkdirSync(join(__dirname, "../../data"), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  -- Auth
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    nombre        TEXT NOT NULL,
    password_hash TEXT,
    google_id     TEXT UNIQUE,
    avatar_url    TEXT,
    rol           TEXT NOT NULL DEFAULT 'user',
    activo        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- Config por usuario
  CREATE TABLE IF NOT EXISTS configuracion (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clave   TEXT NOT NULL,
    valor   TEXT,
    UNIQUE(user_id, clave)
  );

  -- Marcas por usuario
  CREATE TABLE IF NOT EXISTS marcas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nombre     TEXT NOT NULL,
    activo     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(user_id, nombre)
  );

  -- Productos por usuario
  CREATE TABLE IF NOT EXISTS productos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    codigo_barras   TEXT,
    sku             TEXT,
    nombre          TEXT NOT NULL,
    descripcion     TEXT,
    marca_id        INTEGER REFERENCES marcas(id),
    categoria       TEXT DEFAULT 'General',
    unidad          TEXT DEFAULT 'unidad',
    tiene_variantes INTEGER NOT NULL DEFAULT 0,
    precio_costo    REAL NOT NULL DEFAULT 0,
    margen_ganancia REAL,
    precio_con_iva  REAL NOT NULL DEFAULT 0,
    precio_venta    REAL NOT NULL DEFAULT 0,
    stock_actual    INTEGER NOT NULL DEFAULT 0,
    stock_minimo    INTEGER NOT NULL DEFAULT 0,
    activo          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now','localtime')),
    updated_at      TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS producto_variantes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id     INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    nombre          TEXT NOT NULL,
    sku             TEXT,
    codigo_barras   TEXT,
    precio_costo    REAL,
    margen_ganancia REAL,
    precio_con_iva  REAL NOT NULL DEFAULT 0,
    precio_venta    REAL NOT NULL DEFAULT 0,
    stock_actual    INTEGER NOT NULL DEFAULT 0,
    stock_minimo    INTEGER NOT NULL DEFAULT 0,
    activo          INTEGER NOT NULL DEFAULT 1,
    orden           INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Ventas por usuario
  CREATE TABLE IF NOT EXISTS ventas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fecha      TEXT DEFAULT (datetime('now','localtime')),
    total      REAL NOT NULL DEFAULT 0,
    medio_pago TEXT NOT NULL DEFAULT 'efectivo',
    notas      TEXT,
    anulada    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS venta_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    venta_id        INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id     INTEGER REFERENCES productos(id),
    variante_id     INTEGER REFERENCES producto_variantes(id),
    nombre_snapshot TEXT NOT NULL,
    cantidad        REAL NOT NULL DEFAULT 1,
    precio_unitario REAL NOT NULL,
    subtotal        REAL NOT NULL
  );

  -- Alquileres por usuario
  CREATE TABLE IF NOT EXISTS alquileres (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    numero_alquiler   TEXT,
    cliente_nombre    TEXT NOT NULL,
    cliente_telefono  TEXT,
    cliente_direccion TEXT,
    cliente_dni       TEXT,
    fecha_inicio      TEXT NOT NULL,
    fecha_devolucion  TEXT NOT NULL,
    periodo_tipo      TEXT NOT NULL DEFAULT 'semana',
    precio_total      REAL NOT NULL DEFAULT 0,
    estado            TEXT NOT NULL DEFAULT 'activo',
    notas             TEXT,
    created_at        TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS alquiler_items (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    alquiler_id          INTEGER NOT NULL REFERENCES alquileres(id) ON DELETE CASCADE,
    producto_alquiler_id INTEGER REFERENCES productos_alquiler(id),
    nombre_snapshot      TEXT NOT NULL,
    periodo_tipo         TEXT NOT NULL DEFAULT 'semana',
    precio_acordado      REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS pagos_alquiler (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    alquiler_id INTEGER NOT NULL REFERENCES alquileres(id) ON DELETE CASCADE,
    fecha_pago  TEXT DEFAULT (datetime('now','localtime')),
    monto       REAL NOT NULL,
    periodo     TEXT NOT NULL,
    notas       TEXT
  );

  -- Catálogo alquiler por usuario
  CREATE TABLE IF NOT EXISTS productos_alquiler (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nombre          TEXT NOT NULL,
    descripcion     TEXT,
    precio_semana   REAL NOT NULL DEFAULT 0,
    precio_2semanas REAL NOT NULL DEFAULT 0,
    precio_3semanas REAL NOT NULL DEFAULT 0,
    precio_mes      REAL NOT NULL DEFAULT 0,
    activo          INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Proveedores por usuario
  CREATE TABLE IF NOT EXISTS proveedores (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nombre               TEXT NOT NULL,
    contacto             TEXT,
    email                TEXT,
    telefono             TEXT,
    notas                TEXT,
    lista_precios_nombre TEXT,
    lista_precios_url    TEXT,
    lista_precios_fecha  TEXT,
    lista_precios_html   TEXT,
    activo               INTEGER NOT NULL DEFAULT 1,
    created_at           TEXT DEFAULT (datetime('now','localtime'))
  );

  -- WhatsApp log
  CREATE TABLE IF NOT EXISTS wa_notificaciones (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    alquiler_id INTEGER NOT NULL,
    tipo        TEXT NOT NULL,
    enviado_at  TEXT DEFAULT (datetime('now','localtime')),
    ok          INTEGER DEFAULT 1,
    error       TEXT
  );
`);

db.exec(`
  CREATE TRIGGER IF NOT EXISTS productos_updated_at
  AFTER UPDATE ON productos BEGIN
    UPDATE productos SET updated_at = datetime('now','localtime') WHERE id = NEW.id;
  END;
`);

export default db;
