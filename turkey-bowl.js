/* The server verifies Discord and saves the entry only after final confirmation. */
(() => {
  const form = document.querySelector('#signup-form');
  const button = document.querySelector('#connect-discord');
  const status = document.querySelector('#signup-status');
  const endpoint = new URL('/tournament/status', form.action);
  fetch(endpoint, {cache: 'no-store', signal: AbortSignal.timeout(10000)})
    .then(response => {
      if (!response.ok) throw new Error('Signup status unavailable');
      return response.json();
    })
    .then(data => {
      if (data.event_key !== form.elements.event_key.value || !data.ready || !data.registration_open) {
        button.disabled = true;
        status.textContent = 'Registration is temporarily unavailable. Please check back shortly or contact a GFA organizer.';
      } else {
        status.textContent = 'Discord verification is ready. Connect, then confirm your entry on the next screen.';
      }
    })
    .catch(() => {
      status.textContent = 'You can continue to Discord. If signup is unavailable, try again shortly or contact a GFA organizer.';
    });
  addEventListener('pageshow', () => {
    form.removeAttribute('aria-busy');
    button.querySelector('span').textContent = 'CONNECT DISCORD & CONTINUE';
  });
  form.addEventListener('submit', () => {
    form.setAttribute('aria-busy', 'true');
    button.querySelector('span').textContent = 'OPENING DISCORD…';
    status.textContent = 'Continue on Discord to verify your account. Your spot is saved after you confirm your entry.';
  });
})();
