import { Router } from "express";
import { randomUUID } from "crypto";
import bcrypt from "bcrypt";
import { Google } from "arctic";
import { lucia } from "../auth.js";
import pool from "../db/database.js";

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? new Google(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        `${BACKEND_URL}/api/auth/google/callback`,
      )
    : null;

// ── Helpers ──────────────────────────────────────────
async function createSession(userId) {
  return await lucia.createSession(userId, {});
}

function getToken(req) {
  return (
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.auth_session
  );
}

// ── POST /api/auth/register ──────────────────────────
router.post("/register", async (req, res) => {
  const { email, password, nombre } = req.body;
  if (!email || !password || !nombre)
    return res.status(400).json({ error: "Completá todos los campos." });
  if (password.length < 6)
    return res
      .status(400)
      .json({ error: "La contraseña debe tener al menos 6 caracteres." });

  const { rows: existe } = await pool.query(
    `SELECT id FROM users WHERE email = $1`,
    [email.toLowerCase()],
  );
  if (existe.length > 0)
    return res
      .status(409)
      .json({ error: "Ya existe una cuenta con ese email." });

  const hash = await bcrypt.hash(password, 12);
  const userId = randomUUID();

  await pool.query(
    `INSERT INTO users (id, email, nombre, password_hash) VALUES ($1, $2, $3, $4)`,
    [userId, email.toLowerCase(), nombre.trim(), hash],
  );

  const session = await createSession(userId);
  const sessionCookie = lucia.createSessionCookie(session.id);
  res.appendHeader("Set-Cookie", sessionCookie.serialize());
  
  const { rows } = await pool.query(
    `SELECT id, email, nombre, avatar_url, rol FROM users WHERE id = $1`,
    [userId],
  );
  res.json({ ok: true, user: rows[0] });
});

// ── POST /api/auth/login ─────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email y contraseña requeridos." });

  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = $1 AND activo = true`,
    [email.toLowerCase()],
  );
  const user = rows[0];
  if (!user || !user.password_hash)
    return res.status(401).json({ error: "Email o contraseña incorrectos." });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match)
    return res.status(401).json({ error: "Email o contraseña incorrectos." });

  const session = await createSession(user.id);
  const sessionCookie = lucia.createSessionCookie(session.id);
  res.appendHeader("Set-Cookie", sessionCookie.serialize());
  
  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      avatar_url: user.avatar_url,
      rol: user.rol,
    },
  });
});

// ── POST /api/auth/logout ────────────────────────────
router.post("/logout", async (req, res) => {
  const token = getToken(req);
  if (token) await lucia.invalidateSession(token);
  
  // Limpiar la cookie en el navegador
  const sessionCookie = lucia.createBlankSessionCookie();
  res.appendHeader("Set-Cookie", sessionCookie.serialize());
  
  res.json({ ok: true });
});

// ── GET /api/auth/me ─────────────────────────────────
router.get("/me", async (req, res) => {
  const token = getToken(req);
  if (!token) {
    console.log("❌ No llegó el token desde las cookies ni los headers.");
    return res.status(401).json({ error: "No autenticado" });
  }
  
  try {
    const { session, user } = await lucia.validateSession(token);
    if (!session) {
      console.log("❌ La sesión no existe en la DB o está expirada.");
      return res.status(401).json({ error: "Sesión expirada o no encontrada" });
    }
    res.json({ ok: true, user });
  } catch (error) {
    // 🔥 ESTO NOS DIRÁ LA VERDAD EN LOS LOGS DE RENDER 🔥
    console.error("🔥 Error interno al validar la sesión en /me:", error);
    res.status(500).json({ 
      error: "Error interno del servidor", 
      detail: error.message 
    });
  }
});

// ── GET /api/auth/google ─────────────────────────────
router.get("/google", async (req, res) => {
  if (!google)
    return res.status(503).json({ error: "Google OAuth no configurado." });

  const state = randomUUID();
  const codeVerifier = randomUUID();

  res.cookie("google_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 600000,
  });
  res.cookie("google_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 600000,
  });

  const url = await google.createAuthorizationURL(state, codeVerifier, [
    "profile",
    "email",
  ]);
  res.redirect(url.toString());
});

// ── GET /api/auth/google/callback ───────────────────
router.get("/google/callback", async (req, res) => {
  if (!google) return res.status(503).send("No configurado");

  const { code, state } = req.query;
  const savedState = req.cookies?.google_oauth_state;
  const codeVerifier = req.cookies?.google_code_verifier;

  if (!code || state !== savedState)
    return res.redirect(`${FRONTEND_URL}/login?error=google_state`);

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

    let { rows } = await pool.query(
      `SELECT * FROM users WHERE google_id = $1`,
      [profile.id],
    );
    let user = rows[0];

    if (!user) {
      const { rows: byEmail } = await pool.query(
        `SELECT * FROM users WHERE email = $1`,
        [profile.email?.toLowerCase()],
      );
      user = byEmail[0];
    }

    if (!user) {
      const userId = randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, nombre, google_id, avatar_url) VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          profile.email.toLowerCase(),
          profile.name,
          profile.id,
          profile.picture,
        ],
      );
      const { rows: newUser } = await pool.query(
        `SELECT * FROM users WHERE id = $1`,
        [userId],
      );
      user = newUser[0];
    } else if (!user.google_id) {
      await pool.query(
        `UPDATE users SET google_id = $1, avatar_url = $2 WHERE id = $3`,
        [profile.id, profile.picture, user.id],
      );
    }

    const session = await createSession(user.id);
    const sessionCookie = lucia.createSessionCookie(session.id);
    
    // Setear la cookie y redirigir limpio al frontend
    res.appendHeader("Set-Cookie", sessionCookie.serialize());
    res.redirect(`${FRONTEND_URL}/`);
    
  } catch (e) {
    console.error("[Google OAuth]", e.message);
    res.redirect(`${FRONTEND_URL}/login?error=google`);
  }
});

export default router;