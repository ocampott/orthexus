import { Router } from "express";
import { lucia } from "../auth.js";
import pool from "../db/database.js";
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

function calcDias(fecha_devolucion) {
  const hoy = hoyISO();
  return Math.ceil(
    (new Date(fecha_devolucion + "T12:00:00") - new Date(hoy + "T12:00:00")) /
      86400000,
  );
}

// ══════════════════════════════════════════════════════
// CATÁLOGO DE PRODUCTOS DE ALQUILER
// ══════════════════════════════════════════════════════

router.get("/productos-catalogo", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { rows } = await pool.query(
    `SELECT * FROM productos_alquiler WHERE user_id = $1 AND activo = true ORDER BY nombre ASC`,
    [userId],
  );
  res.json(rows);
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

  const {
    rows: [r],
  } = await pool.query(
    `
    INSERT INTO productos_alquiler (user_id, nombre, descripcion, precio_semana, precio_2semanas, precio_3semanas, precio_mes)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
  `,
    [
      userId,
      nombre,
      descripcion,
      precio_semana,
      precio_2semanas,
      precio_3semanas,
      precio_mes,
    ],
  );
  res.status(201).json(r);
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
  const {
    rows: [r],
  } = await pool.query(
    `
    UPDATE productos_alquiler SET
      nombre          = COALESCE($1, nombre),
      descripcion     = COALESCE($2, descripcion),
      precio_semana   = COALESCE($3, precio_semana),
      precio_2semanas = COALESCE($4, precio_2semanas),
      precio_3semanas = COALESCE($5, precio_3semanas),
      precio_mes      = COALESCE($6, precio_mes)
    WHERE id = $7 AND user_id = $8 RETURNING *
  `,
    [
      nombre ?? null,
      descripcion ?? null,
      precio_semana ?? null,
      precio_2semanas ?? null,
      precio_3semanas ?? null,
      precio_mes ?? null,
      req.params.id,
      userId,
    ],
  );
  res.json(r);
});

router.delete("/productos-catalogo/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  await pool.query(
    `UPDATE productos_alquiler SET activo = false WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
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
      (SELECT STRING_AGG(ai.nombre_snapshot, ', ') FROM alquiler_items ai WHERE ai.alquiler_id = a.id) as productos_nombres
    FROM alquileres a
    WHERE a.user_id = $1
  `;
  const params = [userId];
  let i = 2;

  if (estado) {
    sql += ` AND a.estado = $${i}`;
    params.push(estado);
    i++;
  }
  if (periodo_tipo) {
    sql += ` AND a.periodo_tipo = $${i}`;
    params.push(periodo_tipo);
    i++;
  }
  if (numero) {
    sql += ` AND (a.numero_alquiler ILIKE $${i} OR a.id::text = $${i + 1})`;
    params.push(`%${numero}%`, numero);
    i += 2;
  }
  if (fecha_inicio_desde) {
    sql += ` AND a.fecha_inicio >= $${i}`;
    params.push(fecha_inicio_desde);
    i++;
  }
  if (fecha_inicio_hasta) {
    sql += ` AND a.fecha_inicio <= $${i}`;
    params.push(fecha_inicio_hasta);
    i++;
  }
  if (fecha_dev_desde) {
    sql += ` AND a.fecha_devolucion >= $${i}`;
    params.push(fecha_dev_desde);
    i++;
  }
  if (fecha_dev_hasta) {
    sql += ` AND a.fecha_devolucion <= $${i}`;
    params.push(fecha_dev_hasta);
    i++;
  }
  if (producto_id) {
    sql += ` AND EXISTS (SELECT 1 FROM alquiler_items ai WHERE ai.alquiler_id = a.id AND ai.producto_alquiler_id = $${i})`;
    params.push(producto_id);
    i++;
  }

  sql += ` ORDER BY a.fecha_devolucion ASC`;

  const { rows } = await pool.query(sql, params);
  const hoy = hoyISO();
  res.json(
    rows.map((a) => ({
      ...a,
      fecha_devolucion:
        a.fecha_devolucion instanceof Date
          ? a.fecha_devolucion.toISOString().split("T")[0]
          : a.fecha_devolucion,
      fecha_inicio:
        a.fecha_inicio instanceof Date
          ? a.fecha_inicio.toISOString().split("T")[0]
          : a.fecha_inicio,
      vencido:
        a.estado === "activo" && String(a.fecha_devolucion).slice(0, 10) < hoy,
      dias_restantes: calcDias(String(a.fecha_devolucion).slice(0, 10)),
    })),
  );
});

router.get("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [alquiler],
  } = await pool.query(
    `SELECT * FROM alquileres WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  if (!alquiler) return res.status(404).json({ error: "No encontrado" });

  const { rows: items } = await pool.query(
    `
    SELECT ai.*, pa.precio_semana, pa.precio_2semanas, pa.precio_3semanas, pa.precio_mes
    FROM alquiler_items ai
    LEFT JOIN productos_alquiler pa ON pa.id = ai.producto_alquiler_id
    WHERE ai.alquiler_id = $1
  `,
    [req.params.id],
  );

  const fechaDev = String(alquiler.fecha_devolucion).slice(0, 10);
  res.json({
    ...alquiler,
    fecha_devolucion: fechaDev,
    fecha_inicio: String(alquiler.fecha_inicio).slice(0, 10),
    items,
    vencido: alquiler.estado === "activo" && fechaDev < hoyISO(),
    dias_restantes: calcDias(fechaDev),
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      rows: [alquiler],
    } = await client.query(
      `
      INSERT INTO alquileres (user_id, numero_alquiler, cliente_nombre, cliente_telefono,
        cliente_direccion, cliente_dni, fecha_inicio, fecha_devolucion, periodo_tipo, precio_total, notas)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `,
      [
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
      ],
    );

    for (const item of items) {
      await client.query(
        `
        INSERT INTO alquiler_items (alquiler_id, producto_alquiler_id, nombre_snapshot, periodo_tipo, precio_acordado)
        VALUES ($1,$2,$3,$4,$5)
      `,
        [
          alquiler.id,
          item.producto_alquiler_id || null,
          item.nombre,
          item.periodo_tipo || periodo_tipo,
          item.precio_acordado || 0,
        ],
      );
    }

    await client.query("COMMIT");

    // Normalizar fechas para WhatsApp y respuesta
    const alquilerCreado = {
      ...alquiler,
      fecha_inicio: String(alquiler.fecha_inicio).slice(0, 10),
      fecha_devolucion: String(alquiler.fecha_devolucion).slice(0, 10),
    };

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
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
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

  const {
    rows: [r],
  } = await pool.query(
    `
    UPDATE alquileres SET
      numero_alquiler   = COALESCE($1,  numero_alquiler),
      cliente_nombre    = COALESCE($2,  cliente_nombre),
      cliente_telefono  = COALESCE($3,  cliente_telefono),
      cliente_direccion = COALESCE($4,  cliente_direccion),
      cliente_dni       = COALESCE($5,  cliente_dni),
      fecha_inicio      = COALESCE($6,  fecha_inicio),
      fecha_devolucion  = COALESCE($7,  fecha_devolucion),
      periodo_tipo      = COALESCE($8,  periodo_tipo),
      precio_total      = COALESCE($9,  precio_total),
      notas             = COALESCE($10, notas),
      estado            = COALESCE($11, estado)
    WHERE id = $12 AND user_id = $13 RETURNING *
  `,
    [
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
    ],
  );

  if (!r) return res.status(404).json({ error: "No encontrado" });
  res.json({
    ...r,
    fecha_inicio: String(r.fecha_inicio).slice(0, 10),
    fecha_devolucion: String(r.fecha_devolucion).slice(0, 10),
  });
});

router.patch("/:id/devolver", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  await pool.query(
    `UPDATE alquileres SET estado = 'devuelto' WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  await pool.query(`DELETE FROM alquileres WHERE id = $1 AND user_id = $2`, [
    req.params.id,
    userId,
  ]);
  res.json({ ok: true });
});

export default router;
