import { Router } from "express";
import { lucia } from "../auth.js";
import db from "../db/database.js";

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

function getMargenGlobal(userId) {
  const row = db
    .prepare(
      `SELECT valor FROM configuracion WHERE user_id = ? AND clave = 'margen_ganancia_default'`,
    )
    .get(userId);
  return parseFloat(row?.valor ?? 30);
}

function calcularPreciosVariante(variante, padre, userId) {
  const costo = variante.precio_costo ?? padre.precio_costo;
  const margen =
    variante.margen_ganancia ??
    padre.margen_ganancia ??
    getMargenGlobal(userId);
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
  // Verificar que el producto pertenece al usuario
  const padre = db
    .prepare(`SELECT * FROM productos WHERE id = ? AND user_id = ?`)
    .get(req.params.productoId, userId);
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });
  res.json(
    db
      .prepare(
        `SELECT * FROM producto_variantes WHERE producto_id = ? AND activo = 1 ORDER BY orden ASC, nombre ASC`,
      )
      .all(req.params.productoId),
  );
});

router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const padre = db
    .prepare(`SELECT * FROM productos WHERE id = ? AND user_id = ?`)
    .get(req.params.productoId, userId);
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

  const { precio_con_iva, precio_venta } = calcularPreciosVariante(
    {
      precio_costo: precio_costo ?? null,
      margen_ganancia: margen_ganancia ?? null,
    },
    padre,
    userId,
  );

  try {
    const r = db
      .prepare(
        `
      INSERT INTO producto_variantes
        (producto_id, nombre, sku, codigo_barras, precio_costo, margen_ganancia, precio_con_iva, precio_venta, stock_actual, stock_minimo, orden)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
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
      );
    res
      .status(201)
      .json(
        db
          .prepare(`SELECT * FROM producto_variantes WHERE id = ?`)
          .get(r.lastInsertRowid),
      );
  } catch (err) {
    if (err.message.includes("UNIQUE"))
      return res.status(409).json({ error: "El código de barras ya existe" });
    throw err;
  }
});

router.put("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const padre = db
    .prepare(`SELECT * FROM productos WHERE id = ? AND user_id = ?`)
    .get(req.params.productoId, userId);
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });

  const actual = db
    .prepare(
      `SELECT * FROM producto_variantes WHERE id = ? AND producto_id = ?`,
    )
    .get(req.params.id, req.params.productoId);
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
  const { precio_con_iva, precio_venta } = calcularPreciosVariante(
    { precio_costo: nuevoCosto, margen_ganancia: nuevoMargen },
    padre,
    userId,
  );

  try {
    db.prepare(
      `
      UPDATE producto_variantes SET
        nombre = COALESCE(?, nombre), sku = ?, codigo_barras = ?,
        precio_costo = ?, margen_ganancia = ?, precio_con_iva = ?, precio_venta = ?,
        stock_actual = COALESCE(?, stock_actual), stock_minimo = COALESCE(?, stock_minimo),
        orden = COALESCE(?, orden)
      WHERE id = ? AND producto_id = ?
    `,
    ).run(
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
    );
    res.json(
      db
        .prepare(`SELECT * FROM producto_variantes WHERE id = ?`)
        .get(req.params.id),
    );
  } catch (err) {
    if (err.message.includes("UNIQUE"))
      return res.status(409).json({ error: "El código de barras ya existe" });
    throw err;
  }
});

router.patch("/:id/stock", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const padre = db
    .prepare(`SELECT * FROM productos WHERE id = ? AND user_id = ?`)
    .get(req.params.productoId, userId);
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });

  const { cantidad, operacion = "set" } = req.body;
  const v = db
    .prepare(
      `SELECT * FROM producto_variantes WHERE id = ? AND producto_id = ?`,
    )
    .get(req.params.id, req.params.productoId);
  if (!v) return res.status(404).json({ error: "Variante no encontrada" });

  let nuevo;
  if (operacion === "add") nuevo = v.stock_actual + cantidad;
  else if (operacion === "subtract") nuevo = v.stock_actual - cantidad;
  else nuevo = cantidad;
  if (nuevo < 0)
    return res.status(400).json({ error: "Stock no puede ser negativo" });

  db.prepare(`UPDATE producto_variantes SET stock_actual = ? WHERE id = ?`).run(
    nuevo,
    req.params.id,
  );
  res.json({ stock_actual: nuevo });
});

router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const padre = db
    .prepare(`SELECT * FROM productos WHERE id = ? AND user_id = ?`)
    .get(req.params.productoId, userId);
  if (!padre) return res.status(404).json({ error: "Producto no encontrado" });
  db.prepare(
    `UPDATE producto_variantes SET activo = 0 WHERE id = ? AND producto_id = ?`,
  ).run(req.params.id, req.params.productoId);
  res.json({ ok: true });
});

export default router;
