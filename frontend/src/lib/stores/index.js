import { writable, derived } from 'svelte/store';
import { productosApi, alquileresApi } from '../api/index.js';

// ── Toast store ────────────────────────────────────────
const _toasts = writable([]);

export const toasts = {
  subscribe: _toasts.subscribe,
  agregar(mensaje, tipo = 'info', duracion = 3800) {
    const id = Date.now() + Math.random();
    _toasts.update(ts => [...ts, { id, mensaje, tipo }]);
    setTimeout(() => _toasts.update(ts => ts.filter(t => t.id !== id)), duracion);
  },
  ok:    (msg) => toasts.agregar(msg, 'ok'),
  error: (msg) => toasts.agregar(msg, 'error'),
  info:  (msg) => toasts.agregar(msg, 'info'),
  warn:  (msg) => toasts.agregar(msg, 'warn'),
};

export const notif = toasts; // backward compat

// ── Carrito ────────────────────────────────────────────
// Soporta productos simples y variantes
// _key = "prod-{id}" o "var-{variante_id}" para deduplicar correctamente
function crearCarrito() {
  const { subscribe, set, update } = writable([]);
  return {
    subscribe,
    agregar(producto) {
      const key = producto.variante_id ? `var-${producto.variante_id}` : `prod-${producto.id ?? producto.producto_id}`;
      update(items => {
        const ex = items.find(i => i._key === key);
        if (ex) {
          if (ex.cantidad >= ex.stock_actual) return items;
          return items.map(i => i._key === key
            ? { ...i, cantidad: i.cantidad + 1, subtotal: (i.cantidad + 1) * i.precio_unitario }
            : i);
        }
        const precio = parseFloat(producto.precio_venta) || 0;
        return [...items, {
          _key:            key,
          producto_id:     producto.producto_id ?? producto.id,
          variante_id:     producto.variante_id ?? null,
          nombre:          producto.nombre,
          precio_unitario: precio,
          stock_actual:    typeof producto.stock_actual === 'number' ? producto.stock_actual : Infinity,
          cantidad:        1,
          subtotal:        precio,
        }];
      });
    },
    setCantidad(key, cant) {
      update(items => items
        .map(i => i._key === key ? { ...i, cantidad: cant, subtotal: cant * i.precio_unitario } : i)
        .filter(i => i.cantidad > 0));
    },
    eliminar(key) { update(items => items.filter(i => i._key !== key)); },
    vaciar()      { set([]); },
  };
}

export const carrito      = crearCarrito();
export const totalCarrito = derived(carrito, $c => $c.reduce((s, i) => s + i.subtotal, 0));

// ── Notificaciones persistentes ────────────────────────
export const notifStore   = writable([]);
export const dismissedIds = writable(new Set());

export async function refreshNotifications() {
  try {
    const [productos, alquileres] = await Promise.all([
      productosApi.listar(),
      alquileresApi.listar(),
    ]);

    const out = [];
    const now = Date.now();

    for (const p of productos) {
      if (!p.tiene_variantes) {
        if (p.stock_actual === 0) {
          out.push({ id: `out-${p.id}`, kind: 'out_stock', title: 'Sin stock',
            desc: `${p.nombre} — 0 unidades`, href: '/productos', time: new Date().toISOString() });
        } else if (p.stock_actual <= p.stock_minimo && p.stock_minimo > 0) {
          out.push({ id: `low-${p.id}`, kind: 'low_stock', title: 'Stock bajo',
            desc: `${p.nombre} — ${p.stock_actual} u. (mín. ${p.stock_minimo})`, href: '/productos', time: new Date().toISOString() });
        }
      }
    }

    for (const a of alquileres) {
      if (a.estado === 'devuelto') continue;
      const end  = new Date(a.fecha_devolucion + 'T12:00:00').getTime();
      const dias = (end - now) / 86400_000;
      if (dias < 0) {
        out.push({ id: `over-${a.id}`, kind: 'rental_overdue', title: 'Alquiler vencido',
          desc: `${a.cliente_nombre} — ${Math.abs(Math.ceil(dias))}d de retraso`, href: '/alquileres', time: a.fecha_devolucion });
      } else if (dias <= 2) {
        out.push({ id: `due-${a.id}`, kind: 'rental_due', title: 'Por vencer',
          desc: `${a.cliente_nombre} devuelve en ${Math.ceil(dias)} día${Math.ceil(dias) !== 1 ? 's' : ''}`, href: '/alquileres', time: a.fecha_devolucion });
      }
    }

    notifStore.set(out);
  } catch { /* backend no disponible */ }
}

// ── Confirm dialog ─────────────────────────────────────
export const _confirmStore = writable(null);

export function showConfirm(opts) {
  return new Promise((resolve) => {
    _confirmStore.set({ ...opts, resolve });
  });
}


export const formatPeso = (n) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0
  }).format(n ?? 0);
