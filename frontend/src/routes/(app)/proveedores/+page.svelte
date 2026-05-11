<script>
  import { onMount } from 'svelte';
  import * as XLSX from 'xlsx';
  import { proveedoresApi } from '$lib/api';
  import { toasts, showConfirm } from '$lib/stores';

  const BASEURL = 'http://localhost:3001';

  // ── Estado proveedores ─────────────────────────────
  let proveedores = [];
  let cargando = true;
  let seleccionado = null;
  let modalProveedor = null;
  let guardando = false;
  let subiendoLista = false;

  // ── Estado visor ───────────────────────────────────
  let workbook = null;          // XLSX workbook
  let hojaActiva = 0;
  let cargandoVisor = false;
  let errorVisor = null;
  let busqueda = '';

  // Tabla actual
  $: hoja = workbook?.SheetNames[hojaActiva];
  $: ws   = hoja ? workbook.Sheets[hoja] : null;

  // Obtener range y datos con estilos
  $: { wsData = ws ? parsearHoja(ws) : null; }
  let wsData = null;

  function parsearHoja(ws) {
    if (!ws || !ws['!ref']) return { rows: [], cols: [], nCols: 0 };
    const range  = XLSX.utils.decode_range(ws['!ref']);
    const merges = ws['!merges'] ?? [];
    const cols   = ws['!cols']   ?? [];
    const nRows  = range.e.r - range.s.r + 1;
    const nCols  = range.e.c - range.s.c + 1;

    // Grid de ocupación: occupied[r][c] = true si está cubierta por un merge
    const occupied = Array.from({ length: nRows }, () => new Array(nCols).fill(false));
    // Marcar todas las celdas cubiertas por merges (excepto la celda origen)
    for (const m of merges) {
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r !== m.s.r || c !== m.s.c) {
            const ri = r - range.s.r;
            const ci = c - range.s.c;
            if (ri >= 0 && ri < nRows && ci >= 0 && ci < nCols) {
              occupied[ri][ci] = true;
            }
          }
        }
      }
    }

    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const fila = [];
      const ri   = r - range.s.r;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ci  = c - range.s.c;
        if (occupied[ri][ci]) continue; // celda cubierta → no emitir td

        const addr  = XLSX.utils.encode_cell({ r, c });
        const cell  = ws[addr];
        // Buscar si esta celda es origen de un merge
        const merge = merges.find(m => m.s.r === r && m.s.c === c);

        fila.push({
          valor:   cell ? formatearCelda(cell) : '',
          estilo:  cell?.s ?? {},
          tipo:    cell?.t ?? 's',
          colspan: merge ? (merge.e.c - merge.s.c + 1) : undefined,
          rowspan: merge ? (merge.e.r - merge.s.r + 1) : undefined,
        });
      }
      rows.push(fila);
    }
    return { rows, cols, nCols };
  }

  function formatearCelda(cell) {
    if (!cell) return '';
    // cell.w = formatted text exactly as Excel shows it — always prefer this
    if (cell.w !== undefined && cell.w !== null && cell.w !== '') return String(cell.w);
    // Fallback for dates
    if (cell.t === 'd') return new Date(cell.v).toLocaleDateString('es-AR');
    // Fallback for numbers
    if (cell.t === 'n') {
      const n = cell.v;
      if (n === null || n === undefined) return '';
      return Number.isInteger(n) ? n.toLocaleString('es-AR') : n.toFixed(2);
    }
    return cell.v !== null && cell.v !== undefined ? String(cell.v) : '';
  }

  // Estilo de celda desde el objeto s de SheetJS
  function estiloCell(s) {
    if (!s) return '';
    const parts = [];
    if (s.fgColor?.rgb) {
      const c = s.fgColor.rgb;
      if (c !== '000000' && c !== 'FFFFFF' && c !== 'ffffff') {
        parts.push(`background:#${c}`);
      }
    }
    if (s.font?.color?.rgb) {
      const c = s.font.color.rgb;
      parts.push(`color:#${c}`);
    }
    if (s.font?.bold)   parts.push('font-weight:bold');
    if (s.font?.italic) parts.push('font-style:italic');
    if (s.alignment?.horizontal === 'right')  parts.push('text-align:right');
    if (s.alignment?.horizontal === 'center') parts.push('text-align:center');
    return parts.join(';');
  }

  function anchoCol(idx) {
    const col = wsData?.cols?.[idx];
    if (col?.wch) return Math.max(col.wch * 7, 60) + 'px';
    return 'auto';
  }

  // Filas filtradas por búsqueda
  $: filasFiltradas = wsData
    ? (busqueda.trim()
        ? wsData.rows.filter(f => f.some(c => String(c.valor).toLowerCase().includes(busqueda.toLowerCase())))
        : wsData.rows)
    : [];

  // ── Cargar archivo ─────────────────────────────────
  async function cargarVisor(url) {
    workbook = null; wsData = null; hojaActiva = 0; errorVisor = null; busqueda = '';
    if (!url) return;
    cargandoVisor = true;
    try {
      const res = await fetch(BASEURL + url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      workbook = XLSX.read(buf, {
        type: 'array',
        cellStyles: true,    // ← leer estilos (colores, negrita, etc.)
        cellDates: true,
        cellNF: true,
        cellFormula: false,
        sheetStubs: true,
      });
    } catch(e) {
      errorVisor = 'No se pudo leer el archivo: ' + e.message;
    } finally {
      cargandoVisor = false;
    }
  }

  // ── Proveedores CRUD ───────────────────────────────
  onMount(cargar);

  async function cargar() {
    cargando = true;
    try { proveedores = await proveedoresApi.listar(); }
    finally { cargando = false; }
  }

  async function seleccionar(p) {
    seleccionado = await proveedoresApi.obtener(p.id);
    cargarVisor(seleccionado.lista_precios_url);
  }

  async function subirArchivo(e) {
    const file = e.target.files?.[0];
    if (!file || !seleccionado) return;
    subiendoLista = true;
    try {
      await proveedoresApi.subirLista(seleccionado.id, file);
      toasts.ok('Lista actualizada ✓');
      seleccionado = await proveedoresApi.obtener(seleccionado.id);
      cargarVisor(seleccionado.lista_precios_url);
      await cargar();
      e.target.value = '';
    } catch(err) { toasts.error(err.message); }
    finally { subiendoLista = false; }
  }

  const provVacio = () => ({ id:null, nombre:'', contacto:'', email:'', telefono:'', notas:'' });

  async function guardar() {
    if (!modalProveedor.nombre?.trim()) return;
    guardando = true;
    try {
      if (modalProveedor.id) {
        const act = await proveedoresApi.actualizar(modalProveedor.id, modalProveedor);
        if (seleccionado?.id === modalProveedor.id) seleccionado = act;
        toasts.ok('Actualizado ✓');
      } else {
        await proveedoresApi.crear(modalProveedor);
        toasts.ok('Proveedor creado ✓');
      }
      modalProveedor = null; cargar();
    } catch(e) { toasts.error(e.message); }
    finally { guardando = false; }
  }

  async function eliminar(p) {
    const ok = await showConfirm({
      title: 'Eliminar proveedor',
      message: `¿Eliminar "${p.nombre}"?`,
      confirmLabel: 'Eliminar', danger: true, icon: '🗑️'
    });
    if (!ok) return;
    await proveedoresApi.eliminar(p.id);
    toasts.ok('Eliminado');
    if (seleccionado?.id === p.id) { seleccionado = null; workbook = null; }
    cargar();
  }
</script>

<div class="prov-shell">

  <!-- ── Sidebar ── -->
  <aside class="prov-aside">
    <div class="aside-header">
      <h1 class="page-title" style="font-size:1.1rem;margin:0">Proveedores</h1>
      <button class="btn btn-primary btn-sm" on:click={() => modalProveedor = provVacio()}>+ Nuevo</button>
    </div>

    {#if cargando}
      <p class="text-muted2" style="padding:1rem;font-size:13px">Cargando...</p>
    {:else if proveedores.length === 0}
      <div class="aside-empty">
        <p style="font-size:1.5rem;margin-bottom:0.4rem">🏭</p>
        <p style="font-weight:700;font-size:13.5px">Sin proveedores</p>
        <p style="font-size:12px;color:var(--text2);margin-top:0.2rem">Creá el primero</p>
      </div>
    {:else}
      <div class="prov-list">
        {#each proveedores as p}
          <button class="prov-item" class:activo={seleccionado?.id === p.id} on:click={() => seleccionar(p)}>
            <div class="prov-avatar">{p.nombre.charAt(0).toUpperCase()}</div>
            <div class="prov-info">
              <div class="prov-nombre">{p.nombre}</div>
              {#if p.contacto}<div class="prov-sub">{p.contacto}</div>{/if}
              <div class="prov-badge {p.lista_precios_url ? 'con-lista' : 'sin-lista'}">
                {p.lista_precios_url ? '📄 Lista cargada' : 'Sin lista'}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </aside>

  <!-- ── Panel derecho ── -->
  <main class="prov-main">
    {#if !seleccionado}
      <div class="main-empty">
        <div style="font-size:3rem;margin-bottom:0.75rem">🏭</div>
        <h2 style="font-size:1.1rem;font-weight:700;color:var(--text)">Seleccioná un proveedor</h2>
        <p style="font-size:13.5px;color:var(--text2);margin-top:0.3rem">
          Hacé click en uno de la lista para ver su información y lista de precios.
        </p>
      </div>

    {:else}
      <!-- Header -->
      <div class="card prov-header">
        <div style="display:flex;align-items:flex-start;gap:1rem;flex:1">
          <div class="prov-avatar-lg">{seleccionado.nombre.charAt(0).toUpperCase()}</div>
          <div style="flex:1">
            <h2 style="font-size:1.1rem;font-weight:800;margin-bottom:0.3rem">{seleccionado.nombre}</h2>
            <div class="prov-meta">
              {#if seleccionado.contacto}<span>👤 {seleccionado.contacto}</span>{/if}
              {#if seleccionado.email}<a href="mailto:{seleccionado.email}" class="prov-meta-link">✉️ {seleccionado.email}</a>{/if}
              {#if seleccionado.telefono}<a href="tel:{seleccionado.telefono}" class="prov-meta-link">📞 {seleccionado.telefono}</a>{/if}
            </div>
            {#if seleccionado.notas}
              <p class="text-muted2" style="font-size:12.5px;margin-top:0.4rem">{seleccionado.notas}</p>
            {/if}
          </div>
        </div>
        <div style="display:flex;gap:0.4rem;flex-shrink:0">
          <button class="btn btn-ghost btn-sm" on:click={() => modalProveedor = {...seleccionado}}>✏️ Editar</button>
          <button class="btn btn-danger btn-sm" on:click={() => eliminar(seleccionado)}>🗑️</button>
        </div>
      </div>

      <!-- Barra lista de precios -->
      <div class="card lista-bar">
        <div>
          {#if seleccionado.lista_precios_url}
            <div style="font-weight:700;font-size:13.5px">📄 {seleccionado.lista_precios_nombre}</div>
            {#if seleccionado.lista_precios_fecha}
              <div class="text-muted2" style="font-size:12px">
                Actualizada el {new Date(seleccionado.lista_precios_fecha).toLocaleDateString('es-AR',{day:'numeric',month:'long',year:'numeric'})}
              </div>
            {/if}
          {:else}
            <div style="font-weight:600;color:var(--text2);font-size:13.5px">Sin lista de precios</div>
            <div class="text-muted2" style="font-size:12px">Subí un Excel o CSV</div>
          {/if}
        </div>
        <div style="display:flex;gap:0.5rem;align-items:center;flex-shrink:0">
          {#if seleccionado.lista_precios_url}
            <a href="{BASEURL}{seleccionado.lista_precios_url}" target="_blank" class="btn btn-ghost btn-sm">⬇️ Descargar</a>
          {/if}
          <label class="btn {seleccionado.lista_precios_url ? 'btn-ghost' : 'btn-primary'} btn-sm" style="cursor:pointer">
            {subiendoLista ? '⏳ Subiendo…' : seleccionado.lista_precios_url ? '🔄 Actualizar lista' : '📁 Subir lista'}
            <input type="file" accept=".xlsx,.xls,.csv,.tsv,.ods" style="display:none"
              on:change={subirArchivo} disabled={subiendoLista} />
          </label>
        </div>
      </div>

      <!-- Visor -->
      <div class="visor-wrap card">
        {#if cargandoVisor}
          <div class="visor-centro">
            <div class="spin">⟳</div>
            <p style="font-weight:600;margin-top:0.5rem">Leyendo archivo…</p>
          </div>

        {:else if errorVisor}
          <div class="visor-centro">
            <p style="font-size:1.5rem;margin-bottom:0.5rem">⚠️</p>
            <p style="font-weight:600">No se pudo leer el archivo</p>
            <p class="text-muted2" style="font-size:12.5px;margin-top:0.25rem">{errorVisor}</p>
          </div>

        {:else if workbook}
          <!-- Tabs de hojas -->
          {#if workbook.SheetNames.length > 1}
            <div class="hojas-tabs">
              {#each workbook.SheetNames as nombre, i}
                <button class="hoja-tab" class:activa={hojaActiva === i}
                  on:click={() => { hojaActiva = i; busqueda = ''; }}>
                  📋 {nombre}
                </button>
              {/each}
            </div>
          {:else}
            <div class="hoja-unica-bar">
              <span style="font-size:12px;font-weight:700;color:var(--text2)">📋 {workbook.SheetNames[0]}</span>
            </div>
          {/if}

          <!-- Toolbar búsqueda -->
          <div class="visor-toolbar">
            <div style="position:relative;flex:1;max-width:340px">
              <svg style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);color:var(--text3)"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input class="input input-search" style="padding-left:2.25rem"
                placeholder="Buscar en la lista…" bind:value={busqueda} />
            </div>
            <span class="text-muted2" style="font-size:12px;white-space:nowrap">
              {filasFiltradas.length} fila{filasFiltradas.length !== 1 ? 's' : ''}
              {#if workbook.SheetNames.length > 1} · hoja {hojaActiva + 1}/{workbook.SheetNames.length}{/if}
            </span>
          </div>

          <!-- Tabla con estilos -->
          <div class="visor-tabla-wrap">
            {#if !wsData || wsData.rows.length === 0}
              <div class="visor-centro" style="padding:2rem">
                <p class="text-muted2">La hoja está vacía</p>
              </div>
            {:else}
              <table class="visor-tabla">
                <colgroup>
                  {#each {length: wsData.nCols} as _, i}
                    <col style="min-width:{anchoCol(i)}" />
                  {/each}
                </colgroup>
                <thead>
                  <tr>
                    {#each wsData.rows[0] as cell}
                      <th
                        colspan={cell.colspan}
                        rowspan={cell.rowspan}
                        style={estiloCell(cell.estilo)}
                      >{cell.valor}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each filasFiltradas.slice(busqueda ? 0 : 1, busqueda ? undefined : 2001) as fila}
                    <tr>
                      {#each fila as cell}
                        <td
                          colspan={cell.colspan}
                          rowspan={cell.rowspan}
                          style={estiloCell(cell.estilo)}
                          class:celda-num={cell.tipo === 'n'}
                          class:celda-vacia={cell.valor === ''}
                        >{cell.valor}</td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
              {#if !busqueda && wsData.rows.length > 2001}
                <div class="visor-mas">
                  Mostrando 2000 de {wsData.rows.length - 1} filas
                </div>
              {/if}
            {/if}
          </div>

        {:else if seleccionado.lista_precios_url}
          <div class="visor-centro">
            <div class="spin">⟳</div>
          </div>

        {:else}
          <div class="visor-centro visor-placeholder">
            <div style="font-size:3rem;margin-bottom:0.75rem">📊</div>
            <p style="font-weight:700;font-size:15px">Sin lista de precios</p>
            <p class="text-muted2" style="font-size:13px;margin-top:0.3rem;max-width:320px;text-align:center">
              Subí un archivo Excel o CSV para verlo acá.
            </p>
          </div>
        {/if}
      </div>
    {/if}
  </main>
</div>

<!-- Modal crear/editar -->
{#if modalProveedor}
  <div class="overlay" on:click|self={() => modalProveedor = null}>
    <div class="modal" style="max-width:500px">
      <h2 class="modal-title">{modalProveedor.id ? 'Editar proveedor' : 'Nuevo proveedor'}</h2>
      <div class="form-grid">
        <div class="field field-full">
          <label>Nombre *</label>
          <input class="input" bind:value={modalProveedor.nombre} placeholder="Nombre del proveedor" autofocus />
        </div>
        <div class="field">
          <label>Persona de contacto</label>
          <input class="input" bind:value={modalProveedor.contacto} placeholder="Ej: Juan García" />
        </div>
        <div class="field">
          <label>Email</label>
          <input class="input" type="email" bind:value={modalProveedor.email} placeholder="proveedor@empresa.com" />
        </div>
        <div class="field">
          <label>Teléfono</label>
          <input class="input" bind:value={modalProveedor.telefono} placeholder="+54 9 11 …" />
        </div>
        <div class="field field-full">
          <label>Notas</label>
          <textarea class="input" bind:value={modalProveedor.notas} rows="2" placeholder="Condiciones, días de entrega, etc."></textarea>
        </div>
      </div>
      <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.25rem">
        <button class="btn btn-ghost" on:click={() => modalProveedor = null}>Cancelar</button>
        <button class="btn btn-primary" on:click={guardar} disabled={guardando || !modalProveedor.nombre?.trim()}>
          {guardando ? 'Guardando…' : modalProveedor.id ? 'Guardar' : 'Crear proveedor'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .prov-shell {
    display: grid; grid-template-columns: 268px 1fr;
    gap: 1.25rem; flex: 1; min-height: 0; overflow: hidden;
  }

  /* Aside */
  .prov-aside {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: var(--radius);
    display: flex; flex-direction: column; overflow: hidden; min-height: 0;
  }
  .aside-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.85rem 1rem; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .aside-empty { padding: 2.5rem 1rem; text-align: center; color: var(--text2); }
  .prov-list   { overflow-y: auto; flex: 1; }

  .prov-item {
    width: 100%; display: flex; align-items: flex-start; gap: 0.7rem;
    padding: 0.8rem 1rem;
    background: none; border: none; border-bottom: 1px solid var(--bg3);
    cursor: pointer; font-family: var(--font); text-align: left; transition: background 0.12s;
  }
  .prov-item:last-child { border-bottom: none; }
  .prov-item:hover  { background: var(--primary-bg); }
  .prov-item.activo { background: var(--primary-bg); border-right: 3px solid var(--primary); }
  .prov-avatar {
    width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
    background: var(--gradient-pr); color: white;
    font-weight: 800; font-size: 14px;
    display: flex; align-items: center; justify-content: center;
  }
  .prov-info   { flex: 1; min-width: 0; }
  .prov-nombre { font-weight: 700; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prov-sub    { font-size: 12px; color: var(--text2); margin-top: 1px; }
  .prov-badge  { font-size: 11px; margin-top: 3px; font-weight: 600; }
  .prov-badge.con-lista { color: var(--primary); }
  .prov-badge.sin-lista { color: var(--text3); }

  /* Main */
  .prov-main { display: flex; flex-direction: column; gap: 1rem; overflow: hidden; min-height: 0; }
  .main-empty {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
  }

  .prov-header  { display: flex; align-items: flex-start; gap: 1rem; flex-shrink: 0; }
  .prov-avatar-lg {
    width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
    background: var(--gradient-pr); color: white;
    font-weight: 800; font-size: 1.25rem;
    display: flex; align-items: center; justify-content: center;
    box-shadow: var(--shadow-md);
  }
  .prov-meta      { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; font-size: 13px; color: var(--text2); }
  .prov-meta-link { color: var(--primary); text-decoration: none; font-size: 13px; }
  .prov-meta-link:hover { text-decoration: underline; }

  .lista-bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; flex-wrap: wrap; flex-shrink: 0; padding: 0.85rem 1.25rem;
  }

  /* Visor */
  .visor-wrap {
    flex: 1; min-height: 0; padding: 0; overflow: hidden;
    display: flex; flex-direction: column;
  }
  .visor-centro {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    text-align: center; padding: 2.5rem; color: var(--text2);
  }
  .visor-placeholder { background: var(--bg3); }
  .spin { font-size: 2rem; animation: spin 0.8s linear infinite; color: var(--primary); }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Tabs de hojas */
  .hojas-tabs {
    display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0;
    overflow-x: auto;
  }
  .hoja-unica-bar {
    padding: 0.5rem 1rem; border-bottom: 1px solid var(--border);
    background: var(--bg3); flex-shrink: 0;
  }
  .hoja-tab {
    padding: 0.55rem 1.1rem; border: none; background: none; cursor: pointer;
    font-family: var(--font); font-size: 13px; font-weight: 600;
    color: var(--text2); border-bottom: 2px solid transparent;
    transition: all 0.12s; white-space: nowrap;
  }
  .hoja-tab.activa { color: var(--primary); border-bottom-color: var(--primary); background: var(--primary-bg); }
  .hoja-tab:hover:not(.activa) { background: var(--bg3); }

  .visor-toolbar {
    display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.6rem 1rem; border-bottom: 1px solid var(--border);
    background: var(--bg3); flex-shrink: 0;
  }

  /* Tabla visor — preserva estilos de Excel */
  .visor-tabla-wrap { overflow: auto; flex: 1; min-height: 0; }
  .visor-tabla {
    border-collapse: collapse;
    width: max-content; min-width: 100%;
    font-size: 12.5px; font-family: Calibri, Arial, sans-serif;
  }
  .visor-tabla thead th {
    position: sticky; top: 0; z-index: 2;
    padding: 4px 8px; border: 1px solid #c8c8c8;
    font-size: 12px; background: #f2f2f2;
    white-space: nowrap; min-width: 60px;
  }
  .visor-tabla tbody td {
    padding: 3px 8px; border: 1px solid #e0e0e0;
    white-space: nowrap; max-width: 300px;
    overflow: hidden; text-overflow: ellipsis;
  }
  .visor-tabla tbody td.celda-num { text-align: right; }
  .visor-tabla tbody td.celda-vacia { color: #bbb; }
  .visor-tabla tbody tr:hover td { filter: brightness(0.95); }

  .visor-mas {
    padding: 0.6rem 1rem; text-align: center;
    font-size: 12px; color: var(--text2);
    background: var(--bg3); border-top: 1px solid var(--border);
  }
</style>
