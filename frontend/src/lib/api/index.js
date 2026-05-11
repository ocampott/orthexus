// Usar variable de entorno en producción, localhost en desarrollo
import { PUBLIC_API_URL } from "$env/static/public";

const BASE = (PUBLIC_API_URL || "http://localhost:3001") + "/api";

async function request(method, path, body) {
  const opts = {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const get = (p) => request("GET", p);
const post = (p, b) => request("POST", p, b);
const put = (p, b) => request("PUT", p, b);
const patch = (p, b) => request("PATCH", p, b);
const del = (p) => request("DELETE", p);

export const authApi = {
  register: (data) => post("/auth/register", data),
  login: (data) => post("/auth/login", data),
  logout: () => post("/auth/logout", {}),
  me: () => get("/auth/me"),
  googleUrl: () => `${BASE}/auth/google`,
};

export const productosApi = {
  listar: (params = {}) => get("/productos?" + new URLSearchParams(params)),
  buscar: (q = "") => get(`/productos/buscar?q=${encodeURIComponent(q)}`),
  porBarcode: (codigo) =>
    get(`/productos/barcode/${encodeURIComponent(codigo)}`),
  porId: (id) => get(`/productos/${id}`),
  categorias: () => get("/productos/categorias"),
  crear: (data) => post("/productos", data),
  actualizar: (id, data) => put(`/productos/${id}`, data),
  ajustarStock: (id, cant, op = "set") =>
    patch(`/productos/${id}/stock`, { cantidad: cant, operacion: op }),
  eliminar: (id) => del(`/productos/${id}`),
  recalcularTodos: () => post("/productos/recalcular-todos", {}),
};

export const variantesApi = {
  listar: (productoId) => get(`/productos/${productoId}/variantes`),
  crear: (productoId, data) => post(`/productos/${productoId}/variantes`, data),
  editar: (productoId, id, data) =>
    put(`/productos/${productoId}/variantes/${id}`, data),
  ajustarStock: (productoId, id, cant, op = "set") =>
    patch(`/productos/${productoId}/variantes/${id}/stock`, {
      cantidad: cant,
      operacion: op,
    }),
  eliminar: (productoId, id) => del(`/productos/${productoId}/variantes/${id}`),
};

export const proveedoresApi = {
  listar: () => get("/proveedores"),
  obtener: (id) => get(`/proveedores/${id}`),
  crear: (data) => post("/proveedores", data),
  actualizar: (id, data) => put(`/proveedores/${id}`, data),
  eliminar: (id) => del(`/proveedores/${id}`),
  reconvertir: (id) => post(`/proveedores/${id}/reconvertir`, {}),
  subirLista: async (id, archivo) => {
    const fd = new FormData();
    fd.append("lista", archivo);
    const res = await fetch(`${BASE}/proveedores/${id}/lista`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Error al subir archivo");
    return data;
  },
};

export const uploadsApi = {
  subir: async (tipo, archivo) => {
    const fd = new FormData();
    fd.append("imagen", archivo);
    const res = await fetch(`${BASE}/uploads/${tipo}`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Error al subir archivo");
    return data;
  },
};

export const marcasApi = {
  listar: () => get("/marcas"),
  crear: (data) => post("/marcas", data),
  editar: (id, data) => put(`/marcas/${id}`, data),
  eliminar: (id) => del(`/marcas/${id}`),
};

export const configuracionApi = {
  obtener: () => get("/configuracion"),
  guardar: (clave, valor) => put(`/configuracion/${clave}`, { valor }),
};

export const whatsappApi = {
  estado: () => get("/whatsapp/estado"),
  testCron: () => post("/whatsapp/test-cron", {}),
  enviar: (id, tipo) => post(`/whatsapp/enviar/${id}/${tipo}`, {}),
};

export const ventasApi = {
  listar: (params = {}) => get("/ventas?" + new URLSearchParams(params)),
  resumenHoy: () => get("/ventas/resumen-hoy"),
  resumenSemana: () => get("/ventas/resumen-semana"),
  resumenMes: () => get("/ventas/resumen-mes"),
  detalle: (id) => get(`/ventas/${id}`),
  crear: (data) => post("/ventas", data),
  anular: (id) => del(`/ventas/${id}`),
};

export const alquileresApi = {
  catalogo: () => get("/alquileres/productos-catalogo"),
  crearProducto: (data) => post("/alquileres/productos-catalogo", data),
  editarProducto: (id, data) =>
    put(`/alquileres/productos-catalogo/${id}`, data),
  eliminarProducto: (id) => del(`/alquileres/productos-catalogo/${id}`),
  listar: (p = {}) => get("/alquileres?" + new URLSearchParams(p)),
  detalle: (id) => get(`/alquileres/${id}`),
  crear: (data) => post("/alquileres", data),
  actualizar: (id, data) => put(`/alquileres/${id}`, data),
  devolver: (id) => patch(`/alquileres/${id}/devolver`, {}),
  eliminar: (id) => del(`/alquileres/${id}`),
};
