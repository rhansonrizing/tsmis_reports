  // ── Bootstrap ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Default reference date to today
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('refDate').value = today;

    document.getElementById('reportSelect').addEventListener('change', function () {
      this.classList.toggle('has-value', !!this.value);
      // Enable mode buttons now that a report is selected
      document.querySelectorAll('.mode-btn').forEach(b => { b.disabled = false; b.classList.remove('active'); });
      document.getElementById('appForm').style.display      = 'none';
      document.getElementById('controlsGrid').style.display = 'none';
      resetModeSelections();
      clearResults();
    });

    populateCounties();
    setupValidation();
    initAuth();
  });
