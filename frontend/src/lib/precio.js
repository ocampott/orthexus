// Formatea número como moneda Argentina: $ 10.000
export function formatearPrecioInput(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const num = parseFloat(String(valor).replace(/\./g, '').replace(',', '.'));
  if (isNaN(num)) return '';
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num);
}

// Parsea el string formateado de vuelta a número
export function parsearPrecioInput(str) {
  if (!str) return 0;
  // Remover todo excepto dígitos y coma
  const limpio = str.replace(/[^\d,]/g, '').replace(',', '.');
  return parseFloat(limpio) || 0;
}

// Svelte action para inputs de precio
// Uso: <input use:precioInput bind:value={num} />
export function precioInput(node) {
  function format() {
    const raw = node.value.replace(/[^\d,]/g, '');
    const num = parseFloat(raw.replace(',', '.'));
    if (!isNaN(num) && raw !== '') {
      const formatted = formatearPrecioInput(num);
      if (node.value !== formatted) {
        const pos = node.selectionStart;
        node.value = formatted;
        // Mantener cursor al final si estaba al final
        try { node.setSelectionRange(pos, pos); } catch {}
      }
    }
  }

  function onBlur() {
    const num = parsearPrecioInput(node.value);
    node.value = num > 0 ? formatearPrecioInput(num) : '';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onFocus() {
    // Al hacer foco, mostrar solo el número sin formato
    const num = parsearPrecioInput(node.value);
    node.value = num > 0 ? String(num) : '';
    node.select();
  }

  node.addEventListener('blur', onBlur);
  node.addEventListener('focus', onFocus);

  // Formato inicial
  const num = parsearPrecioInput(node.value);
  if (num > 0) node.value = formatearPrecioInput(num);

  return {
    destroy() {
      node.removeEventListener('blur', onBlur);
      node.removeEventListener('focus', onFocus);
    }
  };
}
