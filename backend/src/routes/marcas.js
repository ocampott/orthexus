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

router.get("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  res.json(
    db
      .prepare(
        `SELECT * FROM marcas WHERE user_id = ? AND activo = 1 ORDER BY nombre ASC`,
      )
      .all(userId),
  );
});

router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { nombre } = req.body;
  if (!nombre?.trim())
    return res.status(400).json({ error: "El nombre es obligatorio" });
  try {
    const r = db
      .prepare(`INSERT INTO marcas (user_id, nombre) VALUES (?, ?)`)
      .run(userId, nombre.trim());
    res
      .status(201)
      .json(
        db.prepare(`SELECT * FROM marcas WHERE id = ?`).get(r.lastInsertRowid),
      );
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
    db.prepare(`UPDATE marcas SET nombre = ? WHERE id = ? AND user_id = ?`).run(
      nombre.trim(),
      req.params.id,
      userId,
    );
    res.json(
      db.prepare(`SELECT * FROM marcas WHERE id = ?`).get(req.params.id),
    );
  } catch {
    res.status(409).json({ error: "Ya existe una marca con ese nombre" });
  }
});

router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const count = db
    .prepare(
      `SELECT COUNT(*) as n FROM productos WHERE marca_id = ? AND user_id = ? AND activo = 1`,
    )
    .get(req.params.id, userId);
  if (count.n > 0)
    return res
      .status(409)
      .json({ error: `Hay ${count.n} productos con esta marca.` });
  db.prepare(`UPDATE marcas SET activo = 0 WHERE id = ? AND user_id = ?`).run(
    req.params.id,
    userId,
  );
  res.json({ ok: true });
});

export default router;
