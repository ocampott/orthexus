/**
 * Cron job — Notificaciones automáticas de alquileres por WhatsApp
 *
 * Corre todos los días a las 9:00 AM (hora Argentina)
 *
 * Qué hace:
 *   1. Alquileres que vencen HOY         → aviso urgente
 *   2. Alquileres que vencen en 3 días   → recordatorio
 *   3. Alquileres vencidos hace 1 día    → aviso de devolución pendiente
 *   4. Alquileres vencidos hace 7 días   → segundo aviso
 *
 * Para no spamear, guarda en DB qué mensajes ya se enviaron.
 */

import cron from 'node-cron';
import db   from '../db/database.js';
import {
  waAlquilerPorVencer,
  waAlquilerVencido,
  WA_CONFIGURED,
} from '../services/whatsapp.js';

// Tabla para trackear mensajes enviados (evitar spam)
db.exec(`
  CREATE TABLE IF NOT EXISTS wa_notificaciones (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    alquiler_id   INTEGER NOT NULL,
    tipo          TEXT NOT NULL,    -- 'vence_hoy' | 'vence_3d' | 'vencido_1d' | 'vencido_7d'
    enviado_at    TEXT DEFAULT (datetime('now','localtime')),
    ok            INTEGER DEFAULT 1,
    error         TEXT
  );
`);

function yaEnviado(alquilerId, tipo) {
  // Verificar si ya se envió este tipo de notificación hoy
  const hoy = new Date().toISOString().split('T')[0];
  const row = db.prepare(`
    SELECT id FROM wa_notificaciones
    WHERE alquiler_id = ? AND tipo = ? AND date(enviado_at) = ?
  `).get(alquilerId, tipo, hoy);
  return !!row;
}

function registrar(alquilerId, tipo, ok, error = null) {
  db.prepare(`
    INSERT INTO wa_notificaciones (alquiler_id, tipo, ok, error)
    VALUES (?, ?, ?, ?)
  `).run(alquilerId, tipo, ok ? 1 : 0, error);
}

async function procesarAlquiler(a, tipo, fn) {
  if (yaEnviado(a.id, tipo)) {
    console.log(`[WA Cron] Ya enviado ${tipo} para alquiler #${a.id} — omitiendo`);
    return;
  }
  if (!a.cliente_telefono) {
    console.log(`[WA Cron] Alquiler #${a.id} sin teléfono — omitiendo`);
    return;
  }

  console.log(`[WA Cron] Enviando ${tipo} → ${a.cliente_nombre} (${a.cliente_telefono})`);
  const result = await fn(a);
  registrar(a.id, tipo, result.ok, result.error);

  if (result.ok) {
    console.log(`[WA Cron] ✓ ${tipo} enviado a ${a.cliente_nombre}`);
  } else {
    console.error(`[WA Cron] ✗ Error ${tipo} para #${a.id}: ${result.error}`);
  }
}

export async function runNotificaciones() {
  if (!WA_CONFIGURED) {
    console.log('[WA Cron] WhatsApp no configurado. Saltando notificaciones.');
    return;
  }

  const hoy = new Date().toISOString().split('T')[0];
  console.log(`[WA Cron] ── Corriendo notificaciones para ${hoy} ──`);

  // Traer todos los alquileres activos
  const activos = db.prepare(`
    SELECT a.*,
      (SELECT GROUP_CONCAT(ai.nombre_snapshot, ', ')
       FROM alquiler_items ai WHERE ai.alquiler_id = a.id) as productos_nombres,
      CAST((julianday(a.fecha_devolucion) - julianday(?)) AS INTEGER) as dias_restantes
    FROM alquileres a
    WHERE a.estado = 'activo' AND a.activo != 0
  `).all(hoy);

  let enviados = 0;

  for (const a of activos) {
    const d = a.dias_restantes;
    a.vencido = d < 0;

    if (d === 0) {
      // Vence HOY
      await procesarAlquiler(a, 'vence_hoy', waAlquilerPorVencer);
      enviados++;
    } else if (d === 3) {
      // Vence en 3 días
      await procesarAlquiler(a, 'vence_3d', waAlquilerPorVencer);
      enviados++;
    } else if (d === -1) {
      // Venció ayer
      await procesarAlquiler(a, 'vencido_1d', waAlquilerVencido);
      enviados++;
    } else if (d === -7) {
      // Venció hace una semana
      await procesarAlquiler(a, 'vencido_7d', waAlquilerVencido);
      enviados++;
    }

    // Pequeña pausa entre mensajes para no saturar la API
    if (enviados > 0) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[WA Cron] ── Finalizó. ${enviados} mensajes enviados ──`);
}

// ── Iniciar cron ─────────────────────────────────────
export function iniciarCron() {
  // Todos los días a las 9:00 AM (America/Argentina/Buenos_Aires)
  cron.schedule('0 9 * * *', runNotificaciones, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  console.log('[WA Cron] Cron de notificaciones activo — corre a las 9:00 AM ARG');
}
