/**
 * Genera URLs de WhatsApp con mensajes pre-cargados
 * Abre wa.me con el mensaje listo — el usuario solo aprieta enviar
 */

// Limpiar número para wa.me (solo dígitos, con código de país)
function limpiarNumero(tel) {
  if (!tel) return null;
  let n = tel.replace(/\D/g, '');
  // Si no tiene código de país, asumir Argentina (+54)
  if (n.startsWith('0')) n = '54' + n.slice(1);       // 011... → 54 11...
  if (n.startsWith('15')) n = '549' + n.slice(2);     // 1566... → 549...
  if (!n.startsWith('54')) n = '54' + n;              // sin código → agregar 54
  // WhatsApp Argentina: sacar el 0 y el 15 del celular
  // Formato correcto: 5491166778899
  return n;
}

// Formatear fecha en español
function fmtFecha(str) {
  if (!str) return '';
  return new Date(str + 'T12:00:00').toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

// Abrir WhatsApp en nueva pestaña
function abrirWA(numero, mensaje) {
  const n = limpiarNumero(numero);
  const url = n
    ? `https://wa.me/${n}?text=${encodeURIComponent(mensaje)}`
    : `https://wa.me/?text=${encodeURIComponent(mensaje)}`;  // sin número, solo mensaje
  window.open(url, '_blank', 'noopener');
}

// ── Mensajes de alquiler ──────────────────────────────

export function waMensajeNuevoAlquiler(alquiler, items = []) {
  const productos = items.length
    ? items.map(i => `  • ${i.nombre_snapshot} x${i.cantidad}`).join('\n')
    : '  • (productos del alquiler)';

  const msg = `Hola ${alquiler.cliente_nombre} 👋

Te confirmamos tu alquiler en *Orthexus*:

📦 *Productos:*
${productos}

📅 *Inicio:* ${fmtFecha(alquiler.fecha_inicio)}
📅 *Devolución:* ${fmtFecha(alquiler.fecha_devolucion)}
💰 *Total:* $${Number(alquiler.precio_total).toLocaleString('es-AR')}

${alquiler.numero_alquiler ? `📋 *Contrato:* ${alquiler.numero_alquiler}` : ''}

Cualquier consulta no dudes en escribirnos. ¡Muchas gracias! 🙏`;

  return msg.trim();
}

export function waMensajePorVencer(alquiler) {
  const dias = alquiler.dias_restantes;
  const msg = `Hola ${alquiler.cliente_nombre} 👋

Te recordamos que tu alquiler en *Orthexus* vence ${dias === 1 ? 'mañana' : `en ${dias} días`}.

📅 *Fecha de devolución:* ${fmtFecha(alquiler.fecha_devolucion)}
${alquiler.numero_alquiler ? `📋 *Contrato:* ${alquiler.numero_alquiler}` : ''}

Si necesitás renovar el alquiler o tenés alguna consulta, comunicate con nosotros.

¡Gracias! 🙏`;

  return msg.trim();
}

export function waMensajeVencido(alquiler) {
  const diasVencido = Math.abs(alquiler.dias_restantes);
  const msg = `Hola ${alquiler.cliente_nombre} 👋

Te informamos que tu alquiler en *Orthexus* venció hace ${diasVencido} día${diasVencido !== 1 ? 's' : ''}.

📅 *Fecha de devolución pactada:* ${fmtFecha(alquiler.fecha_devolucion)}
${alquiler.numero_alquiler ? `📋 *Contrato:* ${alquiler.numero_alquiler}` : ''}

Por favor, coordinar la devolución del equipo a la brevedad.

Ante cualquier consulta, estamos a disposición. 🙏`;

  return msg.trim();
}

// ── Funciones principales ─────────────────────────────

export function enviarWANuevoAlquiler(alquiler, items = []) {
  const msg = waMensajeNuevoAlquiler(alquiler, items);
  abrirWA(alquiler.cliente_telefono, msg);
}

export function enviarWAPorVencer(alquiler) {
  const msg = waMensajePorVencer(alquiler);
  abrirWA(alquiler.cliente_telefono, msg);
}

export function enviarWAVencido(alquiler) {
  const msg = waMensajeVencido(alquiler);
  abrirWA(alquiler.cliente_telefono, msg);
}
