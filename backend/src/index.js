import express from "express";
import cors from "cors";
import "dotenv/config";
import cookieParser from "cookie-parser";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
import db from "./db/database.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: ["http://localhost:5173", /^http:\/\/192\.168\.\d+\.\d+/],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.use((req, _res, next) => {
  console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.path}`);
  next();
});

app.use("/api/auth", authRouter);
app.use("/api/productos", productosRouter);
app.use("/api/productos/:productoId/variantes", variantesRouter);
app.use("/api/ventas", ventasRouter);
app.use("/api/alquileres", alquileresRouter);
app.use("/api/marcas", marcasRouter);
app.use("/api/configuracion", configuracionRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/proveedores", proveedoresRouter);

const uploadsPath = join(__dirname, "../uploads");
app.use(
  "/uploads",
  express.static(uploadsPath, {
    setHeaders: (res) => res.setHeader("X-Frame-Options", "SAMEORIGIN"),
  }),
);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    wa: WA_CONFIGURED,
  });
});

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

// Enviar WA puntual — verifica que el alquiler pertenece al usuario
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

  const a = db
    .prepare(
      `
    SELECT a.*,
      CAST((julianday(a.fecha_devolucion) - julianday(?)) AS INTEGER) as dias_restantes
    FROM alquileres a
    WHERE a.id = ? AND a.user_id = ?
  `,
    )
    .get(hoy, alquilerId, userId);

  if (!a) return res.status(404).json({ error: "Alquiler no encontrado" });

  // Traer items del alquiler para la confirmación
  const items = db
    .prepare(`SELECT * FROM alquiler_items WHERE alquiler_id = ?`)
    .all(alquilerId);

  let result;
  if (tipo === "confirmacion") result = await waConfirmacionAlquiler(a, items);
  else if (tipo === "por_vencer") result = await waAlquilerPorVencer(a);
  else if (tipo === "vencido") result = await waAlquilerVencido(a);
  else
    return res
      .status(400)
      .json({
        error: "Tipo inválido. Usar: confirmacion, por_vencer, vencido",
      });

  res.json(result);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno", detail: err.message });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Orthexus backend en http://localhost:${PORT}`);
  console.log(`   WhatsApp: ${WA_CONFIGURED ? "✓" : "⚠ no configurado"}`);
  iniciarCron();
});
