import { Lucia } from "lucia";
import pool from "./db/database.js";

const adapter = {
  async getSessionAndUser(sessionId) {
    const { rows } = await pool.query(
      `
      SELECT s.id, s.user_id, s.expires_at,
             u.id as uid, u.email, u.nombre, u.avatar_url, u.google_id, u.rol
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1
    `,
      [sessionId],
    );
    if (!rows[0]) return [null, null];
    const r = rows[0];
    return [
      {
        id: r.id,
        userId: r.user_id,
        expiresAt: new Date(Number(r.expires_at) * 1000),
      },
      {
        id: r.uid,
        // 🔥 LA MAGIA ESTÁ AQUÍ: Envolver todo en 'attributes' 🔥
        attributes: {
          email: r.email,
          nombre: r.nombre,
          avatar_url: r.avatar_url,
          google_id: r.google_id,
          rol: r.rol,
        },
      },
    ];
  },
  async getUserSessions(userId) {
    const { rows } = await pool.query(
      `SELECT * FROM sessions WHERE user_id = $1`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      expiresAt: new Date(Number(r.expires_at) * 1000),
    }));
  },
  async setSession(session) {
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET expires_at = $3`,
      [
        session.id,
        session.userId,
        Math.floor(session.expiresAt.getTime() / 1000),
      ],
    );
  },
  async updateSessionExpiration(sessionId, expiresAt) {
    await pool.query(`UPDATE sessions SET expires_at = $1 WHERE id = $2`, [
      Math.floor(expiresAt.getTime() / 1000),
      sessionId,
    ]);
  },
  async deleteSession(sessionId) {
    await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  },
  async deleteUserSessions(userId) {
    await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  },
  async deleteExpiredSessions() {
    await pool.query(`DELETE FROM sessions WHERE expires_at < $1`, [
      Math.floor(Date.now() / 1000),
    ]);
  },
};

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    },
  },
  getUserAttributes(attrs) {
    return {
      email: attrs.email,
      nombre: attrs.nombre,
      avatar_url: attrs.avatar_url,
      google_id: attrs.google_id,
      rol: attrs.rol,
    };
  },
});
