<script>
  import { onMount } from 'svelte';
  import { productosApi } from '$lib/api';
  import { toasts, notif, formatPeso, refreshNotifications , showConfirm } from '$lib/stores';
  import Pagination from '$lib/components/Pagination.svelte';

  let productos = [], categorias = [], cargando = true;

  // Paginación
  let paginaStock = 1, tamanoPaginaStock = 25;
  $: paginadosStock = productos.slice((paginaStock - 1) * tamanoPaginaStock, paginaStock * tamanoPaginaStock);
  function onPagStock(e) { paginaStock = e.detail.page; tamanoPaginaStock = e.detail.pageSize; }
  let busqueda = '', categoriaFiltro = '', soloStockBajo = false;
  let modal = null, guardando = false;

  onMount(cargar);

  async function cargar() {
    cargando = true;
    try {
      [productos, categorias] = await Promise.all([
        productosApi.listar({ q: busqueda, categoria: categoriaFiltro, bajo_stock: soloStockBajo ? '1' : '' }),
        productosApi.categorias()
      ]);
    } catch { /* no autenticado */ }
    finally { cargando = false; }
  }

  let timer;
  function onBuscar() { clearTimeout(timer); timer = setTimeout(cargar, 280); }
  $: categoriaFiltro, soloStockBajo, cargar();

  const prodVacio = () => ({
    id:null, nombre:'', codigo_barras:'', categoria:'General', unidad:'unidad',
    descripcion:'', precio_base:0, precio_venta:0, precio_mayorista:0,
    stock_actual:0, stock_minimo:0
  });

  async function guardar() {
    if (!modal.nombre) return;
    guardando = true;
    try {
      modal.id ? await productosApi.actualizar(modal.id, modal) : await productosApi.crear(modal);
      notif.agregar(modal.id ? 'Producto actualizado ✓' : 'Producto creado ✓', 'ok');
      modal = null; cargar();
    } catch(e) { toasts.error(e.message); }
    finally { guardando = false; }
  }

  async function eliminar(p) {
    const ok = await showConfirm({ title: 'Eliminar producto', message: `¿Eliminar "${p.nombre}"?`, confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', danger: true, icon: '🗑️' }); if (!ok) return;
    await productosApi.eliminar(p.id);
    toasts.ok('Eliminado'); cargar();
  }
</script>

<div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.75rem">
    <div>
      <h1 class="page-title">Stock</h1>
      <p class="page-sub">{productos.length} productos</p>
    </div>
    <button class="btn btn-primary" on:click={() => modal = prodVacio()}>+ Nuevo producto</button>
  </div>

  <!-- Filtros -->
  <div class="card" style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">
    <input class="input" placeholder="Buscar..." bind:value={busqueda} on:input={onBuscar} style="max-width:260px" />
    <select class="input" bind:value={categoriaFiltro} style="width:180px">
      <option value="">Todas las categorías</option>
      {#each categorias as c}<option value={c}>{c}</option>{/each}
    </select>
    <label style="display:flex;align-items:center;gap:0.4rem;font-size:13px;color:var(--text2);cursor:pointer">
      <input type="checkbox" bind:checked={soloStockBajo} /> Solo stock bajo
    </label>
  </div>

  <!-- Tabla -->
  <div class="card" style="padding:0;display:flex;flex-direction:column;overflow:hidden">
    {#if cargando}
      <p style="padding:2rem;color:var(--text2)">Cargando...</p>
    {:else if productos.length === 0}
      <p style="padding:2rem;color:var(--text2)">No hay productos.</p>
    {:else}
      <div style="flex:1;overflow-y:auto;overflow-x:auto">
        <table>
          <thead><tr>
            <th>Código</th><th>Nombre</th><th>Categoría</th>
            <th style="text-align:right">Precio base</th>
            <th style="text-align:right">+ IVA (21%)</th>
            <th style="text-align:right">Precio venta</th>
            <th style="text-align:right">Mayorista</th>
            <th style="text-align:center">Stock</th>
            <th></th>
          </tr></thead>
          <tbody>
            {#each paginadosStock as p}
              <tr>
                <td class="mono text-muted2" style="font-size:11.5px">{p.codigo_barras ?? '—'}</td>
                <td>
                  <div style="font-weight:700">{p.nombre}</div>
                  {#if p.descripcion}<div class="text-muted2" style="font-size:12px">{p.descripcion}</div>{/if}
                </td>
                <td><span class="badge badge-blue">{p.categoria}</span></td>
                <td class="mono" style="text-align:right">{formatPeso(p.precio_base)}</td>
                <td class="mono text-muted" style="text-align:right">{formatPeso(p.precio_iva)}</td>
                <td class="mono" style="text-align:right;font-weight:700;color:var(--green)">{formatPeso(p.precio_venta)}</td>
                <td class="mono text-muted" style="text-align:right">{formatPeso(p.precio_mayorista)}</td>
                <td style="text-align:center">
                  <span class="badge {p.stock_actual <= p.stock_minimo ? 'badge-red' : 'badge-green'}">
                    {p.stock_actual} {p.unidad}
                  </span>
                </td>
                <td style="text-align:right">
                  <div style="display:flex;gap:0.3rem;justify-content:flex-end">
                    <button class="btn btn-ghost btn-sm" on:click={() => modal = {...p}}>Editar</button>
                    <button class="btn btn-danger btn-sm" on:click={() => eliminar(p)}>Eliminar</button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <Pagination total={productos.length} page={paginaStock} pageSize={tamanoPaginaStock} on:change={onPagStock} />
      </div>
    {/if}
  </div>
</div>

<!-- Modal -->
{#if modal}
  <div class="overlay" on:click|self={() => modal = null}>
    <div class="modal" style="max-width:600px">
      <h2 class="modal-title">{modal.id ? 'Editar producto' : 'Nuevo producto'}</h2>
      <div class="form-grid">
        <div class="field field-full"><label>Nombre *</label><input class="input" bind:value={modal.nombre} /></div>
        <div class="field"><label>Código de barras</label><input class="input mono" bind:value={modal.codigo_barras} /></div>
        <div class="field"><label>Categoría</label><input class="input" bind:value={modal.categoria} list="cats" /><datalist id="cats">{#each categorias as c}<option value={c}/>{/each}</datalist></div>
        <div class="field"><label>Unidad</label><select class="input" bind:value={modal.unidad}><option>unidad</option><option>kg</option><option>litro</option><option>metro</option></select></div>
        <div class="field"><label>Descripción</label><input class="input" bind:value={modal.descripcion} /></div>
        <div class="field"><label>Precio base $</label><input class="input mono" type="number" bind:value={modal.precio_base} /></div>
        <div class="field"><label>Precio venta $</label><input class="input mono" type="number" bind:value={modal.precio_venta} /></div>
        <div class="field"><label>Precio mayorista $</label><input class="input mono" type="number" bind:value={modal.precio_mayorista} /></div>
        <div class="field"><label>Stock actual</label><input class="input" type="number" bind:value={modal.stock_actual} /></div>
        <div class="field"><label>Stock mínimo</label><input class="input" type="number" bind:value={modal.stock_minimo} /></div>
      </div>
      <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.5rem">
        <button class="btn btn-ghost" on:click={() => modal = null}>Cancelar</button>
        <button class="btn btn-primary" on:click={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
      </div>
    </div>
  </div>
{/if}
