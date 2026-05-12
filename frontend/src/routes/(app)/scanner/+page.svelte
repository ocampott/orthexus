<script>
  import { onMount, onDestroy } from 'svelte';
  import { productosApi, variantesApi, marcasApi } from '$lib/api';
  import { toasts, formatPeso, refreshNotifications } from '$lib/stores';

  // ── Modos de operación ────────────────────────────
  let modo = 'buscar'; // buscar | stock

  // ── Marcas y categorías ───────────────────────────
  let marcas = [];
  let categorias = [];
  let nuevaMarcaScanner = '';
  let guardandoMarcaScanner = false;
  let mostrarNuevaMarca = false;
  // Categoría inline create para scanner
  let nuevaCatScanner = '';
  let agregandoCatScanner = false;
  function confirmarNuevaCatSimple() {
    const cat = nuevaCatScanner.trim();
    if (!cat) { agregandoCatScanner = false; return; }
    if (!categorias.includes(cat)) categorias = [...categorias, cat];
    if (modalSimple) modalSimple.categoria = cat;
    nuevaCatScanner = ''; agregandoCatScanner = false;
  }
  function confirmarNuevaCatPadre() {
    const cat = nuevaCatScanner.trim();
    if (!cat) { agregandoCatScanner = false; return; }
    if (!categorias.includes(cat)) categorias = [...categorias, cat];
    if (modalVariante) modalVariante.categoria = cat;
    nuevaCatScanner = ''; agregandoCatScanner = false;
  }
  async function crearMarcaScanner() {
    if (!nuevaMarcaScanner.trim()) return;
    guardandoMarcaScanner = true;
    try {
      await marcasApi.crear({ nombre: nuevaMarcaScanner.trim() });
      marcas = await marcasApi.listar();
      const nueva = marcas.find(m => m.nombre === nuevaMarcaScanner.trim());
      if (nueva) {
        if (modalSimple) modalSimple.marca_id = nueva.id;
        if (modalVariante) modalVariante.marca_id = nueva.id;
      }
      nuevaMarcaScanner = '';
      mostrarNuevaMarca = false;
    } catch(e) { toasts.error(e.message); }
    finally { guardandoMarcaScanner = false; }
  }

  // ── Scanner buffer ────────────────────────────────
  let buffer = '', bufferTimer = null, procesando = false;
  let codigoManual = '';
  let flashOk = false, flashErr = false;
  let cantidad = 1;

  // ── Historial ─────────────────────────────────────
  let historial = [];

  // ── Modales ───────────────────────────────────────
  // 1. Producto encontrado (simple o variante)
  let modalEncontrado = null;
  let editando = false;
  let guardando = false;

  // 2. Decisión: ¿simple o variante?
  let modalDecision = null;  // { codigo }

  // 3a. Nuevo producto simple
  let modalSimple = null;

  // 3b. Flujo variante
  let modalVariante = null;  // { codigo, paso: 'buscar_padre' | 'crear_padre' | 'crear_variante' }
  let busquedaPadre = '';
  let resultadosPadre = [];
  let padreSeleccionado = null;
  let guardandoPadre = false;

  // ── Scanner handlers ──────────────────────────────
  function onKeyDown(e) {
    const hayModal = modalEncontrado || modalDecision || modalSimple || modalVariante;
    if (hayModal) return;
    if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Enter') {
      if (buffer.length >= 3) escanear(buffer);
      buffer = ''; clearTimeout(bufferTimer); return;
    }
    if (e.key.length > 1) return;
    buffer += e.key;
    clearTimeout(bufferTimer);
    bufferTimer = setTimeout(() => buffer = '', 280);
  }

  onMount(async () => {
    try {
      [marcas, categorias] = await Promise.all([marcasApi.listar(), productosApi.categorias()]);
    } catch { /* silencioso */ }
  });
  onDestroy(() => {});

  function flash(ok) {
    if (ok) { flashOk = true; setTimeout(() => flashOk = false, 700); }
    else    { flashErr = true; setTimeout(() => flashErr = false, 700); }
  }

  function registrar(codigo, nombre, ok) {
    historial = [{ codigo, nombre, ok, ts: new Date() }, ...historial].slice(0, 10);
  }

  // ── Escanear ──────────────────────────────────────
  async function escanear(codigo) {
    if (procesando || !codigo?.trim()) return;
    const cod = codigo.trim();
    procesando = true;
    codigoManual = '';
    try {
      const p = await productosApi.porBarcode(cod);
      // Encontrado
      if (modo === 'stock') {
        if (p._esVariante) {
          await variantesApi.ajustarStock(p.producto_id, p.id, cantidad, 'add');
        } else {
          await productosApi.ajustarStock(p.id, cantidad, 'add');
        }
        toasts.ok(`+${cantidad} stock: ${p.nombre}`);
        flash(true);
        registrar(cod, p.nombre, true);
        await refreshNotifications();
      } else {
        modalEncontrado = { ...p };
        editando = false;
        flash(true);
        registrar(cod, p.nombre, true);
      }
    } catch {
      // No encontrado → modal de decisión
      flash(false);
      registrar(cod, null, false);
      modalDecision = { codigo: cod };
    } finally {
      procesando = false;
    }
  }

  // ── Modal: producto encontrado ────────────────────
  async function guardarEdicion() {
    guardando = true;
    try {
      if (modalEncontrado._esVariante) {
        await variantesApi.editar(modalEncontrado.producto_id, modalEncontrado.id, {
          precio_costo:    parseFloat(modalEncontrado.precio_costo)    || 0,
          margen_ganancia: modalEncontrado.margen_ganancia === '' ? null : parseFloat(modalEncontrado.margen_ganancia),
          stock_actual:    parseInt(modalEncontrado.stock_actual)  || 0,
          stock_minimo:    parseInt(modalEncontrado.stock_minimo)  || 0,
        });
      } else {
        await productosApi.actualizar(modalEncontrado.id, {
          precio_costo:    parseFloat(modalEncontrado.precio_costo)    || 0,
          margen_ganancia: modalEncontrado.margen_ganancia === '' ? null : parseFloat(modalEncontrado.margen_ganancia),
          stock_actual:    parseInt(modalEncontrado.stock_actual)  || 0,
          stock_minimo:    parseInt(modalEncontrado.stock_minimo)  || 0,
        });
      }
      toasts.ok('Actualizado ✓');
      editando = false;
      await refreshNotifications();
      if (!modalEncontrado._esVariante) {
        modalEncontrado = await productosApi.porId(modalEncontrado.id);
      }
    } catch(e) { toasts.error(e.message); }
    finally { guardando = false; }
  }

  // ── Flujo nuevo simple ────────────────────────────
  function elegirSimple() {
    modalSimple = {
      nombre: '', codigo_barras: modalDecision.codigo, categoria: 'General',
      marca_id: '', descripcion: '', tiene_variantes: false,
      precio_costo: '', margen_ganancia: '', stock_actual: '', stock_minimo: ''
    };
    agregandoCatScanner = false; nuevaCatScanner = '';
    mostrarNuevaMarca = false; nuevaMarcaScanner = '';
    modalDecision = null;
  }

  async function crearSimple() {
    if (!modalSimple.nombre?.trim()) return;
    guardando = true;
    try {
      const tieneVar = !!modalSimple.tiene_variantes;
      await productosApi.crear({
        ...modalSimple,
        precio_costo:    tieneVar ? 0 : (parseFloat(String(modalSimple.precio_costo).replace(',','.'))    || 0),
        margen_ganancia: tieneVar ? null : (modalSimple.margen_ganancia === '' ? null : parseFloat(String(modalSimple.margen_ganancia).replace(',','.'))),
        stock_actual:    tieneVar ? 0 : (parseInt(modalSimple.stock_actual)  || 0),
        stock_minimo:    tieneVar ? 0 : (parseInt(modalSimple.stock_minimo)  || 0),
        tiene_variantes: tieneVar ? 1 : 0,
      });
      toasts.ok('Producto creado ✓');
      await refreshNotifications();
      modalSimple = null;
    } catch(e) { toasts.error(e.message); }
    finally { guardando = false; }
  }

  // ── Flujo variante ────────────────────────────────
  let timerPadre;
  function elegirVariante() {
    modalVariante = { codigo: modalDecision.codigo, paso: 'buscar_padre' };
    busquedaPadre = '';
    resultadosPadre = [];
    padreSeleccionado = null;
    modalDecision = null;
  }

  async function buscarPadre() {
    clearTimeout(timerPadre);
    if (busquedaPadre.trim().length < 2) { resultadosPadre = []; return; }
    timerPadre = setTimeout(async () => {
      resultadosPadre = await productosApi.listar({ q: busquedaPadre });
    }, 220);
  }

  function seleccionarPadre(p) {
    padreSeleccionado = p;
    // Si el padre no tiene variantes activadas, avisamos pero igual procedemos
    modalVariante = {
      ...modalVariante,
      paso: 'crear_variante',
      nombre_variante: '',
      sku: '',
      precio_costo: '',
      margen_ganancia: '',
      stock_actual: '',
      stock_minimo: '',
    };
  }

  function irCrearPadre() {
    modalVariante = {
      ...modalVariante,
      paso: 'crear_padre',
      nombre_padre: '', categoria: 'General', marca_id: '',
      precio_costo_padre: '', margen_ganancia_padre: '',
    };
    agregandoCatScanner = false; nuevaCatScanner = '';
    mostrarNuevaMarca = false; nuevaMarcaScanner = '';
  }

  async function crearPadre() {
    if (!modalVariante.nombre_padre?.trim()) return;
    guardandoPadre = true;
    try {
      padreSeleccionado = await productosApi.crear({
        nombre:          modalVariante.nombre_padre.trim(),
        categoria:       modalVariante.categoria || 'General',
        marca_id:        modalVariante.marca_id || null,
        tiene_variantes: 1,
        precio_costo:    0,
        margen_ganancia: null,
        stock_actual:    0, stock_minimo: 0,
      });
      toasts.ok(`"${padreSeleccionado.nombre}" creado ✓`);
      modalVariante = { ...modalVariante, paso: 'crear_variante', nombre_variante: '', sku: '', precio_costo: '', margen_ganancia: '', stock_actual: '', stock_minimo: '' };
    } catch(e) { toasts.error(e.message); }
    finally { guardandoPadre = false; }
  }

  async function crearVariante() {
    if (!modalVariante.nombre_variante?.trim() || !padreSeleccionado) return;
    guardando = true;
    try {
      // Si el padre no tiene variantes, activarlo
      if (!padreSeleccionado.tiene_variantes) {
        await productosApi.actualizar(padreSeleccionado.id, { tiene_variantes: 1 });
      }
      await variantesApi.crear(padreSeleccionado.id, {
        nombre:          modalVariante.nombre_variante.trim(),
        codigo_barras:   modalVariante.codigo,
        sku:             modalVariante.sku || null,
        precio_costo:    parseFloat(String(modalVariante.precio_costo||'').replace(',','.')) || null,
        margen_ganancia: modalVariante.margen_ganancia === '' ? null : parseFloat(String(modalVariante.margen_ganancia||'').replace(',','.')),
        stock_actual:    parseInt(modalVariante.stock_actual) || 0,
        stock_minimo:    parseInt(modalVariante.stock_minimo) || 0,
      });
      toasts.ok(`Variante "${modalVariante.nombre_variante}" creada en "${padreSeleccionado.nombre}" ✓`);
      await refreshNotifications();
      modalVariante = null;
      padreSeleccionado = null;
    } catch(e) { toasts.error(e.message); }
    finally { guardando = false; }
  }

  // Cálculo preview precios
  function calcPrev(costo, margen) {
    const c = parseFloat(String(costo||'').replace(',','.')) || 0;
    const m = parseFloat(String(margen||'').replace(',','.')) || 0;
    return { conIva: Math.round(c*1.21*100)/100, venta: Math.round(c*1.21*(1+m/100)*100)/100 };
  }
  $: prevSimple   = calcPrev(modalSimple?.precio_costo,    modalSimple?.margen_ganancia);
  $: prevVariante = calcPrev(modalVariante?.precio_costo,  modalVariante?.margen_ganancia);
  $: prevPadre    = calcPrev(modalVariante?.precio_costo_padre, modalVariante?.margen_ganancia_padre);
  $: prevEncontrado = calcPrev(modalEncontrado?.precio_costo, modalEncontrado?.margen_ganancia);
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="scanner-shell">

  <!-- ── Col izquierda ── -->
  <div class="col-left">
    <h1 class="page-title" style="margin-bottom:0.2rem">Scanner</h1>
    <p class="page-sub" style="margin-bottom:1.5rem">Lector USB de código de barras</p>

    <!-- Modo -->
    <div class="card" style="margin-bottom:1rem">
      <p class="sec-lbl" style="margin-bottom:0.65rem">MODO</p>
      <div style="display:flex;gap:0.5rem">
        {#each [['buscar','🔍 Consultar'],['stock','➕ Agregar stock']] as [m,l]}
          <button class="btn {modo===m?'btn-primary':'btn-ghost'}" on:click={() => modo=m}>{l}</button>
        {/each}
      </div>
      {#if modo === 'stock'}
        <div class="stock-cant-box">
          <div style="flex:1">
            <p style="font-size:13px;font-weight:700;margin-bottom:0.25rem">Cantidad a agregar</p>
            <p style="font-size:12px;color:var(--text2)">Ingresá cuántas unidades querés sumar antes de escanear</p>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <button class="cant-btn" on:click={() => cantidad = Math.max(1, cantidad - 1)}>−</button>
            <input class="input mono cant-input" type="text" inputmode="numeric"
              bind:value={cantidad}
              on:change={() => { cantidad = parseInt(cantidad) || 1; }} />
            <button class="cant-btn" on:click={() => cantidad = cantidad + 1}>+</button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Zona de scan -->
    <div class="scan-zone card {flashOk?'flash-ok':''} {flashErr?'flash-err':''} {procesando?'scanning':''}">
      <div class="scan-icon-wrap">
        {#if procesando}
          <div class="spin-icon">⟳</div>
        {:else if flashOk}
          <div class="ok-icon">✓</div>
        {:else if flashErr}
          <div class="err-icon">✗</div>
        {:else}
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
            <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
            <line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/>
            <line x1="13" y1="8" x2="13" y2="11"/><line x1="13" y1="13" x2="13" y2="16"/>
            <line x1="16" y1="8" x2="16" y2="16"/>
          </svg>
        {/if}
      </div>
      <p class="scan-title">
        {procesando?'Procesando…':flashOk?'Encontrado':flashErr?'No registrado':'Listo para escanear'}
      </p>
      <p class="scan-sub">Apuntá el lector o ingresá el código:</p>
      <div style="display:flex;gap:0.5rem;width:100%;max-width:360px">
        <input class="input" placeholder="Código de barras…"
          bind:value={codigoManual}
          on:keydown={e => e.key==='Enter' && escanear(codigoManual)} />
        <button class="btn btn-ghost" on:click={() => escanear(codigoManual)} disabled={procesando}>Buscar</button>
      </div>
    </div>

    <!-- Instrucciones -->
    <div class="card instrucciones">
      <p class="sec-lbl" style="margin-bottom:0.65rem">FLUJO AL ESCANEAR</p>
      {#each [
        ['Producto registrado','Muestra ficha con precio y stock. Podés editar.'],
        ['No registrado','Pregunta si es producto simple o variante de otro.'],
        ['Simple nuevo','Completás los datos y se crea.'],
        ['Variante nueva','Buscás el producto padre, elegís el talle y se asigna el código.'],
        ['Padre no existe','Podés crear el padre ahí mismo y seguir con la variante.'],
      ] as [t, d]}
        <div class="instr-row">
          <div class="instr-num">→</div>
          <div><strong>{t}:</strong> {d}</div>
        </div>
      {/each}
    </div>
  </div>

  <!-- ── Col derecha: historial ── -->
  <div class="col-right">
    <div class="card" style="height:100%">
      <p class="sec-lbl" style="margin-bottom:0.85rem">ÚLTIMOS SCANS</p>
      {#if historial.length === 0}
        <div style="text-align:center;padding:2rem 0;color:var(--text3)">
          <p style="font-size:1.5rem;margin-bottom:0.5rem">📋</p>
          <p style="font-size:13px">Los scans aparecerán acá</p>
        </div>
      {:else}
        <div style="display:flex;flex-direction:column;gap:0.4rem">
          {#each historial as h}
            <div class="hist-row" class:hist-err={!h.ok}>
              <div class="hist-status {h.ok?'hs-ok':'hs-err'}">{h.ok?'✓':'✗'}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  {h.nombre ?? 'No encontrado'}
                </div>
                <div class="mono" style="font-size:11px;color:var(--text3)">{h.codigo}</div>
              </div>
              <div style="font-size:11px;color:var(--text3);flex-shrink:0">
                {h.ts.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════ -->
<!-- MODAL 1: Producto encontrado                      -->
<!-- ══════════════════════════════════════════════════ -->
{#if modalEncontrado}
  <div class="overlay" on:click|self={() => { modalEncontrado=null; editando=false; }}>
    <div class="modal" style="max-width:500px">
      {#if !editando}
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.1rem">
          <div>
            <div class="badge {modalEncontrado._esVariante?'badge-primary':'badge-gray'}" style="margin-bottom:0.4rem">
              {modalEncontrado._esVariante ? '↳ Variante' : '📦 Producto'}
            </div>
            <h2 style="font-size:1.1rem;font-weight:800">{modalEncontrado.nombre}</h2>
            {#if modalEncontrado.marca_nombre}
              <p class="text-muted2" style="font-size:12.5px">{modalEncontrado.marca_nombre}</p>
            {/if}
          </div>
          <button class="btn btn-ghost btn-sm" on:click={() => { modalEncontrado=null; editando=false; }}>✕</button>
        </div>

        <!-- Precios -->
        <div class="prev-row">
          <div class="prev-box"><div class="prev-lbl">Costo</div><div class="prev-val mono">{formatPeso(modalEncontrado.precio_costo)}</div></div>
          <div class="prev-arrow">→</div>
          <div class="prev-box"><div class="prev-lbl">+ IVA</div><div class="prev-val mono">{formatPeso(modalEncontrado.precio_con_iva)}</div></div>
          <div class="prev-arrow">→</div>
          <div class="prev-box highlight"><div class="prev-lbl">Venta</div><div class="prev-val mono text-green">{formatPeso(modalEncontrado.precio_venta)}</div></div>
        </div>

        <!-- Stock -->
        <div style="display:flex;align-items:center;gap:0.75rem;margin:0.85rem 0;padding:0.7rem 1rem;background:var(--bg3);border-radius:calc(var(--radius)-2px);border:1px solid var(--border)">
          <span style="font-size:13px;font-weight:700;color:var(--text2)">Stock</span>
          <span class="badge {modalEncontrado.stock_actual <= modalEncontrado.stock_minimo && modalEncontrado.stock_minimo > 0 ? 'badge-red':'badge-green'}" style="font-size:13px;padding:3px 12px">
            {modalEncontrado.stock_actual} {modalEncontrado.unidad ?? 'u.'}
          </span>
          {#if modalEncontrado.stock_actual <= modalEncontrado.stock_minimo && modalEncontrado.stock_minimo > 0}
            <span style="font-size:12px;color:var(--red)">⚠ Stock bajo</span>
          {/if}
        </div>

        <div style="display:flex;gap:0.6rem;margin-top:1rem">
          <button class="btn btn-primary" style="flex:1;justify-content:center" on:click={() => editando=true}>✏️ Editar</button>
          <button class="btn btn-ghost" on:click={() => { modalEncontrado=null; editando=false; }}>Cerrar</button>
        </div>

      {:else}
        <!-- Formulario edición -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.1rem">
          <h2 style="font-size:1rem;font-weight:800">Editar: {modalEncontrado.nombre}</h2>
          <button class="btn btn-ghost btn-sm" on:click={() => editando=false}>← Volver</button>
        </div>
        <div class="form-grid">
          <div class="field"><label>Costo $</label>
            <input class="input mono" type="text" inputmode="decimal" value={modalEncontrado.precio_costo||''}
              on:input={e => modalEncontrado.precio_costo = parseFloat(e.target.value.replace(',','.'))||0} />
          </div>
          <div class="field"><label>Margen %</label>
            <input class="input mono" type="text" inputmode="decimal" placeholder="Global"
              value={modalEncontrado.margen_ganancia??''}
              on:input={e => { const v=e.target.value.replace(',','.'); modalEncontrado.margen_ganancia=v===''?null:parseFloat(v)||0; }} />
          </div>
          {#if !modalEncontrado._esVariante}
            <div class="field"><label>Stock actual</label>
              <input class="input" type="text" inputmode="numeric" value={modalEncontrado.stock_actual||''}
                on:input={e => modalEncontrado.stock_actual=parseInt(e.target.value)||0} />
            </div>
            <div class="field"><label>Stock mínimo</label>
              <input class="input" type="text" inputmode="numeric" value={modalEncontrado.stock_minimo||''}
                on:input={e => modalEncontrado.stock_minimo=parseInt(e.target.value)||0} />
            </div>
          {:else}
            <div class="field"><label>Stock variante</label>
              <input class="input" type="text" inputmode="numeric" value={modalEncontrado.stock_actual||''}
                on:input={e => modalEncontrado.stock_actual=parseInt(e.target.value)||0} />
            </div>
            <div class="field"><label>Stock mínimo</label>
              <input class="input" type="text" inputmode="numeric" value={modalEncontrado.stock_minimo||''}
                on:input={e => modalEncontrado.stock_minimo=parseInt(e.target.value)||0} />
            </div>
          {/if}
        </div>
        <!-- Preview -->
        <div class="prev-row" style="margin-top:0.85rem">
          <div class="prev-box"><div class="prev-lbl">Costo</div><div class="prev-val mono">{formatPeso(modalEncontrado.precio_costo)}</div></div>
          <div class="prev-arrow">→</div>
          <div class="prev-box"><div class="prev-lbl">+ IVA</div><div class="prev-val mono">{formatPeso(prevEncontrado.conIva)}</div></div>
          <div class="prev-arrow">→</div>
          <div class="prev-box highlight"><div class="prev-lbl">Venta</div><div class="prev-val mono text-green">{formatPeso(prevEncontrado.venta)}</div></div>
        </div>
        <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.1rem">
          <button class="btn btn-ghost" on:click={() => editando=false}>Cancelar</button>
          <button class="btn btn-primary" on:click={guardarEdicion} disabled={guardando}>{guardando?'Guardando…':'Guardar'}</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- ══════════════════════════════════════════════════ -->
<!-- MODAL 2: Decisión — ¿simple o variante?           -->
<!-- ══════════════════════════════════════════════════ -->
{#if modalDecision}
  <div class="overlay" on:click|self={() => modalDecision=null}>
    <div class="modal" style="max-width:440px">
      <div class="badge badge-yellow" style="margin-bottom:0.6rem">⚠ Código no registrado</div>
      <h2 style="font-size:1.1rem;font-weight:800;margin-bottom:0.3rem">¿Qué tipo de producto es?</h2>
      <p class="text-muted2" style="font-size:13px;margin-bottom:1.5rem">
        Código: <span class="mono">{modalDecision.codigo}</span>
      </p>

      <div style="display:flex;flex-direction:column;gap:0.75rem">
        <button class="decision-btn" on:click={elegirSimple}>
          <div class="decision-icon">📦</div>
          <div>
            <div style="font-weight:700;font-size:14.5px">Producto simple</div>
            <div style="font-size:12.5px;color:var(--text2);margin-top:2px">Un solo SKU, sin talles. El stock se maneja en el producto.</div>
          </div>
        </button>

        <button class="decision-btn" on:click={elegirVariante}>
          <div class="decision-icon">📏</div>
          <div>
            <div style="font-weight:700;font-size:14.5px">Variante de un producto</div>
            <div style="font-size:12.5px;color:var(--text2);margin-top:2px">Es un talle o variación de algo que ya existe (o creás el padre ahora).</div>
          </div>
        </button>
      </div>

      <button class="btn btn-ghost" style="width:100%;justify-content:center;margin-top:1rem" on:click={() => modalDecision=null}>
        Cancelar
      </button>
    </div>
  </div>
{/if}

<!-- ══════════════════════════════════════════════════ -->
<!-- MODAL 3a: Crear producto simple                   -->
<!-- ══════════════════════════════════════════════════ -->
{#if modalSimple}
  <div class="overlay" on:click|self={() => modalSimple=null}>
    <div class="modal" style="max-width:520px">
      <h2 class="modal-title">Nuevo producto</h2>
      <p class="text-muted2" style="font-size:12.5px;margin-top:-0.75rem;margin-bottom:1.25rem">
        Código: <span class="mono">{modalSimple.codigo_barras}</span>
      </p>

      <div class="form-grid">
        <div class="field field-full"><label>Nombre *</label>
          <input class="input" bind:value={modalSimple.nombre} placeholder="Nombre del producto" autofocus />
        </div>
        <div class="field">
          <label>Marca</label>
          {#if mostrarNuevaMarca}
            <div style="display:flex;gap:0.4rem">
              <input class="input" bind:value={nuevaMarcaScanner} placeholder="Nueva marca..." autofocus
                on:keydown={e => { if(e.key==='Enter') crearMarcaScanner(); if(e.key==='Escape'){ mostrarNuevaMarca=false; nuevaMarcaScanner=''; } }} />
              <button class="btn btn-primary btn-sm" on:click={crearMarcaScanner} disabled={guardandoMarcaScanner}>OK</button>
              <button class="btn btn-ghost btn-sm" on:click={() => { mostrarNuevaMarca=false; nuevaMarcaScanner=''; }}>✕</button>
            </div>
          {:else}
            <div style="display:flex;gap:0.4rem">
              <select class="input" bind:value={modalSimple.marca_id}>
                <option value="">Sin marca</option>
                {#each marcas as m}<option value={m.id}>{m.nombre}</option>{/each}
              </select>
              <button class="btn btn-ghost btn-sm" style="white-space:nowrap" on:click={() => mostrarNuevaMarca=true}>+ Marca</button>
            </div>
          {/if}
        </div>
        <div class="field">
          <label>Categoría</label>
          {#if agregandoCatScanner}
            <div style="display:flex;gap:0.4rem">
              <input class="input" bind:value={nuevaCatScanner} placeholder="Nueva categoría..."
                on:keydown={e => { if(e.key==='Enter') confirmarNuevaCatSimple(); if(e.key==='Escape'){ agregandoCatScanner=false; nuevaCatScanner=''; } }} />
              <button class="btn btn-primary btn-sm" on:click={confirmarNuevaCatSimple}>OK</button>
              <button class="btn btn-ghost btn-sm" on:click={() => { agregandoCatScanner=false; nuevaCatScanner=''; }}>✕</button>
            </div>
          {:else}
            <div style="display:flex;gap:0.4rem">
              <select class="input" bind:value={modalSimple.categoria}>
                {#each categorias as c}<option value={c}>{c}</option>{/each}
              </select>
              <button class="btn btn-ghost btn-sm" style="white-space:nowrap" on:click={() => agregandoCatScanner=true}>+ Cat.</button>
            </div>
          {/if}
        </div>
      </div>

      <!-- Checkbox tiene variantes -->
      <label class="variantes-check-row-sm" style="margin-top:0.85rem">
        <input type="checkbox" bind:checked={modalSimple.tiene_variantes} />
        <div>
          <span style="font-weight:700;font-size:13.5px">Producto con variantes (talles, colores, etc.)</span>
          <span class="text-muted2" style="font-size:12px;display:block">Precios y stock se definen en cada variante</span>
        </div>
      </label>

      {#if !modalSimple.tiene_variantes}
        <div class="form-grid" style="margin-top:0.85rem">
          <div class="field"><label>Costo $</label>
            <input class="input mono" type="text" inputmode="decimal" placeholder="$ 0" bind:value={modalSimple.precio_costo} />
          </div>
          <div class="field"><label>Margen %</label>
            <input class="input mono" type="text" inputmode="decimal" placeholder="Global" bind:value={modalSimple.margen_ganancia} />
          </div>
        </div>

        <!-- Preview -->
        <div class="prev-row" style="margin:0.75rem 0">
          <div class="prev-box"><div class="prev-lbl">Costo</div><div class="prev-val mono">{formatPeso(parseFloat(String(modalSimple.precio_costo).replace(',','.'))||0)}</div></div>
          <div class="prev-arrow">→</div>
          <div class="prev-box"><div class="prev-lbl">+ IVA</div><div class="prev-val mono">{formatPeso(prevSimple.conIva)}</div></div>
          <div class="prev-arrow">→</div>
          <div class="prev-box highlight"><div class="prev-lbl">Venta</div><div class="prev-val mono text-green">{formatPeso(prevSimple.venta)}</div></div>
        </div>

        <div class="form-grid">
          <div class="field"><label>Stock inicial</label>
            <input class="input" type="text" inputmode="numeric" placeholder="0" bind:value={modalSimple.stock_actual} />
          </div>
          <div class="field"><label>Stock mínimo</label>
            <input class="input" type="text" inputmode="numeric" placeholder="0" bind:value={modalSimple.stock_minimo} />
          </div>
        </div>
      {:else}
        <div class="variantes-info-box">
          📏 Los precios y stock se agregarán en las variantes después de crear el producto.
        </div>
      {/if}

      <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.25rem">
        <button class="btn btn-ghost" on:click={() => modalSimple=null}>Cancelar</button>
        <button class="btn btn-primary" on:click={crearSimple} disabled={guardando||!modalSimple.nombre?.trim()}>
          {guardando?'Creando…':'Crear producto'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ══════════════════════════════════════════════════ -->
<!-- MODAL 3b: Flujo variante (multi-paso)             -->
<!-- ══════════════════════════════════════════════════ -->
{#if modalVariante}
  <div class="overlay" on:click|self={() => { modalVariante=null; padreSeleccionado=null; }}>
    <div class="modal" style="max-width:540px">

      <!-- Paso 1: Buscar padre -->
      {#if modalVariante.paso === 'buscar_padre'}
        <h2 class="modal-title">Buscar producto padre</h2>
        <p class="text-muted2" style="margin-top:-0.75rem;margin-bottom:1.25rem;font-size:12.5px">
          Código de la variante: <span class="mono">{modalVariante.codigo}</span>
        </p>

        <div style="position:relative;margin-bottom:1rem">
          <input class="input" placeholder="Buscá el producto padre (ej: Rodillera tubular)…"
            bind:value={busquedaPadre} on:input={buscarPadre} autofocus />
          {#if resultadosPadre.length > 0}
            <div class="busq-dropdown">
              {#each resultadosPadre as p}
                <button class="busq-item" on:mousedown={() => seleccionarPadre(p)}>
                  <div>
                    <span style="font-weight:600">{p.nombre}</span>
                    {#if p.marca_nombre}<span class="text-muted2" style="font-size:12px"> · {p.marca_nombre}</span>{/if}
                  </div>
                  <div style="display:flex;align-items:center;gap:0.4rem">
                    {#if p.tiene_variantes}<span class="badge badge-primary" style="font-size:11px">con variantes</span>{/if}
                    <span class="mono text-green" style="font-size:12px">{formatPeso(p.precio_venta)}</span>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <div class="divider"></div>
        <p style="font-size:13px;color:var(--text2);margin-bottom:0.75rem">¿El producto padre no existe todavía?</p>
        <button class="btn btn-ghost" on:click={irCrearPadre}>+ Crear producto padre nuevo</button>

        <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.5rem">
          <button class="btn btn-ghost" on:click={() => { modalVariante=null; padreSeleccionado=null; }}>Cancelar</button>
        </div>

      <!-- Paso 2: Crear padre -->
      {:else if modalVariante.paso === 'crear_padre'}
        <h2 class="modal-title">Crear producto padre</h2>
        <p class="text-muted2" style="margin-top:-0.75rem;margin-bottom:1.25rem;font-size:12.5px">
          Se creará con variantes habilitadas. Los precios van en cada variante.
        </p>

        <div class="form-grid">
          <div class="field field-full"><label>Nombre del producto *</label>
            <input class="input" bind:value={modalVariante.nombre_padre} placeholder="Ej: Rodillera tubular" autofocus />
          </div>
          <div class="field">
            <label>Marca</label>
            {#if mostrarNuevaMarca}
              <div style="display:flex;gap:0.4rem">
                <input class="input" bind:value={nuevaMarcaScanner} placeholder="Nueva marca..."
                  on:keydown={e => { if(e.key==='Enter') crearMarcaScanner(); if(e.key==='Escape'){ mostrarNuevaMarca=false; nuevaMarcaScanner=''; } }} />
                <button class="btn btn-primary btn-sm" on:click={crearMarcaScanner} disabled={guardandoMarcaScanner}>OK</button>
                <button class="btn btn-ghost btn-sm" on:click={() => { mostrarNuevaMarca=false; nuevaMarcaScanner=''; }}>✕</button>
              </div>
            {:else}
              <div style="display:flex;gap:0.4rem">
                <select class="input" bind:value={modalVariante.marca_id}>
                  <option value="">Sin marca</option>
                  {#each marcas as m}<option value={m.id}>{m.nombre}</option>{/each}
                </select>
                <button class="btn btn-ghost btn-sm" style="white-space:nowrap" on:click={() => mostrarNuevaMarca=true}>+ Marca</button>
              </div>
            {/if}
          </div>
          <div class="field">
            <label>Categoría</label>
            {#if agregandoCatScanner}
              <div style="display:flex;gap:0.4rem">
                <input class="input" bind:value={nuevaCatScanner} placeholder="Nueva categoría..."
                  on:keydown={e => { if(e.key==='Enter') confirmarNuevaCatPadre(); if(e.key==='Escape'){ agregandoCatScanner=false; nuevaCatScanner=''; } }} />
                <button class="btn btn-primary btn-sm" on:click={confirmarNuevaCatPadre}>OK</button>
                <button class="btn btn-ghost btn-sm" on:click={() => { agregandoCatScanner=false; nuevaCatScanner=''; }}>✕</button>
              </div>
            {:else}
              <div style="display:flex;gap:0.4rem">
                <select class="input" bind:value={modalVariante.categoria}>
                  {#each categorias as c}<option value={c}>{c}</option>{/each}
                </select>
                <button class="btn btn-ghost btn-sm" style="white-space:nowrap" on:click={() => agregandoCatScanner=true}>+ Cat.</button>
              </div>
            {/if}
          </div>
        </div>

        <div class="variantes-info-box" style="margin-top:0.85rem">
          📏 Los precios y stock se agregarán en la variante que vas a crear a continuación (y en las que agregues después).
        </div>

        <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1rem">
          <button class="btn btn-ghost" on:click={() => modalVariante = {...modalVariante, paso:'buscar_padre'}}>← Volver</button>
          <button class="btn btn-primary" on:click={crearPadre} disabled={guardandoPadre||!modalVariante.nombre_padre?.trim()}>
            {guardandoPadre?'Creando…':'Crear y continuar →'}
          </button>
        </div>

      <!-- Paso 3: Crear variante -->
      {:else if modalVariante.paso === 'crear_variante'}
        <h2 class="modal-title">Nueva variante</h2>
        <div style="background:var(--primary-bg);border:1px solid var(--primary-bd);border-radius:calc(var(--radius)-2px);padding:0.65rem 1rem;margin-bottom:1.25rem;font-size:13px">
          <span class="text-muted2">Producto padre:</span>
          <strong> {padreSeleccionado?.nombre}</strong>
        </div>

        <div class="form-grid">
          <div class="field field-full"><label>Talle / Nombre de la variante *</label>
            <input class="input" bind:value={modalVariante.nombre_variante} placeholder="Ej: M / 38-39 / Azul" autofocus />
          </div>
          <div class="field field-full">
            <label>Código de barras asignado</label>
            <input class="input mono" bind:value={modalVariante.codigo} />
          </div>
          <div class="field"><label>Costo propio $ <span class="text-muted2" style="text-transform:none;font-weight:400">(vacío = hereda)</span></label>
            <input class="input mono" type="text" inputmode="decimal" placeholder="Hereda del padre" bind:value={modalVariante.precio_costo} />
          </div>
          <div class="field"><label>Margen % <span class="text-muted2" style="text-transform:none;font-weight:400">(vacío = hereda)</span></label>
            <input class="input mono" type="text" inputmode="decimal" placeholder="Hereda" bind:value={modalVariante.margen_ganancia} />
          </div>
          <div class="field"><label>Stock inicial</label>
            <input class="input" type="text" inputmode="numeric" placeholder="0" bind:value={modalVariante.stock_actual} />
          </div>
          <div class="field"><label>Stock mínimo</label>
            <input class="input" type="text" inputmode="numeric" placeholder="0" bind:value={modalVariante.stock_minimo} />
          </div>
        </div>

        {#if modalVariante.precio_costo !== ''}
          <div class="prev-row" style="margin:0.85rem 0">
            <div class="prev-box"><div class="prev-lbl">Costo</div><div class="prev-val mono">{formatPeso(parseFloat(String(modalVariante.precio_costo||'').replace(',','.'))||0)}</div></div>
            <div class="prev-arrow">→</div>
            <div class="prev-box"><div class="prev-lbl">+IVA</div><div class="prev-val mono">{formatPeso(prevVariante.conIva)}</div></div>
            <div class="prev-arrow">→</div>
            <div class="prev-box highlight"><div class="prev-lbl">Venta</div><div class="prev-val mono text-green">{formatPeso(prevVariante.venta)}</div></div>
          </div>
        {/if}

        <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1rem">
          <button class="btn btn-ghost" on:click={() => { modalVariante={...modalVariante,paso:'buscar_padre'}; padreSeleccionado=null; }}>← Cambiar padre</button>
          <button class="btn btn-primary" on:click={crearVariante} disabled={guardando||!modalVariante.nombre_variante?.trim()}>
            {guardando?'Creando…':'Crear variante ✓'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Stock cantidad box */
  .stock-cant-box {
    display: flex; align-items: center; gap: 1rem; margin-top: 0.85rem;
    padding: 0.75rem 1rem;
    background: var(--primary-bg); border: 1.5px solid var(--primary-bd);
    border-radius: calc(var(--radius) - 2px);
  }
  .cant-btn {
    width: 32px; height: 32px; border-radius: 50%;
    border: 1.5px solid var(--border); background: var(--bg2);
    font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    font-family: var(--font); color: var(--text); transition: all 0.12s;
  }
  .cant-btn:hover { background: var(--primary-bg); border-color: var(--primary); color: var(--primary); }
  .cant-input { width: 72px; text-align: center; font-size: 1.1rem; font-weight: 700; }

  /* Variantes check (compact) */
  .variantes-check-row-sm {
    display: flex; align-items: flex-start; gap: 0.65rem;
    padding: 0.75rem 0.85rem;
    background: var(--primary-bg); border: 1.5px solid var(--primary-bd);
    border-radius: calc(var(--radius) - 2px); cursor: pointer;
  }
  .variantes-check-row-sm input[type="checkbox"] {
    width: 15px; height: 15px; cursor: pointer; flex-shrink: 0;
    margin-top: 2px; accent-color: var(--primary);
  }
  .variantes-info-box {
    padding: 0.75rem 0.9rem;
    background: var(--bg3); border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    font-size: 13px; color: var(--text2);
  }

  .scanner-shell { display:grid; grid-template-columns:1fr 280px; gap:1.5rem; flex:1; min-height:0; overflow:hidden; }
  .col-left  { display:flex; flex-direction:column; gap:1rem; overflow-y:auto; min-height:0; }
  .col-right { overflow-y:auto; min-height:0; }
  .sec-lbl   { font-size:10.5px; font-weight:800; letter-spacing:0.1em; color:var(--text3); }

  /* Zona scan */
  .scan-zone {
    display:flex; flex-direction:column; align-items:center; text-align:center;
    padding:2.25rem 1.75rem; border:2px dashed var(--border);
    background:var(--bg3); box-shadow:none; gap:0.75rem;
    transition:all 0.2s;
  }
  .scan-zone.flash-ok  { background:var(--green-lt); border-color:var(--green); border-style:solid; }
  .scan-zone.flash-err { background:var(--red-lt);   border-color:var(--red);   border-style:solid; }
  .scan-zone.scanning  { border-color:var(--primary); border-style:solid; }
  .scan-icon-wrap {
    width:68px; height:68px; border-radius:14px;
    background:var(--bg2); border:1.5px solid var(--border);
    display:flex; align-items:center; justify-content:center;
    font-size:1.4rem; color:var(--text2); transition:all 0.2s;
  }
  .scan-zone.flash-ok  .scan-icon-wrap { background:var(--green); border-color:var(--green); color:#fff; }
  .scan-zone.flash-err .scan-icon-wrap { background:var(--red);   border-color:var(--red);   color:#fff; }
  .scan-zone.scanning  .scan-icon-wrap { border-color:var(--primary); color:var(--primary); }
  .ok-icon, .err-icon { font-size:1.75rem; font-weight:900; }
  .spin-icon { font-size:1.75rem; animation:spin 0.8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  .scan-title { font-size:1rem; font-weight:700; }
  .scan-sub   { font-size:13px; color:var(--text2); }

  /* Instrucciones */
  .instrucciones { padding:1rem 1.25rem; }
  .instr-row { display:flex; gap:0.6rem; font-size:12.5px; margin-bottom:0.45rem; }
  .instr-num { color:var(--primary); font-weight:800; flex-shrink:0; margin-top:1px; }

  /* Historial */
  .hist-row { display:flex; align-items:center; gap:0.6rem; padding:0.5rem 0.7rem; background:var(--bg3); border-radius:7px; border:1px solid var(--border); }
  .hist-row.hist-err { background:var(--red-lt); border-color:var(--red-bd); }
  .hist-status { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800; flex-shrink:0; }
  .hs-ok  { background:var(--green-lt); color:var(--green); }
  .hs-err { background:var(--red-lt);   color:var(--red); }

  /* Precios preview (compacto) */
  .prev-row { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; align-items:center; gap:0.4rem; background:var(--bg3); border:1px solid var(--border); border-radius:calc(var(--radius)-2px); padding:0.75rem; }
  .prev-box { display:flex; flex-direction:column; gap:0.15rem; text-align:center; padding:0.45rem; background:var(--bg2); border:1px solid var(--border); border-radius:calc(var(--radius)-4px); }
  .prev-box.highlight { background:var(--green-lt); border-color:var(--green-bd); }
  .prev-lbl { font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.07em; color:var(--text3); }
  .prev-val { font-size:0.9rem; font-weight:800; }
  .prev-arrow { font-size:0.85rem; color:var(--text3); font-weight:700; text-align:center; }

  /* Decisión modal */
  .decision-btn {
    display:flex; align-items:center; gap:1rem; padding:1rem 1.1rem;
    background:var(--bg3); border:1.5px solid var(--border); border-radius:var(--radius);
    cursor:pointer; font-family:var(--font); text-align:left; transition:all 0.13s; width:100%;
  }
  .decision-btn:hover { border-color:var(--primary); background:var(--primary-bg); }
  .decision-icon { font-size:1.75rem; width:44px; text-align:center; flex-shrink:0; }

  /* Búsqueda padre dropdown */
  .busq-dropdown { position:absolute; top:calc(100%+4px); left:0; right:0; background:var(--bg2); border:1.5px solid var(--border); border-radius:var(--radius); box-shadow:var(--shadow-md); z-index:50; overflow:hidden; max-height:280px; overflow-y:auto; }
  .busq-item { width:100%; display:flex; justify-content:space-between; align-items:center; gap:1rem; padding:0.65rem 1rem; background:none; border:none; border-bottom:1px solid var(--bg3); cursor:pointer; font-family:var(--font); text-align:left; transition:background 0.1s; color:var(--text); }
  .busq-item:last-child { border-bottom:none; }
  .busq-item:hover { background:var(--primary-bg); }
</style>
