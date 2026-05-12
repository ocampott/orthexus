<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { productosApi, ventasApi } from '$lib/api';
  import { carrito, totalCarrito, toasts, notif, formatPeso, refreshNotifications } from '$lib/stores';

  let medio_pago = 'efectivo';
  let notas = '';
  let procesando = false;

  // ── Scanner buffer ────────────────────────────────
  let buffer = '';
  let bufferTimer = null;
  let ultimoScan = null; // feedback visual

  function onKeyDown(e) {
    // Si el foco está en búsqueda manual, no interceptar
    if (document.activeElement?.id === 'busqueda-manual') return;
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;

    if (e.key === 'Enter') {
      if (buffer.length >= 3) escanear(buffer);
      buffer = '';
      clearTimeout(bufferTimer);
      return;
    }
    if (e.key.length > 1) return; // ignorar Shift, Ctrl, etc.
    buffer += e.key;
    clearTimeout(bufferTimer);
    bufferTimer = setTimeout(() => { buffer = ''; }, 250);
  }

  onMount(() => {
    carrito.vaciar();
    // listener manejado por svelte:window
  });
  onDestroy(() => { /* nada que limpiar */ });

  // ── Escanear código ───────────────────────────────
  let flashOk = false;
  let flashErr = false;

  async function escanear(codigo) {
    if (procesando) return;
    procesando = true;
    try {
      const p = await productosApi.porBarcode(codigo);
      if (p.stock_actual <= 0) {
        notif.agregar(`"${p.nombre}" sin stock`, 'error');
        flashErr = true;
        setTimeout(() => { flashErr = false; }, 600);
        return;
      }
      carrito.agregar(p);
      ultimoScan = p;
      flashOk = true;
      setTimeout(() => { flashOk = false; }, 600);
    } catch {
      flashErr = true;
      ultimoScan = null;
      setTimeout(() => { flashErr = false; }, 600);
      notif.agregar(`Código "${codigo}" no encontrado`, 'error');
    } finally {
      procesando = false;
    }
  }

  // ── Búsqueda manual ───────────────────────────────
  let termino = '';
  let resultados = [];
  let showResultados = false;
  let timerBusq;

  async function buscarProducto() {
    clearTimeout(timerBusq);
    if (termino.length < 2) { resultados = []; showResultados = false; return; }
    timerBusq = setTimeout(async () => {
      const todos = await productosApi.buscar(termino);
      resultados = todos.filter(p => p.stock_actual > 0);
      showResultados = resultados.length > 0;
    }, 220);
  }

  function agregarDesdeBusqueda(p) {
    carrito.agregar(p);
    ultimoScan = p;
    termino = '';
    resultados = [];
    showResultados = false;
    flashOk = true;
    setTimeout(() => flashOk = false, 600);
  }

  // ── Confirmar venta ───────────────────────────────
  let confirming = false;

  async function confirmarVenta() {
    if ($carrito.length === 0 || confirming) return;
    confirming = true;
    try {
      await ventasApi.crear({ medio_pago, notas, items: $carrito });
      toasts.ok('✓ Venta registrada');
      carrito.vaciar();
      goto('/ventas');
    } catch (e) {
      toasts.error(e.message);
    } finally {
      confirming = false;
    }
  }

  // ── Utils ─────────────────────────────────────────
  const MEDIOS = [
    { key: 'efectivo',      icon: '💵', label: 'Efectivo' },
    { key: 'transferencia', icon: '📲', label: 'Transferencia' },
    { key: 'tarjeta',       icon: '💳', label: 'Tarjeta' },
  ];
</script>

<svelte:window on:keydown={onKeyDown} />

<!-- Layout POS full-height -->
<div class="pos-shell">

  <!-- ═══════════════════════════════════ -->
  <!-- Panel izquierdo: productos         -->
  <!-- ═══════════════════════════════════ -->
  <div class="pos-left">

    <!-- Topbar -->
    <div class="pos-topbar">
      <a href="/ventas" class="btn btn-ghost btn-sm">← Volver</a>
      <h1 style="font-size:1.15rem;font-weight:800">Nueva venta</h1>
      <div style="width:80px"></div>
    </div>

    <!-- Scanner zone + búsqueda -->
    <div class="scan-zone {flashOk ? 'flash-ok' : ''} {flashErr ? 'flash-err' : ''}">
      <div class="scan-icon">
        {#if procesando}⏳{:else if flashOk}✓{:else if flashErr}✗{:else}
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
            <line x1="7" y1="12" x2="17" y2="12"/>
          </svg>
        {/if}
      </div>

      <div class="scan-info">
        {#if ultimoScan && flashOk}
          <span class="scan-nombre">{ultimoScan.nombre}</span>
          <span class="scan-precio">{formatPeso(ultimoScan.precio_venta)}</span>
        {:else}
          <span class="scan-hint">Apuntá el lector o buscá abajo</span>
        {/if}
      </div>
    </div>

    <!-- Búsqueda manual -->
    <div class="busqueda-wrap">
      <div style="position:relative">
        <input
          id="busqueda-manual"
          class="input busqueda-input"
          placeholder="Buscar producto por nombre..."
          bind:value={termino}
          on:input={buscarProducto}
          on:focus={() => { if(resultados.length) showResultados = true; }}
          on:blur={() => setTimeout(() => showResultados = false, 150)}
          autocomplete="off"
        />
        {#if showResultados}
          <div class="dropdown">
            {#each resultados.slice(0,8) as p}
              <button class="dropdown-item" on:mousedown={() => agregarDesdeBusqueda(p)}>
                <div class="dr-left">
                  <span class="dr-nombre">{p.nombre}</span>
                  {#if p.codigo_barras}
                    <span class="dr-cod mono">{p.codigo_barras}</span>
                  {/if}
                </div>
                <div class="dr-right">
                  <span class="badge {p.stock_actual > 0 ? 'badge-green' : 'badge-red'}">{p.stock_actual}</span>
                  <span class="dr-precio mono">{formatPeso(p.precio_venta)}</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Lista de ítems en el carrito -->
    {#if $carrito.length > 0}
      <div class="items-lista">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th style="text-align:center;width:120px">Cantidad</th>
              <th style="text-align:right;width:110px">Precio unit.</th>
              <th style="text-align:right;width:110px">Subtotal</th>
              <th style="width:36px"></th>
            </tr>
          </thead>
          <tbody>
            {#each $carrito as item (item._key)}
              <tr class="item-row">
                <td style="font-weight:600">{item.nombre}</td>
                <td style="text-align:center">
                  <div class="qty-control">
                    <button class="qty-btn" on:click={() => carrito.setCantidad(item._key, item.cantidad - 1)}>−</button>
                    <span class="qty-val mono">{item.cantidad}</span>
                    <button class="qty-btn qty-btn-add"
                      disabled={item.cantidad >= item.stock_actual}
                      on:click={() => carrito.setCantidad(item._key, item.cantidad + 1)}>+</button>
                  </div>
                </td>
                <td class="mono text-muted" style="text-align:right">{formatPeso(item.precio_unitario)}</td>
                <td class="mono" style="text-align:right;font-weight:700">{formatPeso(item.subtotal)}</td>
                <td>
                  <button class="del-btn" on:click={() => carrito.eliminar(item._key)}>✕</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="vacio">
        <span style="font-size:2.5rem">🛒</span>
        <p>Carrito vacío</p>
        <p style="font-size:13px;color:var(--text3)">Escaneá un producto para empezar</p>
      </div>
    {/if}
  </div>

  <!-- ═══════════════════════════════════ -->
  <!-- Panel derecho: cobro               -->
  <!-- ═══════════════════════════════════ -->
  <div class="pos-right">
    <!-- Total grande -->
    <div class="total-box">
      <p class="total-label">TOTAL</p>
      <p class="total-valor mono">{formatPeso($totalCarrito)}</p>
      <p class="total-items">{$carrito.length} ítem{$carrito.length !== 1 ? 's' : ''} · {$carrito.reduce((s,i)=>s+i.cantidad,0)} unidades</p>
    </div>

    <div class="divider"></div>

    <!-- Medio de pago -->
    <p style="font-size:11px;font-weight:800;letter-spacing:0.1em;color:var(--text3);margin-bottom:0.65rem">MEDIO DE PAGO</p>
    <div class="medios-grid">
      {#each MEDIOS as m}
        <button
          class="medio-btn {medio_pago === m.key ? 'active' : ''}"
          on:click={() => medio_pago = m.key}
        >
          <span class="medio-icon">{m.icon}</span>
          <span class="medio-label">{m.label}</span>
        </button>
      {/each}
    </div>

    <div class="divider"></div>

    <!-- Notas -->
    <div class="field" style="margin-bottom:1.25rem">
      <label>Notas (opcional)</label>
      <textarea class="input" bind:value={notas} rows="2" placeholder="Observaciones..."></textarea>
    </div>

    <!-- Botón confirmar -->
    <button
      class="btn-confirmar"
      class:disabled={$carrito.length === 0 || confirming}
      disabled={$carrito.length === 0 || confirming}
      on:click={confirmarVenta}
    >
      {#if confirming}
        Registrando...
      {:else}
        ✓ &nbsp;Cobrar {formatPeso($totalCarrito)}
      {/if}
    </button>

    <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:0.6rem;font-size:13px"
      on:click={() => { carrito.vaciar(); ultimoScan = null; }}>
      Vaciar carrito
    </button>
  </div>

</div>

<style>
  /* ── Layout ── */
  .pos-shell {
    display: flex;
    height: calc(100vh - 0px);
    gap: 0;
    margin: -2rem -2.25rem; /* cancelar el padding del main */
  }

  /* ── Panel izquierdo ── */
  .pos-left {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid var(--border);
  }

  .pos-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
    flex-shrink: 0;
  }

  /* ── Zona scanner ── */
  .scan-zone {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem 1.5rem;
    background: var(--bg3);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    transition: background 0.2s;
    min-height: 68px;
  }
  .scan-zone.flash-ok { background: #dcfce7; }
  .scan-zone.flash-err { background: #fee2e2; }

  .scan-icon {
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg2);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    font-size: 1.2rem;
    color: var(--text2);
    flex-shrink: 0;
  }
  .scan-zone.flash-ok .scan-icon { background: var(--green); color: #fff; border-color: var(--green); font-size: 1.3rem; font-weight: 900; }
  .scan-zone.flash-err .scan-icon { background: var(--red); color: #fff; border-color: var(--red); font-size: 1.3rem; font-weight: 900; }

  .scan-info { display: flex; flex-direction: column; gap: 0.1rem; }
  .scan-nombre { font-weight: 700; font-size: 14.5px; color: var(--text); }
  .scan-precio { font-family: var(--mono); font-size: 13px; color: var(--green); font-weight: 700; }
  .scan-hint   { font-size: 13px; color: var(--text3); }

  /* ── Búsqueda ── */
  .busqueda-wrap {
    padding: 0.75rem 1.5rem;
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .busqueda-input { font-size: 14px; }

  .dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--bg2);
    border: 1.5px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    z-index: 50;
    overflow: hidden;
    max-height: 320px;
    overflow-y: auto;
  }
  .dropdown-item {
    width: 100%; background: none; border: none; cursor: pointer;
    padding: 0.65rem 1rem;
    display: flex; justify-content: space-between; align-items: center;
    border-bottom: 1px solid var(--bg3);
    color: var(--text); font-family: var(--font);
    text-align: left; gap: 1rem;
    transition: background 0.1s;
  }
  .dropdown-item:last-child { border-bottom: none; }
  .dropdown-item:hover { background: var(--bg3); }
  .dr-left { display: flex; flex-direction: column; gap: 0.1rem; }
  .dr-nombre { font-weight: 600; font-size: 13.5px; }
  .dr-cod    { font-size: 11px; color: var(--text3); }
  .dr-right  { display: flex; align-items: center; gap: 0.6rem; flex-shrink: 0; }
  .dr-precio { font-weight: 700; color: var(--accent); font-size: 14px; }

  /* ── Lista ítems ── */
  .items-lista {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }
  .item-row { animation: popIn 0.15s ease; }
  tbody td { vertical-align: middle; }

  .qty-control { display: flex; align-items: center; gap: 0.3rem; justify-content: center; }
  .qty-btn {
    width: 26px; height: 26px;
    background: var(--bg3); border: 1px solid var(--border);
    border-radius: 5px; cursor: pointer; font-size: 15px;
    display: flex; align-items: center; justify-content: center;
    color: var(--text); font-family: var(--font);
    transition: background 0.1s;
  }
  .qty-btn:hover { background: var(--bg4); }
  .qty-btn-add:disabled { opacity: 0.3; cursor: not-allowed; }
  .qty-btn-add:disabled:hover { background: var(--bg3); }
  .qty-val { min-width: 28px; text-align: center; font-size: 14px; font-weight: 700; }
  .del-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text3); font-size: 13px; padding: 4px;
    border-radius: 4px; transition: all 0.1s;
  }
  .del-btn:hover { background: var(--red-lt); color: var(--red); }

  /* ── Carrito vacío ── */
  .vacio {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 0.5rem; color: var(--text2); padding: 3rem;
  }

  /* ── Panel derecho ── */
  .pos-right {
    width: 300px;
    flex-shrink: 0;
    background: var(--bg2);
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    overflow-y: auto;
  }

  /* ── Total ── */
  .total-box { text-align: center; padding: 1rem 0; }
  .total-label { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; color: var(--text3); margin-bottom: 0.4rem; }
  .total-valor { font-size: 2.4rem; font-weight: 800; color: var(--text); letter-spacing: -0.04em; line-height: 1; }
  .total-items { font-size: 12px; color: var(--text3); margin-top: 0.4rem; }

  /* ── Medios de pago ── */
  .medios-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.4rem; margin-bottom: 0; }
  .medio-btn {
    display: flex; flex-direction: column; align-items: center;
    gap: 0.3rem; padding: 0.65rem 0.5rem;
    background: var(--bg3); border: 1.5px solid var(--border);
    border-radius: var(--radius-sm); cursor: pointer;
    font-family: var(--font); transition: all 0.12s;
  }
  .medio-btn:hover { border-color: var(--accent); background: var(--accent-lt); }
  .medio-btn.active { border-color: var(--accent); background: var(--accent-lt); }
  .medio-icon { font-size: 1.2rem; }
  .medio-label { font-size: 11px; font-weight: 700; color: var(--text2); }
  .medio-btn.active .medio-label { color: var(--accent); }

  /* ── Botón cobrar ── */
  .btn-confirmar {
    width: 100%;
    padding: 1rem;
    border-radius: var(--radius);
    background: #1a1a1a;
    color: #fff;
    font-family: var(--font);
    font-size: 1rem;
    font-weight: 800;
    border: none;
    cursor: pointer;
    transition: all 0.13s;
    letter-spacing: 0.01em;
  }
  .btn-confirmar:hover:not(.disabled) { background: #2d2d2d; transform: translateY(-1px); box-shadow: var(--shadow-md); }
  .btn-confirmar.disabled { opacity: 0.35; cursor: not-allowed; }
</style>
