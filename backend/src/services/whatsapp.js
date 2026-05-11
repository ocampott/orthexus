/**
 * WhatsApp Cloud API — Meta Business Platform
 *
 * Documentación: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Variables de entorno requeridas en .env:
 *   WA_TOKEN          — Permanent access token de tu app de Meta
 *   WA_PHONE_ID       — Phone Number ID (no el número, el ID que da Meta)
 *   WA_TEMPLATE_NUEVO — Nombre del template "confirmacion_alquiler" (default)
 *   WA_TEMPLATE_VENCE — Nombre del template "alquiler_por_vencer" (default)
 *   WA_TEMPLATE_VENCIDO — Nombre del template "alquiler_vencido" (default)
 */

import axios from 'axios';

const API_VERSION = 'v20.0';
const BASE_URL    = `https://graph.facebook.com/${API_VERSION}`;

// ── Configuración ────────────────────────────────────
export const WA_CONFIGURED = !!(process.env.WA_TOKEN && process.env.WA_PHONE_ID);

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.WA_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// ── Normalizar número argentino ──────────────────────
export function normalizarNumero(tel) {
  if (!tel) return null;
  let n = tel.replace(/\D/g, '');

  // Remover 0 inicial
  if (n.startsWith('0')) n = n.slice(1);

  // Remover 15 de celulares argentinos (011 15 xxxx-xxxx → 11 xxxx xxxx)
  // El formato correcto para WA Argentina es: 549XXXXXXXX
  if (n.length === 10 && !n.startsWith('54')) {
    // 1166778899 → 5491166778899
    n = '549' + n;
  } else if (n.startsWith('54') && n.length === 12) {
    // 541166778899 → 5491166778899 (agregar el 9 de celular)
    n = '549' + n.slice(2);
  } else if (!n.startsWith('54')) {
    n = '54' + n;
  }

  return n;
}

// ── Enviar mensaje con template ──────────────────────
async function enviarTemplate(numero, template, componentes = [], idioma = 'es_AR') {
  if (!WA_CONFIGURED) {
    console.warn('[WA] No configurado. Agregar WA_TOKEN y WA_PHONE_ID en .env');
    return { ok: false, error: 'WhatsApp no configurado' };
  }

  const tel = normalizarNumero(numero);
  if (!tel) return { ok: false, error: 'Número inválido' };

  try {
    const payload = {
      messaging_product: 'whatsapp',
      to:                tel,
      type:              'template',
      template: {
        name:       template,
        language:   { code: idioma },
        components: componentes,   // ← la clave DEBE ser "components" (inglés)
      },
    };
    console.log('[WA] Payload:', JSON.stringify(payload, null, 2));
    const { data } = await axios.post(
      `${BASE_URL}/${process.env.WA_PHONE_ID}/messages`,
      payload,
      { headers: getHeaders() }
    );

    console.log(`[WA] ✓ Enviado a ${tel} (template: ${template})`);
    return { ok: true, messageId: data.messages?.[0]?.id };
  } catch(e) {
    const err = e.response?.data?.error?.message || e.message;
    console.error(`[WA] ✗ Error enviando a ${tel}:`, err);
    return { ok: false, error: err };
  }
}

// ── Templates específicos ────────────────────────────

/**
 * Confirmación de nuevo alquiler
 * Template: "confirmacion_alquiler"
 * Variables: {{1}} nombre, {{2}} productos, {{3}} fecha_inicio, {{4}} fecha_devolucion, {{5}} total
 */
export async function waConfirmacionAlquiler(alquiler, items = []) {
  if (!alquiler.cliente_telefono) return { ok: false, error: 'Sin teléfono' };

  const productos = items.length
    ? items.map(i => `${i.nombre_snapshot} x${i.cantidad}`).join(', ')
    : 'productos del alquiler';

  const template = process.env.WA_TEMPLATE_NUEVO || 'confirmacion_alquiler';

  return enviarTemplate(alquiler.cliente_telefono, template, [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: alquiler.cliente_nombre },
        { type: 'text', text: productos },
        { type: 'text', text: formatFecha(alquiler.fecha_inicio) },
        { type: 'text', text: formatFecha(alquiler.fecha_devolucion) },
        { type: 'text', text: `$${Number(alquiler.precio_total).toLocaleString('es-AR')}` },
      ],
    },
  ]);
}

/**
 * Aviso de alquiler por vencer
 * Template: "alquiler_por_vencer"
 * Variables: {{1}} nombre, {{2}} dias, {{3}} fecha_devolucion
 */
export async function waAlquilerPorVencer(alquiler) {
  console.log("🚀 ~ waAlquilerPorVencer ~ alquiler:", alquiler)
  if (!alquiler.cliente_telefono) return { ok: false, error: 'Sin teléfono' };

  const dias = alquiler.dias_restantes;
  const diasText = dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`;
  const template = process.env.WA_TEMPLATE_VENCE || 'alquiler_por_vencer';

  return enviarTemplate(alquiler.cliente_telefono, template, [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: alquiler.cliente_nombre },
        { type: 'text', text: formatFecha(alquiler.fecha_devolucion) },
      ],
    },
  ]);
}

/**
 * Aviso de alquiler vencido
 * Template: "alquiler_vencido"
 * Variables: {{1}} nombre, {{2}} dias_vencido, {{3}} fecha_devolucion
 */
export async function waAlquilerVencido(alquiler) {
  if (!alquiler.cliente_telefono) return { ok: false, error: 'Sin teléfono' };

  const diasVencido = Math.abs(alquiler.dias_restantes);
  const template = process.env.WA_TEMPLATE_VENCIDO || 'alquiler_vencido';

  return enviarTemplate(alquiler.cliente_telefono, template, [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: alquiler.cliente_nombre },
        { type: 'text', text: String(diasVencido) },
        { type: 'text', text: formatFecha(alquiler.fecha_devolucion) },
      ],
    },
  ]);
}

// ── Verificar estado de un número ───────────────────
export async function verificarNumero(tel) {
  if (!WA_CONFIGURED) return { ok: false, error: 'No configurado' };
  const numero = normalizarNumero(tel);
  if (!numero) return { ok: false, error: 'Número inválido' };
  // La API no tiene endpoint directo de verificación, pero podemos intentar
  // enviar un mensaje y ver si el número existe
  return { ok: true, numero };
}

// ── Helper fecha ──────────────────────────────────────
function formatFecha(str) {
  if (!str) return '';
  return new Date(str + 'T12:00:00').toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}
