<script>
  import { onMount } from 'svelte';
  import { ventasApi } from '$lib/api';
  import { toasts, formatPeso , showConfirm } from '$lib/stores';

  let ventas = [], resumen = null, cargando = true;
  let ventaDetalle = null;
  let detalleId = null;
  let cargandoDetalle = false;

  // Fecha local correcta (evita bug de UTC)
  function fechaLocal() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  const hoy = fechaLocal();
  let desde = hoy, hasta = hoy;

  onMount(cargar);

  async function cargar() {
    cargando = true;
    try {
      [ventas, resumen] = await Promise.all([
        ventasApi.listar({ desde, hasta }),
        ventasApi.resumenHoy(),
      ]);
      // Si había un detalle abierto, refrescarlo
      if (detalleId) await abrirDetalle(detalleId);
    } finally { cargando = false; }
  }

  async function abrirDetalle(id) {
    if (detalleId === id) { detalleId = null; ventaDetalle = null; return; }
    detalleId = id;
    cargandoDetalle = true;
    try {
      ventaDetalle = await ventasApi.detalle(id);
    } finally { cargandoDetalle = false; }
  }

  async function anular(id) {
    const ok = await showConfirm({ title: 'Anular venta', message: 'Se restaurará el stock de todos los productos vendidos. ¿Continuar?', confirmLabel: 'Anular', cancelLabel: 'No', danger: true, icon: '⚠️' }); if (!ok) return;
    await ventasApi.anular(id);
    toasts.ok('Venta anulada');
    if (detalleId === id) { detalleId = null; ventaDetalle = null; }
    cargar();
  }

  const MEDIOS = {
    efectivo:       '💵 Efectivo',
    transferencia:  '📲 Transferencia',
    tarjeta:        '💳 Tarjeta',
  };
  const MEDIOS_BADGE = {
    efectivo:      'badge-green',
    transferencia: 'badge-primary',
    tarjeta:       'badge-yellow',
  };
</script>

<div class="ventas-page">

  <!-- Header -->
  <div class="page-header">
    <div>
      <h1 class="page-title">Ventas</h1>
      <p class="page-sub">{ventas.length} registro{ventas.length !== 1 ? 's' : ''} en el período</p>
    </div>
    <a href="/ventas/nueva" class="btn btn-dark btn-lg">+ Nueva venta</a>
  </div>

  <!-- KPIs hoy -->
  {#if resumen}
    <div class="kpi-row">
      <div class="card kpi-main">
        <p class="kpi-lbl">Hoy — Total recaudado</p>
        <p class="kpi-val mono text-green">{formatPeso(resumen.total_recaudado)}</p>
        <p class="kpi-hint">{resumen.total_ventas} ventas</p>
      </div>
      {#each [['💵 Efectivo', resumen.efectivo], ['📲 Transferencia', resumen.transferencia], ['💳 Tarjeta', resumen.tarjeta]] as [l, v]}
        <div class="card kpi-sm">
          <p class="kpi-lbl">{l}</p>
          <p class="kpi-val mono">{formatPeso(v)}</p>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Filtro fechas -->
  <div class="card filtros">
    <label class="filtro-lbl">Desde</label>
    <input class="input" type="date" bind:value={desde} style="width:155px" />
    <label class="filtro-lbl">Hasta</label>
    <input class="input" type="date" bind:value={hasta} style="width:155px" />
    <button class="btn btn-ghost" on:click={cargar}>Filtrar</button>
    <span class="text-muted2" style="font-size:12px;margin-left:auto">
      Hacé click en una fila para ver el detalle
    </span>
  </div>

  <!-- Split: tabla + detalle -->
  <div class="split" class:with-detail={detalleId !== null}>

    <!-- Tabla -->
    <div class="card tabla-wrap">
      {#if cargando}
        <div class="empty-state">Cargando...</div>
      {:else if ventas.length === 0}
        <div class="empty-state">No hay ventas en ese período.</div>
      {:else}
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Fecha y hora</th>
              <th>Ítems</th>
              <th>Medio de pago</th>
              <th style="text-align:right">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each ventas as v}
              <tr
                class:sel={detalleId === v.id}
                on:click={() => abrirDetalle(v.id)}
                style="cursor:pointer"
              >
                <td class="mono text-muted2" style="font-size:12px">#{v.id}</td>
                <td style="font-size:13px">{new Date(v.fecha).toLocaleString('es-AR')}</td>
                <td class="text-muted">{v.cantidad_items} ítem{v.cantidad_items !== 1 ? 's' : ''}</td>
                <td>
                  <span class="badge {MEDIOS_BADGE[v.medio_pago] ?? 'badge-gray'}">
                    {MEDIOS[v.medio_pago] ?? v.medio_pago}
                  </span>
                </td>
                <td class="mono" style="text-align:right;font-weight:700;color:var(--green)">
                  {formatPeso(v.total)}
                </td>
                <td style="text-align:right" on:click|stopPropagation>
                  <button class="btn btn-danger btn-sm" on:click={() => anular(v.id)}>Anular</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Panel detalle -->
    {#if detalleId !== null}
      <div class="card detalle-panel">
        <div class="detalle-header">
          <div>
            <div class="mono text-muted2" style="font-size:11px">VENTA #{detalleId}</div>
            {#if ventaDetalle}
              <div style="font-size:13px;color:var(--text2);margin-top:2px">
                {new Date(ventaDetalle.fecha).toLocaleString('es-AR')}
              </div>
            {/if}
          </div>
          <button class="btn btn-ghost btn-sm" on:click={() => { detalleId = null; ventaDetalle = null; }}>✕</button>
        </div>

        {#if cargandoDetalle}
          <div style="padding:2rem;text-align:center;color:var(--text2)">Cargando...</div>
        {:else if ventaDetalle}
          <!-- Medio y total -->
          <div class="detalle-meta">
            <span class="badge {MEDIOS_BADGE[ventaDetalle.medio_pago] ?? 'badge-gray'}">
              {MEDIOS[ventaDetalle.medio_pago] ?? ventaDetalle.medio_pago}
            </span>
            {#if ventaDetalle.notas}
              <span class="text-muted2" style="font-size:12px">📝 {ventaDetalle.notas}</span>
            {/if}
          </div>

          <div class="divider"></div>

          <!-- Lista de productos -->
          <p class="detalle-section-title">PRODUCTOS VENDIDOS</p>
          <div class="items-lista">
            {#each ventaDetalle.items as item}
              <div class="item-row">
                <div class="item-info">
                  <span class="item-nombre">{item.nombre_snapshot}</span>
                  <span class="item-cant badge badge-gray">× {item.cantidad}</span>
                </div>
                <div class="item-precios">
                  <span class="text-muted2" style="font-size:11.5px">{formatPeso(item.precio_unitario)} c/u</span>
                  <span class="mono item-subtotal">{formatPeso(item.subtotal)}</span>
                </div>
              </div>
            {/each}
          </div>

          <div class="divider"></div>

          <!-- Total -->
          <div class="detalle-total">
            <span>Total</span>
            <span class="mono text-green" style="font-size:1.25rem;font-weight:800">{formatPeso(ventaDetalle.total)}</span>
          </div>

          <button
            class="btn btn-danger"
            style="width:100%;justify-content:center;margin-top:0.85rem;font-size:13px"
            on:click={() => anular(ventaDetalle.id)}
          >
            Anular venta
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .ventas-page { display: flex; flex-direction: column; gap: 1rem; height: 100%; }
  .page-header { display: flex; justify-content: space-between; align-items: flex-start; }

  /* KPIs */
  .kpi-row { display: grid; grid-template-columns: 1.8fr 1fr 1fr 1fr; gap: 1rem; }
  .kpi-main, .kpi-sm { display: flex; flex-direction: column; gap: 0.2rem; }
  .kpi-main { border-left: 3px solid var(--green); }
  .kpi-lbl  { font-size: 12px; font-weight: 700; color: var(--text2); }
  .kpi-val  { font-size: 1.65rem; font-weight: 800; letter-spacing: -0.04em; line-height: 1.1; margin: 0.15rem 0; }
  .kpi-sm .kpi-val { font-size: 1.25rem; }
  .kpi-hint { font-size: 12px; color: var(--text3); }

  /* Filtros */
  .filtros {
    display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;
    padding: 0.75rem 1rem;
  }
  .filtro-lbl { font-size: 12px; font-weight: 700; color: var(--text2); white-space: nowrap; }

  /* Split layout */
  .split {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    flex: 1;
    min-height: 0;
    align-items: start;
  }
  .split.with-detail {
    grid-template-columns: 1fr 300px;
  }

  .tabla-wrap { padding: 0; overflow: hidden; }
  .empty-state { padding: 2.5rem; text-align: center; color: var(--text2); font-size: 14px; }

  /* Detalle panel */
  .detalle-panel {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 12rem);
    overflow-y: auto;
  }
  .detalle-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 0.85rem;
  }
  .detalle-meta { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .detalle-section-title {
    font-size: 10px; font-weight: 800; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--text3); margin-bottom: 0.6rem;
  }
  .detalle-total {
    display: flex; justify-content: space-between; align-items: center;
    font-weight: 700;
  }

  /* Items lista */
  .items-lista { display: flex; flex-direction: column; gap: 0.4rem; }
  .item-row {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
    background: var(--bg3);
    border-radius: calc(var(--radius) - 4px);
    border: 1px solid var(--border);
  }
  .item-info { display: flex; align-items: center; gap: 0.4rem; flex: 1; min-width: 0; flex-wrap: wrap; }
  .item-nombre { font-weight: 600; font-size: 13px; }
  .item-cant { font-size: 11px; flex-shrink: 0; }
  .item-precios { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; flex-shrink: 0; }
  .item-subtotal { font-weight: 700; font-size: 14px; color: var(--green); }
</style>
