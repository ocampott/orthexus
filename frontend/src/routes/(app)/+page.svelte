<script>
  import { onMount } from 'svelte';
  import { whatsappApi } from '$lib/api';
  import { toasts } from '$lib/stores';

  async function enviarWA(a, tipo) {
    try {
      const r = await whatsappApi.enviar(a.id, tipo);
      if (r.ok) toasts.ok('✅ WA enviado a ' + a.cliente_nombre);
      else toasts.error('Error: ' + r.error);
    } catch(e) { toasts.error(e.message); }
  }
  import { formatPeso } from '$lib/stores';

  let tab = 'hoy';
  let resumenHoy = null, resumenSemana = null, resumenMes = null;
  let alquileres = [], productos = [];
  let cargando = true;

  const hoyStr = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const now = new Date();
  const _mesLabel = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const mesLabel = _mesLabel.charAt(0).toUpperCase() + _mesLabel.slice(1);

  onMount(async () => {
    try {
      [resumenHoy, resumenSemana, resumenMes, alquileres, productos] = await Promise.all([
        ventasApi.resumenHoy(),
        ventasApi.resumenSemana(),
        ventasApi.resumenMes(),
        alquileresApi.listar(),
        productosApi.listar(),
      ]);
    } finally { cargando = false; }
  });

  $: resumen     = tab === 'hoy' ? resumenHoy : tab === 'semana' ? resumenSemana : resumenMes;
  $: diasData    = resumen?.dias ?? [];
  $: maxTotal    = Math.max(...diasData.map(d => d.total), 1);

  // Alquileres por estado
  $: vencidos       = alquileres.filter(a => a.vencido);
  $: porVencer      = alquileres.filter(a => a.estado === 'activo' && !a.vencido && a.dias_restantes >= 0 && a.dias_restantes <= 5);
  $: activos        = alquileres.filter(a => a.estado === 'activo' && !a.vencido && a.dias_restantes > 5);
  $: alertasAlq     = [...vencidos, ...porVencer].sort((a,b) => a.dias_restantes - b.dias_restantes);

  // Stock bajo
  $: stockBajo      = productos.filter(p => !p.tiene_variantes && p.stock_actual <= p.stock_minimo && p.stock_minimo > 0);
  $: sinStock       = productos.filter(p => !p.tiene_variantes && p.stock_actual === 0);

  const TABS = [
    { key: 'hoy',    label: 'Hoy' },
    { key: 'semana', label: 'Esta semana' },
    { key: 'mes',    label: mesLabel },
  ];

  function diaLabel(d) {
    const s = new Date(d + 'T12:00:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function diasLabel(n) {
    if (n < 0) return `${Math.abs(n)}d de retraso`;
    if (n === 0) return 'vence hoy';
    return `${n}d restante${n !== 1 ? 's' : ''}`;
  }
</script>

<div class="dash">
  <!-- ── Header ── -->
  <div class="dash-header">
    <div>
      <h1 class="page-title">Dashboard</h1>
      <p class="page-sub" style="text-transform:capitalize">{hoyStr}</p>
    </div>
    <a href="/ventas/nueva" class="btn btn-dark btn-lg">+ Nueva venta</a>
  </div>

  {#if cargando}
    <p class="text-muted" style="padding:2rem 0">Cargando...</p>
  {:else}

    <!-- ── Tabs período ── -->
    <div class="tabs-row">
      {#each TABS as t}
        <button class="tab-pill" class:active={tab === t.key} on:click={() => tab = t.key}>
          {t.label}
        </button>
      {/each}
    </div>

    <!-- ── KPIs ── -->
    <div class="kpi-grid">
      <div class="card kpi-main">
        <p class="kpi-lbl">Total recaudado</p>
        <p class="kpi-val mono text-green">{formatPeso(resumen?.total_recaudado ?? 0)}</p>
        <p class="kpi-hint">{resumen?.total_ventas ?? 0} venta{(resumen?.total_ventas ?? 0) !== 1 ? 's' : ''}</p>
      </div>
      {#each [['💵 Efectivo', resumen?.efectivo ?? 0], ['📲 Transferencia', resumen?.transferencia ?? 0], ['💳 Tarjeta', resumen?.tarjeta ?? 0]] as [l, v]}
        <div class="card kpi-sm">
          <p class="kpi-lbl">{l}</p>
          <p class="kpi-val mono">{formatPeso(v)}</p>
        </div>
      {/each}
    </div>

    <!-- ── Gráfico ── -->
    {#if diasData.length > 0}
      <div class="card chart-card">
        <p class="chart-title">VENTAS POR DÍA</p>
        <div class="bar-chart">
          {#each diasData as d}
            <div class="bar-col">
              <div class="bar-amount">{formatPeso(d.total)}</div>
              <div class="bar-track">
                <div class="bar-fill" style="height:{Math.max(Math.round((d.total / maxTotal) * 100), d.total > 0 ? 3 : 0)}%"></div>
              </div>
              <div class="bar-day">{diaLabel(d.dia)}</div>
              <div class="bar-cant">{d.cant_ventas}v</div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- ── Fila inferior ── -->
    <div class="bottom-grid">

      <!-- Alquileres por vencer / vencidos -->
      <div class="card panel-alq">
        <div class="panel-header">
          <p class="panel-title">⏱ Alquileres críticos</p>
          <div style="display:flex;gap:0.5rem">
            {#if vencidos.length > 0}
              <span class="badge badge-red">{vencidos.length} vencido{vencidos.length !== 1 ? 's' : ''}</span>
            {/if}
            {#if porVencer.length > 0}
              <span class="badge badge-yellow">{porVencer.length} por vencer</span>
            {/if}
          </div>
        </div>

        {#if alertasAlq.length === 0}
          <div class="panel-empty">
            <span style="font-size:1.5rem">✓</span>
            <span>Todos los alquileres al día</span>
          </div>
        {:else}
          <div class="alq-lista">
            {#each alertasAlq as a}
              <div class="alq-item">
                <div class="alq-estado-dot {a.vencido ? 'dot-red' : 'dot-yellow'}"></div>
                <a href="/alquileres" class="alq-info" style="text-decoration:none;color:inherit">
                  <div class="alq-nombre">{a.cliente_nombre}</div>
                  <div class="alq-detalle">
                    {a.productos_nombres ?? 'Sin productos'} · {new Date(a.fecha_devolucion + 'T12:00:00').toLocaleDateString('es-AR')}
                  </div>
                </a>
                <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0">
                  <span class="alq-dias {a.vencido ? 'dias-red' : 'dias-yellow'}">{diasLabel(a.dias_restantes)}</span>
                  {#if a.cliente_telefono}
                    <button
                      class="btn btn-sm"
                      style="background:#25D366;color:white;font-size:11px;padding:0.2rem 0.45rem;border-radius:6px;flex-shrink:0"
                      title="Enviar aviso por WhatsApp"
                      on:click={() => enviarWA(a, a.vencido ? 'vencido' : 'por_vencer')}
                    >📱</button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
          <a href="/alquileres" class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:0.75rem;font-size:13px">
            Ver todos los alquileres →
          </a>
        {/if}
      </div>

      <!-- Columna derecha -->
      <div style="display:flex;flex-direction:column;gap:1rem">

        <!-- Stock bajo -->
        <div class="card panel-stock">
          <div class="panel-header">
            <p class="panel-title">📦 Alertas de stock</p>
            {#if sinStock.length + stockBajo.length > 0}
              <span class="badge badge-red">{sinStock.length + stockBajo.length} alertas</span>
            {/if}
          </div>
          {#if sinStock.length === 0 && stockBajo.length === 0}
            <div class="panel-empty"><span>✓</span><span>Stock en orden</span></div>
          {:else}
            <div class="stock-lista">
              {#each sinStock.slice(0,3) as p}
                <a href="/productos" class="stock-item">
                  <span class="badge badge-red" style="font-size:10px;flex-shrink:0">Sin stock</span>
                  <span class="stock-nombre">{p.nombre}</span>
                  <span class="mono" style="font-size:12px;color:var(--red)">0 {p.unidad}</span>
                </a>
              {/each}
              {#each stockBajo.slice(0, 3 - Math.min(sinStock.length,3)) as p}
                <a href="/productos" class="stock-item">
                  <span class="badge badge-yellow" style="font-size:10px;flex-shrink:0">Bajo</span>
                  <span class="stock-nombre">{p.nombre}</span>
                  <span class="mono" style="font-size:12px;color:var(--yellow)">{p.stock_actual} {p.unidad}</span>
                </a>
              {/each}
            </div>
            {#if sinStock.length + stockBajo.length > 3}
              <a href="/productos" class="text-muted2" style="font-size:12px;margin-top:0.5rem;display:block">
                +{sinStock.length + stockBajo.length - 3} más →
              </a>
            {/if}
          {/if}
        </div>

        <!-- Resumen alquileres + accesos -->
        <div class="card">
          <p class="panel-title" style="margin-bottom:0.85rem">📋 Resumen alquileres</p>
          <div class="alq-kpis">
            {#each [[activos.length, 'Activos', 'var(--primary)'], [vencidos.length, 'Vencidos', 'var(--red)'], [alquileres.filter(a=>a.estado==='devuelto').length, 'Devueltos', 'var(--green)']] as [v, l, c]}
              <div style="text-align:center">
                <div class="mono" style="font-size:1.6rem;font-weight:800;color:{c}">{v}</div>
                <div style="font-size:11.5px;color:var(--text2);font-weight:600;margin-top:0.1rem">{l}</div>
              </div>
            {/each}
          </div>
        </div>

        <!-- Accesos rápidos -->
        <div class="card">
          <p class="panel-title" style="margin-bottom:0.85rem">⚡ Accesos rápidos</p>
          <div class="accesos-grid">
            {#each [['Nueva venta','/ventas/nueva','🧾'],['Scanner','/scanner','📷'],['Productos','/productos','📦'],['Alquileres','/alquileres','⏱']] as [label, href, icon]}
              <a {href} class="acceso-btn">
                <span style="font-size:1.1rem">{icon}</span>
                <span>{label}</span>
              </a>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .dash { display:flex; flex-direction:column; gap:1.1rem; }
  .dash-header { display:flex; justify-content:space-between; align-items:flex-start; }

  /* Tabs */
  .tabs-row { display:flex; gap:0.4rem; flex-wrap:wrap; }
  .tab-pill {
    padding:0.4rem 1.1rem; border-radius:999px;
    border:1.5px solid var(--border); background:var(--bg2);
    font-family:var(--font); font-size:13.5px; font-weight:700;
    color:var(--text2); cursor:pointer; transition:all 0.13s;
  }
  .tab-pill:hover { border-color:var(--primary); color:var(--primary); }
  .tab-pill.active { background:var(--gradient-pr); border-color:transparent; color:white; box-shadow:var(--shadow-md); }

  /* KPIs */
  .kpi-grid { display:grid; grid-template-columns:1.8fr 1fr 1fr 1fr; gap:1rem; }
  .kpi-main { border-left:3px solid var(--green); }
  .kpi-main, .kpi-sm { display:flex; flex-direction:column; gap:0.2rem; }
  .kpi-lbl  { font-size:12px; font-weight:700; color:var(--text2); }
  .kpi-val  { font-size:1.75rem; font-weight:800; letter-spacing:-0.04em; line-height:1.1; margin:0.15rem 0; }
  .kpi-sm .kpi-val { font-size:1.25rem; }
  .kpi-hint { font-size:12px; color:var(--text3); }

  /* Chart */
  .chart-card { }
  .chart-title { font-size:10.5px; font-weight:800; letter-spacing:0.1em; color:var(--text3); margin-bottom:1rem; }
  .bar-chart { display:flex; align-items:flex-end; gap:0.5rem; height:110px; }
  .bar-col { display:flex; flex-direction:column; align-items:center; gap:0.15rem; flex:1; min-width:44px; max-width:90px; height:100%; }
  .bar-amount { font-size:9px; font-weight:700; color:var(--text2); white-space:nowrap; font-family:var(--mono); }
  .bar-track  { flex:1; width:100%; display:flex; align-items:flex-end; background:var(--bg3); border-radius:4px 4px 0 0; }
  .bar-fill   { width:100%; background:var(--primary); border-radius:4px 4px 0 0; transition:height 0.4s ease; }
  .bar-day    { font-size:10px; font-weight:600; color:var(--text2); white-space:nowrap; text-transform:capitalize; }
  .bar-cant   { font-size:9px; color:var(--text3); }

  /* Bottom grid */
  .bottom-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }

  /* Panels */
  .panel-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:0.85rem; }
  .panel-title  { font-size:13.5px; font-weight:700; }
  .panel-empty  { display:flex; align-items:center; gap:0.5rem; font-size:13px; color:var(--text2); padding:0.75rem 0; }

  /* Alquileres lista */
  .alq-lista { display:flex; flex-direction:column; gap:0; }
  .alq-item {
    display:flex; align-items:center; gap:0.75rem;
    padding:0.6rem 0.5rem;
    border-radius:calc(var(--radius) - 2px);
    transition:background 0.1s;
    border-bottom:1px solid var(--bg3);
  }
  .alq-item:last-child { border-bottom:none; }
  .alq-item:hover { background:var(--primary-bg); }
  .alq-estado-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .dot-red    { background:var(--red);    box-shadow:0 0 0 3px var(--red-lt); }
  .dot-yellow { background:var(--yellow); box-shadow:0 0 0 3px var(--yellow-lt); }
  .alq-info { flex:1; min-width:0; }
  .alq-nombre  { font-weight:700; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .alq-detalle { font-size:11.5px; color:var(--text2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px; }
  .alq-dias    { font-size:11.5px; font-weight:700; white-space:nowrap; flex-shrink:0; }
  .dias-red    { color:var(--red); }
  .dias-yellow { color:var(--yellow); }
  .alq-kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:0.5rem; }

  /* Stock */
  .stock-lista { display:flex; flex-direction:column; gap:0.3rem; }
  .stock-item {
    display:flex; align-items:center; gap:0.5rem;
    padding:0.45rem 0.5rem; text-decoration:none; color:var(--text);
    border-radius:6px; transition:background 0.1s;
  }
  .stock-item:hover { background:var(--bg3); }
  .stock-nombre { flex:1; font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  /* Accesos */
  .accesos-grid { display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; }
  .acceso-btn {
    display:flex; align-items:center; gap:0.5rem; padding:0.65rem 0.85rem;
    border-radius:calc(var(--radius) - 2px);
    background:var(--bg3); border:1px solid var(--border);
    text-decoration:none; color:var(--text);
    font-size:13px; font-weight:700; transition:all 0.13s;
  }
  .acceso-btn:hover { background:var(--primary-bg); border-color:var(--primary-bd); color:var(--primary); }
</style>
