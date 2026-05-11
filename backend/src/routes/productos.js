import { Router } from 'express';
import { lucia } from '../auth.js';
import db from '../db/database.js';

const router = Router();

// ── Auth middleware ──────────────────────────────────
async function requireUser(req, res) {
  const sessionId = req.cookies?.auth_session;
  if (!sessionId) { res.status(401).json({ error: 'No autenticado' }); return null; }
  try {
    const { user } = await lucia.validateSession(sessionId);
    if (!user) { res.status(401).json({ error: 'Sesión inválida' }); return null; }
    return user.id;
  } catch { res.status(401).json({ error: 'Sesión inválida' }); return null; }
}

// ── Helpers ──────────────────────────────────────────
function calcularPrecios(precio_costo, margen_pct) {
  const costo  = parseFloat(precio_costo) || 0;
  const margen = parseFloat(margen_pct)   || 0;
  const con_iva = Math.round(costo * 1.21 * 100) / 100;
  const venta   = Math.round(con_iva * (1 + margen / 100) * 100) / 100;
  return { precio_con_iva: con_iva, precio_venta: venta };
}

function getMargenGlobal(userId) {
  const row = db.prepare(
    `SELECT valor FROM configuracion WHERE user_id = ? AND clave = 'margen_ganancia_default'`
  ).get(userId);
  return parseFloat(row?.valor ?? 30);
}

// GET /api/productos
router.get('/', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { q, marca_id, categoria, bajo_stock, activo = 1 } = req.query;

  let sql = `
    SELECT p.*, m.nombre as marca_nombre,
      (SELECT COUNT(*) FROM producto_variantes WHERE producto_id = p.id AND activo = 1) as cant_variantes
    FROM productos p
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = ? AND p.activo = ?
  `;
  const params = [userId, activo];

  if (q) {
    sql += ` AND (p.nombre LIKE ? OR p.codigo_barras LIKE ? OR p.sku LIKE ? OR p.descripcion LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (marca_id)  { sql += ` AND p.marca_id = ?`;  params.push(marca_id); }
  if (categoria) { sql += ` AND p.categoria = ?`; params.push(categoria); }
  if (bajo_stock === '1') {
    sql += ` AND (
      (p.stock_actual <= p.stock_minimo AND (SELECT COUNT(*) FROM producto_variantes WHERE producto_id = p.id AND activo = 1) = 0)
      OR EXISTS (SELECT 1 FROM producto_variantes WHERE producto_id = p.id AND activo = 1 AND stock_actual <= stock_minimo)
    )`;
  }

  sql += ` ORDER BY p.nombre ASC`;
  res.json(db.prepare(sql).all(...params));
});

// GET /api/productos/categorias
router.get('/categorias', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const cats = db.prepare(
    `SELECT DISTINCT categoria FROM productos WHERE user_id = ? AND activo = 1 ORDER BY categoria`
  ).all(userId);
  res.json(cats.map(r => r.categoria));
});

// GET /api/productos/buscar
router.get('/buscar', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { q = '' } = req.query;
  const like = `%${q}%`;

  const simples = db.prepare(`
    SELECT p.id, p.nombre, p.codigo_barras, p.sku, p.categoria,
      p.precio_venta, p.precio_costo, p.precio_con_iva,
      p.stock_actual, p.stock_minimo, p.unidad,
      p.tiene_variantes, m.nombre as marca_nombre,
      NULL as variante_id, NULL as variante_nombre, p.id as producto_id
    FROM productos p
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = ? AND p.activo = 1 AND p.tiene_variantes = 0
      AND (p.nombre LIKE ? OR p.codigo_barras LIKE ? OR p.sku LIKE ? OR p.descripcion LIKE ?)
    ORDER BY p.nombre ASC LIMIT 30
  `).all(userId, like, like, like, like);

  const variantes = db.prepare(`
    SELECT p.id, p.nombre as nombre_padre, p.categoria, p.tiene_variantes,
      m.nombre as marca_nombre,
      pv.id as variante_id, pv.nombre as variante_nombre,
      pv.codigo_barras, pv.sku,
      COALESCE(pv.precio_venta, p.precio_venta)   as precio_venta,
      COALESCE(pv.precio_costo, p.precio_costo)   as precio_costo,
      COALESCE(pv.precio_con_iva, p.precio_con_iva) as precio_con_iva,
      pv.stock_actual, pv.stock_minimo, p.unidad, p.id as producto_id,
      p.nombre || ' — ' || pv.nombre as nombre
    FROM producto_variantes pv
    JOIN productos p ON p.id = pv.producto_id
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = ? AND pv.activo = 1 AND p.activo = 1
      AND (p.nombre LIKE ? OR pv.nombre LIKE ? OR pv.codigo_barras LIKE ? OR pv.sku LIKE ?)
    ORDER BY p.nombre ASC, pv.nombre ASC LIMIT 30
  `).all(userId, like, like, like, like);

  res.json([...simples, ...variantes]);
});

// GET /api/productos/barcode/:codigo
router.get('/barcode/:codigo', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const p = db.prepare(`
    SELECT p.*, m.nombre as marca_nombre FROM productos p
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = ? AND p.codigo_barras = ? AND p.activo = 1
  `).get(userId, req.params.codigo);
  if (p) return res.json({ ...p, _esVariante: false });

  const v = db.prepare(`
    SELECT pv.*, p.nombre as producto_nombre, p.categoria, p.marca_id,
      m.nombre as marca_nombre, p.margen_ganancia as margen_padre,
      p.precio_costo as costo_padre
    FROM producto_variantes pv
    JOIN productos p ON p.id = pv.producto_id
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = ? AND pv.codigo_barras = ? AND pv.activo = 1 AND p.activo = 1
  `).get(userId, req.params.codigo);
  if (v) return res.json({ ...v, nombre: `${v.producto_nombre} — ${v.nombre}`, _esVariante: true });

  res.status(404).json({ error: 'Producto no encontrado' });
});

// GET /api/productos/:id
router.get('/:id', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const p = db.prepare(`
    SELECT p.*, m.nombre as marca_nombre FROM productos p
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.id = ? AND p.user_id = ?
  `).get(req.params.id, userId);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  res.json(p);
});

// POST /api/productos
router.post('/', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    codigo_barras, sku, nombre, descripcion,
    marca_id, categoria = 'General', unidad = 'unidad',
    tiene_variantes = 0, precio_costo = 0, margen_ganancia,
    stock_actual = 0, stock_minimo = 0
  } = req.body;

  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

  const margenEfectivo = margen_ganancia ?? getMargenGlobal(userId);
  const { precio_con_iva, precio_venta } = calcularPrecios(precio_costo, margenEfectivo);
  const stockFinal = tiene_variantes ? 0 : (stock_actual || 0);

  try {
    const r = db.prepare(`
      INSERT INTO productos
        (user_id, codigo_barras, sku, nombre, descripcion, marca_id, categoria, unidad,
         tiene_variantes, precio_costo, margen_ganancia, precio_con_iva, precio_venta,
         stock_actual, stock_minimo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      userId,
      codigo_barras || null, sku || null, nombre.trim(), descripcion || null,
      marca_id || null, categoria, unidad,
      tiene_variantes ? 1 : 0,
      precio_costo, margen_ganancia ?? null, precio_con_iva, precio_venta,
      stockFinal, stock_minimo
    );
    res.status(201).json(
      db.prepare(`SELECT p.*, m.nombre as marca_nombre FROM productos p LEFT JOIN marcas m ON m.id = p.marca_id WHERE p.id = ?`).get(r.lastInsertRowid)
    );
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código de barras o SKU ya existe' });
    throw err;
  }
});

// PUT /api/productos/:id
router.put('/:id', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const actual = db.prepare(`SELECT * FROM productos WHERE id = ? AND user_id = ?`).get(req.params.id, userId);
  if (!actual) return res.status(404).json({ error: 'No encontrado' });

  const {
    codigo_barras, sku, nombre, descripcion, marca_id, categoria, unidad,
    tiene_variantes, precio_costo, margen_ganancia, stock_actual, stock_minimo, activo
  } = req.body;

  const nuevoCosto         = precio_costo  ?? actual.precio_costo;
  const nuevoMargen        = margen_ganancia !== undefined ? margen_ganancia : actual.margen_ganancia;
  const margenEfectivo     = nuevoMargen ?? getMargenGlobal(userId);
  const { precio_con_iva, precio_venta } = calcularPrecios(nuevoCosto, margenEfectivo);
  const nuevoTieneVariantes = tiene_variantes !== undefined ? (tiene_variantes ? 1 : 0) : actual.tiene_variantes;
  const nuevoStock         = nuevoTieneVariantes ? 0 : (stock_actual ?? actual.stock_actual);

  try {
    db.prepare(`
      UPDATE productos SET
        codigo_barras = COALESCE(?, codigo_barras), sku = COALESCE(?, sku),
        nombre = COALESCE(?, nombre), descripcion = ?,
        marca_id = ?, categoria = COALESCE(?, categoria), unidad = COALESCE(?, unidad),
        tiene_variantes = ?, precio_costo = ?, margen_ganancia = ?,
        precio_con_iva = ?, precio_venta = ?,
        stock_actual = ?, stock_minimo = COALESCE(?, stock_minimo),
        activo = COALESCE(?, activo)
      WHERE id = ? AND user_id = ?
    `).run(
      codigo_barras ?? null, sku ?? null, nombre?.trim() ?? null,
      descripcion !== undefined ? descripcion : actual.descripcion,
      marca_id !== undefined ? (marca_id || null) : actual.marca_id,
      categoria ?? null, unidad ?? null,
      nuevoTieneVariantes, nuevoCosto,
      nuevoMargen !== undefined ? nuevoMargen : actual.margen_ganancia,
      precio_con_iva, precio_venta, nuevoStock,
      stock_minimo ?? null, activo ?? null,
      req.params.id, userId
    );
    res.json(
      db.prepare(`SELECT p.*, m.nombre as marca_nombre FROM productos p LEFT JOIN marcas m ON m.id = p.marca_id WHERE p.id = ?`).get(req.params.id)
    );
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código de barras o SKU ya existe' });
    throw err;
  }
});

// PATCH /api/productos/:id/stock
router.patch('/:id/stock', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { cantidad, operacion = 'set' } = req.body;
  const p = db.prepare(`SELECT * FROM productos WHERE id = ? AND user_id = ?`).get(req.params.id, userId);
  if (!p) return res.status(404).json({ error: 'No encontrado' });

  let nuevo;
  if (operacion === 'add')           nuevo = p.stock_actual + cantidad;
  else if (operacion === 'subtract') nuevo = p.stock_actual - cantidad;
  else nuevo = cantidad;

  if (nuevo < 0) return res.status(400).json({ error: 'Stock no puede ser negativo' });
  db.prepare(`UPDATE productos SET stock_actual = ? WHERE id = ? AND user_id = ?`).run(nuevo, req.params.id, userId);
  res.json({ stock_actual: nuevo });
});

// DELETE /api/productos/:id
router.delete('/:id', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  db.prepare(`UPDATE productos SET activo = 0, codigo_barras = NULL, sku = NULL WHERE id = ? AND user_id = ?`)
    .run(req.params.id, userId);
  res.json({ ok: true });
});

// POST /api/productos/recalcular-todos
router.post('/recalcular-todos', async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const margenGlobal = getMargenGlobal(userId);
  const productos = db.prepare(
    `SELECT * FROM productos WHERE user_id = ? AND activo = 1 AND margen_ganancia IS NULL`
  ).all(userId);
  const update = db.prepare(`UPDATE productos SET precio_con_iva = ?, precio_venta = ? WHERE id = ?`);
  db.transaction(() => {
    for (const p of productos) {
      const { precio_con_iva, precio_venta } = calcularPrecios(p.precio_costo, margenGlobal);
      update.run(precio_con_iva, precio_venta, p.id);
    }
  })();
  res.json({ actualizados: productos.length });
});

export default router;