/* GFA tournament winners, leaders, and next-event information. */
window.GFATournament = {
  assetRoot: new URL('.', document.currentScript.src),
  render() {
    const main = document.querySelector('main');
    document.body.classList.add('tourney-page');
    const winnersGraphic = new URL('assets/halloween-tournament-winners.jpg', this.assetRoot).href;
    const turkeyWinnersGraphic = new URL('assets/turkey-bowl-winners-2026.jpg', this.assetRoot).href;
    const leadersGraphic = new URL('assets/halloween-tournament-leaders.png', this.assetRoot).href;
    main.innerHTML = `
      <section class="tourney-hero tourney-gallery" aria-label="GFA tournament results">
        <figure class="tourney-art-card" style="grid-column:1/-1">
          <figcaption class="tourney-eventline"><span>TURKEY BOWL · NOVEMBER 20, 2026</span><span>CHAMPIONS · NO FEAST NO PEACE</span></figcaption>
          <a href="${new URL('turkey-bowl/', this.assetRoot).href}" aria-label="View No Feast No Peace, Turkey Bowl Tournament Winners"><img class="tourney-winner-art" src="${turkeyWinnersGraphic}" alt="Turkey Bowl Tournament Winners: No Feast No Peace. Icczz, Death, Kenny, Eden, RJ, Stach, and Velcarus." width="1672" height="941" fetchpriority="high"></a>
        </figure>
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
          <div><div class="eyebrow">TURKEY BOWL CHAMPIONS</div><h2 id="next-tourney-heading">NO FEAST<br>NO PEACE</h2><p>November 20, 2026 · Icczz, Death, Kenny, Eden, RJ, Stach, Velcarus</p></div>
          <a class="btn tourney-btn" href="${new URL('turkey-bowl/', this.assetRoot).href}">VIEW TURKEY BOWL WINNERS</a>
        </article>
      </section>`;
    document.title = 'GFA Tournament Winners | Gridiron';
  }
};

