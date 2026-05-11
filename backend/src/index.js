import express from "express";
import cors from "cors";
import "dotenv/config";
import cookieParser from "cookie-parser";

import productosRouter from "./routes/productos.js";
import ventasRouter from "./routes/ventas.js";
import alquileresRouter from "./routes/alquileres.js";
import variantesRouter from "./routes/variantes.js";
import marcasRouter from "./routes/marcas.js";
import configuracionRouter from "./routes/configuracion.js";
import uploadsRouter from "./routes/uploads.js";
import proveedoresRouter from "./routes/proveedores.js";
import authRouter from "./routes/auth.js";
import { lucia } from "./auth.js";
import { iniciarCron, runNotificaciones } from "./cron/notificaciones.js";
import {
  WA_CONFIGURED,
  waConfirmacionAlquiler,
  waAlquilerPorVencer,
  waAlquilerVencido,
} from "./services/whatsapp.js";
import pool from "./db/database.js";

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// ── CORS ──────────────────────────────────────────────
const corsOptions = {
  origin: (origin, callback) => {
    const allowed = [
      "http://localhost:5173",
      "http://localhost:4173",
      process.env.FRONTEND_URL,
    ].filter(Boolean);
    if (
      !origin ||
      allowed.includes(origin) ||
      /^http:\/\/192\.168\.\d+\.\d+/.test(origin)
    ) {
      callback(null, true);
    } else {
      callback(new Error(`CORS bloqueado: ${origin}`));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
  exposedHeaders: ["Set-Cookie"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // preflight para todas las rutas

// ── Middleware ────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

app.use((req, _res, next) => {
  console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.path}`);
  next();
});

// ── Rutas ─────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/productos", productosRouter);
app.use("/api/productos/:productoId/variantes", variantesRouter);
app.use("/api/ventas", ventasRouter);
app.use("/api/alquileres", alquileresRouter);
app.use("/api/marcas", marcasRouter);
app.use("/api/configuracion", configuracionRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/proveedores", proveedoresRouter);

// ── Health ────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    wa: WA_CONFIGURED,
  });
});

// ── WhatsApp ──────────────────────────────────────────
app.get("/api/whatsapp/estado", (_req, res) => {
  res.json({
    configurado: WA_CONFIGURED,
    phone_id: process.env.WA_PHONE_ID ? "✓" : "✗ falta WA_PHONE_ID",
    token: process.env.WA_TOKEN ? "✓" : "✗ falta WA_TOKEN",
  });
});

app.post("/api/whatsapp/test-cron", async (_req, res) => {
  try {
    await runNotificaciones();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/whatsapp/enviar/:alquilerId/:tipo", async (req, res) => {
  const sessionId = req.cookies?.auth_session;
  let userId = null;
  if (sessionId) {
    try {
      const { user } = await lucia.validateSession(sessionId);
      userId = user?.id;
    } catch {}
  }
  if (!userId) return res.status(401).json({ error: "No autenticado" });

  const { alquilerId, tipo } = req.params;
  const hoy = new Date().toISOString().split("T")[0];

  const {
    rows: [a],
  } = await pool.query(
    `
    SELECT a.*, (a.fecha_devolucion::date - $1::date) AS dias_restantes
    FROM alquileres a WHERE a.id = $2 AND a.user_id = $3
  `,
    [hoy, alquilerId, userId],
  );

  if (!a) return res.status(404).json({ error: "Alquiler no encontrado" });

  a.fecha_devolucion = String(a.fecha_devolucion).slice(0, 10);
  a.dias_restantes = parseInt(a.dias_restantes);

  const { rows: items } = await pool.query(
    `SELECT * FROM alquiler_items WHERE alquiler_id = $1`,
    [alquilerId],
  );

  let result;
  if (tipo === "confirmacion") result = await waConfirmacionAlquiler(a, items);
  else if (tipo === "por_vencer") result = await waAlquilerPorVencer(a);
  else if (tipo === "vencido") result = await waAlquilerVencido(a);
  else return res.status(400).json({ error: "Tipo inválido" });

  res.json(result);
});

// ── Error handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno", detail: err.message });
});

// ── Inicio ────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Orthexus backend en http://localhost:${PORT}`);
  console.log(`   WhatsApp: ${WA_CONFIGURED ? "✓" : "⚠ no configurado"}`);
  iniciarCron();
});
