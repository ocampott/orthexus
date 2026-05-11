import { Lucia } from "lucia";
import { PostgresJsAdapter } from "@lucia-auth/adapter-postgresql";
import pool from "./db/database.js";

const adapter = new PostgresJsAdapter(pool, {
  user: "users",
  session: "sessions",
});

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
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
