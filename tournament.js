/* Halloween Horror Nights tournament signup. Discord identity is checked server-side. */
window.GFATournament = {
  assetRoot: new URL('.', document.currentScript.src),
  render() {
    const main = document.querySelector('main');
    document.body.classList.add('tourney-page');
    const playerArt = new URL('assets/halloween-players.webp', this.assetRoot).href;
    const eventLogo = new URL('assets/halloween-gfa.webp', this.assetRoot).href;
    main.innerHTML = `
      <section class="tourney-hero" aria-labelledby="tourney-title">
        <div class="tourney-eventline"><span>GFA · HALLOWEEN EVENT</span><time datetime="2026-10-24">SATURDAY, OCTOBER 24, 2026</time></div>
        <div class="tourney-hero-stage">
          <img class="tourney-player-art" src="${playerArt}" alt="Gridiron players under a Halloween moon with pumpkins and a haunted castle" width="1672" height="941" fetchpriority="high">
          <div class="tourney-hero-copy">
            <div class="eyebrow">GRIDIRON AFTER DARK</div>
            <h1 id="tourney-title"><span>HALLOWEEN</span><span>HORROR NIGHTS</span><em>TOURNEY</em></h1>
            <a class="btn tourney-btn" href="#tourney-signup">SIGN UP FOR OCTOBER 24 <span>↓</span></a>
          </div>
          <span class="tourney-hero-mark" aria-hidden="true">GFA / 10.24.26</span>
        </div>
      </section>
      <div class="wrap tourney-wrap">
        <section class="tourney-info">
          <div class="tourney-brand-card">
            <img src="${eventLogo}" alt="GFA Halloween shield with orange and purple lighting" width="1254" height="1254" loading="lazy">
            <div><div class="eyebrow">THE GFA HALLOWEEN TOURNEY</div><h2>OCTOBER 24.<br>GET IN THE GAME.</h2><p>Enter your details and verify Discord to join the tournament.</p></div>
          </div>
          <h3 class="tourney-how-heading">HOW TO SIGN UP</h3>
          <ol class="tourney-steps">
            <li><strong>Enter your details</strong><p>Name, position, and Discord username.</p></li>
            <li><strong>Verify your Discord</strong><p>Sign in and confirm your account.</p></li>
            <li><strong>Join GFA. Get your role.</strong><p>Finish signup to receive the Tournament role.</p></li>
          </ol>
          <p class="tourney-note">Already in the server? You’ll receive the role there. Your signup details are visible to GFA organizers.</p>
          <a class="text-link" href="https://officialgfa.com">← Back to GFA</a>
        </section>
        <section class="tourney-form-card" id="tourney-signup" aria-labelledby="signup-heading">
          <div class="tourney-form-top"><span class="eyebrow">PLAYER REGISTRATION</span><span class="tourney-form-date">10.24.26</span></div>
          <h2 id="signup-heading">CLAIM YOUR SPOT.</h2>
          <p class="tourney-form-intro">Your entry starts here.</p>
          <form id="tourney-form" method="post" autocomplete="on">
            <div class="tourney-fields">
              <div><label for="tourney-name">Name</label><input id="tourney-name" name="name" placeholder="Your player name" required maxlength="64" autocomplete="nickname"></div>
              <div><label for="tourney-position">Position</label><input id="tourney-position" name="position" placeholder="e.g. WR / DB" required maxlength="40" list="tourney-positions"></div>
              <div class="tourney-full-field"><label for="tourney-discord">Discord name</label><input id="tourney-discord" name="discord_name" placeholder="Your Discord username" required maxlength="64" autocapitalize="none" spellcheck="false" autocomplete="off"></div>
            </div>
            <datalist id="tourney-positions"><option value="QB"><option value="WR"><option value="RB"><option value="OL"><option value="DL"><option value="LB"><option value="CB"><option value="S"><option value="Flex"></datalist>
            <label class="tourney-consent"><input type="checkbox" name="consent" value="yes" required><span>I agree to verify my Discord account, join the GFA server, and receive the Tournament role when I complete signup.</span></label>
            <button class="btn tourney-btn" id="tourney-submit" type="submit" disabled>VERIFY DISCORD & SIGN UP <span>↗</span></button>
            <p class="tourney-status" id="tourney-status" role="status" aria-live="polite">Checking signup availability…</p>
          </form>
        </section>
      </div>`;
    document.title = 'Halloween Horror Nights Tourney · October 24 | GFA';
    // Keep the main route intact when scrolling to the form.
    main.querySelector('a[href="#tourney-signup"]').onclick = event => {
      event.preventDefault();
      main.querySelector('#tourney-signup').scrollIntoView({behavior: 'smooth'});
      main.querySelector('#tourney-name').focus({preventScroll: true});
    };
    const form = main.querySelector('#tourney-form');
    const status = main.querySelector('#tourney-status');
    const button = main.querySelector('#tourney-submit');
    const draftKey = 'gfa-halloween-2026-draft';
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) || '{}');
      ['name', 'position', 'discord_name'].forEach(key => { if (typeof draft[key] === 'string') form.elements[key].value = draft[key]; });
    } catch (_) { /* Storage can be unavailable in private browsing. */ }
    form.addEventListener('submit', event => {
      if (!form.action || button.disabled) { event.preventDefault(); return; }
      try { sessionStorage.setItem(draftKey, JSON.stringify(Object.fromEntries(['name', 'position', 'discord_name'].map(key => [key, form.elements[key].value])))); } catch (_) {}
      button.disabled = true;
      status.textContent = 'Opening Discord verification…';
    });
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 10000);
    fetch(new URL('tournament-config.json?v=20261013', this.assetRoot), {cache: 'no-store', signal: timeout.signal})
      .then(response => { if (!response.ok) throw Error('config'); return response.json(); })
      .then(config => {
        const origin = new URL(config.signup_origin);
        if (origin.protocol !== 'https:') throw Error('origin');
        form.action = `${origin.origin}/signup/start`;
        return fetch(`${origin.origin}/tournament/status`, {cache: 'no-store', signal: timeout.signal});
      })
      .then(response => { if (!response.ok) throw Error('server'); return response.json(); })
      .then(result => {
        if (!form.isConnected) return;
        if (result.ready && result.registration_open) {
          button.disabled = false;
          status.textContent = 'Discord will confirm your account. Review your details to finish signup.';
        } else {
          status.textContent = result.registration_open === false ? 'Registration is currently closed.' : 'Discord verification is being connected. Registration will open here once it’s ready.';
        }
      })
      .catch(() => { if (form.isConnected) status.textContent = 'Signup is temporarily unavailable. Please try again shortly.'; })
      .finally(() => clearTimeout(timer));
  }
};
addEventListener('pageshow', event => {
  if (event.persisted && document.querySelector('#tourney-form')) window.GFATournament.render();
});
