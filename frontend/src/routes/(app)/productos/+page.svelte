<script>
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { productosApi, marcasApi, configuracionApi, variantesApi } from '$lib/api';
  import { toasts, formatPeso, refreshNotifications , showConfirm } from '$lib/stores';
  import { precioInput, parsearPrecioInput } from '$lib/precio.js';
  import Pagination from '$lib/components/Pagination.svelte';

  // ── Estado ────────────────────────────────────────
  let productos = [], marcas = [], categorias = [];
  let config = { margen_ganancia_default: '30' };
  let cargando = true;

  // Paginación
  let pagina = 1;
  let tamanoPagina = 25;
  $: paginados = productos.slice((pagina - 1) * tamanoPagina, pagina * tamanoPagina);
  function onPagChange(e) { pagina = e.detail.page; tamanoPagina = e.detail.pageSize; }

  // Filtros
  let filtros = { q: '', marca_id: '', categoria: '', bajo_stock: false };

  // Modales
  let modalProducto = null;
  let modalMarcas = false;
  let modalConfig = false;
  let guardando = false;

  // Variantes — filas expandibles inline (Map por producto_id)
  let expandidos = new Set();          // IDs de productos con filas desplegadas
  let variantesMap = {};               // { [productoId]: variante[] }
  let cargandoMap = {};                // { [productoId]: boolean }
  let modalVariante = null;
  let variantesProductoId = null;
  let guardandoVariante = false;
  let varianteVacia = () => ({
    id: null, nombre: '', sku: '', codigo_barras: '',
    precio_costo: '', margen_ganancia: '', stock_actual: 0, stock_minimo: 0, orden: 0
  });

  async function toggleVariantes(p) {
    if (expandidos.has(p.id)) {
      expandidos.delete(p.id);
      expandidos = new Set(expandidos);
      return;
    }
    expandidos.add(p.id);
    expandidos = new Set(expandidos);
    if (!variantesMap[p.id]) {
      cargandoMap = { ...cargandoMap, [p.id]: true };
      variantesMap = { ...variantesMap, [p.id]: await variantesApi.listar(p.id) };
      cargandoMap = { ...cargandoMap, [p.id]: false };
    }
  }

  // Reload variantes for a product after save/delete
  async function recargarVariantes(productoId) {
    variantesMap = { ...variantesMap, [productoId]: await variantesApi.listar(productoId) };
  }

  // Kept for the modal system
  function abrirVariantes(p) { variantesProductoId = p.id; }
  function cerrarVariantes() { variantesProductoId = null; modalVariante = null; }

  async function guardarVariante() {
    if (!modalVariante.nombre?.trim()) return;
    guardandoVariante = true;
    try {
      const data = {
        ...modalVariante,
        precio_costo:    modalVariante.precio_costo    === '' ? null : parseFloat(String(modalVariante.precio_costo).replace(',','.'))    || 0,
        margen_ganancia: modalVariante.margen_ganancia === '' ? null : parseFloat(String(modalVariante.margen_ganancia).replace(',','.')) || null,
        stock_actual:    parseInt(modalVariante.stock_actual)  || 0,
        stock_minimo:    parseInt(modalVariante.stock_minimo)  || 0,
      };
      if (data.id) {
        await variantesApi.editar(variantesProductoId, data.id, data);
        toasts.ok('Variante actualizada ✓');
      } else {
        await variantesApi.crear(variantesProductoId, data);
        toasts.ok('Variante creada ✓');
      }
      modalVariante = null;
      await recargarVariantes(variantesProductoId);
      await cargar(); // refresh cant_variantes count
      await refreshNotifications();
    } catch(e) { toasts.error(e.message); }
    finally { guardandoVariante = false; }
  }

  async function eliminarVariante(productoId, v) {
    const ok = await showConfirm({ title: 'Eliminar variante', message: `¿Eliminar la variante "${v.nombre}"? Esta acción no se puede deshacer.`, confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', danger: true, icon: '🗑️' }); if (!ok) return;
    await variantesApi.eliminar(productoId, v.id);
    await recargarVariantes(productoId);
    await cargar();
    toasts.ok('Variante eliminada');
  }

  // ── Producto (resto del estado original) ──────────
  let nuevaMarca = '';
  let editandoMarca = null;
  let guardandoMarca = false;
  let margenEditable = '30';

  // ── Categoría inline create ───────────────────────
  let nuevaCategoria = '';
  let agregandoCategoria = false;
  function confirmarNuevaCategoria() {
    const cat = nuevaCategoria.trim();
    if (!cat) { agregandoCategoria = false; return; }
    if (!categorias.includes(cat)) categorias = [...categorias, cat];
    modalProducto.categoria = cat;
    nuevaCategoria = '';
    agregandoCategoria = false;
  }

  onMount(cargar);

  async function cargar() {
    cargando = true;
    try {
      const params = { ...filtros, bajo_stock: filtros.bajo_stock ? '1' : '' };
      if (!params.marca_id) delete params.marca_id;
      if (!params.categoria) delete params.categoria;
      if (!params.q) delete params.q;
      [productos, marcas, categorias, config] = await Promise.all([
        productosApi.listar(params),
        marcasApi.listar(),
        productosApi.categorias(),
        configuracionApi.obtener(),
      ]);
      margenEditable = config.margen_ganancia_default ?? '30';
    } catch { /* no autenticado o backend caído — onMount redirige */ }
    finally { cargando = false; }
  }

  let timer;
  function onFiltro() { clearTimeout(timer); timer = setTimeout(() => { pagina = 1; cargar(); }, 280); }
  $: if (browser) (filtros.marca_id, filtros.categoria, filtros.bajo_stock, (pagina = 1, cargar()));

  // ── Cálculo de precios en tiempo real ─────────────
  function calcularPrecios(costo, margen) {
    const c = parseFloat(costo) || 0;
    const m = parseFloat(margen) || 0;
    const conIva = Math.round(c * 1.21 * 100) / 100;
    const venta  = Math.round(conIva * (1 + m / 100) * 100) / 100;
    return { conIva, venta };
  }

  $: previewPrecios = modalProducto
    ? calcularPrecios(
        modalProducto.precio_costo,
        modalProducto.margen_ganancia ?? config.margen_ganancia_default
      )
    : { conIva: 0, venta: 0 };

  // ── CRUD Producto ─────────────────────────────────
  const prodVacio = () => ({
    id: null,
    nombre: '', descripcion: '', sku: '', codigo_barras: '',
    marca_id: '', categoria: 'General',
    tiene_variantes: false,
    precio_costo: 0, margen_ganancia: null,
    stock_actual: 0, stock_minimo: 0,
  });

  async function guardarProducto() {
    if (!modalProducto.nombre?.trim()) return;
    guardando = true;
    try {
      const data = {
        ...modalProducto,
        marca_id:         modalProducto.marca_id  || null,
        tiene_variantes:  modalProducto.tiene_variantes ? 1 : 0,
        precio_costo:     parseFloat(modalProducto.precio_costo)     || 0,
        margen_ganancia:  modalProducto.margen_ganancia === '' || modalProducto.margen_ganancia === null
                            ? null
                            : parseFloat(modalProducto.margen_ganancia),
        stock_actual:     modalProducto.tiene_variantes ? 0 : (parseInt(modalProducto.stock_actual)  || 0),
        stock_minimo:     modalProducto.tiene_variantes ? 0 : (parseInt(modalProducto.stock_minimo)  || 0),
      };
      if (data.id) {
        await productosApi.actualizar(data.id, data);
        toasts.ok('Producto actualizado ✓');
      } else {
        await productosApi.crear(data);
        toasts.ok('Producto creado ✓');
      }
      await refreshNotifications();
      modalProducto = null;
      cargar();
    } catch(e) { toasts.error(e.message); }
    finally { guardando = false; }
  }

  async function eliminarProducto(p) {
    const ok = await showConfirm({ title: 'Eliminar producto', message: `¿Eliminar "${p.nombre}"?`, confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', danger: true, icon: '🗑️' }); if (!ok) return;
    await productosApi.eliminar(p.id);
    toasts.ok('Producto eliminado');
    cargar();
  }

  // ── CRUD Marcas ───────────────────────────────────
  async function crearMarca() {
    if (!nuevaMarca.trim()) return;
    guardandoMarca = true;
    try {
      await marcasApi.crear({ nombre: nuevaMarca.trim() });
      nuevaMarca = '';
      marcas = await marcasApi.listar();
    } catch(e) { notif.agregar(e.message, 'error'); }
    finally { guardandoMarca = false; }
  }

  async function guardarMarca() {
    if (!editandoMarca?.nombre?.trim()) return;
    guardandoMarca = true;
    try {
      await marcasApi.editar(editandoMarca.id, { nombre: editandoMarca.nombre });
      editandoMarca = null;
      marcas = await marcasApi.listar();
    } catch(e) { notif.agregar(e.message, 'error'); }
    finally { guardandoMarca = false; }
  }

  async function eliminarMarca(m) {
    try {
      await marcasApi.eliminar(m.id);
      marcas = await marcasApi.listar();
    } catch(e) { notif.agregar(e.message, 'error'); }
  }

  // ── Configuración (margen global) ─────────────────
  async function guardarConfig() {
    guardando = true;
    try {
      await configuracionApi.guardar('margen_ganancia_default', margenEditable);
      // Recalcular todos los productos sin margen propio
      const { actualizados } = await productosApi.recalcularTodos();
      notif.agregar(`Margen global actualizado. ${actualizados} producto(s) recalculado(s) ✓`, 'ok');
      modalConfig = false;
      cargar();
    } catch(e) { notif.agregar(e.message, 'error'); }
    finally { guardando = false; }
  }

  $: previewConfig = calcularPrecios(1000, parseFloat(margenEditable) || 0);
</script>

<div style="display:flex;flex-direction:column;height:100%">

  <!-- ── Header ── -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem">
    <div>
      <h1 class="page-title">Productos</h1>
      <p class="page-sub">{productos.length} resultado{productos.length !== 1 ? 's' : ''}</p>
    </div>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
      <button class="btn btn-ghost" on:click={() => modalConfig = true}>⚙ Configuración</button>
      <button class="btn btn-ghost" on:click={() => { modalMarcas = true; }}>🏷 Marcas</button>
      <button class="btn btn-primary" on:click={() => modalProducto = prodVacio()}>+ Nuevo producto</button>
    </div>
  </div>

  <!-- ── Filtros ── -->
  <div class="card filtros-bar">
    <input
      class="input"
      placeholder="Buscar por nombre, SKU o código de barras..."
      bind:value={filtros.q}
      on:input={onFiltro}
      style="flex:1;min-width:200px"
    />

    <select class="input" bind:value={filtros.marca_id} style="width:170px">
      <option value="">Todas las marcas</option>
      {#each marcas as m}<option value={m.id}>{m.nombre}</option>{/each}
    </select>

    <select class="input" bind:value={filtros.categoria} style="width:160px">
      <option value="">Todas las categorías</option>
      {#each categorias as c}<option value={c}>{c}</option>{/each}
    </select>

    <label class="check-lbl">
      <input type="checkbox" bind:checked={filtros.bajo_stock} />
      Solo stock bajo
    </label>
  </div>

  <!-- ── Info margen global ── -->
  <div class="margen-banner">
    <span>Margen de ganancia global: <strong>{config.margen_ganancia_default}%</strong></span>
    <span class="text-muted2" style="font-size:12px">Los productos sin margen propio usan este valor</span>
    <button class="btn btn-ghost btn-sm" on:click={() => modalConfig = true}>Cambiar</button>
  </div>

  <!-- ── Tabla ── -->
  <div class="card tabla-card">
    {#if cargando}
      <p style="padding:2rem;color:var(--text2)">Cargando...</p>
    {:else if productos.length === 0}
      <div style="text-align:center;padding:3rem;color:var(--text2)">
        <p style="font-size:1.5rem;margin-bottom:0.5rem">📦</p>
        <p style="font-weight:700">No hay productos</p>
        <p style="font-size:13px;margin-top:0.25rem">Creá el primero con el botón "+ Nuevo producto"</p>
      </div>
    {:else}
      <div class="tabla-scroll">
        <table style="table-layout:auto;width:100%;min-width:700px">
          <thead>
            <tr>
              <th style="width:20px"></th>
              <th>Nombre</th>
              <th style="width:80px">Marca</th>
              <th style="width:82px;text-align:right">Costo</th>
              <th style="width:82px;text-align:right">+IVA</th>
              <th style="width:86px;text-align:right">Venta</th>
              <th style="width:75px;text-align:right">Margen</th>
              <th style="width:78px;text-align:center">Stock</th>
              <th style="width:90px"></th>
            </tr>
          </thead>
          <tbody>
            {#each paginados as p}
              {@const tieneVariantes = !!p.tiene_variantes}
              {@const estaExpandido = expandidos.has(p.id)}

              <!-- Fila del producto padre -->
              <tr
                class="fila-padre"
                class:expandida={estaExpandido}
                on:click={() => tieneVariantes ? toggleVariantes(p) : (modalProducto = { ...p, marca_id: p.marca_id ?? '', tiene_variantes: false })}
                style="cursor:pointer"
              >
                <!-- Chevron -->
                <td class="td-chevron">
                  {#if tieneVariantes}
                    <svg class="chevron" class:abierto={estaExpandido}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                      width="14" height="14">
                      <path d="M9 18l6-6-6-6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  {/if}
                </td>
                <td>
                  <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{p.nombre}</div>
                  <div style="display:flex;gap:0.3rem;align-items:center;margin-top:1px;flex-wrap:nowrap;overflow:hidden">
                    <span class="badge badge-gray" style="font-size:10px;padding:1px 5px;flex-shrink:0">{p.categoria}</span>
                    {#if p.codigo_barras}<span class="mono text-muted2" style="font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{p.codigo_barras}</span>{/if}
                  </div>
                </td>
                <td>
                  {#if p.marca_nombre}
                    <span class="badge badge-blue" style="font-size:11px">{p.marca_nombre}</span>
                  {:else}
                    <span class="text-muted2">—</span>
                  {/if}
                </td>
                <td class="mono" style="text-align:right;font-size:12.5px">{formatPeso(p.precio_costo)}</td>
                <td class="mono text-muted" style="text-align:right;font-size:12.5px">{formatPeso(p.precio_con_iva)}</td>
                <td class="mono" style="text-align:right;font-weight:700;color:var(--green);font-size:13.5px">{formatPeso(p.precio_venta)}</td>
                <td style="text-align:right">
                  {#if p.margen_ganancia !== null && p.margen_ganancia !== undefined}
                    <span class="badge badge-primary" style="font-size:10.5px">{p.margen_ganancia}%</span>
                  {:else}
                    <span class="badge badge-gray" style="font-size:10px">{config.margen_ganancia_default}%<br/><span style="font-size:9px;opacity:0.7">global</span></span>
                  {/if}
                </td>
                <td style="text-align:center">
                  {#if p.tiene_variantes}
                    <!-- Stock total de variantes -->
                    {@const stockTotal = (variantesMap[p.id] ?? []).reduce((s, v) => s + v.stock_actual, 0)}
                    {@const hayStockBajo = (variantesMap[p.id] ?? []).some(v => v.stock_actual <= v.stock_minimo && v.stock_minimo > 0)}
                    {#if estaExpandido}
                      <span class="badge {hayStockBajo ? 'badge-red' : 'badge-green'}">
                        {stockTotal} total
                      </span>
                    {:else}
                      <span class="badge badge-gray" style="color:var(--text3);font-size:11px">ver variantes</span>
                    {/if}
                  {:else}
                    <span class="badge {p.stock_actual <= p.stock_minimo && p.stock_minimo > 0 ? 'badge-red' : 'badge-green'}">
                      {p.stock_actual} {p.unidad}
                    </span>
                  {/if}
                </td>
                <td on:click|stopPropagation style="padding:0.4rem 0.5rem;white-space:nowrap">
                  <div style="display:flex;gap:0.2rem;justify-content:flex-end;align-items:center">
                    <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:0.22rem 0.5rem"
                      on:click={() => modalProducto = { ...p, marca_id: p.marca_id ?? '', tiene_variantes: !!p.tiene_variantes }}>
                      Editar
                    </button>
                    <button class="btn btn-danger btn-sm" style="font-size:11px;padding:0.22rem 0.4rem"
                      on:click={() => eliminarProducto(p)}>✕</button>
                  </div>
                </td>
              </tr>

              <!-- Filas de variantes (inline, expandibles) -->
              {#if estaExpandido}
                {#if cargandoMap[p.id]}
                  <tr class="fila-variante">
                    <td colspan="9" style="text-align:center;padding:1rem;color:var(--text2);font-size:13px">
                      Cargando variantes...
                    </td>
                  </tr>
                {:else if (variantesMap[p.id] ?? []).length === 0}
                  <tr class="fila-variante">
                    <td colspan="9">
                      <div class="variante-vacia">
                        <span>Sin variantes aún.</span>
                        <button class="btn btn-primary btn-sm" on:click={() => { variantesProductoId = p.id; modalVariante = varianteVacia(); }}>
                          + Agregar primera variante
                        </button>
                      </div>
                    </td>
                  </tr>
                {:else}
                  <!-- Header variantes — alineado exacto con columnas del padre -->
                  <tr class="fila-variante-header">
                    <td></td><!-- chevron -->
                    <td style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.09em;color:var(--text3);padding:0.4rem 0.65rem 0.4rem 1.75rem">↳ Variante</td><!-- nombre -->
                    <td style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.09em;color:var(--text3);padding:0.4rem 0.65rem">Marca</td><!-- marca -->
                    <td style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.09em;color:var(--text3);text-align:right;padding:0.4rem 0.65rem">Costo</td><!-- costo -->
                    <td style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.09em;color:var(--text3);text-align:right;padding:0.4rem 0.65rem">+IVA</td><!-- +iva -->
                    <td style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.09em;color:var(--text3);text-align:right;padding:0.4rem 0.65rem">Venta</td><!-- venta -->
                    <td style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.09em;color:var(--text3);text-align:right;padding:0.4rem 0.65rem">Margen</td><!-- margen -->
                    <td style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.09em;color:var(--text3);text-align:center;padding:0.4rem 0.65rem">Stock</td><!-- stock -->
                    <td style="text-align:right;padding:0.4rem 0.5rem"><!-- acciones -->
                      <button class="btn btn-primary btn-sm" style="font-size:11px;padding:0.22rem 0.5rem"
                        on:click={() => { variantesProductoId = p.id; modalVariante = varianteVacia(); }}>
                        + Agregar
                      </button>
                    </td>
                  </tr>
                  {#each variantesMap[p.id] as v}
                    <tr class="fila-variante">
                      <td></td><!-- chevron col -->
                      <td style="padding-left:1.75rem"><!-- nombre col -->
                        <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap">
                          <span class="badge badge-primary" style="font-size:11.5px">{v.nombre}</span>
                          {#if v.codigo_barras}<span class="mono text-muted2" style="font-size:10.5px">{v.codigo_barras}</span>{/if}
                        </div>
                      </td>
                      <td></td><!-- marca col (vacío) -->
                      <td class="mono" style="text-align:right;font-size:12.5px;color:var(--text2)"><!-- costo -->
                        {v.precio_costo !== null && v.precio_costo !== undefined ? formatPeso(v.precio_costo) : '—'}
                      </td>
                      <td class="mono" style="text-align:right;font-size:12.5px;color:var(--text3)">{formatPeso(v.precio_con_iva)}</td><!-- +iva -->
                      <td class="mono" style="text-align:right;font-weight:700;color:var(--green);font-size:13px">{formatPeso(v.precio_venta)}</td><!-- venta -->
                      <td style="text-align:right"><!-- margen -->
                        {#if v.margen_ganancia !== null && v.margen_ganancia !== undefined}
                          <span class="badge badge-primary" style="font-size:10.5px">{v.margen_ganancia}%</span>
                        {:else}
                          <span class="text-muted2" style="font-size:10.5px">—</span>
                        {/if}
                      </td>
                      <td style="text-align:center"><!-- stock -->
                        <span class="badge {v.stock_actual <= v.stock_minimo && v.stock_minimo > 0 ? 'badge-red' : 'badge-green'}" style="font-size:11px">
                          {v.stock_actual}
                        </span>
                      </td>
                      <td style="padding:0.4rem 0.5rem"><!-- acciones -->
                        <div style="display:flex;gap:0.2rem;justify-content:flex-end">
                          <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:0.22rem 0.5rem"
                            on:click={() => { variantesProductoId = p.id; modalVariante = { ...v, precio_costo: v.precio_costo ?? '', margen_ganancia: v.margen_ganancia ?? '' }; }}>
                            Editar
                          </button>
                          <button class="btn btn-danger btn-sm" style="font-size:11px;padding:0.22rem 0.4rem"
                            on:click={() => eliminarVariante(p.id, v)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                {/if}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      <Pagination total={productos.length} page={pagina} pageSize={tamanoPagina} on:change={onPagChange} />
    {/if}
  </div>
</div>

<!-- ════════════════════════════════════════════════ -->
<!-- MODAL: Crear / Editar Producto                  -->
<!-- ════════════════════════════════════════════════ -->
{#if modalProducto}
  <div class="overlay" on:click|self={() => modalProducto = null}>
    <div class="modal" style="max-width:680px">
      <h2 class="modal-title">
        {modalProducto.id ? `Editar: ${modalProducto.nombre}` : 'Nuevo producto'}
      </h2>

      <!-- SECCIÓN: Identificación -->
      <p class="modal-section">IDENTIFICACIÓN</p>
      <div class="form-grid">
        <div class="field field-full">
          <label>Nombre *</label>
          <input class="input" bind:value={modalProducto.nombre} placeholder="Nombre del producto" />
        </div>
        <div class="field field-full">
          <label>Descripción</label>
          <input class="input" bind:value={modalProducto.descripcion} placeholder="Descripción opcional" />
        </div>
        <div class="field">
          <label>Marca</label>
          <div style="display:flex;gap:0.4rem">
            <select class="input" bind:value={modalProducto.marca_id}>
              <option value="">Sin marca</option>
              {#each marcas as m}<option value={m.id}>{m.nombre}</option>{/each}
            </select>
            <button class="btn btn-ghost btn-sm" style="white-space:nowrap" on:click={() => { modalMarcas = true; }}>+ Marca</button>
          </div>
        </div>
        <div class="field">
          <label>Categoría</label>
          {#if agregandoCategoria}
            <div style="display:flex;gap:0.4rem">
              <input class="input" bind:value={nuevaCategoria} placeholder="Nueva categoría..." autofocus
                on:keydown={e => { if (e.key === 'Enter') confirmarNuevaCategoria(); if (e.key === 'Escape') { agregandoCategoria = false; nuevaCategoria = ''; } }} />
              <button class="btn btn-primary btn-sm" style="white-space:nowrap" on:click={confirmarNuevaCategoria}>OK</button>
              <button class="btn btn-ghost btn-sm" on:click={() => { agregandoCategoria = false; nuevaCategoria = ''; }}>✕</button>
            </div>
          {:else}
            <div style="display:flex;gap:0.4rem">
              <select class="input" bind:value={modalProducto.categoria}>
                {#each categorias as c}<option value={c}>{c}</option>{/each}
              </select>
              <button class="btn btn-ghost btn-sm" style="white-space:nowrap" on:click={() => agregandoCategoria = true}>+ Cat.</button>
            </div>
          {/if}
        </div>
        <div class="field">
          <label>SKU</label>
          <input class="input mono" bind:value={modalProducto.sku} placeholder="ABC-001" />
        </div>
        <div class="field">
          <label>Código de barras</label>
          <input class="input mono" bind:value={modalProducto.codigo_barras} />
        </div>
      </div>

      <div class="divider"></div>

      <!-- SECCIÓN: Tipo de producto -->
      <label class="variantes-check-row">
        <input type="checkbox" bind:checked={modalProducto.tiene_variantes} />
        <div>
          <span style="font-weight:700;font-size:14px">Producto con variantes</span>
          <span class="text-muted2" style="font-size:12.5px;display:block;margin-top:1px">
            Tiene talles, colores u otras variaciones. Cada variante tiene su propio precio y stock.
          </span>
        </div>
      </label>

      {#if !modalProducto.tiene_variantes}
        <div class="divider"></div>

        <!-- SECCIÓN: Precios (solo si NO tiene variantes) -->
        <p class="modal-section">PRECIOS</p>
        <div class="form-grid" style="margin-bottom:1rem">
          <div class="field">
            <label>Precio de costo $</label>
            <input
              class="input mono" type="text" inputmode="decimal" placeholder="$ 0"
              use:precioInput
              value={modalProducto.precio_costo === 0 ? '' : modalProducto.precio_costo}
              on:input={e => { modalProducto.precio_costo = parsearPrecioInput(e.target.value); }}
            />
          </div>
          <div class="field">
            <label>
              Margen de ganancia %
              <span class="text-muted2" style="font-size:10px;font-weight:400;text-transform:none">
                (vacío = global {config.margen_ganancia_default}%)
              </span>
            </label>
            <input
              class="input mono" type="text" inputmode="decimal"
              placeholder="Global ({config.margen_ganancia_default}%)"
              value={modalProducto.margen_ganancia ?? ''}
              on:input={e => { const v=e.target.value.replace(',','.'); modalProducto.margen_ganancia = v==='' ? null : (parseFloat(v)||0); }}
            />
          </div>
        </div>

        <!-- Preview precios -->
        <div class="precios-preview">
          <div class="precio-prev-item">
            <div class="precio-prev-label">Costo</div>
            <div class="precio-prev-value mono">{formatPeso(modalProducto.precio_costo || 0)}</div>
            <div class="precio-prev-formula text-muted2">ingresado</div>
          </div>
          <div class="precio-prev-arrow">→</div>
          <div class="precio-prev-item">
            <div class="precio-prev-label">Costo + IVA</div>
            <div class="precio-prev-value mono">{formatPeso(previewPrecios.conIva)}</div>
            <div class="precio-prev-formula text-muted2">× 1.21</div>
          </div>
          <div class="precio-prev-arrow">→</div>
          <div class="precio-prev-item highlight">
            <div class="precio-prev-label">Precio de venta</div>
            <div class="precio-prev-value mono text-green">{formatPeso(previewPrecios.venta)}</div>
            <div class="precio-prev-formula text-muted2">
              + {modalProducto.margen_ganancia ?? config.margen_ganancia_default}% ganancia
            </div>
          </div>
        </div>

        <div class="divider"></div>

        <!-- SECCIÓN: Stock -->
        <p class="modal-section">STOCK</p>
        <div class="form-grid">
          <div class="field">
            <label>Stock actual</label>
            <input
              class="input" type="text" inputmode="numeric" placeholder="0"
              value={modalProducto.stock_actual === 0 ? '' : modalProducto.stock_actual}
              on:input={e => { modalProducto.stock_actual = parseInt(e.target.value) || 0; }}
            />
          </div>
          <div class="field">
            <label>Stock mínimo (alerta)</label>
            <input
              class="input" type="text" inputmode="numeric" placeholder="0"
              value={modalProducto.stock_minimo === 0 ? '' : modalProducto.stock_minimo}
              on:input={e => { modalProducto.stock_minimo = parseInt(e.target.value) || 0; }}
            />
          </div>
        </div>
      {:else}
        <div class="variantes-stock-info" style="margin-top:1rem">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Los precios y stock se definen en cada variante. Podés agregarlas después de crear el producto.
        </div>
      {/if}

      <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.5rem">
        <button class="btn btn-ghost" on:click={() => modalProducto = null}>Cancelar</button>
        <button
          class="btn btn-primary"
          on:click={guardarProducto}
          disabled={guardando || !modalProducto.nombre?.trim()}
        >
          {guardando ? 'Guardando...' : modalProducto.id ? 'Guardar cambios' : 'Crear producto'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ════════════════════════════════════════════════ -->
<!-- MODAL: Gestión de Marcas                        -->
<!-- ════════════════════════════════════════════════ -->
{#if modalMarcas}
  <div class="overlay" on:click|self={() => modalMarcas = false}>
    <div class="modal" style="max-width:440px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem">
        <h2 class="modal-title" style="margin-bottom:0">Gestión de marcas</h2>
        <button class="btn btn-ghost btn-sm" on:click={() => modalMarcas = false}>✕</button>
      </div>

      <!-- Crear nueva marca -->
      <div style="display:flex;gap:0.5rem;margin-bottom:1.25rem">
        <input
          class="input"
          placeholder="Nombre de la nueva marca..."
          bind:value={nuevaMarca}
          on:keydown={e => e.key === 'Enter' && crearMarca()}
        />
        <button class="btn btn-primary" on:click={crearMarca} disabled={guardandoMarca || !nuevaMarca.trim()}>
          + Agregar
        </button>
      </div>

      <div class="divider"></div>

      <!-- Lista de marcas -->
      {#if marcas.length === 0}
        <p class="text-muted2" style="text-align:center;padding:1.5rem 0;font-size:13px">
          No hay marcas creadas aún
        </p>
      {:else}
        <div style="display:flex;flex-direction:column;gap:0.4rem;max-height:360px;overflow-y:auto">
          {#each marcas as m}
            <div class="marca-row">
              {#if editandoMarca?.id === m.id}
                <input
                  class="input"
                  bind:value={editandoMarca.nombre}
                  on:keydown={e => e.key === 'Enter' && guardarMarca()}
                  style="flex:1"
                  autofocus
                />
                <button class="btn btn-success btn-sm" on:click={guardarMarca} disabled={guardandoMarca}>✓</button>
                <button class="btn btn-ghost btn-sm" on:click={() => editandoMarca = null}>✕</button>
              {:else}
                <span style="flex:1;font-weight:600;font-size:14px">{m.nombre}</span>
                <button class="btn btn-ghost btn-sm" on:click={() => editandoMarca = { id: m.id, nombre: m.nombre }}>
                  Editar
                </button>
                <button class="btn btn-danger btn-sm" on:click={() => eliminarMarca(m)}>
                  Eliminar
                </button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- ════════════════════════════════════════════════ -->
<!-- MODAL: Configuración global                     -->
<!-- ════════════════════════════════════════════════ -->
{#if modalConfig}
  <div class="overlay" on:click|self={() => modalConfig = false}>
    <div class="modal" style="max-width:420px">
      <h2 class="modal-title">Configuración de precios</h2>

      <div class="field" style="margin-bottom:1.25rem">
        <label>Margen de ganancia global (%)</label>
        <input class="input mono" type="number" min="0" step="0.5" bind:value={margenEditable} />
        <p style="font-size:12px;color:var(--text2);margin-top:0.4rem">
          Aplica automáticamente a todos los productos que no tengan margen propio definido.
          Al guardar, se recalculan los precios de esos productos.
        </p>
      </div>

      <!-- Preview con el margen nuevo -->
      <div class="precios-preview" style="margin-bottom:1.5rem">
        <div class="precio-prev-item">
          <div class="precio-prev-label">Costo ejemplo</div>
          <div class="precio-prev-value mono">{formatPeso(1000)}</div>
        </div>
        <div class="precio-prev-arrow">→</div>
        <div class="precio-prev-item">
          <div class="precio-prev-label">+ IVA</div>
          <div class="precio-prev-value mono">{formatPeso(previewConfig.conIva)}</div>
        </div>
        <div class="precio-prev-arrow">→</div>
        <div class="precio-prev-item highlight">
          <div class="precio-prev-label">Precio venta</div>
          <div class="precio-prev-value mono text-green">{formatPeso(previewConfig.venta)}</div>
        </div>
      </div>

      <div style="display:flex;gap:0.6rem;justify-content:flex-end">
        <button class="btn btn-ghost" on:click={() => modalConfig = false}>Cancelar</button>
        <button class="btn btn-primary" on:click={guardarConfig} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar y recalcular'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal crear/editar variante -->
{#if modalVariante}
  <div class="overlay" style="z-index:350" on:click|self={() => modalVariante = null}>
    <div class="modal" style="max-width:480px">
      <h2 class="modal-title">{modalVariante.id ? 'Editar variante' : 'Nueva variante'}</h2>

      <div class="form-grid">
        <div class="field field-full">
          <label>Talle / Nombre *</label>
          <input class="input" bind:value={modalVariante.nombre} placeholder="Ej: S, M, L, XL / 34/35 / 36/37..." />
        </div>
        <div class="field">
          <label>Código de barras</label>
          <input class="input mono" bind:value={modalVariante.codigo_barras} placeholder="Opcional" />
        </div>
        <div class="field">
          <label>SKU</label>
          <input class="input mono" bind:value={modalVariante.sku} placeholder="Opcional" />
        </div>
      </div>

      <div class="divider"></div>
      <p class="modal-section">PRECIOS (vacío = hereda del producto padre)</p>

      <div class="form-grid" style="margin-bottom:1rem">
        <div class="field">
          <label>Precio costo propio $</label>
          <input class="input mono" type="text" inputmode="decimal"
            placeholder="Hereda del padre"
            bind:value={modalVariante.precio_costo} />
        </div>
        <div class="field">
          <label>Margen ganancia % propio</label>
          <input class="input mono" type="text" inputmode="decimal"
            placeholder="Hereda"
            bind:value={modalVariante.margen_ganancia} />
        </div>
      </div>

      <div class="divider"></div>
      <p class="modal-section">STOCK</p>
      <div class="form-grid">
        <div class="field">
          <label>Stock actual</label>
          <input class="input" type="text" inputmode="numeric"
            value={modalVariante.stock_actual}
            on:input={e => modalVariante.stock_actual = parseInt(e.target.value) || 0} />
        </div>
        <div class="field">
          <label>Stock mínimo</label>
          <input class="input" type="text" inputmode="numeric"
            value={modalVariante.stock_minimo}
            on:input={e => modalVariante.stock_minimo = parseInt(e.target.value) || 0} />
        </div>
      </div>

      <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.25rem">
        <button class="btn btn-ghost" on:click={() => modalVariante = null}>Cancelar</button>
        <button class="btn btn-primary" on:click={guardarVariante} disabled={guardandoVariante || !modalVariante.nombre?.trim()}>
          {guardandoVariante ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Filtros */
  .filtros-bar {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 0.6rem;
  }
  .check-lbl {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 13px; color: var(--text2); cursor: pointer;
    white-space: nowrap; font-weight: 600;
  }

  /* Banner margen */
  .margen-banner {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.55rem 0.9rem;
    background: var(--primary-bg);
    border: 1px solid var(--primary-bd);
    border-radius: calc(var(--radius) - 2px);
    font-size: 13px;
    font-weight: 600;
    color: var(--primary);
    margin-bottom: 0.75rem;
  }

  /* Tabla */
  .tabla-card { padding: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
  .tabla-scroll { flex: 1; overflow-y: auto; overflow-x: auto; }

  /* Override global td padding for compact table */
  .tabla-card :global(thead th) {
    padding: 0.5rem 0.65rem;
    font-size: 10px;
  }
  .tabla-card :global(tbody td) {
    padding: 0.6rem 0.65rem;
  }

  /* Icon action buttons */
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 2px;
    width: 28px; height: 28px; border-radius: 6px;
    border: none; cursor: pointer;
    transition: all 0.12s; flex-shrink: 0;
  }
  .icon-btn-ghost  { background: var(--bg3); color: var(--text2); }
  .icon-btn-ghost:hover  { background: var(--primary-bg); color: var(--primary); }
  .icon-btn-primary { background: var(--primary-bg); color: var(--primary); border: 1px solid var(--primary-bd); }
  .icon-btn-primary:hover { background: var(--primary); color: white; }
  .icon-btn-danger { background: var(--red-lt); color: var(--red); }
  .icon-btn-danger:hover { background: var(--red); color: white; }

  /* Preview precios en modal */
  .precios-preview {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    align-items: center;
    gap: 0.6rem;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem 1.25rem;
  }
  .precio-prev-item {
    display: flex; flex-direction: column; gap: 0.2rem;
    text-align: center; padding: 0.6rem;
    border-radius: var(--radius-sm);
    background: var(--bg2);
    border: 1px solid var(--border);
  }
  .precio-prev-item.highlight {
    background: var(--green-lt);
    border-color: var(--green-bd);
  }
  .precio-prev-label {
    font-size: 10.5px; font-weight: 800;
    text-transform: uppercase; letter-spacing: 0.07em;
    color: var(--text3);
  }
  .precio-prev-value { font-size: 1rem; font-weight: 800; }
  .precio-prev-formula { font-size: 10.5px; }
  .precio-prev-arrow { font-size: 1rem; color: var(--text3); font-weight: 700; }

  /* Marcas */
  .marca-row {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  /* Variantes check row */
  .variantes-check-row {
    display: flex; align-items: flex-start; gap: 0.75rem;
    padding: 0.85rem 1rem;
    background: var(--primary-bg);
    border: 1.5px solid var(--primary-bd);
    border-radius: calc(var(--radius) - 2px);
    cursor: pointer;
    margin-bottom: 0;
  }
  .variantes-check-row input[type="checkbox"] {
    width: 16px; height: 16px; cursor: pointer; flex-shrink: 0; margin-top: 2px;
    accent-color: var(--primary);
  }
  .variantes-stock-info {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.75rem 1rem;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    font-size: 13px; color: var(--text2);
  }

  /* ── Filas expandibles de variantes ── */
  .fila-padre { transition: background 0.12s; }
  .fila-padre:hover td { background: var(--primary-bg) !important; }
  .fila-padre.expandida td { background: var(--primary-bg); }

  .td-chevron { width: 28px; padding-right: 0 !important; text-align: center; }
  .chevron { transition: transform 0.18s ease; color: var(--text3); display: block; margin: auto; }
  .chevron.abierto { transform: rotate(90deg); color: var(--primary); }

  .fila-variante-header td {
    background: var(--primary-bg) !important;
    border-bottom: 1px solid var(--primary-bd) !important;
  }

  .fila-variante td {
    background: color-mix(in srgb, var(--primary-bg) 60%, var(--bg2)) !important;
    border-bottom: 1px solid var(--bg3) !important;
    font-size: 13px;
  }
  .fila-variante:last-child td { border-bottom: 2px solid var(--primary-bd) !important; }
  .fila-variante:hover td { background: var(--primary-bg) !important; }

  .variante-vacia {
    display: flex; align-items: center; justify-content: center; gap: 1rem;
    padding: 1.25rem 1rem;
    background: var(--primary-bg);
    border: 1px solid var(--primary-bd);
    font-size: 13.5px; color: var(--text2); font-weight: 500;
  }
</style>
