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

router.get("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { rows } = await pool.query(
    `SELECT * FROM marcas WHERE user_id = $1 AND activo = true ORDER BY nombre ASC`,
    [userId],
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { nombre } = req.body;
  if (!nombre?.trim())
    return res.status(400).json({ error: "El nombre es obligatorio" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO marcas (user_id, nombre) VALUES ($1, $2) RETURNING *`,
      [userId, nombre.trim()],
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(409).json({ error: "Ya existe una marca con ese nombre" });
  }
});

router.put("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { nombre } = req.body;
  if (!nombre?.trim())
    return res.status(400).json({ error: "El nombre es obligatorio" });
  try {
    const { rows } = await pool.query(
      `UPDATE marcas SET nombre = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
      [nombre.trim(), req.params.id, userId],
    );
    if (!rows[0]) return res.status(404).json({ error: "No encontrado" });
    res.json(rows[0]);
  } catch {
    res.status(409).json({ error: "Ya existe una marca con ese nombre" });
  }
});

router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { rows } = await pool.query(
    `SELECT COUNT(*) as n FROM productos WHERE marca_id = $1 AND user_id = $2 AND activo = true`,
    [req.params.id, userId],
  );
  if (parseInt(rows[0].n) > 0)
    return res
      .status(409)
      .json({ error: `Hay ${rows[0].n} productos con esta marca.` });
  await pool.query(
    `UPDATE marcas SET activo = false WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  res.json({ ok: true });
});

export default router;
