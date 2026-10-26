/* GFA tournament winners and next-event information. */
window.GFATournament = {
  assetRoot: new URL('.', document.currentScript.src),
  render() {
    const main = document.querySelector('main');
    document.body.classList.add('tourney-page');
    const winnersGraphic = new URL('assets/halloween-tournament-winners.jpg', this.assetRoot).href;
    main.innerHTML = `
      <section class="tourney-hero" aria-labelledby="tourney-title">
        <div class="tourney-eventline"><span>GFA · TOURNAMENT WINNERS</span><span>HALLOWEEN HORROR NIGHTS · 2026</span></div>
        <div class="tourney-hero-stage">
          <img class="tourney-winner-art" src="${winnersGraphic}" alt="Halloween Horror Nights Tournament Winners graphic. JBX, DongFrog, Eden, Flows, Sushi, Deion, and Vishy are listed as winners." width="1920" height="1080" fetchpriority="high">
        </div>
      </section>
      <section class="tourney-next-wrap" aria-labelledby="next-tourney-heading">
        <article class="tourney-next-card">
          <div><div class="eyebrow">COMING UP</div><h2 id="next-tourney-heading">NEXT TOURNAMENT</h2><p>Details for the next GFA tournament will be posted here.</p></div>
          <span class="tourney-tbd">TBD</span>
        </article>
      </section>`;
    document.title = 'GFA Tournament Winners | Gridiron';
  }
};
