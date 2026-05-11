<script>
  import { onMount } from 'svelte';
  import { alquileresApi, whatsappApi } from '$lib/api';

  async function enviarWA(alquiler, tipo) {
    try {
      const r = await whatsappApi.enviar(alquiler.id, tipo);
      if (r.ok) toasts.ok('✅ WhatsApp enviado');
      else toasts.error('Error WA: ' + r.error);
    } catch(e) { toasts.error(e.message); }
  }
  import { toasts, notif, formatPeso, refreshNotifications , showConfirm } from '$lib/stores';

  let vista = 'contratos'; // contratos | catalogo | calendario
  let contratos = [], catalogo = [], cargando = true;
  let modalContrato = null, modalProducto = null;
  let detalleId = null, detalle = null, guardando = false;
  let editandoEnDetalle = false;

  // Calendario
  let calMes = new Date().getMonth();
  let calAnio = new Date().getFullYear();

  const PERIODOS = [
    { value: 'semana',   label: '1 Semana',  short: '1S',  key: 'precio_semana' },
    { value: '2semanas', label: '2 Semanas', short: '2S',  key: 'precio_2semanas' },
    { value: '3semanas', label: '3 Semanas', short: '3S',  key: 'precio_3semanas' },
    { value: 'mes',      label: '1 Mes',     short: '1M',  key: 'precio_mes' },
  ];

  const ESTADO = {
    activo:   { clase: 'badge-blue',   label: 'Activo' },
    devuelto: { clase: 'badge-green',  label: 'Devuelto' },
    vencido:  { clase: 'badge-red',    label: 'Vencido' },
  };

  function hoy() { return new Date().toISOString().split('T')[0]; }

  onMount(cargar);

  async function cargar() {
    cargando = true;
    try {
      [contratos, catalogo] = await Promise.all([alquileresApi.listar(), alquileresApi.catalogo()]);
    } finally { cargando = false; }
  }

  // ── Calendario ────────────────────────────────────
  const DIAS_SEMANA = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  $: calDias = generarCalendario(calAnio, calMes);
  $: eventosCalendario = construirEventos(contratos, calAnio, calMes);

  function generarCalendario(anio, mes) {
    const primerDia = new Date(anio, mes, 1);
    const ultimoDia = new Date(anio, mes + 1, 0);
    // Ajuste: lunes = 0
    let primerDiaSem = primerDia.getDay() - 1;
    if (primerDiaSem < 0) primerDiaSem = 6;

    const dias = [];
    for (let i = 0; i < primerDiaSem; i++) dias.push(null);
    for (let d = 1; d <= ultimoDia.getDate(); d++) dias.push(d);
    return dias;
  }

  function construirEventos(contratos, anio, mes) {
    const map = {};
    const primerDelMes = new Date(anio, mes, 1);
    const ultimoDelMes = new Date(anio, mes + 1, 0, 23, 59);

    function push(fecha, contrato, tipo) {
      if (fecha < primerDelMes || fecha > ultimoDelMes) return;
      const key = fecha.getDate();
      if (!map[key]) map[key] = [];
      if (map[key].some(e => e.contrato.id === contrato.id && e.tipo === tipo)) return;
      map[key].push({ contrato, tipo, vencido: contrato.vencido, devuelto: contrato.estado === 'devuelto' });
    }

    contratos.forEach(c => {
      const inicio = new Date(c.fecha_inicio    + 'T12:00:00');
      const fin    = new Date(c.fecha_devolucion + 'T12:00:00');

      // Para contratos devueltos: solo mostrar la devolución, no el inicio
      if (c.estado !== 'devuelto') {
        push(inicio, c, 'inicio');
      }

      if      (c.estado === 'devuelto') push(fin, c, 'devuelto');
      else if (c.vencido)               push(fin, c, 'vencido');
      else                              push(fin, c, 'fin');
    });
    return map;
  }

  function prevMes() {
    if (calMes === 0) { calMes = 11; calAnio--; } else calMes--;
  }
  function nextMes() {
    if (calMes === 11) { calMes = 0; calAnio++; } else calMes++;
  }

  function diaHoy(d) {
    const n = new Date();
    return d === n.getDate() && calMes === n.getMonth() && calAnio === n.getFullYear();
  }

  // ── Contrato lógica ───────────────────────────────
  const contratoVacio = () => {
    const inicio = hoy();
    const d = new Date(inicio + 'T12:00:00');
    d.setDate(d.getDate() + 7); // default: 1 semana
    const devolucion = d.toISOString().split('T')[0];
    return {
      id: null, numero_alquiler: '', cliente_nombre:'', cliente_telefono:'',
      cliente_direccion:'', cliente_dni:'',
      fecha_inicio: inicio, fecha_devolucion: devolucion,
      periodo_tipo:'semana', precio_total:0, notas:'', items:[]
    };
  };

  // ── Filtros contratos ─────────────────────────────
  let filtros = {
    numero: '',
    estado: '',
    periodo_tipo: '',
    producto_id: '',
    fecha_inicio_desde: '',
    fecha_inicio_hasta: '',
    fecha_dev_desde: '',
    fecha_dev_hasta: '',
  };
  let filtrosAbiertos = false;

  function limpiarFiltros() {
    filtros = { numero:'', estado:'', periodo_tipo:'', producto_id:'', fecha_inicio_desde:'', fecha_inicio_hasta:'', fecha_dev_desde:'', fecha_dev_hasta:'' };
    cargar();
  }

  $: filtrosActivos = Object.values(filtros).some(v => v !== '');

  async function aplicarFiltros() {
    cargando = true;
    try {
      const params = {};
      if (filtros.numero)            params.numero            = filtros.numero;
      if (filtros.estado)            params.estado            = filtros.estado;
      if (filtros.periodo_tipo)      params.periodo_tipo      = filtros.periodo_tipo;
      if (filtros.producto_id)       params.producto_id       = filtros.producto_id;
      if (filtros.fecha_inicio_desde) params.fecha_inicio_desde = filtros.fecha_inicio_desde;
      if (filtros.fecha_inicio_hasta) params.fecha_inicio_hasta = filtros.fecha_inicio_hasta;
      if (filtros.fecha_dev_desde)    params.fecha_dev_desde    = filtros.fecha_dev_desde;
      if (filtros.fecha_dev_hasta)    params.fecha_dev_hasta    = filtros.fecha_dev_hasta;
      contratos = await alquileresApi.listar(params);
    } finally { cargando = false; }
  }

  function agregarItem(prod) {
    if (modalContrato.items.find(i => i.producto_alquiler_id === prod.id)) return;
    const periodo = PERIODOS.find(p => p.value === modalContrato.periodo_tipo);
    modalContrato.items = [...modalContrato.items, {
      producto_alquiler_id: prod.id, nombre: prod.nombre,
      periodo_tipo: modalContrato.periodo_tipo,
      precio_acordado: prod[periodo?.key] || 0, _prod: prod
    }];
    recalcular();
  }

  function quitarItem(idx) {
    modalContrato.items = modalContrato.items.filter((_,i) => i !== idx);
    recalcular();
  }

  function recalcular() {
    modalContrato.precio_total = modalContrato.items.reduce((s,i) => s + (i.precio_acordado||0), 0);
  }

  function onCambioPeriodo() {
    const periodo = PERIODOS.find(p => p.value === modalContrato.periodo_tipo);
    modalContrato.items = modalContrato.items.map(item => ({
      ...item, periodo_tipo: modalContrato.periodo_tipo,
      precio_acordado: item._prod?.[periodo?.key] ?? item.precio_acordado
    }));
    recalcular();
    sugerirFechaDevolucion();
  }

  function sugerirFechaDevolucion() {
    const d = new Date(modalContrato.fecha_inicio);
    if (isNaN(d)) return;
    const dias = { semana:7, '2semanas':14, '3semanas':21, mes:30 };
    d.setDate(d.getDate() + (dias[modalContrato.periodo_tipo]||7));
    modalContrato.fecha_devolucion = d.toISOString().split('T')[0];
  }

  async function guardarContrato() {
    if (!modalContrato.cliente_nombre) return;
    if (!modalContrato.fecha_inicio || !modalContrato.fecha_devolucion) {
      toasts.error('Las fechas son obligatorias'); return;
    }
    guardando = true;
    try {
      const data = {
        numero_alquiler:   modalContrato.numero_alquiler   || null,
        cliente_nombre:    modalContrato.cliente_nombre,
        cliente_telefono:  modalContrato.cliente_telefono  || null,
        cliente_direccion: modalContrato.cliente_direccion || null,
        cliente_dni:       modalContrato.cliente_dni       || null,
        fecha_inicio:      modalContrato.fecha_inicio,
        fecha_devolucion:  modalContrato.fecha_devolucion,
        periodo_tipo:      modalContrato.periodo_tipo,
        precio_total:      modalContrato.precio_total || 0,
        notas:             modalContrato.notas || null,
        items:             modalContrato.items.map(i => ({
          producto_alquiler_id: i.producto_alquiler_id,
          nombre:               i.nombre,
          periodo_tipo:         i.periodo_tipo,
          precio_acordado:      i.precio_acordado || 0,
        })),
      };
      if (modalContrato.id) {
        await alquileresApi.actualizar(modalContrato.id, data);
        toasts.ok('Contrato actualizado ✓');
      } else {
        const nuevo = await alquileresApi.crear(data);
        toasts.ok('Contrato creado ✓');
        // WhatsApp se envía automáticamente desde el backend
      }
      modalContrato = null;
      cargar();
    } catch(e) { toasts.error(e.message); }
    finally { guardando = false; }
  }

  async function verDetalle(id) {
    detalleId = id;
    editandoEnDetalle = false;
    detalle = await alquileresApi.detalle(id);
  }

  async function devolver(id) {
    const ok = await showConfirm({ title: 'Marcar como devuelto', message: '¿Confirmar la devolución de este alquiler?', confirmLabel: 'Confirmar', cancelLabel: 'Cancelar', icon: '✓' }); if (!ok) return;
    await alquileresApi.devolver(id);
    toasts.ok('Marcado como devuelto ✓');
    cargar();
    if (detalleId === id) { detalle = await alquileresApi.detalle(id); }
  }

  async function eliminarContrato(id) {
    const ok = await showConfirm({ title: 'Eliminar contrato', message: '¿Eliminar este contrato de alquiler? Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', danger: true, icon: '🗑️' }); if (!ok) return;
    await alquileresApi.eliminar(id);
    toasts.ok('Eliminado');
    if (detalleId === id) { detalleId = null; detalle = null; }
    cargar();
  }

  // ── Catálogo lógica ───────────────────────────────
  const prodVacio = () => ({ id:null, nombre:'', descripcion:'', precio_semana:0, precio_2semanas:0, precio_3semanas:0, precio_mes:0 });

  async function guardarProducto() {
    if (!modalProducto.nombre) return;
    guardando = true;
    try {
      modalProducto.id
        ? await alquileresApi.editarProducto(modalProducto.id, modalProducto)
        : await alquileresApi.crearProducto(modalProducto);
      notif.agregar(modalProducto.id ? 'Actualizado ✓' : 'Creado ✓', 'ok');
      modalProducto = null; cargar();
    } catch(e) { toasts.error(e.message); }
    finally { guardando = false; }
  }

  async function eliminarProducto(id) {
    const ok = await showConfirm({ title: 'Eliminar', message: '¿Eliminar este elemento? Esta acción no se puede deshacer.', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', danger: true, icon: '🗑️' }); if (!ok) return;
    await alquileresApi.eliminarProducto(id);
    toasts.ok('Eliminado'); cargar();
  }

  $: activos   = contratos.filter(c => c.estado==='activo' && !c.vencido).length;
  $: vencidos  = contratos.filter(c => c.vencido).length;
  $: devueltos = contratos.filter(c => c.estado==='devuelto').length;
</script>

<div style="height:100%;display:flex;flex-direction:column;">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.25rem">
    <div>
      <h1 class="page-title">Alquileres</h1>
      <p class="page-sub">{contratos.length} contratos totales</p>
    </div>
    <div style="display:flex;gap:0.5rem">
      <button class="btn btn-ghost" on:click={() => modalProducto = prodVacio()}>+ Producto</button>
      <button class="btn btn-primary" on:click={() => modalContrato = contratoVacio()}>+ Nuevo alquiler</button>
    </div>
  </div>

  <!-- KPIs -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.25rem">
    {#each [[activos,'Activos','var(--primary)'],[vencidos,'Vencidos','var(--red)'],[devueltos,'Devueltos','var(--green)'],[catalogo.length,'En catálogo','var(--text)']] as [v,l,c]}
      <div class="card" style="display:flex;flex-direction:column;gap:0.15rem">
        <p style="font-size:12px;font-weight:700;color:var(--text2)">{l}</p>
        <p class="mono" style="font-size:1.6rem;font-weight:800;color:{c}">{v}</p>
      </div>
    {/each}
  </div>

  <!-- Tabs -->
  <div class="tabs-bar">
    {#each [['contratos','Contratos'],['calendario','Calendario'],['catalogo','Catálogo de productos']] as [t,l]}
      <button class="tab-btn {vista===t?'active':''}" on:click={() => { vista=t; detalleId=null; detalle=null; }}>{l}</button>
    {/each}
  </div>

  <!-- ══════════════════════════════════════ -->
  <!-- CONTRATOS -->
  <!-- ══════════════════════════════════════ -->
  {#if vista === 'contratos'}
    <!-- Filtros -->
    <div class="filtros-bar card">
      <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;flex:1">
        <input class="input" placeholder="Nº alquiler o ID…" bind:value={filtros.numero} on:input={aplicarFiltros} style="width:160px" />

        <select class="input" bind:value={filtros.estado} on:change={aplicarFiltros} style="width:150px">
          <option value="">Todos los estados</option>
          <option value="activo">Activos</option>
          <option value="devuelto">Devueltos</option>
        </select>

        <select class="input" bind:value={filtros.periodo_tipo} on:change={aplicarFiltros} style="width:140px">
          <option value="">Todos los períodos</option>
          {#each PERIODOS as p}<option value={p.value}>{p.label}</option>{/each}
        </select>

        <select class="input" bind:value={filtros.producto_id} on:change={aplicarFiltros} style="width:170px">
          <option value="">Todos los productos</option>
          {#each catalogo as p}<option value={p.id}>{p.nombre}</option>{/each}
        </select>

        <button class="btn btn-ghost" style="white-space:nowrap" on:click={() => filtrosAbiertos = !filtrosAbiertos}>
          📅 Fechas {filtrosAbiertos ? '▲' : '▼'}
        </button>

        {#if filtrosActivos}
          <button class="btn btn-danger" style="white-space:nowrap" on:click={limpiarFiltros}>✕ Limpiar</button>
        {/if}
      </div>
    </div>

    {#if filtrosAbiertos}
      <div class="card filtros-fechas">
        <div class="filtros-grupo">
          <span class="filtros-grupo-lbl">Fecha inicio:</span>
          <input class="input" type="date" bind:value={filtros.fecha_inicio_desde} on:change={aplicarFiltros} style="width:150px" />
          <span class="text-muted2">–</span>
          <input class="input" type="date" bind:value={filtros.fecha_inicio_hasta} on:change={aplicarFiltros} style="width:150px" />
        </div>
        <div class="filtros-grupo">
          <span class="filtros-grupo-lbl">Devolución:</span>
          <input class="input" type="date" bind:value={filtros.fecha_dev_desde} on:change={aplicarFiltros} style="width:150px" />
          <span class="text-muted2">–</span>
          <input class="input" type="date" bind:value={filtros.fecha_dev_hasta} on:change={aplicarFiltros} style="width:150px" />
        </div>
      </div>
    {/if}

    <div class="split-view">
      <div class="card" style="padding:0;overflow:hidden;flex:1">
        {#if cargando}
          <p style="padding:2rem;color:var(--text2)">Cargando...</p>
        {:else if contratos.length === 0}
          <p style="padding:2rem;color:var(--text2)">No hay contratos aún.</p>
        {:else}
          <div style="overflow-x:auto">
            <table>
              <thead><tr>
                <th>Nº</th><th>Cliente</th><th>Productos</th><th>Período</th>
                <th>Inicio</th><th>Devolución</th><th style="text-align:right">Total</th>
                <th>Estado</th><th></th>
              </tr></thead>
              <tbody>
                {#each contratos as c}
                  {@const ek = c.vencido ? 'vencido' : c.estado}
                  {@const ec = ESTADO[ek] ?? ESTADO.activo}
                  <tr class:sel={detalleId===c.id} on:click={() => verDetalle(c.id)} style="cursor:pointer">
                    <td>
                      <div class="mono" style="font-weight:700;font-size:13px">{c.numero_alquiler || `#${c.id}`}</div>
                    </td>
                    <td>
                      <div style="font-weight:700">{c.cliente_nombre}</div>
                      {#if c.cliente_dni}<div class="mono text-muted2" style="font-size:11px">DNI {c.cliente_dni}</div>{/if}
                    </td>
                    <td class="text-muted2" style="font-size:12.5px;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                      {c.productos_nombres || '—'}
                    </td>
                    <td>
                      <span class="badge badge-gray" title={PERIODOS.find(p=>p.value===c.periodo_tipo)?.label ?? c.periodo_tipo} style="cursor:default">
                        {PERIODOS.find(p=>p.value===c.periodo_tipo)?.short ?? c.periodo_tipo}
                      </span>
                    </td>
                    <td style="font-size:13px">{new Date(c.fecha_inicio+'T12:00:00').toLocaleDateString('es-AR')}</td>
                    <td>
                      <div style="font-size:13px">{new Date(c.fecha_devolucion+'T12:00:00').toLocaleDateString('es-AR')}</div>
                      {#if c.estado==='activo'}
                        <div class="text-muted2" style="font-size:11px">
                          {c.dias_restantes > 0 ? `${c.dias_restantes}d restantes` : c.dias_restantes === 0 ? 'Vence hoy' : `${Math.abs(c.dias_restantes)}d vencido`}
                        </div>
                      {/if}
                    </td>
                    <td class="mono" style="text-align:right;font-weight:700;color:var(--green)">{formatPeso(c.precio_total)}</td>
                    <td><span class="badge {ec.clase}">{ec.label}</span></td>
                    <td on:click|stopPropagation>
                      <div style="display:flex;gap:0.3rem;justify-content:flex-end">
                        {#if c.estado==='activo'}
                          <button class="btn btn-success btn-sm" title="Marcar como devuelto" on:click={() => devolver(c.id)}>✓</button>
                        {/if}
                        {#if c.cliente_telefono && c.estado === 'activo'}
                          <button
                            class="btn btn-sm"
                            style="background:#25D366;color:white;font-size:12px;padding:0.25rem 0.45rem"
                            title="Enviar WhatsApp"
                            on:click={() => enviarWA(c, c.vencido ? 'vencido' : 'por_vencer')}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.121.553 4.112 1.52 5.843L.058 23.9c-.073.268.028.556.263.705A.75.75 0 0 0 1 24.5L6.7 22.98A11.96 11.96 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.713 9.713 0 0 1-4.964-1.363l-.356-.21-3.688.966.986-3.586-.232-.37A9.751 9.751 0 1 1 12 21.75z"/>
                            </svg>
                          </button>
                        {/if}
                        <button class="btn btn-danger btn-sm" title="Eliminar contrato" on:click={() => eliminarContrato(c.id)}>✕</button>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <!-- Panel detalle -->
      {#if detalle}
        <div class="card detalle-panel">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.85rem">
            <div>
              <div class="mono text-muted2" style="font-size:11px">CONTRATO #{detalle.id}</div>
              <h2 style="font-size:1rem;font-weight:800;margin-top:0.1rem">{detalle.cliente_nombre}</h2>
            </div>
            <div style="display:flex;gap:0.3rem">
              <button class="btn btn-ghost btn-sm" on:click={() => { modalContrato = {...detalle, items: detalle.items?.map(i=>({...i,_prod:null}))??[]}; }}>✏️</button>
              {#if detalle.cliente_telefono && detalle.estado === 'activo'}
                <button
                  class="btn btn-sm"
                  style="background:#25D366;color:white;font-size:12px"
                  title={detalle.vencido ? 'Avisar vencimiento por WhatsApp' : 'Enviar recordatorio por WhatsApp'}
                  on:click={() => enviarWA(detalle, detalle.vencido ? 'vencido' : 'por_vencer')}
                >
                  📱 WA
                </button>
              {/if}
              <button class="btn btn-ghost btn-sm" on:click={() => { detalleId=null; detalle=null; }}>✕</button>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:0.4rem;margin-bottom:0.85rem">
            {#each [['Teléfono', detalle.cliente_telefono],['DNI', detalle.cliente_dni],['Dirección', detalle.cliente_direccion],['Inicio', detalle.fecha_inicio],['Devolución', detalle.fecha_devolucion]] as [l,v]}
              {#if v}
                <div style="display:flex;justify-content:space-between;font-size:13px">
                  <span class="text-muted2">{l}</span>
                  <span style="font-weight:600">{v}</span>
                </div>
              {/if}
            {/each}
          </div>

          <div class="divider"></div>
          <p style="font-size:11px;font-weight:800;color:var(--text3);margin-bottom:0.5rem">PRODUCTOS</p>
          {#each (detalle.items ?? []) as item}
            <div style="display:flex;justify-content:space-between;font-size:13px;padding:0.35rem 0.5rem;background:var(--bg3);border-radius:6px;margin-bottom:0.3rem">
              <span>{item.nombre_snapshot}</span>
              <span class="mono text-green">{formatPeso(item.precio_acordado)}</span>
            </div>
          {/each}
          <div class="divider"></div>
          <div style="display:flex;justify-content:space-between;font-weight:700">
            <span>Total</span>
            <span class="mono text-green">{formatPeso(detalle.precio_total)}</span>
          </div>
          {#if detalle.estado==='activo'}
            <button class="btn btn-success" style="width:100%;justify-content:center;margin-top:0.85rem" on:click={() => devolver(detalle.id)}>
              ✓ Marcar como devuelto
            </button>
          {/if}
        </div>
      {/if}
    </div>

  <!-- ══════════════════════════════════════ -->
  <!-- CALENDARIO -->
  <!-- ══════════════════════════════════════ -->
  {:else if vista === 'calendario'}
    <div class="card" style="flex:1;overflow:auto">
      <!-- Nav mes -->
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
        <button class="btn btn-ghost btn-sm" on:click={prevMes}>←</button>
        <h2 style="font-size:1rem;font-weight:800;min-width:180px;text-align:center">
          {MESES_ES[calMes]} {calAnio}
        </h2>
        <button class="btn btn-ghost btn-sm" on:click={nextMes}>→</button>
        <button class="btn btn-ghost btn-sm" on:click={() => { calMes = new Date().getMonth(); calAnio = new Date().getFullYear(); }}>Hoy</button>
      </div>

      <div style="display:flex;gap:0.85rem;margin-bottom:1rem;flex-wrap:wrap">
        {#each [['▶','ev-activo','Inicio'],['⏹','ev-fin','Devolución'],['⚠','ev-vencido','Vencido'],['✓','ev-devuelto','Devuelto']] as [icon,cls,label]}
          <div style="display:flex;align-items:center;gap:0.35rem;font-size:12px;font-weight:600;color:var(--text2)">
            <span class="cal-evento {cls}" style="padding:1px 6px;font-size:11px;pointer-events:none">{icon} {label}</span>
          </div>
        {/each}
      </div>

      <!-- Grid días semana -->
      <div class="cal-grid">
        {#each DIAS_SEMANA as dia}
          <div class="cal-header">{dia}</div>
        {/each}

        {#each calDias as d}
          <div class="cal-cell {d === null ? 'empty' : ''} {d && diaHoy(d) ? 'hoy' : ''}">
            {#if d !== null}
              <div class="cal-num">{d}</div>
              {#if eventosCalendario[d]}
                <div class="cal-eventos">
                  {#each eventosCalendario[d].slice(0,3) as ev}
                    {@const [icon, cls] = ev.tipo === 'inicio'   ? ['▶','ev-activo']   :
                                         ev.tipo === 'fin'      ? ['⏹','ev-fin']     :
                                         ev.tipo === 'vencido'  ? ['⚠','ev-vencido'] :
                                                                   ['✓','ev-devuelto']}
                    <div
                      class="cal-evento {cls}"
                      title="{ev.contrato.cliente_nombre} — {ev.tipo}"
                      on:click={() => verDetalle(ev.contrato.id)}
                    >
                      <span class="cal-ev-icon">{icon}</span>
                      <span class="cal-ev-nombre">{ev.contrato.cliente_nombre}</span>
                    </div>
                  {/each}
                  {#if eventosCalendario[d].length > 3}
                    <div class="cal-mas">+{eventosCalendario[d].length - 3}</div>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    </div>

  <!-- ══════════════════════════════════════ -->
  <!-- CATÁLOGO -->
  <!-- ══════════════════════════════════════ -->
  {:else}
    <div class="card" style="padding:0;overflow:hidden;flex:1">
      {#if catalogo.length === 0}
        <p style="padding:2rem;color:var(--text2)">No hay productos. Creá el primero con "+ Producto".</p>
      {:else}
        <table>
          <thead><tr>
            <th>Nombre</th><th>Descripción</th>
            <th style="text-align:right">1 Semana</th>
            <th style="text-align:right">2 Semanas</th>
            <th style="text-align:right">3 Semanas</th>
            <th style="text-align:right">Mes</th>
            <th></th>
          </tr></thead>
          <tbody>
            {#each catalogo as p}
              <tr>
                <td style="font-weight:700">{p.nombre}</td>
                <td class="text-muted2">{p.descripcion ?? '—'}</td>
                <td class="mono text-green" style="text-align:right">{formatPeso(p.precio_semana)}</td>
                <td class="mono" style="text-align:right">{formatPeso(p.precio_2semanas)}</td>
                <td class="mono" style="text-align:right">{formatPeso(p.precio_3semanas)}</td>
                <td class="mono" style="text-align:right">{formatPeso(p.precio_mes)}</td>
                <td style="text-align:right">
                  <div style="display:flex;gap:0.3rem;justify-content:flex-end">
                    <button class="btn btn-ghost btn-sm" on:click={() => modalProducto = {...p}}>Editar</button>
                    <button class="btn btn-danger btn-sm" on:click={() => eliminarProducto(p.id)}>Eliminar</button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<!-- ══════════════════════════════════════════ -->
<!-- MODAL: Contrato -->
<!-- ══════════════════════════════════════════ -->
{#if modalContrato}
  <div class="overlay" on:click|self={() => modalContrato = null}>
    <div class="modal" style="max-width:660px">
      <h2 class="modal-title">{modalContrato.id ? 'Editar contrato' : 'Nuevo alquiler'}</h2>

      <p class="modal-section">CLIENTE</p>
      <div class="form-grid">
        <div class="field">
          <label>Número de alquiler</label>
          <input class="input mono" bind:value={modalContrato.numero_alquiler} placeholder="Ej: ALQ-001 (opcional)" />
        </div>
        <div class="field"></div>
        <div class="field field-full"><label>Nombre *</label><input class="input" bind:value={modalContrato.cliente_nombre} /></div>
        <div class="field"><label>Teléfono</label><input class="input" bind:value={modalContrato.cliente_telefono} /></div>
        <div class="field"><label>DNI</label><input class="input mono" bind:value={modalContrato.cliente_dni} /></div>
        <div class="field field-full"><label>Dirección</label><input class="input" bind:value={modalContrato.cliente_direccion} /></div>
      </div>

      <div class="divider"></div>
      <p class="modal-section">PERÍODO</p>
      <div class="form-grid">
        <div class="field">
          <label>Tipo de período</label>
          <select class="input" bind:value={modalContrato.periodo_tipo} on:change={onCambioPeriodo}>
            {#each PERIODOS as p}<option value={p.value}>{p.label}</option>{/each}
          </select>
        </div>
        <div class="field"></div>
        <div class="field"><label>Fecha inicio</label><input class="input" type="date" bind:value={modalContrato.fecha_inicio} on:change={sugerirFechaDevolucion} /></div>
        <div class="field"><label>Fecha devolución</label><input class="input" type="date" bind:value={modalContrato.fecha_devolucion} /></div>
      </div>

      <div class="divider"></div>
      <p class="modal-section">PRODUCTOS</p>

      {#if catalogo.length > 0}
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.75rem">
          {#each catalogo as prod}
            {@const periodo = PERIODOS.find(p => p.value === modalContrato.periodo_tipo)}
            {@const yaEsta = modalContrato.items.some(i => i.producto_alquiler_id === prod.id)}
            <button
              class="chip-prod {yaEsta ? 'chip-active' : ''}"
              on:click={() => yaEsta ? quitarItem(modalContrato.items.findIndex(i => i.producto_alquiler_id === prod.id)) : agregarItem(prod)}
            >
              {prod.nombre}
              <span class="mono" style="font-size:11px;color:var(--text2)">{formatPeso(prod[periodo?.key||'precio_semana'])}</span>
              {#if yaEsta}<span style="color:var(--green);font-weight:800">✓</span>{/if}
            </button>
          {/each}
        </div>
      {/if}

      {#each modalContrato.items as item, i}
        <div style="display:flex;align-items:center;gap:0.5rem;background:var(--bg3);border-radius:7px;padding:0.5rem 0.75rem;margin-bottom:0.3rem">
          <span style="flex:1;font-size:13px;font-weight:600">{item.nombre}</span>
          <input class="input mono" type="number" bind:value={item.precio_acordado} on:input={recalcular} style="width:100px;text-align:right" />
          <button class="btn btn-danger btn-sm" on:click={() => quitarItem(i)}>✕</button>
        </div>
      {/each}

      <div class="divider"></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:1rem">
        <span style="font-weight:700">Total</span>
        <span class="mono text-green" style="font-size:1.1rem;font-weight:800">{formatPeso(modalContrato.precio_total)}</span>
      </div>

      <div class="field" style="margin-bottom:1rem"><label>Notas</label><textarea class="input" bind:value={modalContrato.notas} rows="2"></textarea></div>

      <div style="display:flex;gap:0.6rem;justify-content:flex-end">
        <button class="btn btn-ghost" on:click={() => modalContrato = null}>Cancelar</button>
        <button class="btn btn-primary" on:click={guardarContrato} disabled={guardando || !modalContrato.cliente_nombre}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL: Producto catálogo -->
{#if modalProducto}
  <div class="overlay" on:click|self={() => modalProducto = null}>
    <div class="modal" style="max-width:480px">
      <h2 class="modal-title">{modalProducto.id ? 'Editar producto' : 'Nuevo producto de alquiler'}</h2>
      <div class="form-grid">
        <div class="field field-full"><label>Nombre *</label><input class="input" bind:value={modalProducto.nombre} /></div>
        <div class="field field-full"><label>Descripción</label><input class="input" bind:value={modalProducto.descripcion} /></div>
      </div>
      <div class="divider"></div>
      <p class="modal-section" style="margin-bottom:0.75rem">PRECIOS POR PERÍODO</p>
      <div class="form-grid">
        {#each PERIODOS as p}
          <div class="field"><label>{p.label} $</label><input class="input mono" type="number" bind:value={modalProducto[p.key]} /></div>
        {/each}
      </div>
      <div style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.25rem">
        <button class="btn btn-ghost" on:click={() => modalProducto = null}>Cancelar</button>
        <button class="btn btn-primary" on:click={guardarProducto} disabled={guardando || !modalProducto.nombre}>
          {guardando ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Filtros */
  .filtros-bar {
    padding: 0.75rem 1rem;
    display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .filtros-fechas {
    padding: 0.75rem 1rem;
    display: flex; gap: 1.5rem; align-items: center; flex-wrap: wrap;
    margin-bottom: 0.5rem;
    background: var(--bg3);
  }
  .filtros-grupo { display: flex; align-items: center; gap: 0.5rem; }
  .filtros-grupo-lbl { font-size: 12px; font-weight: 700; color: var(--text2); white-space: nowrap; }

  /* Tabs */
  .tabs-bar { display:flex; border-bottom:2px solid var(--border); margin-bottom:1.25rem; gap:0; }
  .tab-btn {
    background:none; border:none; border-bottom:2px solid transparent;
    margin-bottom:-2px; padding:0.6rem 1.1rem;
    font-family:var(--font); font-size:13.5px; font-weight:700;
    color:var(--text2); cursor:pointer; transition:all 0.12s;
  }
  .tab-btn:hover { color:var(--text); }
  .tab-btn.active { color:var(--primary); border-bottom-color:var(--primary); }

  /* Split view */
  .split-view { display:grid; grid-template-columns:1fr 280px; gap:1.25rem; flex:1; }
  tbody tr.sel td { background:var(--primary-bg) !important; }

  /* Detalle panel */
  .detalle-panel { position:sticky; top:0; overflow-y:auto; max-height:70vh; }

  /* Calendario */
  .cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:1px; background:var(--border); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  .cal-header { background:var(--bg3); padding:0.5rem; text-align:center; font-size:11.5px; font-weight:800; color:var(--text2); }
  .cal-cell { background:var(--bg2); padding:0.4rem; min-height:80px; vertical-align:top; }
  .cal-cell.empty { background:var(--bg3); }
  .cal-cell.hoy { background:var(--primary-bg); }
  .cal-num { font-size:12px; font-weight:800; color:var(--text); margin-bottom:0.3rem; }
  .cal-cell.hoy .cal-num { color:var(--primary); }
  .cal-eventos { display:flex; flex-direction:column; gap:2px; }
  .cal-evento {
    font-size:10.5px; font-weight:700; padding:2px 5px;
    border-radius:4px; cursor:pointer;
    display:flex; align-items:center; gap:3px;
    transition:filter 0.1s;
  }
  .cal-evento:hover { filter:brightness(0.88); }
  .cal-ev-icon   { font-size:9px; flex-shrink:0; }
  .cal-ev-nombre { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .ev-activo   { background:var(--primary-bg);  color:var(--primary); border-left:2px solid var(--primary); }
  .ev-fin      { background:#e0f2fe; color:#0369a1; border-left:2px solid #38bdf8; }
  .ev-vencido  { background:var(--red-lt);    color:var(--red);     border-left:2px solid var(--red); }
  .ev-devuelto { background:var(--green-lt);  color:var(--green);   border-left:2px solid var(--green); }
  .cal-mas { font-size:10px; color:var(--text3); font-weight:700; padding:0 3px; }

  /* Chips productos */
  .chip-prod {
    display:flex; align-items:center; gap:0.4rem;
    padding:0.4rem 0.75rem; border-radius:20px;
    background:var(--bg3); border:1.5px solid var(--border);
    font-family:var(--font); font-size:13px; font-weight:600;
    cursor:pointer; transition:all 0.12s; color:var(--text);
  }
  .chip-prod:hover { border-color:var(--primary); background:var(--primary-bg); }
  .chip-prod.chip-active { border-color:var(--primary); background:var(--primary-bg); color:var(--primary); }
</style>
