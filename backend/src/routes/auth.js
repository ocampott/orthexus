import { Router } from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { Google } from "arctic";
import { lucia } from "../auth.js";
import db from "../db/database.js";

const router = Router();

// ── Google OAuth client ─────────────────────────────
// Credenciales en variables de entorno:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? new Google(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        "http://localhost:3001/api/auth/google/callback",
      )
    : null;

// ── Helpers ─────────────────────────────────────────
function setCookie(res, session) {
  const cookie = lucia.createSessionCookie(session.id);
  res.cookie(cookie.name, cookie.value, cookie.attributes);
}

function clearCookie(res) {
  const blank = lucia.createBlankSessionCookie();
  res.cookie(blank.name, blank.value, blank.attributes);
}

async function createSession(res, userId) {
  const session = await lucia.createSession(userId, {});
  setCookie(res, session);
  return session;
}

// ── POST /api/auth/register ─────────────────────────
router.post("/register", async (req, res) => {
  const { email, password, nombre } = req.body;
  if (!email || !password || !nombre)
    return res.status(400).json({ error: "Completá todos los campos." });
  if (password.length < 6)
    return res
      .status(400)
      .json({ error: "La contraseña debe tener al menos 6 caracteres." });

  const existe = db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .get(email.toLowerCase());
  if (existe)
    return res
      .status(409)
      .json({ error: "Ya existe una cuenta con ese email." });

  const hash = await bcrypt.hash(password, 12);
  const userId = randomUUID();

  db.prepare(
    `
    INSERT INTO users (id, email, nombre, password_hash)
    VALUES (?, ?, ?, ?)
  `,
  ).run(userId, email.toLowerCase(), nombre.trim(), hash);

  const session = await createSession(res, userId);
  const user = db
    .prepare(
      `SELECT id, email, nombre, avatar_url, rol FROM users WHERE id = ?`,
    )
    .get(userId);
  res.json({ ok: true, user, sessionId: session.id });
});

// ── POST /api/auth/login ────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email y contraseña requeridos." });

  const user = db
    .prepare(`SELECT * FROM users WHERE email = ? AND activo = 1`)
    .get(email.toLowerCase());
  if (!user || !user.password_hash)
    return res.status(401).json({ error: "Email o contraseña incorrectos." });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match)
    return res.status(401).json({ error: "Email o contraseña incorrectos." });

  const session = await createSession(res, user.id);
  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      avatar_url: user.avatar_url,
      rol: user.rol,
    },
    sessionId: session.id,
  });
});

// ── POST /api/auth/logout ────────────────────────────
router.post("/logout", async (req, res) => {
  const sessionId = req.cookies?.auth_session;
  if (sessionId) await lucia.invalidateSession(sessionId);
  clearCookie(res);
  res.json({ ok: true });
});

// ── GET /api/auth/me ────────────────────────────────
router.get("/me", async (req, res) => {
  const sessionId = req.cookies?.auth_session;
  if (!sessionId) return res.status(401).json({ error: "No autenticado" });

  try {
    const { session, user } = await lucia.validateSession(sessionId);
    if (!session) {
      clearCookie(res);
      return res.status(401).json({ error: "Sesión inválida" });
    }
    if (session.fresh) setCookie(res, session);
    res.json({ ok: true, user });
  } catch {
    clearCookie(res);
    res.status(401).json({ error: "Sesión inválida" });
  }
});

// ── GET /api/auth/google ─────────────────────────────
// GET /api/auth/google
router.get("/google", async (req, res) => {
  if (!google)
    return res.status(503).json({
      error: "Google OAuth no configurado.",
    });

  const state = randomUUID();
  const codeVerifier = randomUUID();

  res.cookie("google_oauth_state", state, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 600000,
  });
  res.cookie("google_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 600000,
  });

  const url = await google.createAuthorizationURL(state, codeVerifier, [
    "profile",
    "email",
  ]);
  res.redirect(url.toString());
});

// GET /api/auth/google/callback
router.get("/google/callback", async (req, res) => {
  if (!google) return res.status(503).send("No configurado");

  const { code, state } = req.query;
  const savedState = req.cookies?.google_oauth_state;
  const codeVerifier = req.cookies?.google_code_verifier;

  if (!code || state !== savedState) {
    return res.redirect("http://localhost:5173/login?error=google_state");
  }

  res.clearCookie("google_oauth_state");
  res.clearCookie("google_code_verifier");

  try {
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.accessToken()}` },
      },
    );
    const profile = await profileRes.json();

    let user =
      db.prepare(`SELECT * FROM users WHERE google_id = ?`).get(profile.id) ??
      db
        .prepare(`SELECT * FROM users WHERE email = ?`)
        .get(profile.email?.toLowerCase());

    if (!user) {
      const userId = randomUUID();
      db.prepare(
        `INSERT INTO users (id, email, nombre, google_id, avatar_url) VALUES (?, ?, ?, ?, ?)`,
      ).run(
        userId,
        profile.email.toLowerCase(),
        profile.name,
        profile.id,
        profile.picture,
      );
      user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId);
    } else if (!user.google_id) {
      db.prepare(
        `UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?`,
      ).run(profile.id, profile.picture, user.id);
    }

    await createSession(res, user.id);
    res.redirect("http://localhost:5173/?login=ok");
  } catch (e) {
    console.error("[Google OAuth]", e.message);
    res.redirect("http://localhost:5173/login?error=google");
  }
});

export default router;
