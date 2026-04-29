(() => {
  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme(event = colorSchemeQuery) {
    document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
  }

  applyTheme();
  colorSchemeQuery.addEventListener('change', applyTheme);
})();
