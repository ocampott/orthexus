import { Router } from "express";
import { lucia } from "../auth.js";
import db from "../db/database.js";

const router = Router();

// Obtener user_id — requerido para todas las rutas
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

const DEFAULTS = {
  margen_ganancia_default: "30",
  negocio_nombre: "Orthexus",
  color_primary: "#0047AB",
  color_bg: "#f4f7fa",
  color_sidebar: "#0a2d5e",
  color_sidebar_text: "#c8daf4",
  color_btn_primary_text: "#ffffff",
  radio_tarjetas: "0.75",
  logo_object_fit: "contain",
  negocio_logo_url: "",
};

// GET /api/configuracion
router.get("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const rows = db
    .prepare(`SELECT clave, valor FROM configuracion WHERE user_id = ?`)
    .all(userId);

  // Merge defaults con valores del usuario
  const config = { ...DEFAULTS };
  for (const row of rows) config[row.clave] = row.valor;

  res.json(config);
});

// PUT /api/configuracion/:clave
router.put("/:clave", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const { valor } = req.body;

  db.prepare(
    `
    INSERT INTO configuracion (user_id, clave, valor) VALUES (?, ?, ?)
    ON CONFLICT(user_id, clave) DO UPDATE SET valor = excluded.valor
  `,
  ).run(userId, req.params.clave, String(valor ?? ""));

  res.json({ clave: req.params.clave, valor });
});

export default router;
