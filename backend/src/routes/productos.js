import { Router } from "express";
import { lucia } from "../auth.js";
import pool from "../db/database.js";

const router = Router();

async function requireUser(req, res) {
  const sessionId = req.cookies?.auth_session;
  if (!sessionId) {
    res.status(401).json({ error: "No autenticado" });
    return null;
  }
  try {
    const { user } = await lucia.validateSession(sessionId);
    if (!user) {
      res.status(401).json({ error: "Sesión inválida" });
      return null;
    }
    return user.id;
  } catch {
    res.status(401).json({ error: "Sesión inválida" });
    return null;
  }
}

function calcularPrecios(precio_costo, margen_pct) {
  const costo = parseFloat(precio_costo) || 0;
  const margen = parseFloat(margen_pct) || 0;
  const con_iva = Math.round(costo * 1.21 * 100) / 100;
  const venta = Math.round(con_iva * (1 + margen / 100) * 100) / 100;
  return { precio_con_iva: con_iva, precio_venta: venta };
}

async function getMargenGlobal(userId) {
  const { rows } = await pool.query(
    `SELECT valor FROM configuracion WHERE user_id = $1 AND clave = 'margen_ganancia_default'`,
    [userId],
  );
  return parseFloat(rows[0]?.valor ?? 30);
}

const SELECT_PRODUCTO = `
  SELECT p.*, m.nombre as marca_nombre,
    (SELECT COUNT(*) FROM producto_variantes WHERE producto_id = p.id AND activo = true) as cant_variantes
  FROM productos p
  LEFT JOIN marcas m ON m.id = p.marca_id
`;

// GET /api/productos
router.get("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { q, marca_id, categoria, bajo_stock, activo = "true" } = req.query;
  const activoBool = activo === "1" || activo === "true";

  let sql = `${SELECT_PRODUCTO} WHERE p.user_id = $1 AND p.activo = $2`;
  const params = [userId, activoBool];
  let i = 3;

  if (q) {
    sql += ` AND (p.nombre ILIKE $${i} OR p.codigo_barras ILIKE $${i} OR p.sku ILIKE $${i} OR p.descripcion ILIKE $${i})`;
    params.push(`%${q}%`);
    i++;
  }
  if (marca_id) {
    sql += ` AND p.marca_id = $${i}`;
    params.push(marca_id);
    i++;
  }
  if (categoria) {
    sql += ` AND p.categoria = $${i}`;
    params.push(categoria);
    i++;
  }
  if (bajo_stock === "1") {
    sql += ` AND (
      (p.stock_actual <= p.stock_minimo AND (SELECT COUNT(*) FROM producto_variantes WHERE producto_id = p.id AND activo = true) = 0)
      OR EXISTS (SELECT 1 FROM producto_variantes WHERE producto_id = p.id AND activo = true AND stock_actual <= stock_minimo)
    )`;
  }
  sql += ` ORDER BY p.nombre ASC`;

  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

// GET /api/productos/categorias
router.get("/categorias", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { rows } = await pool.query(
    `SELECT DISTINCT categoria FROM productos WHERE user_id = $1 AND activo = true ORDER BY categoria`,
    [userId],
  );
  res.json(rows.map((r) => r.categoria));
});

// GET /api/productos/buscar
router.get("/buscar", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { q = "" } = req.query;
  const like = `%${q}%`;

  const { rows: simples } = await pool.query(
    `
    SELECT p.id, p.nombre, p.codigo_barras, p.sku, p.categoria,
      p.precio_venta, p.precio_costo, p.precio_con_iva,
      p.stock_actual, p.stock_minimo, p.unidad,
      p.tiene_variantes, m.nombre as marca_nombre,
      NULL as variante_id, NULL as variante_nombre, p.id as producto_id
    FROM productos p
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = $1 AND p.activo = true AND p.tiene_variantes = false
      AND (p.nombre ILIKE $2 OR p.codigo_barras ILIKE $2 OR p.sku ILIKE $2 OR p.descripcion ILIKE $2)
    ORDER BY p.nombre ASC LIMIT 30
  `,
    [userId, like],
  );

  const { rows: variantes } = await pool.query(
    `
    SELECT p.id, p.nombre as nombre_padre, p.categoria, p.tiene_variantes,
      m.nombre as marca_nombre,
      pv.id as variante_id, pv.nombre as variante_nombre,
      pv.codigo_barras, pv.sku,
      COALESCE(pv.precio_venta, p.precio_venta)     as precio_venta,
      COALESCE(pv.precio_costo, p.precio_costo)     as precio_costo,
      COALESCE(pv.precio_con_iva, p.precio_con_iva) as precio_con_iva,
      pv.stock_actual, pv.stock_minimo, p.unidad, p.id as producto_id,
      p.nombre || ' — ' || pv.nombre as nombre
    FROM producto_variantes pv
    JOIN productos p ON p.id = pv.producto_id
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = $1 AND pv.activo = true AND p.activo = true
      AND (p.nombre ILIKE $2 OR pv.nombre ILIKE $2 OR pv.codigo_barras ILIKE $2 OR pv.sku ILIKE $2)
    ORDER BY p.nombre ASC, pv.nombre ASC LIMIT 30
  `,
    [userId, like],
  );

  res.json([...simples, ...variantes]);
});

// GET /api/productos/barcode/:codigo
router.get("/barcode/:codigo", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [p],
  } = await pool.query(
    `
    SELECT p.*, m.nombre as marca_nombre FROM productos p
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = $1 AND p.codigo_barras = $2 AND p.activo = true
  `,
    [userId, req.params.codigo],
  );
  if (p) return res.json({ ...p, _esVariante: false });

  const {
    rows: [v],
  } = await pool.query(
    `
    SELECT pv.*, p.nombre as producto_nombre, p.categoria, p.marca_id,
      m.nombre as marca_nombre, p.margen_ganancia as margen_padre,
      p.precio_costo as costo_padre
    FROM producto_variantes pv
    JOIN productos p ON p.id = pv.producto_id
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.user_id = $1 AND pv.codigo_barras = $2 AND pv.activo = true AND p.activo = true
  `,
    [userId, req.params.codigo],
  );
  if (v)
    return res.json({
      ...v,
      nombre: `${v.producto_nombre} — ${v.nombre}`,
      _esVariante: true,
    });

  res.status(404).json({ error: "Producto no encontrado" });
});

// GET /api/productos/:id
router.get("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [p],
  } = await pool.query(
    `
    SELECT p.*, m.nombre as marca_nombre FROM productos p
    LEFT JOIN marcas m ON m.id = p.marca_id
    WHERE p.id = $1 AND p.user_id = $2
  `,
    [req.params.id, userId],
  );
  if (!p) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(p);
});

// POST /api/productos
router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    codigo_barras,
    sku,
    nombre,
    descripcion,
    marca_id,
    categoria = "General",
    unidad = "unidad",
    tiene_variantes = false,
    precio_costo = 0,
    margen_ganancia,
    stock_actual = 0,
    stock_minimo = 0,
  } = req.body;

  if (!nombre?.trim())
    return res.status(400).json({ error: "El nombre es obligatorio" });

  const margenEfectivo = margen_ganancia ?? (await getMargenGlobal(userId));
  const { precio_con_iva, precio_venta } = calcularPrecios(
    precio_costo,
    margenEfectivo,
  );
  const stockFinal = tiene_variantes ? 0 : stock_actual || 0;

  try {
    const {
      rows: [nuevo],
    } = await pool.query(
      `
      INSERT INTO productos
        (user_id, codigo_barras, sku, nombre, descripcion, marca_id, categoria, unidad,
         tiene_variantes, precio_costo, margen_ganancia, precio_con_iva, precio_venta,
         stock_actual, stock_minimo)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING id
    `,
      [
        userId,
        codigo_barras || null,
        sku || null,
        nombre.trim(),
        descripcion || null,
        marca_id || null,
        categoria,
        unidad,
        !!tiene_variantes,
        precio_costo,
        margen_ganancia ?? null,
        precio_con_iva,
        precio_venta,
        stockFinal,
        stock_minimo,
      ],
    );

    const {
      rows: [p],
    } = await pool.query(
      `
      SELECT p.*, m.nombre as marca_nombre FROM productos p
      LEFT JOIN marcas m ON m.id = p.marca_id WHERE p.id = $1
    `,
      [nuevo.id],
    );
    res.status(201).json(p);
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "El código de barras o SKU ya existe" });
    throw err;
  }
});

// PUT /api/productos/:id
router.put("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [actual],
  } = await pool.query(
    `SELECT * FROM productos WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  if (!actual) return res.status(404).json({ error: "No encontrado" });

  const {
    codigo_barras,
    sku,
    nombre,
    descripcion,
    marca_id,
    categoria,
    unidad,
    tiene_variantes,
    precio_costo,
    margen_ganancia,
    stock_actual,
    stock_minimo,
    activo,
  } = req.body;

  const nuevoCosto = precio_costo ?? actual.precio_costo;
  const nuevoMargen =
    margen_ganancia !== undefined ? margen_ganancia : actual.margen_ganancia;
  const margenEfectivo = nuevoMargen ?? (await getMargenGlobal(userId));
  const { precio_con_iva, precio_venta } = calcularPrecios(
    nuevoCosto,
    margenEfectivo,
  );
  const nuevoTieneVariantes =
    tiene_variantes !== undefined ? !!tiene_variantes : actual.tiene_variantes;
  const nuevoStock = nuevoTieneVariantes
    ? 0
    : (stock_actual ?? actual.stock_actual);

  try {
    await pool.query(
      `
      UPDATE productos SET
        codigo_barras   = COALESCE($1, codigo_barras),
        sku             = COALESCE($2, sku),
        nombre          = COALESCE($3, nombre),
        descripcion     = $4,
        marca_id        = $5,
        categoria       = COALESCE($6, categoria),
        unidad          = COALESCE($7, unidad),
        tiene_variantes = $8,
        precio_costo    = $9,
        margen_ganancia = $10,
        precio_con_iva  = $11,
        precio_venta    = $12,
        stock_actual    = $13,
        stock_minimo    = COALESCE($14, stock_minimo),
        activo          = COALESCE($15, activo)
      WHERE id = $16 AND user_id = $17
    `,
      [
        codigo_barras ?? null,
        sku ?? null,
        nombre?.trim() ?? null,
        descripcion !== undefined ? descripcion : actual.descripcion,
        marca_id !== undefined ? marca_id || null : actual.marca_id,
        categoria ?? null,
        unidad ?? null,
        nuevoTieneVariantes,
        nuevoCosto,
        nuevoMargen !== undefined ? nuevoMargen : actual.margen_ganancia,
        precio_con_iva,
        precio_venta,
        nuevoStock,
        stock_minimo ?? null,
        activo ?? null,
        req.params.id,
        userId,
      ],
    );

    const {
      rows: [p],
    } = await pool.query(
      `
      SELECT p.*, m.nombre as marca_nombre FROM productos p
      LEFT JOIN marcas m ON m.id = p.marca_id WHERE p.id = $1
    `,
      [req.params.id],
    );
    res.json(p);
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "El código de barras o SKU ya existe" });
    throw err;
  }
});

// PATCH /api/productos/:id/stock
router.patch("/:id/stock", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { cantidad, operacion = "set" } = req.body;
  const {
    rows: [p],
  } = await pool.query(
    `SELECT * FROM productos WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  if (!p) return res.status(404).json({ error: "No encontrado" });

  let nuevo;
  if (operacion === "add") nuevo = p.stock_actual + cantidad;
  else if (operacion === "subtract") nuevo = p.stock_actual - cantidad;
  else nuevo = cantidad;

  if (nuevo < 0)
    return res.status(400).json({ error: "Stock no puede ser negativo" });
  await pool.query(
    `UPDATE productos SET stock_actual = $1 WHERE id = $2 AND user_id = $3`,
    [nuevo, req.params.id, userId],
  );
  res.json({ stock_actual: nuevo });
});

// DELETE /api/productos/:id
router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  await pool.query(
    `UPDATE productos SET activo = false, codigo_barras = NULL, sku = NULL WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  res.json({ ok: true });
});

// POST /api/productos/recalcular-todos
router.post("/recalcular-todos", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const margenGlobal = await getMargenGlobal(userId);
  const { rows: productos } = await pool.query(
    `SELECT * FROM productos WHERE user_id = $1 AND activo = true AND margen_ganancia IS NULL`,
    [userId],
  );

  for (const p of productos) {
    const { precio_con_iva, precio_venta } = calcularPrecios(
      p.precio_costo,
      margenGlobal,
    );
    await pool.query(
      `UPDATE productos SET precio_con_iva = $1, precio_venta = $2 WHERE id = $3`,
      [precio_con_iva, precio_venta, p.id],
    );
  }

  res.json({ actualizados: productos.length });
});

export default router;
