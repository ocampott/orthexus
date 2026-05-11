import { Router } from "express";
import { lucia } from "../auth.js";
import db from "../db/database.js";
import multer from "multer";
import { join, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LISTAS_DIR = join(__dirname, "../../uploads/listas");
const HTML_DIR = join(__dirname, "../../uploads/listas_html");
mkdirSync(LISTAS_DIR, { recursive: true });
mkdirSync(HTML_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, LISTAS_DIR),
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `prov-${req.params.id}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [".xlsx", ".xls", ".csv", ".tsv", ".ods"];
    if (ok.includes(extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error("Solo se permiten archivos Excel o CSV"));
  },
});

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

function convertirAHtml(archivoPath, htmlId) {
  if (!LO_BIN) return null;
  const tmpDir = `/tmp/lo_conv_${htmlId}_${Date.now()}`;
  const loHome = `/tmp/lo_home_${htmlId}`;
  const loProfile = `${loHome}/.config/libreoffice`;
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(loProfile, { recursive: true });
  try {
    execSync(
      `"${LO_BIN}" --headless --convert-to html --outdir "${tmpDir}" "${archivoPath}"`,
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
    const htmlBase = basename(archivoPath, extname(archivoPath)) + ".html";
    const tmpHtml = join(tmpDir, htmlBase);
    const destHtml = join(HTML_DIR, `${htmlId}.html`);
    if (!existsSync(tmpHtml)) return null;
    let html = readFileSync(tmpHtml, "utf-8");
    const extraCss = `body{margin:0;padding:10px 14px;background:#fff}table{border-collapse:collapse;width:max-content}td,th{border:1px solid #d0d0d0;padding:3px 8px;min-width:50px;font-size:12px}`;
    html = html.includes("</style>")
      ? html.replace("</style>", extraCss + "</style>")
      : html.replace("</head>", `<style>${extraCss}</style></head>`);
    writeFileSync(destHtml, html, "utf-8");
    return `/uploads/listas_html/${htmlId}.html`;
  } catch (e) {
    console.error("[LO] Error:", e.message.slice(0, 200));
    return null;
  } finally {
    try {
      execSync(`rm -rf "${tmpDir}" "${loHome}"`, { stdio: "pipe" });
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
  res.json(
    db
      .prepare(
        `SELECT * FROM proveedores WHERE user_id = ? AND activo = 1 ORDER BY nombre ASC`,
      )
      .all(userId),
  );
});

router.get("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const row = db
    .prepare(`SELECT * FROM proveedores WHERE id = ? AND user_id = ?`)
    .get(req.params.id, userId);
  if (!row) return res.status(404).json({ error: "No encontrado" });
  res.json(row);
});

router.post("/", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { nombre, contacto, email, telefono, notas } = req.body;
  if (!nombre?.trim())
    return res.status(400).json({ error: "El nombre es obligatorio" });
  const r = db
    .prepare(
      `INSERT INTO proveedores (user_id, nombre, contacto, email, telefono, notas) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      nombre.trim(),
      contacto || null,
      email || null,
      telefono || null,
      notas || null,
    );
  res
    .status(201)
    .json(
      db
        .prepare(`SELECT * FROM proveedores WHERE id = ?`)
        .get(r.lastInsertRowid),
    );
});

router.put("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { nombre, contacto, email, telefono, notas } = req.body;
  db.prepare(
    `
    UPDATE proveedores SET
      nombre = COALESCE(?, nombre), contacto = COALESCE(?, contacto),
      email = COALESCE(?, email), telefono = COALESCE(?, telefono), notas = COALESCE(?, notas)
    WHERE id = ? AND user_id = ?
  `,
  ).run(
    nombre?.trim() ?? null,
    contacto ?? null,
    email ?? null,
    telefono ?? null,
    notas ?? null,
    req.params.id,
    userId,
  );
  res.json(
    db.prepare(`SELECT * FROM proveedores WHERE id = ?`).get(req.params.id),
  );
});

router.post("/:id/lista", upload.single("lista"), async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  if (!req.file)
    return res.status(400).json({ error: "No se recibió archivo" });
  const p = db
    .prepare(`SELECT id FROM proveedores WHERE id = ? AND user_id = ?`)
    .get(req.params.id, userId);
  if (!p) return res.status(404).json({ error: "No encontrado" });
  const url = `/uploads/listas/${req.file.filename}`;
  const htmlUrl = convertirAHtml(req.file.path, `prov-${req.params.id}`);
  db.prepare(
    `UPDATE proveedores SET lista_precios_nombre=?, lista_precios_url=?, lista_precios_html=?, lista_precios_fecha=datetime('now','localtime') WHERE id=?`,
  ).run(req.file.originalname, url, htmlUrl, req.params.id);
  res.json({ ok: true, url, htmlUrl, nombre: req.file.originalname });
});

router.post("/:id/reconvertir", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const p = db
    .prepare(`SELECT * FROM proveedores WHERE id = ? AND user_id = ?`)
    .get(req.params.id, userId);
  if (!p?.lista_precios_url)
    return res.status(400).json({ error: "No hay archivo" });
  const archivoPath = join(__dirname, "../..", p.lista_precios_url);
  if (!existsSync(archivoPath))
    return res.status(404).json({ error: "Archivo no encontrado" });
  const htmlUrl = convertirAHtml(archivoPath, `prov-${req.params.id}`);
  db.prepare(`UPDATE proveedores SET lista_precios_html = ? WHERE id = ?`).run(
    htmlUrl,
    req.params.id,
  );
  res.json({ ok: true, htmlUrl });
});

router.delete("/:id", async (req, res) => {
  const userId = await requireUser(req, res);
  if (!userId) return;
  db.prepare(
    `UPDATE proveedores SET activo = 0 WHERE id = ? AND user_id = ?`,
  ).run(req.params.id, userId);
  res.json({ ok: true });
});

export default router;
