import cron from "node-cron";
import pool from "../db/database.js";
import {
  waAlquilerPorVencer,
  waAlquilerVencido,
  WA_CONFIGURED,
} from "../services/whatsapp.js";

async function yaEnviado(alquilerId, tipo) {
  const hoy = new Date().toISOString().split("T")[0];
  const { rows } = await pool.query(
    `
    SELECT id FROM wa_notificaciones
    WHERE alquiler_id = $1 AND tipo = $2 AND enviado_at::date = $3::date
  `,
    [alquilerId, tipo, hoy],
  );
  return rows.length > 0;
}

async function registrar(alquilerId, tipo, ok, error = null) {
  await pool.query(
    `
    INSERT INTO wa_notificaciones (alquiler_id, tipo, ok, error)
    VALUES ($1, $2, $3, $4)
  `,
    [alquilerId, tipo, ok, error],
  );
}

async function procesarAlquiler(a, tipo, fn) {
  if (await yaEnviado(a.id, tipo)) {
    console.log(
      `[WA Cron] Ya enviado ${tipo} para alquiler #${a.id} — omitiendo`,
    );
    return;
  }
  if (!a.cliente_telefono) {
    console.log(`[WA Cron] Alquiler #${a.id} sin teléfono — omitiendo`);
    return;
  }

  console.log(
    `[WA Cron] Enviando ${tipo} → ${a.cliente_nombre} (${a.cliente_telefono})`,
  );
  const result = await fn(a);
  await registrar(a.id, tipo, result.ok, result.error);

  if (result.ok)
    console.log(`[WA Cron] ✓ ${tipo} enviado a ${a.cliente_nombre}`);
  else
    console.error(`[WA Cron] ✗ Error ${tipo} para #${a.id}: ${result.error}`);
}

export async function runNotificaciones() {
  if (!WA_CONFIGURED) {
    console.log("[WA Cron] WhatsApp no configurado. Saltando.");
    return;
  }

  const hoy = new Date().toISOString().split("T")[0];
  console.log(`[WA Cron] ── Corriendo notificaciones para ${hoy} ──`);

  const { rows: activos } = await pool.query(
    `
    SELECT a.*,
      (SELECT STRING_AGG(ai.nombre_snapshot, ', ')
       FROM alquiler_items ai WHERE ai.alquiler_id = a.id) as productos_nombres,
      (a.fecha_devolucion::date - $1::date) AS dias_restantes
    FROM alquileres a
    WHERE a.estado = 'activo'
  `,
    [hoy],
  );

  let enviados = 0;

  for (const a of activos) {
    // Normalizar fecha para que WhatsApp la formatee bien
    a.fecha_devolucion = String(a.fecha_devolucion).slice(0, 10);
    const d = parseInt(a.dias_restantes);
    a.dias_restantes = d;
    a.vencido = d < 0;

    if (d === 0) {
      await procesarAlquiler(a, "vence_hoy", waAlquilerPorVencer);
      enviados++;
    } else if (d === 3) {
      await procesarAlquiler(a, "vence_3d", waAlquilerPorVencer);
      enviados++;
    } else if (d === -1) {
      await procesarAlquiler(a, "vencido_1d", waAlquilerVencido);
      enviados++;
    } else if (d === -7) {
      await procesarAlquiler(a, "vencido_7d", waAlquilerVencido);
      enviados++;
    }

    if (enviados > 0) await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[WA Cron] ── Finalizó. ${enviados} mensajes enviados ──`);
}

export function iniciarCron() {
  cron.schedule("0 9 * * *", runNotificaciones, {
    timezone: "America/Argentina/Buenos_Aires",
  });
  console.log("[WA Cron] Cron activo — corre a las 9:00 AM ARG");
}
