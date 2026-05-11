# 🏪 Mi Local — Sistema de gestión

App de gestión para local comercial: stock, ventas, alquileres y lector de código de barras.

---

## 🚀 Instalación

### Requisitos
- [Node.js](https://nodejs.org/) v18 o superior

---

### 1. Backend

```bash
cd backend
npm install
npm run dev
```

El servidor arranca en `http://localhost:3001`.  
La base de datos SQLite se crea automáticamente en `backend/data/local.db`.

---

### 2. Frontend

```bash
cd frontend
npm install
npm run dev -- --host
```

La app queda disponible en:
- **PC local:** `http://localhost:5173`
- **Celular (misma red Wi-Fi):** `http://<TU-IP-LAN>:5173`

Para saber tu IP local en Windows: ejecutá `ipconfig` en la terminal y buscá "Dirección IPv4".

---

## 📱 Módulos

| Módulo | URL | Descripción |
|--------|-----|-------------|
| Dashboard | `/` | Resumen del día: caja y alquileres |
| Stock | `/stock` | Inventario con todos los precios |
| Scanner | `/scanner` | Alta/baja de stock con lector de barras |
| Ventas | `/ventas` | Historial de ventas y caja |
| Nueva venta | `/ventas/nueva` | Caja con escáner integrado |
| Alquileres | `/alquileres` | Inquilinos y registro de pagos |

---

## 🔫 Lector de código de barras

El lector actúa como teclado USB: no necesita configuración especial.

- En **Scanner**: buscá, agregá stock o registrá nuevos productos
- En **Nueva venta**: el lector agrega el producto al carrito directamente
- No hace falta hacer clic en ningún campo — simplemente escaneá

---

## 💰 Campos de precio por producto

| Campo | Descripción |
|-------|-------------|
| `precio_base` | Precio neto (sin IVA) |
| `precio_iva` | Se calcula automático: base × 1.21 |
| `precio_venta` | Lo que cobrás al cliente |
| `precio_mayorista` | Precio especial por cantidad |

---

## 🗄️ Base de datos

SQLite. El archivo es `backend/data/local.db`.  
Para hacer backup simplemente copiá ese archivo.

---

## 🏗️ Stack

- **Backend:** Node.js + Express + better-sqlite3
- **Frontend:** SvelteKit + Vite + Tailwind CSS
- **DB:** SQLite

---

## 📋 API REST (referencia rápida)

```
GET    /api/productos              → listar productos
GET    /api/productos/barcode/:cod → buscar por código
POST   /api/productos              → crear
PUT    /api/productos/:id          → editar
PATCH  /api/productos/:id/stock    → ajustar stock

GET    /api/ventas                 → historial
GET    /api/ventas/resumen-hoy     → caja del día
POST   /api/ventas                 → registrar venta
DELETE /api/ventas/:id             → anular venta

GET    /api/alquileres             → listar
POST   /api/alquileres             → crear
POST   /api/alquileres/:id/pagos   → registrar pago
```
