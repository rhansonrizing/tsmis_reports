  // ── Bootstrap ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Default reference date to today
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('refDate').value = today;

    document.getElementById('reportSelect').addEventListener('change', function () {
      // Enable mode buttons now that a report is selected
      document.querySelectorAll('.mode-btn').forEach(b => { b.disabled = false; b.classList.remove('active'); });
      document.getElementById('appForm').style.display      = 'none';
      document.getElementById('controlsGrid').style.display = 'none';
      resetModeSelections();
      clearResults();
    });

    // Custom report dropdown
    const cs      = document.getElementById('customReport');
    const csValue = cs.querySelector('.cs-value');
    const hidden  = document.getElementById('reportSelect');

    cs.querySelector('.cs-trigger').addEventListener('click', () => {
      cs.classList.toggle('is-open');
    });

    cs.querySelectorAll('.cs-option:not(.cs-disabled)').forEach(opt => {
      opt.addEventListener('click', () => {
        csValue.textContent = opt.textContent;
        cs.classList.add('has-value');
        cs.classList.remove('is-open');
        hidden.value = opt.dataset.value;
        hidden.dispatchEvent(new Event('change'));
      });
    });

    document.addEventListener('click', e => {
      if (!cs.contains(e.target)) cs.classList.remove('is-open');
    });

    populateCounties();
    setupValidation();
    initAuth();
  });
