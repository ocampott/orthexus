<script>
  // Cambiá estas líneas al inicio del <script>, junto a los otros imports:
  import "../../app.css";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import {
    toasts,
    notifStore,
    refreshNotifications,
    formatPeso,
  } from "$lib/stores";
  import {
    productosApi,
    configuracionApi,
    uploadsApi,
    authApi,
  } from "$lib/api"; // ← authApi acá
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";

  // ── Nav ────────────────────────────────────────────
  const nav = [
    {
      href: "/",
      label: "Dashboard",
      icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    },
    {
      href: "/ventas",
      label: "Ventas",
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01",
    },
    {
      href: "/productos",
      label: "Productos",
      icon: "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
    },
    {
      href: "/scanner",
      label: "Scanner",
      icon: "M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 4h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z",
    },
    {
      href: "/alquileres",
      label: "Alquileres",
      icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    },
    {
      href: "/proveedores",
      label: "Proveedores",
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
    },
  ];

  $: isActive = (href) =>
    href === "/"
      ? $page.url.pathname === "/"
      : $page.url.pathname.startsWith(href);

  // ── Sidebar collapsed ──────────────────────────────
  let collapsed = false;

  // ── Configuración UI ───────────────────────────────
  let showConfigMenu = false;
  let modalConfigUI = false;
  let guardandoConfig = false;
  let cfg = {
    negocio_nombre: "Orthexus",
    negocio_logo_url: "",
    color_primary: "#0047AB",
    color_bg: "#f4f7fa",
    color_sidebar: "#0a2d5e",
    color_sidebar_text: "#c8daf4",
    color_btn_primary_text: "#ffffff",
    radio_tarjetas: "0.75",
    logo_object_fit: "contain", // contain | cover | fill
  };
  let cfgOriginal = { ...cfg };

  let subiendoLogo = false;

  // ── Image Cropper ──────────────────────────────────
  let showCropper = false;
  let cropperImg = null; // URL original para mostrar en cropper
  let cropperFile = null; // File original
  let cropCanvas = null; // canvas element ref
  let cropImg = null; // img element ref

  // Drag state
  let isDragging = false,
    isResizing = false;
  let dragStart = { x: 0, y: 0 };
  // Crop box: porcentajes (0-1) sobre la imagen
  let crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  let resizeCorner = "";

  function abrirCropper(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    cropperFile = file;
    cropperImg = URL.createObjectURL(file);
    crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    showCropper = true;
    e.target.value = "";
  }

  function getCropPx(imgEl) {
    const {
      naturalWidth: nw,
      naturalHeight: nh,
      offsetWidth: ow,
      offsetHeight: oh,
    } = imgEl;
    const scaleX = nw / ow,
      scaleY = nh / oh;
    return {
      x: Math.round(crop.x * ow * scaleX),
      y: Math.round(crop.y * oh * scaleY),
      w: Math.round(crop.w * ow * scaleX),
      h: Math.round(crop.h * oh * scaleY),
    };
  }

  async function confirmarCrop() {
    if (!cropImg) return;
    subiendoLogo = true;
    showCropper = false;
    try {
      const { x, y, w, h } = getCropPx(cropImg);
      const canvas = document.createElement("canvas");
      const size = Math.min(w, h, 512);
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(cropImg, x, y, w, h, 0, 0, size, size);
      const blob = await new Promise((r) =>
        canvas.toBlob(r, "image/png", 0.92),
      );
      const file = new File([blob], "logo.png", { type: "image/png" });
      const res = await uploadsApi.subir("logo", file);
      // Agregar timestamp para evitar caché del browser
      cfg.negocio_logo_url = `http://localhost:3001${res.url}?v=${Date.now()}`;
    } catch (err) {
      toasts.error(err.message);
    } finally {
      subiendoLogo = false;
      URL.revokeObjectURL(cropperImg);
      cropperImg = null;
    }
  }

  function cancelarCrop() {
    showCropper = false;
    URL.revokeObjectURL(cropperImg);
    cropperImg = null;
  }

  // Mouse events on the crop overlay
  function onCropMouseDown(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    // Check if near a corner (resize) or inside box (drag)
    const corner = getCorner(mx, my);
    if (corner) {
      isResizing = true;
      resizeCorner = corner;
    } else if (
      mx > crop.x &&
      mx < crop.x + crop.w &&
      my > crop.y &&
      my < crop.y + crop.h
    ) {
      isDragging = true;
    }
    dragStart = {
      x: mx,
      y: my,
      cx: crop.x,
      cy: crop.y,
      cw: crop.w,
      ch: crop.h,
    };
    e.preventDefault();
  }

  function getCorner(mx, my) {
    const tol = 0.025;
    const corners = [
      ["tl", crop.x, crop.y],
      ["tr", crop.x + crop.w, crop.y],
      ["bl", crop.x, crop.y + crop.h],
      ["br", crop.x + crop.w, crop.y + crop.h],
    ];
    for (const [name, cx, cy] of corners) {
      if (Math.abs(mx - cx) < tol && Math.abs(my - cy) < tol) return name;
    }
    return null;
  }

  function onCropMouseMove(e) {
    if (!isDragging && !isResizing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const dx = mx - dragStart.x,
      dy = my - dragStart.y;

    if (isDragging) {
      crop.x = Math.max(0, Math.min(1 - crop.w, dragStart.cx + dx));
      crop.y = Math.max(0, Math.min(1 - crop.h, dragStart.cy + dy));
    } else if (isResizing) {
      let { cx: ox, cy: oy, cw: ow, ch: oh } = dragStart;
      if (resizeCorner === "br") {
        crop.w = Math.max(0.05, Math.min(1 - ox, ow + dx));
        crop.h = Math.max(0.05, Math.min(1 - oy, oh + dy));
      } else if (resizeCorner === "tl") {
        const nx = Math.max(0, Math.min(ox + ow - 0.05, ox + dx));
        const ny = Math.max(0, Math.min(oy + oh - 0.05, oy + dy));
        crop.w = ox + ow - nx;
        crop.h = oy + oh - ny;
        crop.x = nx;
        crop.y = ny;
      } else if (resizeCorner === "tr") {
        crop.w = Math.max(0.05, Math.min(1 - ox, ow + dx));
        const ny = Math.max(0, Math.min(oy + oh - 0.05, oy + dy));
        crop.h = oy + oh - ny;
        crop.y = ny;
      } else if (resizeCorner === "bl") {
        const nx = Math.max(0, Math.min(ox + ow - 0.05, ox + dx));
        crop.w = ox + ow - nx;
        crop.x = nx;
        crop.h = Math.max(0.05, Math.min(1 - oy, oh + dy));
      }
    }
    crop = { ...crop }; // trigger reactivity
  }

  function onCropMouseUp() {
    isDragging = false;
    isResizing = false;
  }

  const PALETAS = [
    {
      label: "Orthexus (default)",
      primary: "#0047AB",
      bg: "#f4f7fa",
      sidebar: "#0a2d5e",
      sidebar_text: "#c8daf4",
    },
    {
      label: "Verde sage",
      primary: "#3d7a4a",
      bg: "#f4f7f4",
      sidebar: "#1a3d22",
      sidebar_text: "#c0dfc8",
    },
    {
      label: "Azul índigo",
      primary: "#4338ca",
      bg: "#f5f5ff",
      sidebar: "#1e1b4b",
      sidebar_text: "#c7d2fe",
    },
    {
      label: "Tierra",
      primary: "#92400e",
      bg: "#fdf8f0",
      sidebar: "#1c1008",
      sidebar_text: "#d4b896",
    },
    {
      label: "Rosa",
      primary: "#be185d",
      bg: "#fff0f6",
      sidebar: "#3d0a1e",
      sidebar_text: "#f9c0d8",
    },
    {
      label: "Slate oscuro",
      primary: "#475569",
      bg: "#f8fafc",
      sidebar: "#1e293b",
      sidebar_text: "#cbd5e1",
    },
    {
      label: "Naranja",
      primary: "#c2410c",
      bg: "#fff7ed",
      sidebar: "#431407",
      sidebar_text: "#fed7aa",
    },
    {
      label: "Teal",
      primary: "#0f766e",
      bg: "#f0fdfa",
      sidebar: "#134e4a",
      sidebar_text: "#99f6e4",
    },
    {
      label: "Claro / Blanco",
      primary: "#0047AB",
      bg: "#ffffff",
      sidebar: "#ffffff",
      sidebar_text: "#1e3a5f",
    },
  ];

  function aplicarPaleta(p) {
    cfg.color_primary = p.primary;
    cfg.color_bg = p.bg;
    cfg.color_sidebar = p.sidebar;
    cfg.color_sidebar_text = p.sidebar_text;
    aplicarCSSVars(cfg);
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }
  function lighten(hex, amt = 0.88) {
    const { r, g, b } = hexToRgb(hex);
    return `rgb(${Math.round(r + (255 - r) * amt)},${Math.round(g + (255 - g) * amt)},${Math.round(b + (255 - b) * amt)})`;
  }
  function darken(hex, amt = 0.12) {
    const { r, g, b } = hexToRgb(hex);
    return `rgb(${Math.round(r * (1 - amt))},${Math.round(g * (1 - amt))},${Math.round(b * (1 - amt))})`;
  }

  function aplicarCSSVars(c) {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const p = c.color_primary;
    root.style.setProperty("--primary", p);
    root.style.setProperty("--primary-fg", c.color_btn_primary_text);
    root.style.setProperty("--primary-lt", lighten(p, 0.7));
    root.style.setProperty("--primary-bg", lighten(p, 0.9));
    root.style.setProperty("--primary-bd", lighten(p, 0.6));
    root.style.setProperty(
      "--gradient-pr",
      `linear-gradient(135deg,${p},${darken(p, 0.15)})`,
    );
    root.style.setProperty("--bg", c.color_bg);
    root.style.setProperty("--bg2", "#ffffff");
    root.style.setProperty("--bg3", lighten(darken(c.color_bg, 0.04), 0));
    root.style.setProperty("--gradient-bg", c.color_bg);
    root.style.setProperty("--sidebar", c.color_sidebar);
    root.style.setProperty("--sidebar-text", c.color_sidebar_text);
    root.style.setProperty("--radius", `${c.radio_tarjetas}rem`);
    // Aplicar al body directamente — más confiable que solo la CSS var
    document.body.style.background = c.color_bg;
  }

  async function guardarConfig() {
    guardandoConfig = true;
    try {
      // Strip query params before saving (no guardar el timestamp de caché)
      const logoUrl = (
        cfg.negocio_logo_url?.replace("http://localhost:3001", "") ?? ""
      ).split("?")[0];
      const saves = [
        ["negocio_nombre", cfg.negocio_nombre],
        ["color_primary", cfg.color_primary],
        ["color_bg", cfg.color_bg],
        ["color_sidebar", cfg.color_sidebar],
        ["color_sidebar_text", cfg.color_sidebar_text],
        ["color_btn_primary_text", cfg.color_btn_primary_text],
        ["radio_tarjetas", cfg.radio_tarjetas],
        ["logo_object_fit", cfg.logo_object_fit],
        ["negocio_logo_url", logoUrl],
      ];
      await Promise.all(
        saves.map(([k, v]) => configuracionApi.guardar(k, v ?? "")),
      );
      cfgOriginal = { ...cfg };
      aplicarCSSVars(cfg);
      toasts.ok("Configuración guardada ✓");
      modalConfigUI = false;
    } catch (e) {
      toasts.error("Error al guardar: " + e.message);
    } finally {
      guardandoConfig = false;
    }
  }

  function cancelarConfig() {
    cfg = { ...cfgOriginal };
    aplicarCSSVars(cfg);
    modalConfigUI = false;
  }

  // ── Logout con fade ────────────────────────────────
  let fadeOut = false;

  async function logout() {
    fadeOut = true;
    await new Promise((r) => setTimeout(r, 350));
    try {
      await authApi.logout();
    } catch {}
    sessionStorage.removeItem("orthexus_user");
    goto("/login");
  }

  // ── Search + modal de producto ─────────────────────
  let searchQ = "";
  let searchResults = [];
  let showSearch = false;
  let searchTimer;
  let modalProductoBuscado = null; // producto seleccionado desde el buscador
  let guardandoBuscado = false;

  async function onSearch() {
    clearTimeout(searchTimer);
    if (searchQ.trim().length < 2) {
      searchResults = [];
      showSearch = false;
      return;
    }
    searchTimer = setTimeout(async () => {
      searchResults = (await productosApi.buscar(searchQ)).slice(0, 7);
      showSearch = searchResults.length > 0;
    }, 200);
  }

  function closeSearch() {
    setTimeout(() => {
      showSearch = false;
      searchQ = "";
    }, 150);
  }

  function seleccionarProducto(p) {
    modalProductoBuscado = { ...p, margen_ganancia: p.margen_ganancia ?? "" };
    showSearch = false;
    searchQ = "";
  }

  async function guardarProductoBuscado() {
    guardandoBuscado = true;
    try {
      await productosApi.actualizar(modalProductoBuscado.id, {
        ...modalProductoBuscado,
        precio_costo: parseFloat(modalProductoBuscado.precio_costo) || 0,
        margen_ganancia:
          modalProductoBuscado.margen_ganancia === ""
            ? null
            : parseFloat(modalProductoBuscado.margen_ganancia),
        stock_actual: parseInt(modalProductoBuscado.stock_actual) || 0,
        stock_minimo: parseInt(modalProductoBuscado.stock_minimo) || 0,
        marca_id: modalProductoBuscado.marca_id || null,
      });
      toasts.ok("Producto actualizado ✓");
      modalProductoBuscado = null;
    } catch (e) {
      toasts.error(e.message);
    } finally {
      guardandoBuscado = false;
    }
  }

  // Precios preview en modal buscado
  function calcPrev(costo, margen) {
    const c = parseFloat(costo) || 0;
    const m = parseFloat(margen) || 0;
    return {
      conIva: Math.round(c * 1.21 * 100) / 100,
      venta: Math.round(c * 1.21 * (1 + m / 100) * 100) / 100,
    };
  }
  $: prevBuscado = modalProductoBuscado
    ? calcPrev(
        modalProductoBuscado.precio_costo,
        modalProductoBuscado.margen_ganancia,
      )
    : { conIva: 0, venta: 0 };

  // ── Notifications ──────────────────────────────────
  let showNotif = false;
  let dismissed = new Set();

  $: activeNotifs = $notifStore.filter((n) => !dismissed.has(n.id));
  $: notifCount = activeNotifs.length;

  function dismiss(id) {
    dismissed = new Set([...dismissed, id]);
  }
  function dismissAll() {
    dismissed = new Set(activeNotifs.map((n) => n.id));
  }

  function iconKind(kind) {
    if (kind === "out_stock")
      return {
        path: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M10 12v4m4-4v4",
        color: "var(--red)",
      };
    if (kind === "low_stock")
      return {
        path: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
        color: "var(--yellow)",
      };
    if (kind === "rental_overdue")
      return {
        path: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
        color: "var(--red)",
      };
    return {
      path: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
      color: "var(--primary)",
    };
  }

  function timeAgo(iso) {
    const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
    if (d < 1) return "hoy";
    if (d < 7) return `hace ${d}d`;
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "numeric",
      month: "short",
    });
  }

  onMount(async () => {
  // Auth guard
  try {
    const { user } = await authApi.me();
    sessionStorage.setItem('orthexus_user', JSON.stringify(user));
  } catch {
    goto('/login'); return;
  }

  // Aplicar defaults inmediatamente
  aplicarCSSVars(cfg);

  // Cargar config del usuario desde DB
  try {
    const savedCfg = await configuracionApi.obtener();
    cfg = {
      negocio_nombre:         savedCfg.negocio_nombre         ?? cfg.negocio_nombre,
      negocio_logo_url: (() => {
        const url = savedCfg.negocio_logo_url;
        if (!url) return '';
        const base = url.startsWith('http') ? url.split('?')[0] : `http://localhost:3001${url.split('?')[0]}`;
        return `${base}?v=${Date.now()}`;
      })(),
      color_primary:          savedCfg.color_primary          ?? cfg.color_primary,
      color_bg:               savedCfg.color_bg               ?? cfg.color_bg,
      color_sidebar:          savedCfg.color_sidebar          ?? cfg.color_sidebar,
      color_sidebar_text:     savedCfg.color_sidebar_text     ?? cfg.color_sidebar_text,
      color_btn_primary_text: savedCfg.color_btn_primary_text ?? cfg.color_btn_primary_text,
      radio_tarjetas:         savedCfg.radio_tarjetas         ?? cfg.radio_tarjetas,
      logo_object_fit:        savedCfg.logo_object_fit        ?? 'contain',
    };
    cfgOriginal = { ...cfg };
    aplicarCSSVars(cfg);
  } catch { /* usar defaults */ }

  await refreshNotifications();
  setInterval(refreshNotifications, 60_000);
});
</script>

<svelte:window
  on:click={() => {
    if (showNotif) showNotif = false;
    if (showConfigMenu) showConfigMenu = false;
  }}
/>

<div class="shell" class:fading={fadeOut}>
  <!-- ─── Sidebar ─────────────────────────────── -->
  <nav class="sidebar" class:collapsed>
    <!-- Brand -->
    <div class="brand">
      <button
        class="brand-logo"
        class:has-img={!!cfg.negocio_logo_url}
        on:click|stopPropagation={() => (showConfigMenu = !showConfigMenu)}
        title="Configuración del negocio"
      >
        {#if cfg.negocio_logo_url}
          <img
            src={cfg.negocio_logo_url}
            alt="logo"
            style="width:26px;height:26px;object-fit:{cfg.logo_object_fit};border-radius:4px;background:{cfg.color_sidebar}"
          />
        {:else}
          <img
            src="/logo-isotipo.png"
            alt="Orthexus"
            style="width:26px;height:26px;object-fit:contain;mix-blend-mode:screen"
          />
        {/if}
      </button>
      {#if !collapsed}
        <div class="brand-text">
          <span class="brand-name">{cfg.negocio_nombre}</span>
          <span class="brand-hint">Panel de gestión</span>
        </div>
      {/if}
    </div>

    <!-- Config mini-menu -->
    {#if showConfigMenu}
      <div class="config-pop">
        <button
          class="config-pop-item"
          on:click={() => {
            showConfigMenu = false;
            modalConfigUI = true;
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            width="14"
            height="14"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            />
          </svg>
          Configuración
        </button>
      </div>
    {/if}

    <!-- Nav links -->
    <div class="nav-label" class:hidden={collapsed}>MENÚ</div>
    <ul class="nav-list">
      {#each nav as item}
        <li>
          <a
            href={item.href}
            class="nav-link"
            class:active={isActive(item.href)}
            title={collapsed ? item.label : ""}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              class="nav-svg"
            >
              <path
                d={item.icon}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {#if !collapsed}<span>{item.label}</span>{/if}
          </a>
        </li>
      {/each}
    </ul>

    <!-- Collapse toggle -->
    <button
      class="collapse-btn"
      on:click={() => (collapsed = !collapsed)}
      title={collapsed ? "Expandir" : "Colapsar"}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        width="14"
        height="14"
      >
        {#if collapsed}
          <path
            d="M9 5l7 7-7 7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        {:else}
          <path
            d="M15 19l-7-7 7-7"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        {/if}
      </svg>
      {#if !collapsed}<span>Colapsar</span>{/if}
    </button>
  </nav>

  <!-- ─── Main area ───────────────────────────── -->
  <div class="main-wrap">
    <!-- Topbar -->
    <header class="topbar">
      <!-- Search -->
      <div class="search-wrap">
        <svg
          class="search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          width="16"
          height="16"
        >
          <path
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <input
          class="input input-search"
          placeholder="Buscar producto, código, categoría…"
          bind:value={searchQ}
          on:input={onSearch}
          on:blur={closeSearch}
        />
        {#if showSearch}
          <div class="search-dropdown">
            {#each searchResults as p}
              <button
                class="search-item"
                on:mousedown={() => seleccionarProducto(p)}
              >
                <div class="search-item-icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.75"
                    width="16"
                    height="16"
                  >
                    <path
                      d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
                <div class="search-item-info">
                  <span class="search-item-name">{p.nombre}</span>
                  <span class="search-item-sub mono"
                    >{p.codigo_barras ?? p.sku ?? ""} · {p.categoria}</span
                  >
                </div>
                <div class="search-item-right">
                  <span
                    class="mono"
                    style="font-weight:700;color:var(--primary)"
                    >{formatPeso(p.precio_venta)}</span
                  >
                  <span class="text-muted2" style="font-size:11px"
                    >Stock: {p.stock_actual}</span
                  >
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Right side -->
      <div class="topbar-right">
        <!-- Notifications bell -->
        <div class="notif-wrap">
          <button
            class="topbar-btn"
            class:notif-active={notifCount > 0}
            on:click|stopPropagation={() => (showNotif = !showNotif)}
            aria-label="Notificaciones"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              width="18"
              height="18"
            >
              <path
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            {#if notifCount > 0}
              <span class="notif-badge"
                >{notifCount > 9 ? "9+" : notifCount}</span
              >
            {/if}
          </button>

          {#if showNotif}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="notif-pop" on:click|stopPropagation>
              <div class="notif-pop-header">
                <div>
                  <p style="font-size:14px;font-weight:700">Notificaciones</p>
                  <p style="font-size:12px;color:var(--text2)">
                    {notifCount} pendiente{notifCount !== 1 ? "s" : ""}
                  </p>
                </div>
                {#if notifCount > 0}
                  <button class="btn btn-ghost btn-sm" on:click={dismissAll}
                    >✓ Marcar todo</button
                  >
                {/if}
              </div>

              <div class="notif-pop-body">
                {#if activeNotifs.length === 0}
                  <div style="padding:2.5rem 1rem;text-align:center">
                    <div
                      style="width:44px;height:44px;border-radius:50%;background:var(--primary-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 0.75rem"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        width="20"
                        height="20"
                        style="color:var(--primary)"
                      >
                        <path
                          d="M5 13l4 4L19 7"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </div>
                    <p style="font-size:13.5px;font-weight:600">Todo al día</p>
                    <p
                      style="font-size:12px;color:var(--text2);margin-top:0.25rem"
                    >
                      No hay alertas por revisar
                    </p>
                  </div>
                {:else}
                  {#each activeNotifs as n}
                    {@const ic = iconKind(n.kind)}
                    <a
                      href={n.href}
                      class="notif-item"
                      on:click={() => (showNotif = false)}
                    >
                      <div class="notif-item-icon" style="--ic:{ic.color}">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={ic.color}
                          stroke-width="1.75"
                          width="16"
                          height="16"
                        >
                          <path
                            d={ic.path}
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </div>
                      <div style="flex:1;min-width:0">
                        <p
                          style="font-size:13px;font-weight:600;line-height:1.3"
                        >
                          {n.title}
                        </p>
                        <p
                          style="font-size:12px;color:var(--text2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
                        >
                          {n.desc}
                        </p>
                        <p
                          style="font-size:10.5px;color:var(--text3);margin-top:3px"
                        >
                          {timeAgo(n.time)}
                        </p>
                      </div>
                      <button
                        class="notif-dismiss"
                        on:click|preventDefault|stopPropagation={() =>
                          dismiss(n.id)}
                        aria-label="Descartar">✕</button
                      >
                    </a>
                  {/each}
                {/if}
              </div>

              <div class="notif-pop-footer">
                <a
                  href="/"
                  on:click={() => (showNotif = false)}
                  style="font-size:12px;color:var(--primary);font-weight:600;text-decoration:none"
                >
                  Ver dashboard →
                </a>
              </div>
            </div>
          {/if}
        </div>

        <!-- Config button -->
        <button
          class="topbar-btn"
          on:click|stopPropagation={() => {
            showConfigMenu = false;
            modalConfigUI = true;
          }}
          title="Configuración"
          aria-label="Configuración"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            width="18"
            height="18"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <!-- Avatar -->
        <div
          class="topbar-avatar"
          class:has-logo={!!cfg.negocio_logo_url}
          title={cfg.negocio_nombre}
        >
          {#if cfg.negocio_logo_url}
            <img
              src={cfg.negocio_logo_url}
              alt="logo"
              style="width:100%;height:100%;object-fit:cover;border-radius:50%"
            />
          {:else}
            <img
              src="/logo-isotipo.png"
              alt="Orthexus"
              style="width:24px;height:24px;object-fit:contain;mix-blend-mode:screen"
            />
          {/if}
        </div>

        <!-- Logout -->
        <button
          class="topbar-btn"
          on:click={logout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            width="18"
            height="18"
          >
            <path
              d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <polyline
              points="16 17 21 12 16 7"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <line
              x1="21"
              y1="12"
              x2="9"
              y2="12"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </header>

    <!-- Page content -->
    <main class="main-content">
      <slot />
    </main>
  </div>
</div>

<!-- ═══════════════════════════════════════════════════ -->
<!-- MODAL: Configuración del negocio                  -->
<!-- ═══════════════════════════════════════════════════ -->
{#if modalConfigUI}
  <div class="overlay" on:click|self={cancelarConfig} style="z-index:500">
    <div class="modal" style="max-width:620px;max-height:88vh">
      <div
        style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem"
      >
        <div>
          <h2 class="modal-title" style="margin-bottom:0">Configuración</h2>
          <p class="text-muted2" style="font-size:12.5px;margin-top:0.2rem">
            Los cambios se previsual en tiempo real
          </p>
        </div>
        <button class="btn btn-ghost btn-sm" on:click={cancelarConfig}>✕</button
        >
      </div>

      <!-- Identidad -->
      <p class="modal-section">IDENTIDAD DEL NEGOCIO</p>
      <div class="form-grid" style="margin-bottom:1.25rem">
        <div class="field field-full">
          <label>Nombre del negocio</label>
          <input
            class="input"
            bind:value={cfg.negocio_nombre}
            placeholder="Orthexus"
          />
        </div>

        <div class="field field-full">
          <label>Logo del negocio</label>
          <div class="logo-upload-wrap">
            <div
              class="logo-preview-box"
              style="background:{cfg.negocio_logo_url
                ? 'transparent'
                : cfg.color_sidebar}"
            >
              {#if cfg.negocio_logo_url}
                <img
                  src={cfg.negocio_logo_url}
                  alt="logo"
                  style="width:100%;height:100%;object-fit:cover;border-radius:6px"
                />
              {:else}
                <img
                  src="/logo-isotipo.png"
                  alt="Orthexus"
                  style="width:36px;height:36px;object-fit:contain;mix-blend-mode:screen"
                />
              {/if}
            </div>
            <div style="flex:1;display:flex;flex-direction:column;gap:0.5rem">
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
                <label
                  class="btn btn-ghost btn-sm"
                  style="cursor:pointer;display:inline-flex;align-items:center;gap:0.4rem"
                >
                  {subiendoLogo
                    ? "⏳ Subiendo…"
                    : cfg.negocio_logo_url
                      ? "🔄 Cambiar logo"
                      : "📁 Subir logo"}
                  <input
                    type="file"
                    accept="image/*"
                    style="display:none"
                    on:change={abrirCropper}
                    disabled={subiendoLogo}
                  />
                </label>
                {#if cfg.negocio_logo_url}
                  <button
                    class="btn btn-danger btn-sm"
                    on:click={() => (cfg.negocio_logo_url = "")}
                    >✕ Quitar</button
                  >
                {/if}
              </div>
              <p style="font-size:11px;color:var(--text3)">
                JPG, PNG, SVG — máx. 4MB. Sin logo se usa el isotipo de
                Orthexus.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <!-- Paletas -->
      <p class="modal-section">PALETAS DE COLORES</p>
      <div class="paletas-grid">
        {#each PALETAS as p}
          <button
            class="paleta-btn"
            on:click={() => aplicarPaleta(p)}
            style="--pc:{p.primary};--pb:{p.sidebar}"
            title={p.label}
          >
            <div class="paleta-preview">
              <div class="paleta-sidebar" style="background:{p.sidebar}"></div>
              <div class="paleta-main" style="background:{p.bg}">
                <div class="paleta-pill" style="background:{p.primary}"></div>
              </div>
            </div>
            <span class="paleta-label">{p.label}</span>
          </button>
        {/each}
      </div>

      <div class="divider"></div>

      <!-- Colores custom -->
      <p class="modal-section">COLORES PERSONALIZADOS</p>
      <div class="form-grid">
        <div class="field">
          <label>Color primario (botones, activos)</label>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input
              type="color"
              class="color-picker"
              bind:value={cfg.color_primary}
              on:input={() => aplicarCSSVars(cfg)}
            />
            <input
              class="input mono"
              bind:value={cfg.color_primary}
              style="flex:1"
              on:input={() => aplicarCSSVars(cfg)}
            />
          </div>
        </div>
        <div class="field">
          <label>Color de fondo principal</label>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input
              type="color"
              class="color-picker"
              bind:value={cfg.color_bg}
              on:input={() => aplicarCSSVars(cfg)}
            />
            <input
              class="input mono"
              bind:value={cfg.color_bg}
              style="flex:1"
              on:input={() => aplicarCSSVars(cfg)}
            />
          </div>
        </div>
        <div class="field">
          <label>Fondo del sidebar</label>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input
              type="color"
              class="color-picker"
              bind:value={cfg.color_sidebar}
              on:input={() => aplicarCSSVars(cfg)}
            />
            <input
              class="input mono"
              bind:value={cfg.color_sidebar}
              style="flex:1"
              on:input={() => aplicarCSSVars(cfg)}
            />
          </div>
        </div>
        <div class="field">
          <label>Texto / íconos del sidebar</label>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input
              type="color"
              class="color-picker"
              bind:value={cfg.color_sidebar_text}
              on:input={() => aplicarCSSVars(cfg)}
            />
            <input
              class="input mono"
              bind:value={cfg.color_sidebar_text}
              style="flex:1"
              on:input={() => aplicarCSSVars(cfg)}
            />
          </div>
        </div>
        <div class="field">
          <label>Texto en botones primarios</label>
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input
              type="color"
              class="color-picker"
              bind:value={cfg.color_btn_primary_text}
              on:input={() => aplicarCSSVars(cfg)}
            />
            <input
              class="input mono"
              bind:value={cfg.color_btn_primary_text}
              style="flex:1"
              on:input={() => aplicarCSSVars(cfg)}
            />
          </div>
        </div>
        <div class="field">
          <label>Redondez de tarjetas (rem)</label>
          <div style="display:flex;align-items:center;gap:0.75rem">
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.05"
              bind:value={cfg.radio_tarjetas}
              on:input={() => aplicarCSSVars(cfg)}
              style="flex:1"
            />
            <span
              class="mono"
              style="width:40px;text-align:right;font-size:13px"
              >{cfg.radio_tarjetas}r</span
            >
          </div>
        </div>
      </div>

      <div
        style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.5rem"
      >
        <button class="btn btn-ghost" on:click={cancelarConfig}>Cancelar</button
        >
        <button
          class="btn btn-primary"
          on:click={guardarConfig}
          disabled={guardandoConfig}
        >
          {guardandoConfig ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════ -->
<!-- MODAL: Cropper de imagen                          -->
<!-- ═══════════════════════════════════════════════════ -->
{#if showCropper}
  <div class="overlay" style="z-index:600">
    <div class="modal" style="max-width:540px">
      <div
        style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem"
      >
        <div>
          <h2 class="modal-title" style="margin-bottom:0">Recortá tu logo</h2>
          <p class="text-muted2" style="font-size:12.5px;margin-top:0.2rem">
            Arrastrá el recuadro para mover, arrastrá las esquinas para
            redimensionar
          </p>
        </div>
        <button class="btn btn-ghost btn-sm" on:click={cancelarCrop}>✕</button>
      </div>

      <!-- Área de crop -->
      <div
        class="crop-area"
        on:mousedown={onCropMouseDown}
        on:mousemove={onCropMouseMove}
        on:mouseup={onCropMouseUp}
        on:mouseleave={onCropMouseUp}
        style="user-select:none;position:relative;cursor:crosshair;border-radius:8px;overflow:hidden;border:1.5px solid var(--border)"
      >
        <img
          bind:this={cropImg}
          src={cropperImg}
          alt="crop"
          style="display:block;width:100%;max-height:420px;object-fit:contain;pointer-events:none"
        />
        <!-- Oscurecer áreas fuera del crop -->
        <div
          style="
          position:absolute;inset:0;pointer-events:none;
          background: linear-gradient(
            to bottom,
            rgba(0,0,0,0.45) {crop.y * 100}%,
            transparent {crop.y * 100}%,
            transparent {(crop.y + crop.h) * 100}%,
            rgba(0,0,0,0.45) {(crop.y + crop.h) * 100}%
          )"
        ></div>
        <div
          style="
          position:absolute;
          left:0; top:{crop.y * 100}%; width:{crop.x * 100}%; height:{crop.h *
            100}%;
          background:rgba(0,0,0,0.45);pointer-events:none"
        ></div>
        <div
          style="
          position:absolute;
          left:{(crop.x + crop.w) * 100}%; top:{crop.y *
            100}%; right:0; height:{crop.h * 100}%;
          background:rgba(0,0,0,0.45);pointer-events:none"
        ></div>

        <!-- Recuadro de crop -->
        <div
          style="
          position:absolute;
          left:{crop.x * 100}%; top:{crop.y * 100}%;
          width:{crop.w * 100}%; height:{crop.h * 100}%;
          border:2px solid white;
          box-shadow:0 0 0 1px rgba(0,71,171,0.6);
          pointer-events:none
        "
        >
          <!-- Grid lines -->
          <div
            style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr 1fr"
          >
            {#each Array(9) as _}
              <div style="border:0.5px solid rgba(255,255,255,0.2)"></div>
            {/each}
          </div>
          <!-- Corner handles -->
          {#each [["0", "0", "nw"], ["100%", "0", "ne"], ["0", "100%", "sw"], ["100%", "100%", "se"]] as [l, t, c]}
            <div
              style="
              position:absolute;left:{l};top:{t};
              width:12px;height:12px;
              background:white;border:2px solid var(--primary);
              border-radius:2px;
              transform:translate(-50%,-50%);
              cursor:{c}-resize
            "
            ></div>
          {/each}
        </div>
      </div>

      <div
        style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.25rem"
      >
        <button class="btn btn-ghost" on:click={cancelarCrop}>Cancelar</button>
        <button
          class="btn btn-primary"
          on:click={confirmarCrop}
          disabled={subiendoLogo}
        >
          {subiendoLogo ? "⏳ Guardando…" : "✓ Usar esta selección"}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Confirm dialog global -->
<ConfirmDialog />

<!-- Toast stack -->
<div class="toast-stack">
  {#each $toasts as t (t.id)}
    <div class="toast toast-{t.tipo}">
      <div class="toast-dot"></div>
      {t.mensaje}
    </div>
  {/each}
</div>

<!-- Modal producto desde buscador -->
{#if modalProductoBuscado}
  <div
    class="overlay"
    on:click|self={() => (modalProductoBuscado = null)}
    style="z-index:400"
  >
    <div class="modal" style="max-width:540px">
      <!-- Header -->
      <div
        style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.25rem"
      >
        <div>
          <div class="badge badge-primary" style="margin-bottom:0.4rem">
            📦 Producto
          </div>
          <h2 class="modal-title" style="margin-bottom:0">
            {modalProductoBuscado.nombre}
          </h2>
          {#if modalProductoBuscado.marca_nombre}
            <p class="text-muted2" style="font-size:13px;margin-top:0.2rem">
              {modalProductoBuscado.marca_nombre}
            </p>
          {/if}
        </div>
        <button
          class="btn btn-ghost btn-sm"
          on:click={() => (modalProductoBuscado = null)}>✕</button
        >
      </div>

      <!-- Precios calculados -->
      <div class="prev-precios-row">
        <div class="prev-precio">
          <div class="prev-lbl">Costo</div>
          <div class="prev-val mono">
            {formatPeso(modalProductoBuscado.precio_costo)}
          </div>
        </div>
        <div class="prev-arrow">→</div>
        <div class="prev-precio">
          <div class="prev-lbl">+ IVA 21%</div>
          <div class="prev-val mono">{formatPeso(prevBuscado.conIva)}</div>
        </div>
        <div class="prev-arrow">→</div>
        <div class="prev-precio highlight">
          <div class="prev-lbl">Precio venta</div>
          <div class="prev-val mono text-green">
            {formatPeso(modalProductoBuscado.precio_venta)}
          </div>
        </div>
      </div>

      <!-- Stock -->
      <div
        style="display:flex;align-items:center;gap:0.75rem;margin:1rem 0;padding:0.75rem 1rem;background:var(--bg3);border-radius:calc(var(--radius) - 2px);border:1px solid var(--border)"
      >
        <span style="font-size:13px;font-weight:700;color:var(--text2)"
          >Stock actual</span
        >
        <span
          class="badge {modalProductoBuscado.stock_actual <=
          modalProductoBuscado.stock_minimo
            ? 'badge-red'
            : 'badge-green'}"
          style="font-size:13px;padding:3px 12px"
        >
          {modalProductoBuscado.stock_actual}
          {modalProductoBuscado.unidad ?? "unid."}
        </span>
        {#if modalProductoBuscado.stock_actual <= modalProductoBuscado.stock_minimo && modalProductoBuscado.stock_minimo > 0}
          <span style="font-size:12px;color:var(--red)"
            >⚠ Stock bajo (mín. {modalProductoBuscado.stock_minimo})</span
          >
        {/if}
        <span class="badge badge-gray" style="margin-left:auto"
          >{modalProductoBuscado.categoria}</span
        >
      </div>

      <div class="divider"></div>

      <!-- Edición rápida -->
      <p class="modal-section">EDICIÓN RÁPIDA</p>
      <div class="form-grid">
        <div class="field">
          <label>Precio costo $</label>
          <input
            class="input mono"
            type="text"
            inputmode="decimal"
            value={modalProductoBuscado.precio_costo || ""}
            on:input={(e) => {
              modalProductoBuscado.precio_costo =
                parseFloat(e.target.value.replace(",", ".")) || 0;
            }}
          />
        </div>
        <div class="field">
          <label>Margen %</label>
          <input
            class="input mono"
            type="text"
            inputmode="decimal"
            placeholder="Global"
            value={modalProductoBuscado.margen_ganancia ?? ""}
            on:input={(e) => {
              const v = e.target.value.replace(",", ".");
              modalProductoBuscado.margen_ganancia =
                v === "" ? null : parseFloat(v) || 0;
            }}
          />
        </div>
        <div class="field">
          <label>Stock actual</label>
          <input
            class="input"
            type="text"
            inputmode="numeric"
            value={modalProductoBuscado.stock_actual || ""}
            on:input={(e) => {
              modalProductoBuscado.stock_actual = parseInt(e.target.value) || 0;
            }}
          />
        </div>
        <div class="field">
          <label>Stock mínimo</label>
          <input
            class="input"
            type="text"
            inputmode="numeric"
            value={modalProductoBuscado.stock_minimo || ""}
            on:input={(e) => {
              modalProductoBuscado.stock_minimo = parseInt(e.target.value) || 0;
            }}
          />
        </div>
      </div>

      <div
        style="display:flex;gap:0.6rem;justify-content:flex-end;margin-top:1.25rem"
      >
        <a
          href="/productos"
          class="btn btn-ghost"
          on:click={() => (modalProductoBuscado = null)}>Ver en Productos</a
        >
        <button
          class="btn btn-primary"
          on:click={guardarProductoBuscado}
          disabled={guardandoBuscado}
        >
          {guardandoBuscado ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Shell */
  .shell {
    display: flex;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    transition: opacity 0.35s ease;
  }
  .shell.fading {
    opacity: 0;
    pointer-events: none;
  }

  /* ── Sidebar ── */
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--sidebar);
    border-right: 1px solid var(--sidebar-bd);
    display: flex;
    flex-direction: column;
    padding: 1rem 0.75rem;
    transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
  }
  .sidebar.collapsed {
    width: 68px;
  }

  /* Brand */
  .brand {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.4rem 0.5rem 1.5rem;
    min-height: 64px;
  }
  .brand-logo {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--gradient-pr);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: var(--shadow-md);
  }
  .brand-name {
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  .brand-hint {
    font-size: 10.5px;
    color: var(--text3);
    white-space: nowrap;
  }

  /* Nav */
  .nav-label {
    font-size: 9.5px;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: var(--text3);
    padding: 0 0.5rem;
    margin-bottom: 0.4rem;
    white-space: nowrap;
  }
  .nav-label.hidden {
    opacity: 0;
  }
  .nav-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.65rem 0.75rem;
    border-radius: calc(var(--radius) - 2px);
    text-decoration: none;
    color: var(--text2);
    font-size: 13.5px;
    font-weight: 500;
    transition: all 0.13s;
    white-space: nowrap;
    position: relative;
    overflow: hidden;
  }
  .nav-link:hover {
    background: var(--primary-bg);
    color: var(--primary);
  }
  .nav-link.active {
    background: var(--gradient-pr);
    color: white;
    font-weight: 600;
    box-shadow: var(--shadow-md);
  }
  .nav-link.active:hover {
    filter: brightness(1.06);
  }
  .nav-svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  /* Collapse btn */
  .collapse-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.75rem;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font);
    font-size: 12px;
    color: var(--text3);
    border-radius: calc(var(--radius) - 2px);
    margin-top: 0.5rem;
    transition: all 0.13s;
    white-space: nowrap;
  }
  .collapse-btn:hover {
    background: var(--bg3);
    color: var(--text2);
  }

  /* ── Main wrap ── */
  .main-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  /* ── Topbar ── */
  .topbar {
    height: 72px;
    min-height: 72px;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0 1.75rem;
    background: oklch(0.995 0.006 95 / 0.8);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  /* Search */
  .search-wrap {
    position: relative;
    flex: 1;
    max-width: 560px;
  }
  .search-icon {
    position: absolute;
    left: 1rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text3);
    pointer-events: none;
  }
  .search-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    right: 0;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    z-index: 100;
    overflow: hidden;
  }
  .search-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.65rem 1rem;
    background: none;
    border: none;
    border-bottom: 1px solid var(--bg3);
    cursor: pointer;
    font-family: var(--font);
    text-align: left;
    transition: background 0.1s;
  }
  .search-item:last-child {
    border-bottom: none;
  }
  .search-item:hover {
    background: var(--primary-bg);
  }
  .search-item-icon {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: var(--primary-bg);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary);
    flex-shrink: 0;
  }
  .search-item-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }
  .search-item-name {
    font-weight: 600;
    font-size: 13.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search-item-sub {
    font-size: 11.5px;
    color: var(--text3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .search-item-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    flex-shrink: 0;
  }

  /* Topbar right */
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }
  .topbar-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text2);
    transition: all 0.13s;
    position: relative;
  }
  .topbar-btn:hover {
    background: var(--primary-bg);
    color: var(--primary);
  }
  .topbar-btn.notif-active {
    color: var(--primary);
  }
  .notif-badge {
    position: absolute;
    top: -1px;
    right: -1px;
    min-width: 17px;
    height: 17px;
    padding: 0 3px;
    border-radius: 999px;
    background: var(--red);
    color: white;
    font-size: 9.5px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .topbar-avatar {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    background: var(--gradient-pr);
    color: white;
    font-weight: 700;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-md);
    cursor: default;
    overflow: hidden;
  }
  .topbar-avatar.has-logo {
    background: transparent;
    box-shadow: var(--shadow);
  }

  /* Notification popover */
  .notif-wrap {
    position: relative;
    z-index: 200;
  }
  .notif-pop {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    width: 380px;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    box-shadow: var(--shadow-lg);
    z-index: 201;
    overflow: hidden;
    animation: slideUp 0.18s ease;
  }
  .notif-pop-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border);
    background: oklch(0.99 0.005 95 / 0.6);
  }
  .notif-pop-body {
    max-height: 400px;
    overflow-y: auto;
  }
  .notif-pop-footer {
    padding: 0.6rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--bg3);
  }
  .notif-item {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid var(--bg3);
    text-decoration: none;
    color: var(--text);
    transition: background 0.12s;
  }
  .notif-item:last-child {
    border-bottom: none;
  }
  .notif-item:hover {
    background: var(--primary-bg);
  }
  .notif-item-icon {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--ic) 15%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .notif-dismiss {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text3);
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
    line-height: 1;
    transition: all 0.1s;
  }
  .notif-dismiss:hover {
    background: var(--bg4);
    color: var(--text2);
  }

  /* Main content */
  .main-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 2rem 2.25rem;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  /* Preview precios en modal buscador */
  .prev-precios-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    align-items: center;
    gap: 0.5rem;
    background: var(--bg3);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 2px);
    padding: 0.85rem 1rem;
  }
  .prev-precio {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    text-align: center;
    padding: 0.5rem;
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) - 4px);
  }
  .prev-precio.highlight {
    background: var(--green-lt);
    border-color: var(--green-bd);
  }
  .prev-lbl {
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text3);
  }
  .prev-val {
    font-size: 0.95rem;
    font-weight: 800;
  }
  .prev-arrow {
    font-size: 1rem;
    color: var(--text3);
    font-weight: 700;
    text-align: center;
  }

  /* ── Sidebar CSS vars override ── */
  .sidebar {
    background: var(--sidebar) !important;
    border-right-color: color-mix(
      in srgb,
      var(--sidebar) 80%,
      black
    ) !important;
  }
  .nav-label {
    color: color-mix(in srgb, var(--sidebar-text) 55%, transparent) !important;
  }
  .nav-link {
    color: var(--sidebar-text) !important;
    opacity: 0.88;
  }
  .nav-link:hover {
    background: color-mix(
      in srgb,
      var(--sidebar-text) 12%,
      transparent
    ) !important;
    color: var(--sidebar-text) !important;
    opacity: 1;
  }
  .nav-link.active {
    background: var(--gradient-pr) !important;
    color: var(--primary-fg) !important;
    opacity: 1;
    box-shadow: 0 4px 14px rgba(0, 71, 171, 0.35) !important;
  }
  .brand-name {
    color: var(--sidebar-text) !important;
  }
  .brand-hint {
    color: color-mix(in srgb, var(--sidebar-text) 60%, transparent) !important;
  }
  .collapse-btn {
    color: color-mix(in srgb, var(--sidebar-text) 55%, transparent) !important;
  }
  .collapse-btn:hover {
    background: color-mix(
      in srgb,
      var(--sidebar-text) 10%,
      transparent
    ) !important;
    color: var(--sidebar-text) !important;
    opacity: 1;
  }
  /* Brand logo as button */
  .brand-logo {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    background: var(--gradient-pr);
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    box-shadow: var(--shadow-md);
    transition: filter 0.13s;
    overflow: hidden;
  }
  .brand-logo.has-img {
    background: transparent;
    box-shadow: var(--shadow);
  }
  .brand-logo:hover {
    filter: brightness(1.05);
  }

  /* Config pop menu */
  .config-pop {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    overflow: hidden;
    margin-bottom: 0.5rem;
    animation: slideUp 0.15s ease;
  }
  .config-pop-item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.65rem 0.85rem;
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font);
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    transition: background 0.12s;
    text-align: left;
  }
  .config-pop-item:hover {
    background: var(--primary-bg);
    color: var(--primary);
  }

  /* Paletas grid */
  .paletas-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.6rem;
    margin-bottom: 0;
  }
  .paleta-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    background: none;
    border: 1.5px solid var(--border);
    border-radius: var(--radius);
    padding: 0.5rem;
    cursor: pointer;
    font-family: var(--font);
    transition: all 0.13s;
  }
  .paleta-btn:hover {
    border-color: var(--primary);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
  .paleta-preview {
    display: flex;
    width: 100%;
    height: 36px;
    border-radius: calc(var(--radius)-2px);
    overflow: hidden;
  }
  .paleta-sidebar {
    width: 28%;
  }
  .paleta-main {
    flex: 1;
    display: flex;
    align-items: flex-end;
    padding: 4px;
  }
  .paleta-pill {
    height: 8px;
    width: 70%;
    border-radius: 4px;
  }
  .paleta-label {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--text2);
    text-align: center;
  }

  /* Color picker */
  .color-picker {
    width: 42px;
    height: 36px;
    padding: 2px;
    border-radius: 6px;
    border: 1.5px solid var(--border);
    cursor: pointer;
    flex-shrink: 0;
    background: var(--bg2);
  }

  /* Logo upload */
  .logo-upload-wrap {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    padding: 0.75rem;
    background: var(--bg3);
    border: 1.5px dashed var(--border);
    border-radius: calc(var(--radius) - 2px);
  }
  .logo-preview-box {
    width: 52px;
    height: 52px;
    border-radius: 10px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .logo-preview-img {
    width: 52px;
    height: 52px;
    border-radius: 10px;
    object-fit: contain;
    border: 1px solid var(--border);
    flex-shrink: 0;
  }
  .logo-preview-placeholder {
    width: 52px;
    height: 52px;
    border-radius: 10px;
    flex-shrink: 0;
    background: var(--gradient-pr);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.5rem;
  }

  /* Range input */
  input[type="range"] {
    accent-color: var(--primary);
  }
</style>
