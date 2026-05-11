<script>
  import { _confirmStore } from '$lib/stores';
  import { get } from 'svelte/store';

  function ok()     { const s = get(_confirmStore); if (s) { _confirmStore.set(null); s.resolve(true);  } }
  function cancel() { const s = get(_confirmStore); if (s) { _confirmStore.set(null); s.resolve(false); } }

  function onKey(e) { if (e.key === 'Escape' && $_confirmStore) cancel(); }
</script>

<svelte:window on:keydown={onKey} />

{#if $_confirmStore}
  <div class="confirm-overlay" on:click|self={cancel}>
    <div class="confirm-box">
      {#if $_confirmStore.icon}
        <div class="confirm-icon {$_confirmStore.danger ? 'danger' : 'normal'}">
          {$_confirmStore.icon}
        </div>
      {/if}

      <div class="confirm-body">
        {#if $_confirmStore.title}
          <h3 class="confirm-title">{$_confirmStore.title}</h3>
        {/if}
        {#if $_confirmStore.message}
          <p class="confirm-msg">{$_confirmStore.message}</p>
        {/if}
      </div>

      <div class="confirm-actions">
        <button class="btn btn-ghost" on:click={cancel}>
          {$_confirmStore.cancelLabel ?? 'Cancelar'}
        </button>
        <button
          class="btn {$_confirmStore.danger ? 'btn-danger' : 'btn-primary'}"
          on:click={ok}
          autofocus
        >
          {$_confirmStore.confirmLabel ?? 'Confirmar'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-overlay {
    position: fixed; inset: 0;
    background: oklch(0 0 0 / 0.35);
    display: flex; align-items: center; justify-content: center;
    z-index: 9000;
    backdrop-filter: blur(3px);
    animation: fadeIn 0.1s ease;
  }
  .confirm-box {
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: calc(var(--radius) + 2px);
    padding: 1.5rem;
    width: 100%; max-width: 380px;
    box-shadow: var(--shadow-lg);
    animation: slideUp 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
    display: flex; flex-direction: column; gap: 1rem;
  }
  .confirm-icon {
    width: 44px; height: 44px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem;
  }
  .confirm-icon.danger  { background: var(--red-lt);     color: var(--red); }
  .confirm-icon.normal  { background: var(--primary-bg); color: var(--primary); }
  .confirm-body { display: flex; flex-direction: column; gap: 0.35rem; }
  .confirm-title { font-size: 1rem; font-weight: 700; letter-spacing: -0.01em; }
  .confirm-msg   { font-size: 13.5px; color: var(--text2); line-height: 1.5; }
  .confirm-actions {
    display: flex; gap: 0.6rem; justify-content: flex-end;
    padding-top: 0.25rem;
  }
</style>
