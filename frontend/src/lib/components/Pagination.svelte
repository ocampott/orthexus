<script>
  import { createEventDispatcher } from 'svelte';

  export let total = 0;
  export let page = 1;
  export let pageSize = 25;
  export let pageSizes = [10, 25, 50, 100];

  const dispatch = createEventDispatcher();

  $: totalPages = Math.max(1, Math.ceil(total / pageSize));
  $: from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  $: to = Math.min(page * pageSize, total);

  function goTo(p) {
    if (p < 1 || p > totalPages) return;
    dispatch('change', { page: p, pageSize });
  }

  function changeSize(e) {
    dispatch('change', { page: 1, pageSize: parseInt(e.target.value) });
  }

  // Genera páginas visibles con elipsis
  $: pages = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const out = [];
    const d = 1; // delta
    let prev = 0;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= page - d && i <= page + d)) {
        if (prev && i - prev > 1) out.push('…');
        out.push(i);
        prev = i;
      }
    }
    return out;
  })();
</script>

{#if total > 0}
  <div class="pag-bar">
    <span class="pag-info">
      {from}–{to} de {total}
    </span>

    <div class="pag-controls">
      <button class="pag-btn" disabled={page <= 1} on:click={() => goTo(page - 1)}>‹</button>

      {#each pages as p}
        {#if p === '…'}
          <span class="pag-ellipsis">…</span>
        {:else}
          <button
            class="pag-btn"
            class:active={p === page}
            on:click={() => goTo(p)}
          >{p}</button>
        {/if}
      {/each}

      <button class="pag-btn" disabled={page >= totalPages} on:click={() => goTo(page + 1)}>›</button>
    </div>

    <div class="pag-size">
      <span class="pag-size-lbl">Filas:</span>
      <select class="pag-select" value={pageSize} on:change={changeSize}>
        {#each pageSizes as s}
          <option value={s}>{s}</option>
        {/each}
      </select>
    </div>
  </div>
{/if}

<style>
  .pag-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 0.75rem;
    border-top: 1px solid var(--border);
    background: var(--bg2);
    font-size: 13px;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .pag-info { color: var(--text2); white-space: nowrap; }
  .pag-controls { display: flex; align-items: center; gap: 0.2rem; }
  .pag-btn {
    min-width: 30px; height: 30px;
    padding: 0 0.4rem;
    border: 1px solid var(--border);
    background: var(--bg3);
    border-radius: 6px;
    font-size: 13px;
    color: var(--text);
    cursor: pointer;
    font-family: var(--font);
    transition: all 0.1s;
    display: flex; align-items: center; justify-content: center;
  }
  .pag-btn:hover:not(:disabled):not(.active) { background: var(--bg4); border-color: var(--accent); }
  .pag-btn.active { background: var(--accent, #0047AB); color: #fff; border-color: var(--accent, #0047AB); font-weight: 700; }
  .pag-btn:disabled { opacity: 0.35; cursor: default; }
  .pag-ellipsis { padding: 0 0.25rem; color: var(--text3); }
  .pag-size { display: flex; align-items: center; gap: 0.4rem; }
  .pag-size-lbl { color: var(--text2); white-space: nowrap; }
  .pag-select {
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg3);
    color: var(--text);
    font-family: var(--font);
    font-size: 13px;
    cursor: pointer;
  }
</style>
