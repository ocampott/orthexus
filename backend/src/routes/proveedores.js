import { Router } from "express";
import { lucia } from "../auth.js";
import pool from "../db/database.js";
import multer from "multer";
import { extname, join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Supabase Storage para listas
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// Multer en memoria — no guarda en disco
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [".xlsx", ".xls", ".csv", ".tsv", ".ods"];
    if (ok.includes(extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Solo se permiten archivos Excel o CSV"));
  },
});

// LibreOffice — para conversión a HTML necesitamos guardar temp en disco
const TMP_DIR = "/tmp/orthexus_listas";
const HTML_DIR = join(__dirname, "../../uploads/listas_html");
mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(HTML_DIR, { recursive: true });

function findLibreOffice() {
  const candidates = [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/snap/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const LO_BIN = findLibreOffice();
if (!LO_BIN) console.warn("[LO] LibreOffice no encontrado.");
else console.log(`[LO] Usando: ${LO_BIN}`);

async function convertirYSubirHtml(buffer, originalname, htmlId) {
  if (!LO_BIN) return null;

  // Guardar buffer en disco temporalmente para que LibreOffice lo procese
  const ext = extname(originalname).toLowerCase();
  const tmpInput = join(TMP_DIR, `${htmlId}${ext}`);
  const tmpDir = join(TMP_DIR, `out_${htmlId}`);
  const loHome = join(TMP_DIR, `home_${htmlId}`);
  const loProfile = `${loHome}/.config/libreoffice`;

  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(loProfile, { recursive: true });

  try {
    writeFileSync(tmpInput, buffer);

    execSync(
      `"${LO_BIN}" --headless --convert-to html --outdir "${tmpDir}" "${tmpInput}"`,
      {
        timeout: 45000,
        env: {
          ...process.env,
          HOME: loHome,
          UserInstallation: `file://${loProfile}`,
        },
        stdio: "pipe",
      },
    );

    const htmlBase = basename(originalname, ext) + ".html";
    const tmpHtml = join(tmpDir, htmlBase);
    if (!existsSync(tmpHtml)) return null;

    let html = readFileSync(tmpHtml, "utf-8");
    const extraCss = `body{margin:0;padding:10px 14px;background:#fff}table{border-collapse:collapse;width:max-content}td,th{border:1px solid #d0d0d0;padding:3px 8px;min-width:50px;font-size:12px}`;
    html = html.includes("</style>")
      ? html.replace("</style>", extraCss + "</style>")
      : html.replace("</head>", `<style>${extraCss}</style></head>`);

    // Subir HTML a Supabase Storage
    const htmlPath = `${htmlId}.html`;
    const { error } = await supabase.storage
      .from("listas")
      .upload(htmlPath, Buffer.from(html, "utf-8"), {
        contentType: "text/html",
        upsert: true,
      });

    if (error) {
      console.error("[LO] Error subiendo HTML:", error.message);
      return null;
    }

    const { data } = supabase.storage.from("listas").getPublicUrl(htmlPath);
    return data.publicUrl;
  } catch (e) {
    console.error("[LO] Error:", e.message.slice(0, 200));
    return null;
  } finally {
    try {
      execSync(`rm -rf "${tmpInput}" "${tmpDir}" "${loHome}"`, {
        stdio: "pipe",
      });
    } catch {}
  }
}

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
    `SELECT * FROM proveedores WHERE user_id = $1 AND activo = true ORDER BY nombre ASC`,
    [userId],
  );
  res.json(rows);
});

router.get("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const {
    rows: [row],
  } = await pool.query(
    `SELECT * FROM proveedores WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  if (!row) return res.status(404).json({ error: "No encontrado" });
  res.json(row);
});

router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { nombre, contacto, email, telefono, notas } = req.body;
  if (!nombre?.trim())
    return res.status(400).json({ error: "El nombre es obligatorio" });
  const {
    rows: [r],
  } = await pool.query(
    `INSERT INTO proveedores (user_id, nombre, contacto, email, telefono, notas)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      userId,
      nombre.trim(),
      contacto || null,
      email || null,
      telefono || null,
      notas || null,
    ],
  );
  res.status(201).json(r);
});

router.put("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { nombre, contacto, email, telefono, notas } = req.body;
  const {
    rows: [r],
  } = await pool.query(
    `
    UPDATE proveedores SET
      nombre   = COALESCE($1, nombre), contacto = COALESCE($2, contacto),
      email    = COALESCE($3, email),  telefono = COALESCE($4, telefono),
      notas    = COALESCE($5, notas)
    WHERE id = $6 AND user_id = $7 RETURNING *
  `,
    [
      nombre?.trim() ?? null,
      contacto ?? null,
      email ?? null,
      telefono ?? null,
      notas ?? null,
      req.params.id,
      userId,
    ],
  );
  if (!r) return res.status(404).json({ error: "No encontrado" });
  res.json(r);
});

router.post("/:id/lista", upload.single("lista"), async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!req.file)
    return res.status(400).json({ error: "No se recibió archivo" });

  const {
    rows: [p],
  } = await pool.query(
    `SELECT id FROM proveedores WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  if (!p) return res.status(404).json({ error: "No encontrado" });

  // Subir archivo original a Supabase Storage
  const ext = extname(req.file.originalname).toLowerCase();
  const filePath = `${userId}/prov-${req.params.id}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("listas")
    .upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });

  if (uploadError) {
    console.error("[Storage]", uploadError.message);
    return res.status(500).json({ error: "Error al subir archivo" });
  }

  const { data } = supabase.storage.from("listas").getPublicUrl(filePath);
  const url = data.publicUrl;

  // Convertir a HTML y subir también a Supabase
  const htmlId = `${userId}-prov-${req.params.id}`;
  const htmlUrl = await convertirYSubirHtml(
    req.file.buffer,
    req.file.originalname,
    htmlId,
  );

  await pool.query(
    `
    UPDATE proveedores SET
      lista_precios_nombre = $1,
      lista_precios_url    = $2,
      lista_precios_html   = $3,
      lista_precios_fecha  = NOW()
    WHERE id = $4
  `,
    [req.file.originalname, url, htmlUrl, req.params.id],
  );

  res.json({ ok: true, url, htmlUrl, nombre: req.file.originalname });
});

router.post("/:id/reconvertir", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;

  const {
    rows: [p],
  } = await pool.query(
    `SELECT * FROM proveedores WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  if (!p?.lista_precios_url)
    return res.status(400).json({ error: "No hay archivo" });

  // Descargar el archivo original desde Supabase para reconvertir
  const ext = extname(p.lista_precios_url).split("?")[0]; // quitar query params
  const filePath = `${userId}/prov-${req.params.id}${ext}`;

  const { data, error } = await supabase.storage
    .from("listas")
    .download(filePath);
  if (error)
    return res.status(404).json({ error: "Archivo no encontrado en Storage" });

  const buffer = Buffer.from(await data.arrayBuffer());
  const htmlId = `${userId}-prov-${req.params.id}`;
  const htmlUrl = await convertirYSubirHtml(
    buffer,
    p.lista_precios_nombre,
    htmlId,
  );

  await pool.query(
    `UPDATE proveedores SET lista_precios_html = $1 WHERE id = $2`,
    [htmlUrl, req.params.id],
  );
  res.json({ ok: true, htmlUrl });
});

router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  await pool.query(
    `UPDATE proveedores SET activo = false WHERE id = $1 AND user_id = $2`,
    [req.params.id, userId],
  );
  res.json({ ok: true });
});

export default router;
