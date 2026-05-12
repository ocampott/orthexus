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

// Devuelve la fecha local Argentina (UTC-3) como 'YYYY-MM-DD'
function fechaLocalAR(d = new Date()) {
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().split("T")[0];
}

// new Date() en UTC-3
function nowAR() {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

// GET /api/ventas
router.get("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { desde, hasta, medio_pago } = req.query;
  let sql = `
    SELECT v.*, (SELECT COUNT(*) FROM venta_items WHERE venta_id = v.id) as cantidad_items
    FROM ventas v WHERE v.user_id = $1 AND v.anulada = false
  `;
  const params = [userId];
  let i = 2;

  if (desde) {
    sql += ` AND v.fecha::date >= $${i}::date`;
    params.push(desde);
    i++;
  }
  if (hasta) {
    sql += ` AND v.fecha::date <= $${i}::date`;
    params.push(hasta);
    i++;
  }
  if (medio_pago) {
    sql += ` AND v.medio_pago = $${i}`;
    params.push(medio_pago);
    i++;
  }
  sql += ` ORDER BY v.fecha DESC`;

  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

// GET /api/ventas/resumen-hoy
router.get("/resumen-hoy", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const hoy = fechaLocalAR();
  const {
    rows: [r],
  } = await pool.query(
    `
    SELECT COUNT(*) as total_ventas,
      COALESCE(SUM(total),0) as total_recaudado,
      COALESCE(SUM(CASE WHEN medio_pago='efectivo'      THEN total ELSE 0 END),0) as efectivo,
      COALESCE(SUM(CASE WHEN medio_pago='transferencia' THEN total ELSE 0 END),0) as transferencia,
      COALESCE(SUM(CASE WHEN medio_pago='tarjeta'       THEN total ELSE 0 END),0) as tarjeta
    FROM ventas WHERE user_id = $1 AND fecha::date = $2::date AND anulada = false
  `,
    [userId, hoy],
  );
  res.json(r);
});

// GET /api/ventas/resumen-semana
router.get("/resumen-semana", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const now = nowAR();
  const day = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const lunes = new Date(now);
  lunes.setDate(now.getDate() - day);
  const desde = fechaLocalAR(lunes);
  const hasta = fechaLocalAR(now);

  const {
    rows: [resumen],
  } = await pool.query(
    `
    SELECT COUNT(*) as total_ventas,
      COALESCE(SUM(total),0) as total_recaudado,
      COALESCE(SUM(CASE WHEN medio_pago='efectivo'      THEN total ELSE 0 END),0) as efectivo,
      COALESCE(SUM(CASE WHEN medio_pago='transferencia' THEN total ELSE 0 END),0) as transferencia,
      COALESCE(SUM(CASE WHEN medio_pago='tarjeta'       THEN total ELSE 0 END),0) as tarjeta
    FROM ventas WHERE user_id = $1 AND fecha::date BETWEEN $2::date AND $3::date AND anulada = false
  `,
    [userId, desde, hasta],
  );

  const { rows: dias } = await pool.query(
    `
    SELECT fecha::date as dia, COUNT(*) as cant_ventas, COALESCE(SUM(total),0) as total
    FROM ventas WHERE user_id = $1 AND fecha::date BETWEEN $2::date AND $3::date AND anulada = false
    GROUP BY fecha::date ORDER BY dia ASC
  `,
    [userId, desde, hasta],
  );

  res.json({ ...resumen, desde, hasta, dias });
});

// GET /api/ventas/resumen-mes
router.get("/resumen-mes", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { año, mes } = req.query;
  const now = nowAR();
  const y = año || now.getFullYear();
  const m = String(mes || now.getMonth() + 1).padStart(2, "0");
  const periodo = `${y}-${m}`;

  const { rows: dias } = await pool.query(
    `
    SELECT fecha::date as dia, COUNT(*) as cant_ventas, COALESCE(SUM(total),0) as total
    FROM ventas
    WHERE user_id = $1 AND to_char(fecha, 'YYYY-MM') = $2 AND anulada = false
    GROUP BY fecha::date ORDER BY dia ASC
  `,
    [userId, periodo],
  );

  const {
    rows: [totales],
  } = await pool.query(
    `
    SELECT COUNT(*) as total_ventas,
      COALESCE(SUM(total),0) as total_recaudado,
      COALESCE(SUM(CASE WHEN medio_pago='efectivo'      THEN total ELSE 0 END),0) as efectivo,
      COALESCE(SUM(CASE WHEN medio_pago='transferencia' THEN total ELSE 0 END),0) as transferencia,
      COALESCE(SUM(CASE WHEN medio_pago='tarjeta'       THEN total ELSE 0 END),0) as tarjeta
    FROM ventas WHERE user_id = $1 AND to_char(fecha, 'YYYY-MM') = $2 AND anulada = false
  `,
    [userId, periodo],
  );

  res.json({ dias, ...totales });
});

// GET /api/ventas/:id
router.get("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [venta],
  } = await pool.query(`SELECT * FROM ventas WHERE id = $1 AND user_id = $2`, [
    req.params.id,
    userId,
  ]);
  if (!venta) return res.status(404).json({ error: "Venta no encontrada" });

  const { rows: items } = await pool.query(
    `
    SELECT vi.*, p.codigo_barras, p.categoria
    FROM venta_items vi LEFT JOIN productos p ON p.id = vi.producto_id
    WHERE vi.venta_id = $1
  `,
    [req.params.id],
  );

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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const total = items.reduce(
      (sum, i) => sum + i.precio_unitario * i.cantidad,
      0,
    );

    const {
      rows: [venta],
    } = await client.query(
      `INSERT INTO ventas (user_id, total, medio_pago, notas) VALUES ($1,$2,$3,$4) RETURNING *`,
      [userId, total, medio_pago, notas],
    );

    for (const item of items) {
      await client.query(
        `
        INSERT INTO venta_items (venta_id, producto_id, variante_id, nombre_snapshot, cantidad, precio_unitario, subtotal)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
        [
          venta.id,
          item.producto_id || null,
          item.variante_id || null,
          item.nombre,
          item.cantidad,
          item.precio_unitario,
          item.precio_unitario * item.cantidad,
        ],
      );

      if (item.variante_id) {
        await client.query(
          `UPDATE producto_variantes SET stock_actual = GREATEST(0, stock_actual - $1) WHERE id = $2`,
          [item.cantidad, item.variante_id],
        );
      } else if (item.producto_id) {
        await client.query(
          `UPDATE productos SET stock_actual = GREATEST(0, stock_actual - $1) WHERE id = $2 AND user_id = $3`,
          [item.cantidad, item.producto_id, userId],
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json(venta);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

// DELETE /api/ventas/:id — anular
router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      rows: [venta],
    } = await client.query(
      `SELECT * FROM ventas WHERE id = $1 AND user_id = $2`,
      [req.params.id, userId],
    );
    if (!venta || venta.anulada) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ error: "Venta no encontrada o ya anulada" });
    }

    const { rows: items } = await client.query(
      `SELECT * FROM venta_items WHERE venta_id = $1`,
      [req.params.id],
    );

    for (const item of items) {
      if (item.variante_id) {
        await client.query(
          `UPDATE producto_variantes SET stock_actual = stock_actual + $1 WHERE id = $2`,
          [item.cantidad, item.variante_id],
        );
      } else if (item.producto_id) {
        await client.query(
          `UPDATE productos SET stock_actual = stock_actual + $1 WHERE id = $2 AND user_id = $3`,
          [item.cantidad, item.producto_id, userId],
        );
      }
    }

    await client.query(`UPDATE ventas SET anulada = true WHERE id = $1`, [
      req.params.id,
    ]);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

export default router;
