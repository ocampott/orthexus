<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { authApi } from '$lib/api';

  let email = '', password = '', nombre = '';
  let cargando = false, error = '';
  let vista = 'login';
  let visible = false, fadeOut = false;

  onMount(async () => {
    // Si ya tiene sesión válida, redirigir
    try {
      await authApi.me();
      goto('/');
      return;
    } catch { /* no hay sesión, mostrar login */ }

    // Check si viene de callback de Google con error
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === 'google') error = 'Error al iniciar sesión con Google. Intentá de nuevo.';

    setTimeout(() => visible = true, 10);
  });

  async function iniciarSesion() {
    error = '';
    if (!email || !password) { error = 'Completá todos los campos.'; return; }
    cargando = true;
    try {
      const { user } = await authApi.login({ email, password });
      // Guardar info básica en sessionStorage para UI
      sessionStorage.setItem('orthexus_user', JSON.stringify(user));
      fadeOut = true;
      await new Promise(r => setTimeout(r, 350));
      goto('/');
    } catch(e) {
      error = e.message;
    } finally { cargando = false; }
  }

  async function registrar() {
    error = '';
    if (!nombre || !email || !password) { error = 'Completá todos los campos.'; return; }
    if (password.length < 6) { error = 'La contraseña debe tener al menos 6 caracteres.'; return; }
    cargando = true;
    try {
      const { user } = await authApi.register({ email, password, nombre });
      sessionStorage.setItem('orthexus_user', JSON.stringify(user));
      fadeOut = true;
      await new Promise(r => setTimeout(r, 350));
      goto('/');
    } catch(e) {
      error = e.message;
    } finally { cargando = false; }
  }

  function loginGoogle() {
    window.location.href = authApi.googleUrl();
  }

  function onKey(e) {
    if (e.key === 'Enter') vista === 'login' ? iniciarSesion() : registrar();
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="shell" class:visible class:fading={fadeOut}>

  <!-- ══ Panel izquierdo ══ -->
  <div class="left">
    <div class="left-content">
      <div class="logo-wrap">
        <img src="/logo-isotipo.png" alt="Orthexus" class="logo-img" />
      </div>
      <div class="brand-name">Orthexus</div>
      <div class="brand-sub">Sistema de Gestión</div>
    </div>
  </div>

  <!-- ══ Panel derecho ══ -->
  <div class="right">
    <div class="form-card">

      {#if vista === 'login'}
        <h2 class="form-title">Acceso al Sistema</h2>
        <p class="form-sub">Ingresá tus credenciales para continuar</p>

        <!-- Google -->
        <button class="btn-google" on:click={loginGoogle}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continuar con Google
        </button>

        <div class="divider-text"><span>o ingresá con email</span></div>

        <div class="fields">
          <div class="field">
            <span class="field-label">EMAIL</span>
            <div class="input-wrap">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <input class="inp" type="email" placeholder="tu@email.com" bind:value={email} autocomplete="email" />
            </div>
          </div>

          <div class="field">
            <span class="field-label">CONTRASEÑA</span>
            <div class="input-wrap">
              <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <input class="inp" type="password" placeholder="••••••••" bind:value={password} autocomplete="current-password" />
            </div>
          </div>

          {#if error}<div class="error">{error}</div>{/if}

          <button class="btn-submit" on:click={iniciarSesion} disabled={cargando}>
            {cargando ? 'Verificando…' : 'Iniciar Sesión'}
          </button>
        </div>

        <p class="switch">
          ¿No tenés cuenta?
          <button class="switch-btn" on:click={() => { vista='registro'; error=''; }}>Registrarse</button>
        </p>

      {:else}
        <h2 class="form-title">Crear Cuenta</h2>
        <p class="form-sub">Completá los datos para registrarte</p>

        <!-- Google también para registro -->
        <button class="btn-google" on:click={loginGoogle}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Registrarse con Google
        </button>

        <div class="divider-text"><span>o creá una cuenta</span></div>

        <div class="fields">
          <div class="field">
            <span class="field-label">NOMBRE COMPLETO</span>
            <input class="inp" style="padding-left:0.85rem" placeholder="Tu nombre" bind:value={nombre} autocomplete="name" />
          </div>
          <div class="field">
            <span class="field-label">EMAIL</span>
            <input class="inp" style="padding-left:0.85rem" type="email" placeholder="tu@email.com" bind:value={email} autocomplete="email" />
          </div>
          <div class="field">
            <span class="field-label">CONTRASEÑA</span>
            <input class="inp" style="padding-left:0.85rem" type="password" placeholder="Mínimo 6 caracteres" bind:value={password} autocomplete="new-password" />
          </div>

          {#if error}<div class="error">{error}</div>{/if}

          <button class="btn-submit" on:click={registrar} disabled={cargando}>
            {cargando ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>
        </div>

        <p class="switch">
          ¿Ya tenés cuenta?
          <button class="switch-btn" on:click={() => { vista='login'; error=''; }}>Iniciar sesión</button>
        </p>
      {/if}
    </div>

    <p class="login-footer">© 2025 Orthexus · Sistema de gestión ortopédica</p>
  </div>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
  :global(body) { font-family: 'DM Sans', sans-serif; }

  .shell {
    display: grid; grid-template-columns: 1fr 1fr;
    min-height: 100vh; width: 100vw;
    opacity: 0; transition: opacity 0.4s ease;
  }
  .shell.visible { opacity: 1; }
  .shell.fading  { opacity: 0; pointer-events: none; }

  /* ── Izquierda ── */
  .left {
    background: linear-gradient(135deg, #001a5c 0%, #0047AB 40%, #0099a8 80%, #00C2CB 100%);
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  .left::before {
    content: ''; position: absolute;
    width: 600px; height: 600px; border-radius: 50%;
    background: radial-gradient(circle, rgba(0,194,203,0.15) 0%, transparent 65%);
    top: -100px; right: -150px; pointer-events: none;
  }
  .left::after {
    content: ''; position: absolute;
    width: 400px; height: 400px; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 65%);
    bottom: -80px; left: -80px; pointer-events: none;
  }
  .left-content { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 0; }
  .logo-wrap {
    width: 120px; height: 120px; border-radius: 28px;
    background: rgba(255,255,255,0.12); backdrop-filter: blur(12px);
    border: 1.5px solid rgba(255,255,255,0.22);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 12px 40px rgba(0,0,0,0.25); margin-bottom: 2rem;
  }
  .logo-img { width: 78px; height: 78px; object-fit: contain; }
  .brand-name { font-size: 2.6rem; font-weight: 800; letter-spacing: -0.04em; color: #fff; line-height: 1; margin-bottom: 0.5rem; }
  .brand-sub  { font-size: 1rem; color: rgba(180,220,255,0.8); font-weight: 500; letter-spacing: 0.04em; }

  /* ── Derecha ── */
  .right {
    background: #f2f5fa; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 3rem 2.5rem; gap: 1.5rem;
  }
  .form-card {
    background: #fff; border-radius: 20px; padding: 2.25rem 2.25rem;
    width: 100%; max-width: 400px;
    box-shadow: 0 8px 48px rgba(0,71,171,0.12); border: 1px solid #dce6f5;
  }
  .form-title { font-size: 1.35rem; font-weight: 800; letter-spacing: -0.03em; color: #0d1b2e; margin-bottom: 0.3rem; }
  .form-sub   { font-size: 13.5px; color: #6b84a0; margin-bottom: 1.25rem; }

  /* Google button */
  .btn-google {
    width: 100%; padding: 0.7rem; border: 1.5px solid #dce6f5;
    border-radius: 10px; background: #fff;
    display: flex; align-items: center; justify-content: center; gap: 0.65rem;
    font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; color: #0d1b2e;
    cursor: pointer; transition: all 0.14s; margin-bottom: 1rem;
  }
  .btn-google:hover { background: #f7f9fc; border-color: #b0c4de; }

  /* Divider */
  .divider-text {
    display: flex; align-items: center; gap: 0.75rem;
    margin-bottom: 1rem; color: #a0b4cc; font-size: 12.5px;
  }
  .divider-text::before, .divider-text::after {
    content: ''; flex: 1; height: 1px; background: #dce6f5;
  }

  .fields { display: flex; flex-direction: column; gap: 0.9rem; }
  .field  { display: flex; flex-direction: column; gap: 0.3rem; }
  .field-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.1em; color: #7a90a8; }

  .input-wrap { position: relative; }
  .ico { position: absolute; left: 0.85rem; top: 50%; transform: translateY(-50%); color: #a0b4cc; width: 16px; height: 16px; pointer-events: none; }
  .inp {
    width: 100%; padding: 0.68rem 0.85rem 0.68rem 2.75rem;
    border: 1.5px solid #dce6f5; border-radius: 10px;
    font-family: 'DM Sans', sans-serif; font-size: 14px; color: #0d1b2e;
    background: #f4f7fa; outline: none;
    transition: border-color 0.14s, box-shadow 0.14s, background 0.14s;
  }
  .inp:focus { border-color: #0047AB; box-shadow: 0 0 0 3px rgba(0,71,171,0.1); background: #fff; }
  .inp::placeholder { color: #a8bcd0; }

  .error {
    background: #fde8e8; border: 1px solid #f5b0b0; border-radius: 8px;
    padding: 0.6rem 0.85rem; font-size: 13px; color: #c0392b; font-weight: 600;
  }

  .btn-submit {
    width: 100%; padding: 0.78rem;
    background: linear-gradient(135deg, #0047AB, #0060d6); color: #fff;
    font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 700;
    border: none; border-radius: 10px; cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,71,171,0.38);
    transition: filter 0.14s, transform 0.14s;
  }
  .btn-submit:hover:not(:disabled) { filter: brightness(1.1); transform: translateY(-1px); }
  .btn-submit:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

  .switch { margin-top: 1.5rem; text-align: center; font-size: 13.5px; color: #6b84a0; }
  .switch-btn { background: none; border: none; cursor: pointer; color: #0047AB; font-weight: 700; font-size: 13.5px; font-family: 'DM Sans', sans-serif; margin-left: 0.3rem; text-decoration: underline; }

  .login-footer { font-size: 12px; color: #8fa3bc; text-align: center; }
</style>
