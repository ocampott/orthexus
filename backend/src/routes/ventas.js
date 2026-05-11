import { Router } from "express";
import { lucia } from "../auth.js";
import db from "../db/database.js";

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

function fechaLocal(d = new Date()) {
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().split("T")[0];
}

// GET /api/ventas
router.get("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { desde, hasta, medio_pago } = req.query;
  let sql = `
    SELECT v., (SELECT COUNT(*) FROM venta_items WHERE venta_id = v.id) as cantidad_items
    FROM ventas v WHERE v.user_id = ? AND v.anulada = 0
  `;
  const params = [userId];

  if (desde) {
    sql += ` AND date(v.fecha) >= date(?)`;
    params.push(desde);
  }
  if (hasta) {
    sql += ` AND date(v.fecha) <= date(?)`;
    params.push(hasta);
  }
  if (medio_pago) {
    sql += ` AND v.medio_pago = ?`;
    params.push(medio_pago);
  }
  sql += ` ORDER BY v.fecha DESC`;

  res.json(db.prepare(sql).all(...params));
});

// GET /api/ventas/resumen-hoy
router.get("/resumen-hoy", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const hoy = fechaLocal();
  res.json(
    db
      .prepare(
        `
    SELECT COUNT(*) as total_ventas,
      COALESCE(SUM(total),0) as total_recaudado,
      COALESCE(SUM(CASE WHEN medio_pago='efectivo'       THEN total ELSE 0 END),0) as efectivo,
      COALESCE(SUM(CASE WHEN medio_pago='transferencia'  THEN total ELSE 0 END),0) as transferencia,
      COALESCE(SUM(CASE WHEN medio_pago='tarjeta'        THEN total ELSE 0 END),0) as tarjeta
    FROM ventas WHERE user_id = ? AND date(fecha) = date(?) AND anulada = 0
  `,
      )
      .get(userId, hoy),
  );
});

// GET /api/ventas/resumen-semana
router.get("/resumen-semana", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const now = new Date();
  const day = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const lunes = new Date(now);
  lunes.setDate(now.getDate() - day);
  const desde = fechaLocal(lunes);
  const hasta = fechaLocal(now);

  const resumen = db
    .prepare(
      `
    SELECT COUNT(*) as total_ventas,
      COALESCE(SUM(total),0) as total_recaudado,
      COALESCE(SUM(CASE WHEN medio_pago='efectivo'      THEN total ELSE 0 END),0) as efectivo,
      COALESCE(SUM(CASE WHEN medio_pago='transferencia' THEN total ELSE 0 END),0) as transferencia,
      COALESCE(SUM(CASE WHEN medio_pago='tarjeta'       THEN total ELSE 0 END),0) as tarjeta
    FROM ventas WHERE user_id = ? AND date(fecha) BETWEEN date(?) AND date(?) AND anulada = 0
  `,
    )
    .get(userId, desde, hasta);

  const dias = db
    .prepare(
      `
    SELECT date(fecha) as dia, COUNT(*) as cant_ventas, COALESCE(SUM(total),0) as total
    FROM ventas WHERE user_id = ? AND date(fecha) BETWEEN date(?) AND date(?) AND anulada = 0
    GROUP BY date(fecha) ORDER BY dia ASC
  `,
    )
    .all(userId, desde, hasta);

  res.json({ ...resumen, desde, hasta, dias });
});

// GET /api/ventas/resumen-mes
router.get("/resumen-mes", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { año, mes } = req.query;
  const now = new Date();
  const y = año || now.getFullYear();
  const m = String(mes || now.getMonth() + 1).padStart(2, "0");
  const periodo = `${y}-${m}`;

  const dias = db
    .prepare(
      `
    SELECT date(fecha) as dia, COUNT(*) as cant_ventas, COALESCE(SUM(total),0) as total
    FROM ventas WHERE user_id = ? AND strftime('%Y-%m', fecha) = ? AND anulada = 0
    GROUP BY date(fecha) ORDER BY dia ASC
  `,
    )
    .all(userId, periodo);

  const totales = db
    .prepare(
      `
    SELECT COUNT(*) as total_ventas,
      COALESCE(SUM(total),0) as total_recaudado,
      COALESCE(SUM(CASE WHEN medio_pago='efectivo'      THEN total ELSE 0 END),0) as efectivo,
      COALESCE(SUM(CASE WHEN medio_pago='transferencia' THEN total ELSE 0 END),0) as transferencia,
      COALESCE(SUM(CASE WHEN medio_pago='tarjeta'       THEN total ELSE 0 END),0) as tarjeta
    FROM ventas WHERE user_id = ? AND strftime('%Y-%m', fecha) = ? AND anulada = 0
  `,
    )
    .get(userId, periodo);

  res.json({ dias, ...totales });
});

// GET /api/ventas/:id
router.get("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const venta = db
    .prepare(`SELECT * FROM ventas WHERE id = ? AND user_id = ?`)
    .get(req.params.id, userId);
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });

  const items = db
    .prepare(
      `
    SELECT vi.*, p.codigo_barras, p.categoria
    FROM venta_items vi LEFT JOIN productos p ON p.id = vi.producto_id
    WHERE vi.venta_id = ?
  `,
    )
    .all(req.params.id);

  res.json({ ...venta, items });
});

// POST /api/ventas
router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { medio_pago = "efectivo", notas, items } = req.body;
  if (!items?.length)
    return res
      .status(400)
      .json({ error: "La venta debe tener al menos un ítem" });

  const nuevaVenta = db.transaction(() => {
    const total = items.reduce(
      (sum, i) => sum + i.precio_unitario * i.cantidad,
      0,
    );

    const venta = db
      .prepare(
        `
      INSERT INTO ventas (user_id, total, medio_pago, notas) VALUES (?, ?, ?, ?)
    `,
      )
      .run(userId, total, medio_pago, notas);

    const ventaId = venta.lastInsertRowid;

    for (const item of items) {
      db.prepare(
        `
        INSERT INTO venta_items (venta_id, producto_id, variante_id, nombre_snapshot, cantidad, precio_unitario, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        ventaId,
        item.producto_id || null,
        item.variante_id || null,
        item.nombre,
        item.cantidad,
        item.precio_unitario,
        item.precio_unitario * item.cantidad,
      );

      if (item.variante_id) {
        db.prepare(
          `UPDATE producto_variantes SET stock_actual = MAX(0, stock_actual - ?) WHERE id = ?`,
        ).run(item.cantidad, item.variante_id);
      } else if (item.producto_id) {
        db.prepare(
          `UPDATE productos SET stock_actual = MAX(0, stock_actual - ?) WHERE id = ? AND user_id = ?`,
        ).run(item.cantidad, item.producto_id, userId);
      }
    }

    return db.prepare(`SELECT * FROM ventas WHERE id = ?`).get(ventaId);
  })();

  res.status(201).json(nuevaVenta);
});

// DELETE /api/ventas/:id — anular
router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const ok = db.transaction(() => {
    const venta = db
      .prepare(`SELECT * FROM ventas WHERE id = ? AND user_id = ?`)
      .get(req.params.id, userId);
    if (!venta || venta.anulada) return false;

    const items = db
      .prepare(`SELECT * FROM venta_items WHERE venta_id = ?`)
      .all(req.params.id);
    for (const item of items) {
      if (item.variante_id) {
        db.prepare(
          `UPDATE producto_variantes SET stock_actual = stock_actual + ? WHERE id = ?`,
        ).run(item.cantidad, item.variante_id);
      } else if (item.producto_id) {
        db.prepare(
          `UPDATE productos SET stock_actual = stock_actual + ? WHERE id = ? AND user_id = ?`,
        ).run(item.cantidad, item.producto_id, userId);
      }
    }

    db.prepare(`UPDATE ventas SET anulada = 1 WHERE id = ?`).run(req.params.id);
    return true;
  })();

  if (!ok)
    return res.status(404).json({ error: "Venta no encontrada o ya anulada" });
  res.json({ ok: true });
});

export default router;
