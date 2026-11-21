/* Current-season pages use a separate dataset so Seasons 1–4 stay in the archive.
 * Team: {id,name,logo,colors:{primary,secondary}}.
 * Player: {id,name,teamId,position,number,model,stats:{...archive stat keys}}.
 * Game: {id,week,date (ISO 8601 with offset),homeTeamId,awayTeamId,status,
 *        homeScore,awayScore}. A final result requires both scores.
 * Game log: {playerId,gameId,stats}; award: {playerId,label,detail}.
 */
window.GFASeason = (() => {
  let season;
  const current = () => season;
  const label = () => season.name;
  const empty = (title, detail) => `<div class="season-empty"><span class="season-empty-mark" aria-hidden="true">${esc(season.id)}</span><h3>${esc(title)}</h3><p>${esc(detail)}</p></div>`;
  const team = id => season.teams.find(t => t.id === id);
  const teamName = id => team(id)?.name || 'Team to be announced';
  const teamHref = id => `#team/${enc(season.id)}/${enc(id)}`;
  const playerHref = p => `#player/${enc(p.id || p.name)}`;
  const logo = t => t?.logo ? `<img src="${esc(asset(t.logo))}" alt="${esc(t.name)} logo">` : `<span aria-hidden="true">${esc(initials(t?.name || 'GFA'))}</span>`;
  const asset = value => /^(?:https?:\/\/|\/?assets\/)/i.test(value || '') ? value : '';
  const colors = t => {
    const color = value => /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value || '') ? value : null;
    return `--team-primary:${color(t?.colors?.primary) || '#07152d'};--team-secondary:${color(t?.colors?.secondary) || '#ed243d'}`;
  };
  const validScore = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const final = g => g.status === 'final' && validScore(g.homeScore) && validScore(g.awayScore);
  const timeValue = g => g.date ? Date.parse(g.date) : NaN;
  const order = games => [...games].sort((a,b) => (Number(a.week) || Infinity) - (Number(b.week) || Infinity) || (timeValue(a) || Infinity) - (timeValue(b) || Infinity));
  function dateMarkup(g) {
    if (!g.date || !Number.isFinite(timeValue(g))) return '<span>Time to be announced</span>';
    const date = new Date(g.date);
    const text = new Intl.DateTimeFormat('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York',timeZoneName:'short'}).format(date);
    return `<time datetime="${esc(g.date)}">${esc(text)}</time>`;
  }
  function records() {
    const rows = new Map(season.teams.map(t => [t.id,{team:t,w:0,l:0,t:0,pf:0,pa:0,gp:0}]));
    season.games.filter(final).forEach(g => {
      const h = rows.get(g.homeTeamId), a = rows.get(g.awayTeamId);
      if (!h || !a) return;
      const hs=Number(g.homeScore), as=Number(g.awayScore);
      h.gp++; a.gp++; h.pf+=hs; h.pa+=as; a.pf+=as; a.pa+=hs;
      if (hs>as) {h.w++;a.l++;} else if(as>hs) {a.w++;h.l++;} else {h.t++;a.t++;}
    });
    return [...rows.values()].sort((a,b) => ((b.w+b.t*.5)/(b.gp||1))-((a.w+a.t*.5)/(a.gp||1)) || (b.pf-b.pa)-(a.pf-a.pa) || a.team.name.localeCompare(b.team.name));
  }
  function scheduleMarkup(games, perspective) {
    if (!games.length) return empty('Schedule coming soon', `The ${label()} matchups and game times will appear here once announced.`);
    return `<div class="season-games">${order(games).map(g => {
      const done=final(g), opponent=perspective ? (g.homeTeamId===perspective ? g.awayTeamId : g.homeTeamId) : null;
      const own=perspective ? Number(g.homeTeamId===perspective?g.homeScore:g.awayScore) : null;
      const other=perspective ? Number(g.homeTeamId===perspective?g.awayScore:g.homeScore) : null;
      const result=done&&perspective ? (own>other?'W':own<other?'L':'T') : '';
      return `<article class="season-game"><div class="season-game-meta"><span>${g.week ? `WEEK ${esc(g.week)}` : esc(label())}</span><span class="game-status ${done?'is-final':''}">${done ? (result ? `${result} · FINAL` : 'FINAL') : g.status==='postponed'?'POSTPONED':'UPCOMING'}</span></div><div class="season-matchup">${[g.awayTeamId,g.homeTeamId].map(id=>`<a href="${teamHref(id)}" class="season-game-team"><span class="season-logo">${logo(team(id))}</span><span>${esc(teamName(id))}<small>${id===g.homeTeamId?'HOME':'AWAY'}</small></span><strong>${done?esc(id===g.homeTeamId?g.homeScore:g.awayScore):'—'}</strong></a>`).join('')}</div><div class="season-game-time">${dateMarkup(g)}${opponent?`<span>${g.homeTeamId===perspective?'vs.':'at'} ${esc(teamName(opponent))}</span>`:''}</div></article>`;
    }).join('')}</div>`;
  }
  function teamsMarkup() {
    if (!season.teams.length) return empty('Teams coming soon', `Confirmed ${label()} teams and rosters will be announced here.`);
    return `<div class="team-grid season-team-grid">${season.teams.map(t=>`<a class="team-card season-team-card" href="${teamHref(t.id)}" style="${colors(t)}"><span class="season-logo">${logo(t)}</span><h3>${esc(t.name)}</h3><p>${season.players.filter(p=>p.teamId===t.id).length} players · ${esc(label())}</p><span class="season-card-link">Roster & schedule</span></a>`).join('')}</div>`;
  }
  function tabs(active) {
    return `<nav class="season-nav" aria-label="${esc(label())} navigation">${[['home','Overview'],[`games/${season.id}`,'Schedule'],[`teams/${season.id}`,'Teams'],[`standings/${season.id}`,'Standings'],[`stats/${season.id}`,'Stats']].map(([href,text])=>`<a href="#${href}" ${active===text?'aria-current="page"':''}>${text}</a>`).join('')}</nav>`;
  }
  function homePage() {
    const upcoming=order(season.games.filter(g=>!final(g))).slice(0,4);
    const recent=order(season.games.filter(final)).reverse().slice(0,4);
    main.innerHTML=`<section class="hero season-hero"><img class="hero-img" src="assets/players.jpg?v=20261119-complete" alt="GFA Gridiron players"><div class="hero-content"><div class="eyebrow">${esc(season.status==='preseason'?'A NEW ERA':label())}</div><h1>GFA<br><em>SEASON ${esc(season.id)}</em></h1><p>New season. Same legacy.<br>The home of GFA’s next chapter.</p><span class="season-status">${esc(season.status==='preseason'?'PRESEASON':season.status==='complete'?'SEASON COMPLETE':'REGULAR SEASON')}</span><div class="actions"><a class="btn" href="#games/${enc(season.id)}">SEASON SCHEDULE</a><a class="btn secondary" href="#teams/${enc(season.id)}">EXPLORE TEAMS</a></div></div><span class="hero-label">GRIDIRON / GFA</span></section>${tabs('Overview')}<div class="wrap season-home"><section aria-labelledby="upcoming-title"><div class="section-head"><div><div class="eyebrow">${esc(label())}</div><h2 id="upcoming-title">UPCOMING GAMES</h2></div><a class="text-link" href="#games/${enc(season.id)}">Full schedule</a></div>${upcoming.length?scheduleMarkup(upcoming):season.games.length?empty('No upcoming games scheduled','Check the full schedule for completed games and future matchups.'):scheduleMarkup([])}</section>${recent.length?`<section class="season-section"><div class="section-head"><h2>LATEST RESULTS</h2></div>${scheduleMarkup(recent)}</section>`:''}<section class="season-section" aria-labelledby="season-teams-title"><div class="section-head"><h2 id="season-teams-title">SEASON ${esc(season.id)} TEAMS</h2><a class="text-link" href="#teams/${enc(season.id)}">All teams</a></div>${teamsMarkup()}</section><section class="season-history-card"><div><div class="eyebrow">FOUR SEASONS BUILT THE FOUNDATION</div><h2>THE LEGACY STAYS.</h2><p>Champions, players, stats, and results from Seasons 1–4 remain in the archive.</p></div><a class="btn secondary" href="#seasons">EXPLORE THE ARCHIVE</a></section><section class="season-event"><div><span class="tag">TURKEY BOWL TOURNAMENT WINNERS</span><h3>NO FEAST NO PEACE</h3><p>November 20, 2026</p></div><a class="text-link" href="halloween-horror-nights/#turkey-bowl-winners">View winners</a><a class="text-link" href="halloween-horror-nights/">Past tournament results</a></section></div>`;
    document.title=`${label()} | GFA Gridiron`;
  }
  function schedulePage() {
    main.innerHTML=head(label(),'Schedule','Every matchup, upcoming game, and final result.')+tabs('Schedule')+`<div class="wrap"><div class="toolbar"><label>Team <select id="schedule-team"><option value="">All teams</option>${season.teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></label><label>Status <select id="schedule-status"><option value="all">All games</option><option value="upcoming">Upcoming</option><option value="final">Results</option></select></label></div><div id="season-schedule"></div><p class="notes">Game times are shown in Eastern Time.</p></div>`;
    const draw=()=>{const id=document.querySelector('#schedule-team').value,status=document.querySelector('#schedule-status').value;const games=season.games.filter(g=>(!id||g.homeTeamId===id||g.awayTeamId===id)&&(status==='all'||(status==='final'?final(g):!final(g))));document.querySelector('#season-schedule').innerHTML=games.length?scheduleMarkup(games,id):empty(season.games.length?'No games match these filters':'Schedule coming soon',season.games.length?'Choose another team or status to see more games.':`${label()} matchups and game times will appear here once announced.`);};
    document.querySelector('#schedule-team').onchange=draw;document.querySelector('#schedule-status').onchange=draw;draw();
  }
  function teamsPageCurrent() { main.innerHTML=head(label(),'Teams','Explore each team’s roster and full season schedule.')+tabs('Teams')+`<div class="wrap">${teamsMarkup()}</div>`; }
  function standingsPageCurrent() {
    const rows=records();
    main.innerHTML=head(label(),'Standings','Regular-season records and results.')+tabs('Standings')+`<div class="wrap">${rows.length?`<div class="panel table-scroll"><table><thead><tr><th>TEAM</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th><th>DIFF</th></tr></thead><tbody>${rows.map(r=>`<tr><td><a href="${teamHref(r.team.id)}">${esc(r.team.name)}</a></td>${[r.w,r.l,r.t,r.pf,r.pa,r.pf-r.pa].map(n=>`<td>${fmt(n)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="notes">Ordered by winning percentage, then point differential. Official playoff tiebreakers will be applied when confirmed.</p>`:empty('Standings coming soon','The standings will be ready when the Season I teams are confirmed.')}</div>`;
  }
  function statsPageCurrent() {
    main.innerHTML=head(label(),'Player statistics','Season I performances, organized by stat category.')+tabs('Stats')+`<div class="wrap"><div class="toolbar"><label>Category <select id="current-stat-category">${Object.keys(categories).map(k=>`<option>${k}</option>`).join('')}</select></label><input id="current-player-search" type="search" aria-label="Find a Season I player" placeholder="Search player name…"></div><div id="current-stats" class="panel"></div></div>`;
    const draw=()=>{const cat=document.querySelector('#current-stat-category').value,q=document.querySelector('#current-player-search').value.toLowerCase(), players=season.players.filter(p=>p.stats&&p.name.toLowerCase().includes(q)).sort((a,b)=>num(b.stats[primary[cat]])-num(a.stats[primary[cat]]));document.querySelector('#current-stats').innerHTML=players.length?`<div class="table-scroll"><table><thead><tr><th>PLAYER</th>${categories[cat].map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${players.map(p=>`<tr><td><a href="${playerHref(p)}">${esc(p.name)}</a></td>${categories[cat].map(k=>`<td>${fmt(p.stats[k],k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty(q?'No players match this search':'Stats coming soon',q?'Try another player name.':'Player statistics will appear here as Season I games are played.');};
    document.querySelector('#current-stat-category').onchange=draw;document.querySelector('#current-player-search').oninput=draw;draw();
  }
  function teamPageCurrent(id) {
    const t=team(id)||season.teams.find(t=>t.name===id);if(!t)return missing();
    const roster=season.players.filter(p=>p.teamId===t.id),r=records().find(r=>r.team.id===t.id);
    main.innerHTML=`<section class="team-profile-header" style="${colors(t)}"><a class="profile-back" href="#teams/${enc(season.id)}">All ${esc(label())} teams</a><div class="team-profile-heading"><span class="season-logo">${logo(t)}</span><div><div class="eyebrow">${esc(label())}</div><h1>${esc(t.name)}</h1><p>${r.w}–${r.l}${r.t?`–${r.t}`:''} · ${esc(label())}</p></div></div></section><div class="wrap"><section><div class="section-head"><h2>FULL ROSTER</h2><span class="tag">${roster.length} PLAYERS</span></div>${roster.length?`<div class="panel table-scroll"><table><thead><tr><th>PLAYER</th><th>NUMBER</th><th>POSITION</th></tr></thead><tbody>${roster.map(p=>`<tr><td><a class="roster-player" href="${playerHref(p)}">${asset(p.model)?`<img src="${esc(asset(p.model))}" alt="" loading="lazy">`:''}${esc(p.name)}</a></td><td>${p.number===undefined||p.number===null?'—':esc(p.number)}</td><td>${esc(p.position||'—')}</td></tr>`).join('')}</tbody></table></div>`:empty('Roster coming soon','The confirmed roster will appear here when announced.')}</section><section class="season-section"><div class="section-head"><h2>FULL SEASON SCHEDULE</h2></div>${scheduleMarkup(season.games.filter(g=>g.homeTeamId===t.id||g.awayTeamId===t.id),t.id)}</section></div>`;
    document.title=`${t.name} | ${label()}`;
  }
  function playerPageCurrent(identifier) {
    const normal=s=>String(s||'').toLowerCase();
    const p=season.players.find(p=>p.id===identifier||normal(p.name)===normal(identifier));
    const name=p?.name||identifier;
    const career=D.players.all.find(p=>normal(p['Player Name'])===normal(name));
    const archive=[1,2,3,4].flatMap(s=>(D.players[s]||[]).filter(p=>normal(p['Player Name'])===normal(name)).map(p=>({s,p})));
    const oldAwards=D.awards.filter(a=>normal(a.name)===normal(name));
    const rosterEntries=[...Object.values(D.rosters||{}).flatMap(teams=>Object.values(teams).flat()),...Object.values(D.rosters4||{}).flatMap(players=>Object.entries(players).map(([name,pos])=>({name,pos})))];
    const rosterEntry=rosterEntries.find(entry=>normal(entry.name)===normal(name));
    const championEntry=(D.champions||[]).flatMap(c=>c.roster).find(([,player])=>normal(player)===normal(name));
    const newAwards=p?season.awards.filter(a=>a.playerId===p.id):[];
    if(!p&&!career&&!archive.length&&!oldAwards.length&&!rosterEntry&&!championEntry)return missing();
    const t=p?team(p.teamId):null,position=p?.position||career?.POS||archive.at(-1)?.p.POS||rosterEntry?.pos||championEntry?.[0];
    const hasNumber=p?.number!==undefined&&p?.number!==null&&p?.number!=='';
    const image=asset(p?.model), stats=p?p.stats:career;
    const header=`<section class="player-profile-header" style="${colors(t)}"><a class="profile-back" href="${t?teamHref(t.id):'#stats/all'}">${t?esc(t.name)+' roster':'Career statistics'}</a><div class="player-profile-layout"><div class="player-model ${image?'has-model':''}">${image?`<img src="${esc(image)}" alt="${esc(name)} player model">`:`<div class="player-placeholder" aria-hidden="true">${esc(hasNumber?p.number:initials(name))}</div>`}</div><div class="player-identity"><div class="eyebrow">${p?esc(label()):'GFA PLAYER ARCHIVE'}</div><h1>${esc(name)}</h1><div class="player-details">${hasNumber?`<span>#${esc(p.number)}</span>`:''}${position?`<span>${esc(position)}</span>`:''}${t?`<a href="${teamHref(t.id)}">${esc(t.name)}</a>`:'<span>Seasons 1–4</span>'}</div>${t?`<span class="profile-team-logo season-logo">${logo(t)}</span>`:''}</div></div></section>`;
    main.innerHTML=header+`<div class="profile-tabbar" role="tablist" aria-label="Player profile sections">${['Overview','Stats','Game Log','Career','Awards'].map((tab,i)=>`<button type="button" role="tab" id="profile-tab-${i}" aria-controls="player-profile-content" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-profile-tab="${i}">${tab}</button>`).join('')}</div><div class="wrap"><div id="player-profile-content" role="tabpanel" tabindex="0" aria-labelledby="profile-tab-0"></div></div>`;
    const summary=()=>stats?`<div class="summary-grid">${(position==='QB'?[['PASS YARDS','Pass Yards'],['PASS TDs','Pass TDs'],['COMPLETION %','Comp %'],['GAMES','Games Played']]:position==='LINE'||position==='OL'?[['BLOCKS','Blocks'],['SACKS','Sacks'],['TACKLES','Tackles'],['GAMES','Games Played']]:[['REC YARDS','Rec Yards'],['REC TDs','Rec TDs'],['RECEPTIONS','Receptions'],['GAMES','Games Played']]).map(([title,key])=>`<div><small>${title}</small><strong>${fmt(stats[key],key)}</strong></div>`).join('')}</div>`:empty('Season stats coming soon','Statistics will be added as games are played.');
    const archiveTable=()=>archive.length?`<div class="panel table-scroll"><table><thead><tr><th>SEASON</th>${['Games Played','Pass Yards','Pass TDs','Rec Yards','Rec TDs','Tackles','Sacks','Blocks'].map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${archive.map(({s,p})=>`<tr><td><a href="#stats/${s}">Season ${s}</a></td>${['Games Played','Pass Yards','Pass TDs','Rec Yards','Rec TDs','Tackles','Sacks','Blocks'].map(k=>`<td>${fmt(p[k],k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="notes">Historical seasons match the player name recorded in the archive.</p>`:empty('No archived seasons','No Seasons 1–4 statistics are recorded under this player name.');
    const awardsMarkup=()=>oldAwards.length||newAwards.length?`<div class="award-grid">${oldAwards.map(awardCard).join('')}${newAwards.map(a=>`<article class="award"><span class="tag">${esc(label())}</span><h3>${esc(a.label)}</h3><p>${esc(a.detail||'')}</p></article>`).join('')}</div>`:empty('No awards recorded','Player awards will appear here when announced.');
    function draw(tab) {
      const content=document.querySelector('#player-profile-content');
      document.querySelectorAll('[data-profile-tab]').forEach((button,i)=>{button.setAttribute('aria-selected',String(i===tab));button.tabIndex=i===tab?0:-1;});
      content.setAttribute('aria-labelledby',`profile-tab-${tab}`);
      if(tab===0)content.innerHTML=`<div class="section-head"><h2>${p?esc(label())+' OVERVIEW':'CAREER OVERVIEW'}</h2></div>${summary()}${t?`<div class="notice"><strong>${esc(t.name)}</strong><p><a class="text-link" href="${teamHref(t.id)}">View full roster and team schedule</a></p></div>`:'<p class="notes">Career overview reflects the Seasons 1–4 archive.</p>'}`;
      if(tab===1)content.innerHTML=`<div class="section-head"><h2>${p?esc(label()):'CAREER'} STATISTICS</h2></div>${stats?Object.entries(categories).map(([category,cols])=>`<section class="profile-stat-section"><h3>${esc(category)}</h3><div class="panel table-scroll"><table><thead><tr>${cols.map(k=>`<th>${esc(k)}</th>`).join('')}</tr></thead><tbody><tr>${cols.map(k=>`<td>${fmt(stats[k],k)}</td>`).join('')}</tr></tbody></table></div></section>`).join(''):empty('Statistics coming soon','Statistics will be added as games are played.')}`;
      if(tab===2){const logs=p?season.gameLogs.filter(log=>log.playerId===p.id):[];content.innerHTML=`<div class="section-head"><h2>GAME LOG</h2></div>${logs.length?`<div class="panel table-scroll"><table><thead><tr><th>GAME</th><th>PASS YDS</th><th>REC YDS</th><th>REC TDs</th><th>TACKLES</th><th>SACKS</th><th>BLOCKS</th></tr></thead><tbody>${logs.map(log=>{const g=season.games.find(g=>g.id===log.gameId);const opponent=g?(g.homeTeamId===p.teamId?g.awayTeamId:g.homeTeamId):null;return `<tr><td>${g?`Week ${esc(g.week||'—')} · ${esc(teamName(opponent))}`:'Game'} </td>${['Pass Yards','Rec Yards','Rec TDs','Tackles','Sacks','Blocks'].map(k=>`<td>${fmt(log.stats?.[k],k)}</td>`).join('')}</tr>`;}).join('')}</tbody></table></div>`:empty('Game log coming soon',p?'Individual game performances will appear here after results are recorded.':'Individual game logs are not available in the Seasons 1–4 archive.')}`;}
      if(tab===3)content.innerHTML=`<div class="section-head"><h2>SEASON HISTORY</h2></div>${p?`<div class="notice"><strong>${esc(label())}</strong><p>${t?esc(t.name):'Team to be announced'}${hasNumber?' · #'+esc(p.number):''}${position?' · '+esc(position):''}</p></div>`:''}${archiveTable()}`;
      if(tab===4)content.innerHTML=`<div class="section-head"><h2>PLAYER AWARDS</h2></div>${awardsMarkup()}`;
    }
    const buttons=[...document.querySelectorAll('[data-profile-tab]')];
    buttons.forEach((button,i)=>{button.onclick=()=>draw(i);button.onkeydown=e=>{let index;if(e.key==='ArrowRight')index=(i+1)%buttons.length;else if(e.key==='ArrowLeft')index=(i+buttons.length-1)%buttons.length;else if(e.key==='Home')index=0;else if(e.key==='End')index=buttons.length-1;else return;e.preventDefault();draw(index);buttons[index].focus();};});
    draw(0);document.title=`${name} | GFA Player Profile`;
  }
  function route(page,parts) {
    if(!season)return false;
    if(page==='home'||page==='season'&&parts[1]===season.id)homePage();
    else if(page==='player')playerPageCurrent(decodeURIComponent(parts[1]||''));
    else if(parts[1]===season.id&&['games','schedule','teams','team','standings','stats'].includes(page))({games:schedulePage,schedule:schedulePage,teams:teamsPageCurrent,team:()=>teamPageCurrent(decodeURIComponent(parts[2]||'')),standings:standingsPageCurrent,stats:statsPageCurrent})[page]();
    else return false;
    if(!['home','team','player','season'].includes(page))document.title=`${page==='games'||page==='schedule'?'Schedule':page.charAt(0).toUpperCase()+page.slice(1)} | ${label()}`;
    return true;
  }
  function init(data) {
    season=data;
    document.querySelector('.topline span:last-child').textContent=`${label().toUpperCase()} / ${season.status==='preseason'?'COMING SOON':'CURRENT SEASON'}`;
    document.querySelectorAll('header nav [data-current-page]').forEach(a=>a.href=`#${a.dataset.currentPage}/${enc(season.id)}`);
  }
  return {init,route,current};
})();

