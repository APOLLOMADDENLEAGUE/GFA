/* GFA tournament winners, leaders, and next-event information. */
window.GFATournament = {
  assetRoot: new URL('.', document.currentScript.src),
  render() {
    const main = document.querySelector('main');
    document.body.classList.add('tourney-page');
    const winnersGraphic = new URL('assets/halloween-tournament-winners.jpg', this.assetRoot).href;
    const leadersGraphic = new URL('assets/halloween-tournament-leaders.png', this.assetRoot).href;
    main.innerHTML = `
      <section class="tourney-hero tourney-gallery" aria-label="Halloween Horror Nights tournament results">
        <figure class="tourney-art-card">
          <figcaption class="tourney-eventline"><span>HALLOWEEN HORROR NIGHTS · 2026</span><span>TOURNAMENT WINNERS</span></figcaption>
          <img class="tourney-winner-art" src="${winnersGraphic}" alt="Halloween Horror Nights Tournament Winners graphic. JBX, DongFrog, Eden, Flows, Sushi, Deion, and Vishy are listed as winners." width="1920" height="1080" fetchpriority="high">
        </figure>
        <figure class="tourney-art-card">
          <figcaption class="tourney-eventline"><span>OFFICIAL TOURNAMENT LEADERS</span><span>TOURNAMENT MVP · JBX</span></figcaption>
          <img class="tourney-leader-art" src="${leadersGraphic}" alt="Halloween tournament statistical leaders for passing, rushing, receiving, touchdowns, tackles, sacks, interceptions, and blocks, with JBX named Tournament MVP." width="1920" height="1080" loading="lazy">
        </figure>
      </section>
      <section class="tourney-next-wrap" aria-labelledby="next-tourney-heading">
        <article class="tourney-next-card">
          <div><div class="eyebrow">COMING UP</div><h2 id="next-tourney-heading">TURKEY BOWL<br>AUCTION TOURNAMENT</h2><p>November 20, 2026 · QB / WR / LINE / FLEX · Discord verified entry</p></div>
          <a class="btn tourney-btn" href="${new URL('turkey-bowl/', this.assetRoot).href}">SIGN UP NOW <span>↗</span></a>
        </article>
      </section>`;
    document.title = 'GFA Tournament Winners | Gridiron';
  }
};
