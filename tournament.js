/* GFA tournament winners, leaders, and next-event information. */
window.GFATournament = {
  assetRoot: new URL('.', document.currentScript.src),
  render() {
    const main = document.querySelector('main');
    document.body.classList.add('tourney-page');
    const winnersGraphic = new URL('assets/halloween-tournament-winners.jpg', this.assetRoot).href;
    const turkeyLeadersGraphic = new URL('assets/turkey-bowl-leaders-2026.png', this.assetRoot).href;
    const turkeyWinnersGraphic = new URL('assets/turkey-bowl-winners-2026.jpg', this.assetRoot).href;
    const leadersGraphic = new URL('assets/halloween-tournament-leaders.png', this.assetRoot).href;
    main.innerHTML = `
      <section class="tourney-results-section" id="halloween-winners" aria-labelledby="halloween-winners-title">
        <div class="tourney-section-heading">
          <div><p class="tourney-section-label">GFA TOURNAMENT WINNERS</p><h1 id="halloween-winners-title">HALLOWEEN HORROR NIGHTS</h1></div>
          <p class="tourney-section-date">October 24, 2026</p>
        </div>
        <div class="tourney-hero tourney-gallery" aria-label="Halloween Horror Nights tournament results">
          <figure class="tourney-art-card">
            <figcaption class="tourney-eventline"><span>HALLOWEEN HORROR NIGHTS · 2026</span><span>TOURNAMENT WINNERS</span></figcaption>
            <img class="tourney-winner-art" src="${winnersGraphic}" alt="Halloween Horror Nights Tournament Winners graphic. JBX, DongFrog, Eden, Flows, Sushi, Deion, and Vishy are listed as winners." width="1920" height="1080" fetchpriority="high">
          </figure>
          <figure class="tourney-art-card">
            <figcaption class="tourney-eventline"><span>OFFICIAL TOURNAMENT LEADERS</span><span>TOURNAMENT MVP · JBX</span></figcaption>
            <img class="tourney-leader-art" src="${leadersGraphic}" alt="Halloween tournament statistical leaders for passing, rushing, receiving, touchdowns, tackles, sacks, interceptions, and blocks, with JBX named Tournament MVP." width="1920" height="1080" loading="lazy">
          </figure>
        </div>
      </section>
      <section class="tourney-results-section" id="turkey-bowl-winners" aria-labelledby="turkey-winners-title">
        <div class="tourney-section-heading">
          <div><p class="tourney-section-label">CHAMPIONS · NO FEAST NO PEACE</p><h2 id="turkey-winners-title">TURKEY BOWL TOURNAMENT WINNERS</h2></div>
          <p class="tourney-section-date">November 20, 2026</p>
        </div>
        <div class="tourney-hero tourney-gallery tourney-turkey-gallery" aria-label="Turkey Bowl tournament results">
          <figure class="tourney-art-card">
            <figcaption class="tourney-eventline"><span>TURKEY BOWL · 2026</span><span>NO FEAST NO PEACE</span></figcaption>
            <img class="tourney-winner-art" src="${turkeyWinnersGraphic}" alt="Turkey Bowl Tournament Winners: No Feast No Peace. Icczz, Death, Kenny, Eden, RJ, Stach, and Velcarus." width="1672" height="941" loading="lazy">
          </figure>
          <figure class="tourney-art-card">
            <figcaption class="tourney-eventline"><span>OFFICIAL TOURNAMENT LEADERS</span><span>TOURNAMENT MVP · JAX</span></figcaption>
            <img class="tourney-leader-art" src="${turkeyLeadersGraphic}" alt="Turkey Bowl official tournament leaders in passing, rushing, receiving, touchdowns, tackles, sacks, interceptions, and blocks. Tournament MVP Jax: 643 receiving yards, 44 tackles, 12 sacks, and 7 touchdowns across 4 appearances." width="1672" height="941" loading="lazy">
          </figure>
        </div>
      </section>`;
    document.title = 'GFA Tournament Winners | Gridiron';
  }
};

