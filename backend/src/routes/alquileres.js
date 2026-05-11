import { Router } from "express";
import { lucia } from "../auth.js";
import db from "../db/database.js";
import { waConfirmacionAlquiler } from "../services/whatsapp.js";

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

const hoyISO = () => new Date().toISOString().split("T")[0];

// ══════════════════════════════════════════════════════
// CATÁLOGO DE PRODUCTOS DE ALQUILER
// ══════════════════════════════════════════════════════

router.get("/productos-catalogo", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  res.json(
    db
      .prepare(
        `SELECT * FROM productos_alquiler WHERE user_id = ? AND activo = 1 ORDER BY nombre ASC`,
      )
      .all(userId),
  );
});

router.post("/productos-catalogo", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    nombre,
    descripcion = "",
    precio_semana = 0,
    precio_2semanas = 0,
    precio_3semanas = 0,
    precio_mes = 0,
  } = req.body;
  if (!nombre)
    return res.status(400).json({ error: "El nombre es obligatorio" });

  const r = db
    .prepare(
      `
    INSERT INTO productos_alquiler (user_id, nombre, descripcion, precio_semana, precio_2semanas, precio_3semanas, precio_mes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      userId,
      nombre,
      descripcion,
      precio_semana,
      precio_2semanas,
      precio_3semanas,
      precio_mes,
    );

  res
    .status(201)
    .json(
      db
        .prepare(`SELECT * FROM productos_alquiler WHERE id = ?`)
        .get(r.lastInsertRowid),
    );
});

router.put("/productos-catalogo/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    nombre,
    descripcion,
    precio_semana,
    precio_2semanas,
    precio_3semanas,
    precio_mes,
  } = req.body;
  db.prepare(
    `
    UPDATE productos_alquiler SET
      nombre          = COALESCE(?, nombre),
      descripcion     = COALESCE(?, descripcion),
      precio_semana   = COALESCE(?, precio_semana),
      precio_2semanas = COALESCE(?, precio_2semanas),
      precio_3semanas = COALESCE(?, precio_3semanas),
      precio_mes      = COALESCE(?, precio_mes)
    WHERE id = ? AND user_id = ?
  `,
  ).run(
    nombre ?? null,
    descripcion ?? null,
    precio_semana ?? null,
    precio_2semanas ?? null,
    precio_3semanas ?? null,
    precio_mes ?? null,
    req.params.id,
    userId,
  );

  res.json(
    db
      .prepare(`SELECT * FROM productos_alquiler WHERE id = ?`)
      .get(req.params.id),
  );
});

router.delete("/productos-catalogo/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  db.prepare(
    `UPDATE productos_alquiler SET activo = 0 WHERE id = ? AND user_id = ?`,
  ).run(req.params.id, userId);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════
// CONTRATOS DE ALQUILER
// ══════════════════════════════════════════════════════

router.get("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    estado,
    numero,
    producto_id,
    fecha_inicio_desde,
    fecha_inicio_hasta,
    fecha_dev_desde,
    fecha_dev_hasta,
    periodo_tipo,
  } = req.query;

  let sql = `
    SELECT a.*,
      (SELECT COUNT(*) FROM alquiler_items WHERE alquiler_id = a.id) as cant_productos,
      (SELECT GROUP_CONCAT(ai.nombre_snapshot, ', ') FROM alquiler_items ai WHERE ai.alquiler_id = a.id) as productos_nombres
    FROM alquileres a
    WHERE a.user_id = ?
  `;
  const params = [userId];

  if (estado) {
    sql += ` AND a.estado = ?`;
    params.push(estado);
  }
  if (periodo_tipo) {
    sql += ` AND a.periodo_tipo = ?`;
    params.push(periodo_tipo);
  }
  if (numero) {
    sql += ` AND (a.numero_alquiler LIKE ? OR CAST(a.id AS TEXT) = ?)`;
    params.push(`%${numero}%`, numero);
  }
  if (fecha_inicio_desde) {
    sql += ` AND a.fecha_inicio >= ?`;
    params.push(fecha_inicio_desde);
  }
  if (fecha_inicio_hasta) {
    sql += ` AND a.fecha_inicio <= ?`;
    params.push(fecha_inicio_hasta);
  }
  if (fecha_dev_desde) {
    sql += ` AND a.fecha_devolucion >= ?`;
    params.push(fecha_dev_desde);
  }
  if (fecha_dev_hasta) {
    sql += ` AND a.fecha_devolucion <= ?`;
    params.push(fecha_dev_hasta);
  }
  if (producto_id) {
    sql += ` AND EXISTS (SELECT 1 FROM alquiler_items ai WHERE ai.alquiler_id = a.id AND ai.producto_alquiler_id = ?)`;
    params.push(producto_id);
  }

  sql += ` ORDER BY a.fecha_devolucion ASC`;

  const hoy = hoyISO();
  res.json(
    db
      .prepare(sql)
      .all(...params)
      .map((a) => ({
        ...a,
        vencido: a.estado === "activo" && a.fecha_devolucion < hoy,
        dias_restantes: Math.ceil(
          (new Date(a.fecha_devolucion + "T12:00:00") -
            new Date(hoy + "T12:00:00")) /
            86400000,
        ),
      })),
  );
});

router.get("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const alquiler = db
    .prepare(`SELECT * FROM alquileres WHERE id = ? AND user_id = ?`)
    .get(req.params.id, userId);
  if (!alquiler) return res.status(404).json({ error: "No encontrado" });

  const items = db
    .prepare(
      `
    SELECT ai.*, pa.precio_semana, pa.precio_2semanas, pa.precio_3semanas, pa.precio_mes
    FROM alquiler_items ai
    LEFT JOIN productos_alquiler pa ON pa.id = ai.producto_alquiler_id
    WHERE ai.alquiler_id = ?
  `,
    )
    .all(req.params.id);

  const hoy = hoyISO();
  res.json({
    ...alquiler,
    items,
    vencido: alquiler.estado === "activo" && alquiler.fecha_devolucion < hoy,
    dias_restantes: Math.ceil(
      (new Date(alquiler.fecha_devolucion + "T12:00:00") -
        new Date(hoy + "T12:00:00")) /
        86400000,
    ),
  });
});

router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    numero_alquiler,
    cliente_nombre,
    cliente_telefono,
    cliente_direccion,
    cliente_dni,
    fecha_inicio,
    fecha_devolucion,
    periodo_tipo = "semana",
    precio_total = 0,
    notas,
    items = [],
  } = req.body;

  if (!cliente_nombre || !fecha_inicio || !fecha_devolucion)
    return res
      .status(400)
      .json({
        error:
          "cliente_nombre, fecha_inicio y fecha_devolucion son obligatorios",
      });

  const alquilerCreado = db.transaction(() => {
    const r = db
      .prepare(
        `
      INSERT INTO alquileres (user_id, numero_alquiler, cliente_nombre, cliente_telefono, cliente_direccion, cliente_dni, fecha_inicio, fecha_devolucion, periodo_tipo, precio_total, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        userId,
        numero_alquiler || null,
        cliente_nombre,
        cliente_telefono,
        cliente_direccion,
        cliente_dni,
        fecha_inicio,
        fecha_devolucion,
        periodo_tipo,
        precio_total,
        notas,
      );

    for (const item of items) {
      db.prepare(
        `
        INSERT INTO alquiler_items (alquiler_id, producto_alquiler_id, nombre_snapshot, periodo_tipo, precio_acordado)
        VALUES (?, ?, ?, ?, ?)
      `,
      ).run(
        r.lastInsertRowid,
        item.producto_alquiler_id || null,
        item.nombre,
        item.periodo_tipo || periodo_tipo,
        item.precio_acordado || 0,
      );
    }

    return db
      .prepare(`SELECT * FROM alquileres WHERE id = ?`)
      .get(r.lastInsertRowid);
  })();

  if (alquilerCreado.cliente_telefono) {
    const itemsWA = items.map((i) => ({
      nombre_snapshot: i.nombre,
      cantidad: i.cantidad,
    }));
    waConfirmacionAlquiler(alquilerCreado, itemsWA).catch((e) =>
      console.error("[WA]", e.message),
    );
  }

  res.status(201).json(alquilerCreado);
});

router.put("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    numero_alquiler,
    cliente_nombre,
    cliente_telefono,
    cliente_direccion,
    cliente_dni,
    fecha_inicio,
    fecha_devolucion,
    periodo_tipo,
    precio_total,
    notas,
    estado,
  } = req.body;

  db.prepare(
    `
    UPDATE alquileres SET
      numero_alquiler   = COALESCE(?, numero_alquiler),
      cliente_nombre    = COALESCE(?, cliente_nombre),
      cliente_telefono  = COALESCE(?, cliente_telefono),
      cliente_direccion = COALESCE(?, cliente_direccion),
      cliente_dni       = COALESCE(?, cliente_dni),
      fecha_inicio      = COALESCE(?, fecha_inicio),
      fecha_devolucion  = COALESCE(?, fecha_devolucion),
      periodo_tipo      = COALESCE(?, periodo_tipo),
      precio_total      = COALESCE(?, precio_total),
      notas             = COALESCE(?, notas),
      estado            = COALESCE(?, estado)
    WHERE id = ? AND user_id = ?
  `,
  ).run(
    numero_alquiler ?? null,
    cliente_nombre ?? null,
    cliente_telefono ?? null,
    cliente_direccion ?? null,
    cliente_dni ?? null,
    fecha_inicio ?? null,
    fecha_devolucion ?? null,
    periodo_tipo ?? null,
    precio_total ?? null,
    notas ?? null,
    estado ?? null,
    req.params.id,
    userId,
  );

  res.json(
    db.prepare(`SELECT * FROM alquileres WHERE id = ?`).get(req.params.id),
  );
});

router.patch("/:id/devolver", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  db.prepare(
    `UPDATE alquileres SET estado = 'devuelto' WHERE id = ? AND user_id = ?`,
  ).run(req.params.id, userId);
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  db.prepare(`DELETE FROM alquileres WHERE id = ? AND user_id = ?`).run(
    req.params.id,
    userId,
  );
  res.json({ ok: true });
});

export default router;
