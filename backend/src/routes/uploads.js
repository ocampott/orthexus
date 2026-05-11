import { Router } from "express";
import multer from "multer";
import { extname } from "path";
import { createClient } from "@supabase/supabase-js";
import { lucia } from "../auth.js";

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// Multer en memoria — no guarda en disco, sube directo a Supabase
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"];
    if (allowed.includes(extname(file.originalname).toLowerCase()))
      cb(null, true);
    else cb(new Error("Solo se permiten imágenes (jpg, png, gif, webp, svg)"));
  },
});

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

// POST /api/uploads/:tipo  (tipo: logo, perfil, etc)
router.post("/:tipo", upload.single("imagen"), async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!req.file)
    return res.status(400).json({ error: "No se recibió archivo" });

  const ext = extname(req.file.originalname).toLowerCase() || ".jpg";
  const tipo = req.params.tipo;
  // Ruta: uploads/{userId}/{tipo}.ext — sobreescribe el anterior
  const filePath = `${userId}/${tipo}${ext}`;

  const { error } = await supabase.storage
    .from("uploads")
    .upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true, // sobreescribe si ya existe
    });

  if (error) {
    console.error("[Storage]", error.message);
    return res.status(500).json({ error: "Error al subir archivo" });
  }

  const { data } = supabase.storage.from("uploads").getPublicUrl(filePath);

  // Agregar timestamp para evitar caché del browser
  const url = `${data.publicUrl}?v=${Date.now()}`;
  res.json({ ok: true, url });
});

// Error handler multer
router.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

export default router;
