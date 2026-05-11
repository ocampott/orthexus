import { Router } from "express";
import { lucia } from "../auth.js";
import pool from "../db/database.js";

const router = Router({ mergeParams: true });

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

async function getMargenGlobal(userId) {
  const { rows } = await pool.query(
    `SELECT valor FROM configuracion WHERE user_id = $1 AND clave = 'margen_ganancia_default'`,
    [userId],
  );
  return parseFloat(rows[0]?.valor ?? 30);
}

async function calcularPreciosVariante(variante, padre, userId) {
  const costo = variante.precio_costo ?? padre.precio_costo;
  const margen =
    variante.margen_ganancia ??
    padre.margen_ganancia ??
    (await getMargenGlobal(userId));
  const c = parseFloat(costo) || 0;
  const m = parseFloat(margen) || 0;
  return {
    precio_con_iva: Math.round(c * 1.21 * 100) / 100,
    precio_venta: Math.round(c * 1.21 * (1 + m / 100) * 100) / 100,
  };
}

router.get("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [padre],
  } = await pool.query(
    `SELECT * FROM productos WHERE id = $1 AND user_id = $2`,
    [req.params.productoId, userId],
  );
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });

  const { rows } = await pool.query(
    `SELECT * FROM producto_variantes WHERE producto_id = $1 AND activo = true ORDER BY orden ASC, nombre ASC`,
    [req.params.productoId],
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [padre],
  } = await pool.query(
    `SELECT * FROM productos WHERE id = $1 AND user_id = $2`,
    [req.params.productoId, userId],
  );
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });

  const {
    nombre,
    sku,
    codigo_barras,
    precio_costo,
    margen_ganancia,
    stock_actual = 0,
    stock_minimo = 0,
    orden = 0,
  } = req.body;
  if (!nombre?.trim())
    return res.status(400).json({ error: "El nombre es obligatorio" });

  const { precio_con_iva, precio_venta } = await calcularPreciosVariante(
    {
      precio_costo: precio_costo ?? null,
      margen_ganancia: margen_ganancia ?? null,
    },
    padre,
    userId,
  );

  try {
    const {
      rows: [nueva],
    } = await pool.query(
      `
      INSERT INTO producto_variantes
        (producto_id, nombre, sku, codigo_barras, precio_costo, margen_ganancia, precio_con_iva, precio_venta, stock_actual, stock_minimo, orden)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `,
      [
        req.params.productoId,
        nombre.trim(),
        sku || null,
        codigo_barras || null,
        precio_costo ?? null,
        margen_ganancia ?? null,
        precio_con_iva,
        precio_venta,
        stock_actual,
        stock_minimo,
        orden,
      ],
    );
    res.status(201).json(nueva);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "El código de barras ya existe" });
    throw err;
  }
});

router.put("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [padre],
  } = await pool.query(
    `SELECT * FROM productos WHERE id = $1 AND user_id = $2`,
    [req.params.productoId, userId],
  );
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });

  const {
    rows: [actual],
  } = await pool.query(
    `SELECT * FROM producto_variantes WHERE id = $1 AND producto_id = $2`,
    [req.params.id, req.params.productoId],
  );
  if (!actual) return res.status(404).json({ error: "Variante no encontrada" });

  const {
    nombre,
    sku,
    codigo_barras,
    precio_costo,
    margen_ganancia,
    stock_actual,
    stock_minimo,
    orden,
  } = req.body;
  const nuevoCosto =
    precio_costo !== undefined ? precio_costo : actual.precio_costo;
  const nuevoMargen =
    margen_ganancia !== undefined ? margen_ganancia : actual.margen_ganancia;
  const { precio_con_iva, precio_venta } = await calcularPreciosVariante(
    { precio_costo: nuevoCosto, margen_ganancia: nuevoMargen },
    padre,
    userId,
  );

  try {
    const {
      rows: [updated],
    } = await pool.query(
      `
      UPDATE producto_variantes SET
        nombre          = COALESCE($1, nombre),
        sku             = $2,
        codigo_barras   = $3,
        precio_costo    = $4,
        margen_ganancia = $5,
        precio_con_iva  = $6,
        precio_venta    = $7,
        stock_actual    = COALESCE($8, stock_actual),
        stock_minimo    = COALESCE($9, stock_minimo),
        orden           = COALESCE($10, orden)
      WHERE id = $11 AND producto_id = $12
      RETURNING *
    `,
      [
        nombre?.trim() ?? null,
        sku !== undefined ? sku || null : actual.sku,
        codigo_barras !== undefined
          ? codigo_barras || null
          : actual.codigo_barras,
        nuevoCosto,
        nuevoMargen,
        precio_con_iva,
        precio_venta,
        stock_actual ?? null,
        stock_minimo ?? null,
        orden ?? null,
        req.params.id,
        req.params.productoId,
      ],
    );
    res.json(updated);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "El código de barras ya existe" });
    throw err;
  }
});

router.patch("/:id/stock", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [padre],
  } = await pool.query(
    `SELECT * FROM productos WHERE id = $1 AND user_id = $2`,
    [req.params.productoId, userId],
  );
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });

  const { cantidad, operacion = "set" } = req.body;
  const {
    rows: [v],
  } = await pool.query(
    `SELECT * FROM producto_variantes WHERE id = $1 AND producto_id = $2`,
    [req.params.id, req.params.productoId],
  );
  if (!v) return res.status(404).json({ error: "Variante no encontrada" });

  let nuevo;
  if (operacion === "add") nuevo = Number(v.stock_actual) + cantidad;
  else if (operacion === "subtract") nuevo = Number(v.stock_actual) - cantidad;
  else nuevo = cantidad;
  if (nuevo < 0)
    return res.status(400).json({ error: "Stock no puede ser negativo" });

  await pool.query(
    `UPDATE producto_variantes SET stock_actual = $1 WHERE id = $2`,
    [nuevo, req.params.id],
  );
  res.json({ stock_actual: nuevo });
});

router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [padre],
  } = await pool.query(
    `SELECT * FROM productos WHERE id = $1 AND user_id = $2`,
    [req.params.productoId, userId],
  );
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });

  await pool.query(
    `UPDATE producto_variantes SET activo = false WHERE id = $1 AND producto_id = $2`,
    [req.params.id, req.params.productoId],
  );
  res.json({ ok: true });
});

export default router;
