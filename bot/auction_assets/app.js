(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cash = value => '$' + Number(value || 0).toLocaleString('en-US');
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  const view = location.pathname.endsWith('/host') ? 'host' : location.pathname.endsWith('/stream') ? 'stream' : 'captain';
  const url = v => '/auction/' + v + (demo ? '?demo=1' : '');
  const BOARD = 'https://docs.google.com/spreadsheets/d/1Jzr9S4IVFj0WbYha9ViQXHNiOswcpaT0KYRwuOkoh8I/edit';
  const DEMO_KEY = 'gfa-turkey-auction-practice-v2';
  let state, me = {role:'viewer'}, connected = false, filter = 'ALL', query = '', availableOnly = false;
  let fields = {}, busy = false, lastLot = null, lastEvent = null, toastTimer, overlayTimer, demoCaptain = null, sound = false, audioContext;
  let revealTimer, bidBannerTimer, callTimer, bidFlashTimer, bidFlash = null, effects = true;
  const music = window.GFAAuctionMusic ? new window.GFAAuctionMusic() : {playing:false,volume:.22,setVolume(){},stop(){},async start(){throw new Error('Reload the page to load the music.');}};
  let musicBusy=false, accessError='', demoBackup=null;
  const wakeUntil={};
  const channel = demo && 'BroadcastChannel' in window ? new BroadcastChannel(DEMO_KEY) : null;
  const captain = id => state.captains.find(c => c.id === id);
  const player = id => state.players.find(p => p.id === id);
  const activeCaptain = () => state.captains[state.turn];
  const effectiveMe = () => demo ? (view === 'host' ? {role:'host',name:'Practice host'} : {role:'captain',name:'Practice captain',captainId:demoCaptain || state.captains[0].id}) : me;
  const stamp = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  let fittedFullscreen=false;
  function nativeStreamFullscreen(){return Boolean(document.fullscreenElement||document.webkitFullscreenElement);}
  function streamFullscreen(){return fittedFullscreen||nativeStreamFullscreen();}
  function fitStream(){
    if(view!=='stream')return;
    const full=streamFullscreen();
    document.body.classList.toggle('broadcast-fit',full||(innerWidth>=1000&&innerHeight>=1000));
    document.body.classList.toggle('fullscreen-stream',full);
    if(full)document.documentElement.style.setProperty('--stream-fullscreen-scale',String(Math.min(innerWidth/1920,innerHeight/1080)));
    else document.documentElement.style.removeProperty('--stream-fullscreen-scale');
  }
  async function toggleStreamFullscreen(){
    if(view!=='stream')return;
    if(streamFullscreen()){
      fittedFullscreen=false;
      try{
        if(nativeStreamFullscreen()&&document.exitFullscreen)await document.exitFullscreen();
        else if(nativeStreamFullscreen())document.webkitExitFullscreen?.();
      }catch(_){}
    }else{
      fittedFullscreen=true;
      fitStream();render();
      try{
        if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'});
        else if(document.documentElement.webkitRequestFullscreen)document.documentElement.webkitRequestFullscreen();
      }catch(_){}
    }
    fitStream();render();
  }
  function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4500); }
  function beep(sold = false) {
    if (!sound) return;
    try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); const at=audioContext.currentTime;
      [sold?523:660, sold?659:880, ...(sold?[784]:[])].forEach((f,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain();o.frequency.value=f;g.gain.setValueAtTime(.04,at+i*.10);g.gain.exponentialRampToValueAtTime(.001,at+i*.10+.18);o.connect(g).connect(audioContext.destination);o.start(at+i*.1);o.stop(at+i*.1+.2);});
    } catch (_) {}
  }
  function soldOverlay(event) {
    const p=player(event.playerId),c=captain(event.captainId); if(!p||!c)return;
    if(!effects)return;clearTimeout(revealTimer);['nomination-reveal','auction-call','bid-announcement'].forEach(id=>$(id).classList.remove('visible'));
    const root=$('sold-overlay');root.classList.remove('visible');
    root.innerHTML=`<div class="cash-shower" aria-hidden="true">${Array.from({length:32},(_,i)=>`<span class="cash-note money-${i}"><b>$</b></span>`).join('')}</div><div class="celebration-streamers" aria-hidden="true">${Array.from({length:18},(_,i)=>`<i class="spark s${i}"></i>`).join('')}</div><div class="sold-card"><div class="eyebrow">THE TURKEY BOWL AUCTION</div><div class="stamp">SOLD!</div><h2>${esc(p.name)}</h2><p>TO ${esc(c.name)} · <strong>${cash(event.amount)}</strong></p>${positionPlay(p.position,event.id||p.id)}<div class="sold-subtitle">WELCOME TO THE TEAM</div></div>`;
    void root.offsetWidth;root.classList.add('visible');clearTimeout(overlayTimer);overlayTimer=setTimeout(()=>root.classList.remove('visible'),5200);beep(true);
  }
  function accept(next, animate=true) {
    if(!next || !Array.isArray(next.captains))return;
    if(state && next.revision < state.revision && !demo)return;
    if(lastLot !== (next.lot?.id || null)){delete fields['bid-amount'];delete fields['nom-player'];delete fields['opening-amount'];}lastLot=next.lot?.id || null;
    const ready=Boolean(state),event=next.lastEvent,changed=event?.id && event.id!==lastEvent;
    if(ready&&animate)next.captains.forEach(c=>{if(next.presence?.[c.id]?.online&&!state.presence?.[c.id]?.online)wakeUntil[c.id]=Date.now()+1700;});
    state=next;
    if(animate && ready && changed && event.kind==='bid'){
      bidFlash={captainId:event.captainId,until:Date.now()+1800};
      clearTimeout(bidFlashTimer);bidFlashTimer=setTimeout(()=>{bidFlash=null;render();},1800);
    }
    lastEvent=event?.id || lastEvent;render();
    if(animate && ready && changed){
      if(event.kind==='sold')soldOverlay(event);
      else if(event.kind==='nomination')nominationReveal(event);
      else if(event.kind==='call')auctionCall(state.lot?.call);
      else if(event.kind==='bid'){bidAnnouncement(event);beep();}
      else if(event.kind==='reset'||event.kind==='restore'){clearTransientEffects();toast(event.kind==='reset'?'Draft reset. Press Start Draft when ready.':'Previous draft restored.');}
      else if(event.kind==='pass'||event.kind==='sync'&&!state.lot){clearTimeout(revealTimer);$('nomination-reveal').classList.remove('visible');}
    }
  }
  function athleteSvg(){return `<svg class="athlete" viewBox="0 0 180 240" preserveAspectRatio="xMidYMax meet" fill="none" aria-hidden="true"><ellipse cx="90" cy="229" rx="59" ry="8" fill="#000" opacity=".35"/><g stroke="#0b111a" stroke-width="4" stroke-linejoin="round"><path d="m60 164-7 50 26 4 14-42 11 42 26-4-10-50Z" fill="#e4e1d7"/><path d="m59 171-7 40 10 2 10-41m37 0 9 41 10-2-6-40" fill="var(--kit,#efb54c)" stroke-width="2"/><path d="m53 210-12 14q-3 9 13 8l29-3-4-16Zm51 3 3 16 29 3q15 1 10-8l-17-14Z" fill="#252e3c"/><path d="m48 112-19 12 1 41 18 4 13-39" fill="var(--kit,#efb54c)"/><path d="m29 157-2 15 11 13 13-7-2-18Z" fill="#f3eee5"/><path d="m54 107 24-7 27 1 24 12-6 62-65 1-10-51Z" fill="var(--kit,#efb54c)"/><path d="m54 107-13 10 18 22 10-9m45-22 19 7-16 23-13-9" fill="#29303b"/><path d="m71 112 18 8 17-8 5 18-22 16-23-16Z" fill="#fff6da" stroke-width="2"/><path d="m68 146 23 10 20-10-2 17-40 1Z" fill="#121a29" opacity=".35" stroke="none"/><path d="m61 167 61-1 1 10-63 1Z" fill="#1c2432"/><path d="m83 167 16 0-1 10-15 0Z" fill="#eac57b" stroke-width="2"/><g class="bid-arm"><path d="m124 114 12 3 19-28-14-10-24 27Z" fill="var(--kit,#efb54c)"/><path d="m140 83 4-17 9-4 12 9-1 15-12 8Z" fill="#fff4da"/><path d="m148 68 10 7m-15 1 11 8" stroke="#b1b9c3" stroke-width="2"/></g><path d="M55 84q-14-32 8-47 21-15 47-2 26 11 23 46l-15 24-37 1Z" fill="var(--kit,#efb54c)"/><path d="M79 32q16-3 24 2l9 40-17 1Z" fill="#fff0d0" stroke-width="2"/><path d="M78 66q20-6 45-2l7 16-13 15-35-4Z" fill="#172638"/><path d="m83 69 30-2-25 13Z" fill="#59b8df" stroke="none" opacity=".65"/><path d="m110 84 15 1-5 20-21-2-7-17Z" fill="var(--skin,#a76d4c)"/><circle cx="66" cy="79" r="9" fill="#e9e4da"/><circle cx="66" cy="79" r="4" fill="#202735" stroke-width="2"/><path d="m87 77 53 3-3 23-37 8-17-18m16-13 0 24m17-23 2 23M91 93l47-1" stroke="#f9f4e7" stroke-width="3.5"/><path d="m60 46 14-8m40 5 10 10" stroke="#fff" stroke-opacity=".45" stroke-width="3"/></g></svg>`;}
  function footballSvg(){return '<svg viewBox="0 0 48 28" aria-hidden="true"><path d="M2 14Q24-10 46 14Q24 38 2 14Z" fill="#a7592c" stroke="#f0c083" stroke-width="2"/><path d="m17 14 14 0m-11-4 0 8m5-8 0 8m5-8 0 8" stroke="#fff0d3" stroke-width="2"/></svg>';}
  function positionPlay(position,variant){
    const catchScene=`<div class="play-scene catch-scene"><span class="incoming-ball">${footballSvg()}</span><span class="play-sprite catcher">${athleteSvg()}<span class="caught-ball">${footballSvg()}</span></span><b class="play-shout">SNAGGED!</b></div>`;
    const sack=position==='LINE'&&String(variant).charCodeAt(0)%2===0;
    const lineScene=`<div class="play-scene line-scene ${sack?'sack-play':'block-play'}"><span class="play-sprite trench-hero">${athleteSvg()}</span><span class="play-sprite trench-opponent">${athleteSvg()}</span><span class="play-impact">✦</span><b class="play-shout">${sack?'SACK!':'STONEWALL!'}</b></div>`;
    return `<div class="position-play pos-${position.toLowerCase()}" role="img" aria-label="${position==='WR'?'Wide receiver catching a pass':position==='LINE'?'Lineman '+(sack?'making a sack':'making a block'):'Flex player catching a pass and making a block'}"><span class="play-position">${esc(position)} / ${position==='WR'?'HANDS TEAM':position==='LINE'?'BUILT IN THE TRENCHES':'DO IT ALL'}</span>${position==='WR'?catchScene:position==='LINE'?lineScene:`<div class="flex-catch">${catchScene}</div><div class="flex-block">${lineScene}</div>`}</div>`;
  }
  function clearTransientEffects(){
    [overlayTimer,revealTimer,callTimer,bidBannerTimer,bidFlashTimer].forEach(clearTimeout);bidFlash=null;
    ['sold-overlay','nomination-reveal','auction-call','bid-announcement'].forEach(id=>$(id).classList.remove('visible'));
    fields={};
  }
  function nominationReveal(event){
    if(!effects)return;const p=player(event.playerId),c=captain(event.captainId);if(!p||!c)return;
    const root=$('nomination-reveal');clearTimeout(revealTimer);clearTimeout(overlayTimer);$('sold-overlay').classList.remove('visible');root.classList.remove('visible');$('auction-call').classList.remove('visible');$('bid-announcement').classList.remove('visible');
    root.innerHTML=`<div class="reveal-halo" aria-hidden="true"></div><div class="reveal-card"><div class="reveal-art">${athleteSvg()}</div><div class="reveal-copy"><div class="eyebrow">NEW NOMINATION</div><span class="reveal-position">${esc(p.position)}</span><h2>${esc(p.name)}</h2><p>Nominated by <strong>${esc(c.name)}</strong></p><div class="reveal-opening">OPENING BID <strong>${cash(event.amount)}</strong></div><span class="reveal-tagline">LET THE BIDDING BEGIN.</span></div></div>`;
    void root.offsetWidth;root.classList.add('visible');
    revealTimer=setTimeout(()=>root.classList.remove('visible'),2800);
  }
  function bidAnnouncement(event){
    if(!effects)return;const c=captain(event.captainId);if(!c)return;
    const root=$('bid-announcement');clearTimeout(bidBannerTimer);root.classList.remove('visible');$('auction-call').classList.remove('visible');
    root.innerHTML=`<span>NEW HIGH BID</span><strong>${esc(c.name)}</strong><b>${cash(event.amount)}</b>`;
    void root.offsetWidth;root.classList.add('visible');bidBannerTimer=setTimeout(()=>root.classList.remove('visible'),1800);
  }
  function auctionCall(count){
    if(!effects||!state.lot||!count)return;
    const root=$('auction-call'),lot=state.lot;clearTimeout(callTimer);root.classList.remove('visible');$('bid-announcement').classList.remove('visible');
    root.innerHTML=`<span class="call-kicker">THE AUCTIONEER</span><strong>${['','GOING ONCE','GOING TWICE','GOING THREE TIMES'][count]}</strong><small>${esc(player(lot.playerId)?.name)} · ${esc(captain(lot.leaderId)?.name)} · ${cash(lot.amount)}</small><span class="call-ticks" aria-hidden="true">${[1,2,3].map(n=>`<i class="${n<=count?'lit':''}"></i>`).join('')}</span>`;
    void root.offsetWidth;root.classList.add('visible');callTimer=setTimeout(()=>root.classList.remove('visible'),2400);
  }
  function currentBids(){
    if(!state.lot)return {};
    const bids={};
    // Compatibility for a nomination that was already open before this update.
    [...state.feed].reverse().filter(e=>e.playerId===state.lot.playerId&&e.at>=(state.lot.openedAt||0)&&['bid','nomination'].includes(e.kind)).forEach(e=>{bids[e.captainId]=e.amount;});
    return {...bids,...state.lot.bids,[state.lot.leaderId]:state.lot.amount};
  }
  function bidderPitMarkup(){
    const bids=currentBids(),sale=!state.lot&&state.sales.at(-1),leader=state.lot?.leaderId||sale?.captainId;
    return `<section class="bidder-theatre" aria-label="Live captain bid signs"><div class="theatre-title"><div><span class="eyebrow">THE AUCTION PIT</span><h2>RAISE YOUR GAME.</h2></div><span>${state.lot?'Every sign shows that QB’s latest bid.':sale?'The winning captain takes the spotlight.':'Twelve captains. Who’s making the first move?'}</span></div><div class="bidder-row">${state.captains.map((c,i)=>{
      const amount=state.lot?bids[c.id]:sale?.captainId===c.id?sale.amount:null,leading=leader===c.id;
      const recent=effects&&bidFlash?.captainId===c.id&&bidFlash.until>Date.now();
      const online=demo?(state.demoOnline?.[c.id]??![3,8,11].includes(i)):Boolean(state.presence?.[c.id]?.online);
      return `<button type="button" class="bidder-seat kit-${i} ${online?'awake':'sleeping'} ${effects&&wakeUntil[c.id]>Date.now()?'waking':''} ${leading?'leading sign-up':''} ${recent?'just-bid sign-up':''} ${sale&&leading?'winner':''}" data-action="inspect-captain" data-captain="${esc(c.id)}" aria-label="${esc(c.name)} · ${online?'Online':'Asleep · not connected'} · ${amount?cash(amount)+(leading?' · '+(sale?'Winner':'Leading bid'):' · Previous bid'):'No bid'} · ${cash(c.budget)} remaining"><span class="bidder-aura" aria-hidden="true"></span><span class="bidder-figure">${athleteSvg()}<span class="sleepy-z" aria-hidden="true">Z<span>z</span><small>z</small></span><span class="paddle-rig"><span class="bid-paddle"><span class="paddle-name">${esc(c.name)}</span><strong>${amount?cash(amount):'—'}</strong><small>${sale&&leading?'SOLD!':leading?'HIGH BID':amount?'BID PLACED':'READY'}</small></span><span class="paddle-pole"></span></span></span><span class="bidder-plaque"><strong><i class="captain-presence" aria-hidden="true"></i>${esc(c.name)}</strong><small>${cash(c.budget)} LEFT · ${c.roster.length}/6</small></span></button>`;
    }).join('')}</div></section>`;
  }
  function inspectCaptain(id){
    const c=captain(id);if(!c)return;const dialog=$('captain-dialog');
    dialog.innerHTML=`<button class="dialog-close quiet" data-action="close-captain" aria-label="Close captain details">Close</button><div class="eyebrow">QB / CAPTAIN</div><h2>${esc(c.name)}</h2><p class="captain-wallet">${cash(c.budget)} <span>remaining · ${c.roster.length}/6 drafted</span></p><div class="dialog-roster">${c.roster.map(p=>`<div><span>${esc(player(p.playerId)?.name)} <small>${esc(player(p.playerId)?.position)}</small></span><strong>${cash(p.amount)}</strong></div>`).join('')||'<p class="hint">No players drafted yet.</p>'}</div>`;
    if(!dialog.open)dialog.showModal();
  }
  function captainLinksMarkup(){
    if(view!=='host'||effectiveMe().role!=='host')return '';
    if(demo)return '<section class="captain-links"><div class="control-title">PRIVATE CAPTAIN LINKS</div><p class="hint">Copy the real QB links from your live host desk. This practice room stays local to your browser.</p><a class="button quiet" href="/auction/host">Open live host desk</a></section>';
    return `<section class="captain-links"><div class="flex between wrap"><div><div class="eyebrow">NO DISCORD NEEDED FOR QBS</div><h2>PRIVATE CAPTAIN LINKS</h2><p class="hint">Send each QB their own link. It opens their slot directly.</p></div><button data-action="copy-all-links">Copy all 12 links</button></div><div class="captain-link-grid">${state.captains.map(c=>`<div class="captain-link-row"><strong>${esc(c.name)}</strong><button class="primary" data-action="copy-captain-link" data-captain="${esc(c.id)}">Copy link</button><button class="quiet" data-action="rotate-link" data-captain="${esc(c.id)}">Replace</button></div>`).join('')}</div><p class="hint link-help">Anyone with a captain link can bid as that QB. Replace a link to disconnect its previous sessions.</p></section>`;
  }
  async function copyPrivateLink(id){
    const link=me.captainLinks?.find(l=>l.captainId===id),c=captain(id);if(!link||!c){toast('Refresh your host desk to load the links.');return;}
    try{await navigator.clipboard.writeText(link.url);toast(`${c.name}’s private link copied.`);}
    catch(_){const dialog=$('captain-dialog');dialog.innerHTML=`<button class="dialog-close quiet" data-action="close-captain" aria-label="Close captain details">Close</button><div class="eyebrow">PRIVATE CAPTAIN LINK</div><h2>${esc(c.name)}</h2><label for="private-link-copy">Copy this link and send it to ${esc(c.name)}</label><input id="private-link-copy" value="${esc(link.url)}" readonly>`;dialog.showModal();$('private-link-copy').focus();$('private-link-copy').select();}
  }
  async function copyAllPrivateLinks(){
    const text=state.captains.map(c=>`${c.name}: ${me.captainLinks?.find(l=>l.captainId===c.id)?.url||'Link unavailable'}`).join('\n');
    try{await navigator.clipboard.writeText(text);toast('All 12 private captain links copied.');}
    catch(_){const dialog=$('captain-dialog');dialog.innerHTML='<button class="dialog-close quiet" data-action="close-captain" aria-label="Close captain details">Close</button><h2>Private captain links</h2><label for="all-links-copy">Copy these links</label><textarea id="all-links-copy" rows="12" readonly></textarea>';dialog.showModal();$('all-links-copy').value=text;$('all-links-copy').focus();$('all-links-copy').select();}
  }
  function options(values, selected) {return values.map(v=>`<option value="${esc(v.id)}" ${v.id===selected?'selected':''}>${esc(v.name)}</option>`).join('');}
  function link(v,label){return `<a href="${url(v)}" ${v===view?'class="active" aria-current="page"':''}>${label}</a>`;}
  function orderMarkup(){return `<section class="order" aria-label="Nomination order"><div class="order-heading"><strong>NOMINATION ORDER</strong><span>Left to right on your Google board · repeats each round</span></div><div class="order-list">${state.captains.map((c,i)=>`<div class="order-item ${i===state.turn?'current':''} ${c.roster.length>=state.slots?'full':''}"><small>${String(i+1).padStart(2,'0')}</small>${esc(c.name)}</div>`).join('')}</div></section>`;}
  function stageMarkup(){
    const lot=state.lot,p=lot&&player(lot.playerId),lead=lot&&captain(lot.leaderId),turn=activeCaptain();
    const latest=state.sales.at(-1),previous=latest&&player(latest.playerId);
    const title=p?.name || (state.phase==='setup'?'THE TABLE IS SET':state.phase==='complete'?'TEAMS ARE LOCKED':`${turn.name} IS UP`);
    const initials=p?p.name.replace(/[^a-zA-Z0-9]/g,'').slice(0,2).toUpperCase():'GFA';
    return `<section class="stage-grid" aria-label="Live auction"><div class="stage"><div class="stage-top"><span class="pill">${state.paused?'PAUSED':lot?'ON THE AUCTION BLOCK':state.phase==='setup'?'DRAFT NIGHT LOBBY':state.phase==='complete'?'DRAFT COMPLETE':'NEXT NOMINATION'}</span><span class="round">ROUND ${state.round} / 6</span></div><div class="player-feature"><div class="player-mark" aria-hidden="true">${esc(initials)}</div><div><div class="eyebrow">${p?esc(p.position)+' / AVAILABLE TO DRAFT':'12 CAPTAINS. ONE TURKEY BOWL.'}</div><h2>${esc(title)}</h2><p class="muted">${p?'Nominated by '+esc(captain(lot.nominatorId).name):state.phase==='setup'?'The live auction begins when the host opens the room.':state.phase==='complete'?'All twelve teams have filled their six draft slots.':'Choose a player from the board. Let the bidding begin.'}</p></div></div><div class="stage-footer"><span>ON THE CLOCK <strong>${esc(turn.name)}</strong></span><span>${state.sales.length} / ${state.captains.length*state.slots} DRAFTED</span></div></div><div class="bid-panel"><div class="bid-panel-inner"><div><div class="eyebrow">${lot?'CURRENT HIGH BID':'LAST PLAYER SOLD'}</div><div class="bid-value">${lot?cash(lot.amount):latest?cash(latest.amount):'—'}</div></div><div><div class="leader-name">${lead?esc(lead.name):latest?esc(captain(latest.captainId).name):'Waiting for kickoff'}</div><p class="hint">${lot?cash(lead.budget)+' remaining · '+lead.roster.length+'/6 drafted':previous?esc(previous.name):'November 20, 2026'}</p></div></div><div><div class="call-stage">${[1,2,3].map(n=>`<span class="${lot?.call>=n?'lit':''}"></span>`).join('')}</div><p class="call-label">${state.paused?'Auction paused by the host':lot?['Bidding is open','Going once…','Going twice…','Going three times!'][lot.call]:'Any bid in $10 steps. Make your move.'}</p></div></div></section>`;
  }
  function nominationForm(){
    const available=state.players.filter(p=>p.status==='available').sort((a,b)=>a.name.localeCompare(b.name));
    return `<form data-form="nominate"><label for="nom-player">Player from the board</label><select id="nom-player" name="playerId" required><option value="">Select a player</option>${options(available,fields['nom-player'])}</select><div class="field-row"><div><label for="opening-amount">Starting bid · required</label><input id="opening-amount" name="amount" type="number" min="10" step="10" max="${activeCaptain().budget}" value="${esc(fields['opening-amount'] ?? '')}" placeholder="Enter $10 steps" inputmode="numeric" required></div><button class="primary" ${state.phase!=='nominating'||state.paused||busy?'disabled':''}>Nominate</button></div></form>`;
  }
  function bidForm(host=false){
    const own=captain(effectiveMe().captainId),lot=state.lot;
    const choice=fields['proxy-captain'] || own?.id || state.captains[0].id, target=host?captain(choice):own;
    return `<form data-form="bid">${host?`<label for="proxy-captain">Bid on behalf of a QB</label><select id="proxy-captain" name="captainId">${options(state.captains,choice)}</select>`:''}<label for="bid-amount">Your bid · any multiple of $10</label><div class="bid-form"><input id="bid-amount" name="amount" aria-label="Bid amount in dollars" type="number" min="${(lot?.amount||0)+10}" step="10" max="${target?.budget||0}" inputmode="numeric" value="${esc(fields['bid-amount'] ?? (lot?.amount||0)+10)}" required><button class="primary" ${!lot||state.paused||!target||target.roster.length>=6||busy?'disabled':''}>Place bid</button></div><div class="quick-bids">${[10,50,100].map(n=>`<button type="button" data-action="quick" data-amount="${n}" ${!lot?'disabled':''}>+${cash(n)}</button>`).join('')}</div><p class="hint">${target?cash(target.budget)+' remaining. ':''}Enter any higher bid in $10 steps within your budget.</p></form>`;
  }
  function controlsMarkup(){
    if(view==='stream')return '';
    const user=effectiveMe(),isHost=user.role==='host';
    if(view==='host'&&isHost){return `<section class="control-desk"><div class="flex between"><div class="control-title">HOST DESK</div><span class="hint">${esc(user.name)}</span></div><div class="control-grid"><div class="control-section"><h3>${esc(activeCaptain().name)}’S NOMINATION</h3><p class="hint">Submit their choice here if they tell you the name.</p>${nominationForm()}</div><div class="control-section"><h3>RUN THE DRAFT</h3><p class="hint">Every new bid resets the call to Going once.</p><div class="button-row">${state.phase==='setup'?`<button class="primary" data-action="start" ${busy?'disabled':''}>Start Draft</button>`:`<button data-action="pause">${state.paused?'Resume':'Pause'}</button>`}<button data-action="call" ${!state.lot||busy?'disabled':''}>${['Going once','Going twice','Going three times','Going three times'][state.lot?.call||0]}</button></div><div class="button-row"><button class="primary" data-action="sold" ${!state.lot||busy?'disabled':''}>SOLD ${state.lot?cash(state.lot.amount):''}</button><button class="quiet" data-action="pass" ${!state.lot||busy?'disabled':''}>Pass player</button></div><div class="button-row"><button class="danger" data-action="reset" ${busy?'disabled':''}>Reset Draft</button>${state.phase==='setup'&&(demo?demoBackup:me.hasResetBackup)?'<button data-action="restore_reset">Undo reset</button>':''}</div></div><div class="control-section"><h3>PROXY BID</h3>${bidForm(true)}</div></div></section>`;}
    if(isHost&&view!=='host')return `<section class="control-desk"><div class="flex between wrap"><div><div class="control-title">YOU’RE THE HOST</div><p class="hint">Open your host desk to run nominations, bids and sales.</p></div><a class="button primary" href="${url('host')}">Open host desk</a></div></section>`;
    if(user.role==='captain'){
      const own=captain(user.captainId);if(!own)return '';
      const ownTurn=own.id===activeCaptain().id;
      return `<section class="control-desk captain-controls"><div class="flex between"><div><div class="control-title">${esc(own.name.toUpperCase())} / CAPTAIN CONTROLS</div><p class="hint">${cash(own.budget)} remaining · ${own.roster.length} of 6 players drafted</p></div></div>${demo?`<label for="demo-captain">Practice as a captain</label><select id="demo-captain">${options(state.captains,own.id)}</select>`:''}${state.lot?bidForm():ownTurn&&state.phase==='nominating'?`<div class="notice">You’re on the clock. Nominate here, or tell the host your player.</div>${nominationForm()}`:`<p class="nomination-prompt hint">${state.phase==='setup'?'The host will open the auction shortly.':state.phase==='complete'?'The auction has finished.':esc(activeCaptain().name)+' is choosing the next player.'} Browse the full board below.</p>`}</section>`;
    }
    if(accessError)return `<section class="control-desk"><div class="control-title">PRIVATE LINK NEEDS ATTENTION</div><p class="hint">${esc(accessError)}</p></section>`;
    if(user.role==='pending'||user.role==='unassigned')return '<section class="control-desk"><div class="control-title">OPEN YOUR PRIVATE CAPTAIN LINK</div><p class="hint">Use the link the host sent you to enter your QB slot directly.</p></section>';
    return `<section class="control-desk"><div class="flex between wrap"><div><div class="control-title">${view==='host'?'HOST ACCESS':'YOUR PRIVATE CAPTAIN LINK'}</div><p class="hint">${view==='host'?'Connect with your GFA organizer Discord account.':'Open the private link the host sent you. It takes you straight into your QB slot.'}</p></div>${view==='host'?'<a class="button primary" href="/auction/login?view=host">Connect Discord</a>':'<a class="button quiet" href="/auction/host">Host desk</a>'}</div></section>`;
  }
  function syncMarkup(){
    if(demo)return 'Practice roster · no changes to the live room';
    const s=state.boardSync;if(s?.error)return esc(s.error);
    if(!s?.lastSuccess)return 'Connecting to Google board…';
    const age=Math.max(0,Math.floor((Date.now()-s.lastSuccess)/1000));return `Google board synced ${age<60?'just now':Math.floor(age/60)+'m ago'} · checks every 15s`;
  }
  function poolMarkup(){
    const positions=filter==='ALL'?['WR','LINE','FLEX']:[filter];
    return `<section class="board-section" id="player-board"><div class="section-header"><div><div class="eyebrow">THE DRAFT ROOM</div><h2>PLAYER BOARD</h2></div><div class="tabs" role="group" aria-label="Filter by position">${['ALL','WR','LINE','FLEX'].map(pos=>`<button data-action="filter" data-position="${pos}" aria-pressed="${filter===pos}" class="${filter===pos?'selected':''}">${pos==='ALL'?'All players':pos}</button>`).join('')}</div></div><div class="board-toolbar"><input class="search" id="search" type="search" aria-label="Search player names" placeholder="Search players…" value="${esc(query)}"><label><input id="available-only" type="checkbox" ${availableOnly?'checked':''}>Available only</label><span class="sync-note ${state.boardSync?.error?'stale':''}">${syncMarkup()}</span></div><div class="pool-grid ${filter!=='ALL'?'single':''}">${positions.map(pos=>{
      const all=state.players.filter(p=>p.position===pos&&p.status!=='removed');
      const rows=all.filter(p=>(!availableOnly||p.status==='available')&&p.name.toLowerCase().includes(query.toLowerCase()));
      return `<section class="pool-group ${pos==='FLEX'?'flexpos':pos.toLowerCase()}"><div class="pool-head"><h3>${pos}</h3><span>${all.filter(p=>p.status==='available').length} available / ${all.length}</span></div><div class="pool-players">${rows.length?rows.map(p=>{
        const sale=state.sales.find(s=>s.playerId===p.id), taken=p.status==='sold', nominated=p.status==='nominated';
        return `<button class="player ${taken?'taken':''} ${nominated?'nominated':''} ${fields['nom-player']===p.id?'chosen':''}" data-action="select-player" data-player="${esc(p.id)}" ${taken||nominated?'disabled':''} aria-label="${esc(p.name+' · '+pos+(taken?' · Taken by '+captain(sale?.captainId)?.name:''))}"><span><span class="player-name">${esc(p.name)}</span>${taken?`<small>TAKEN · ${esc(captain(sale?.captainId)?.name||'Drafted')}</small>`:nominated?'<small>ON THE BLOCK</small>':''}</span></button>`;
      }).join(''):'<p class="empty">No matching players.</p>'}</div></section>`;
    }).join('')}</div></section>`;
  }
  function teamsMarkup(){return `<section id="teams"><div class="section-header"><div><div class="eyebrow">12 QBS / 6 PICKS EACH</div><h2>THE TEAMS</h2></div><span class="hint">Remaining auction budget</span></div><div class="teams">${state.captains.map((c,i)=>`<article class="team c${i} ${i===state.turn?'on-clock':''}"><div class="team-head"><span>${esc(c.name)}<small>${i===state.turn?'ON THE CLOCK':'QB / CAPTAIN'}</small></span><span class="stream-budget">${cash(c.budget)}</span><span>${c.roster.length}/6</span></div><div class="team-budget">${cash(c.budget)}<small>OF ${cash(c.startingBudget)} REMAINING</small></div><div class="team-roster">${Array.from({length:6},(_,n)=>{const pick=c.roster[n],p=pick&&player(pick.playerId);return `<div class="roster-slot ${pick?'':'empty-slot'}"><span>${pick?esc(p?.name):'Open slot'}</span><small>${pick?cash(pick.amount):'—'}</small></div>`;}).join('')}</div></article>`).join('')}</div></section>`;}
  function hostTools(){if(effectiveMe().role!=='host'||view!=='host')return '';
    return `<details class="host-tools" ${fields.toolsOpen?'open':''}><summary>Captain access & room settings</summary><p class="hint">Approve only the Discord account that belongs to each QB. New approvals appear on their device automatically.</p><div class="requests">${(me.requests||[]).map(r=>`<div class="request"><span class="name">${esc(r.display_name)}<small>${esc(captain(r.captain_id)?.name)} · ${r.approved?'Approved':'Waiting for approval'}</small></span>${!r.approved?`<button class="primary" data-action="approve" data-discord="${esc(r.discord_id)}">Approve</button>`:''}<button data-action="revoke" data-discord="${esc(r.discord_id)}">${r.approved?'Revoke':'Decline'}</button></div>`).join('')||'<p class="hint">No captain requests yet.</p>'}</div><div class="tool-actions"><button data-action="sync">Sync board now</button><button data-action="undo" ${!state.sales.length||state.lot?'disabled':''}>Undo last sale</button><a class="button" href="/auction/export.csv">Export drafted teams</a><a class="button" href="${BOARD}" target="_blank" rel="noopener">Open Google board</a></div><form data-form="turn"><label for="turn-captain">Change nomination turn</label><div class="field-row"><div><select id="turn-captain" name="captainId">${options(state.captains,fields['turn-captain']||activeCaptain().id)}</select></div><button ${state.lot?'disabled':''}>Set turn</button></div></form><p class="hint">Google controls player names, positions and QB order. This room records bids, teams and budgets. Completed picks stay recorded if their names are removed from Google.</p></details>`;
  }
  function render(){if(!state)return;
    const focused=document.activeElement, focusId=focused?.id, start=focused?.selectionStart, end=focused?.selectionEnd;
    const user=effectiveMe(),available=state.players.filter(p=>p.status==='available').length;
    document.body.classList.toggle('stream',view==='stream');document.body.classList.toggle('effects-off',!effects);
    $('app').innerHTML=`<div class="shell"><header class="topbar"><a href="https://officialgfa.com" aria-label="GFA home"><img class="logo" src="https://officialgfa.com/assets/thanksgiving-gfa.webp" alt="GFA"></a><div class="brand">GFA LIVE AUCTION<small>TURKEY BOWL / 2026</small></div><nav class="navigation" aria-label="Auction views">${link('captain','Draft room')}${link('host','Host desk')}${link('stream','Stream view')}<a href="#teams">Teams</a></nav><span class="spacer"></span><span class="connection ${connected?'':'offline'}">${demo?'PRACTICE':connected?'LIVE ROOM':'RECONNECTING'}</span><span class="account">${esc(user.name||'Spectator')}</span>${view==='stream'?`<button class="fullscreen-toggle primary" data-action="fullscreen" aria-pressed="${streamFullscreen()}" title="Toggle full screen (F)">${streamFullscreen()?'Exit Full Screen':'Full Screen'}</button>`:''}<div class="music-controls"><button class="sound-toggle quiet" data-action="music" aria-pressed="${music.playing}" ${musicBusy?'disabled':''}>Music ${music.playing?'on':'off'}</button><input id="music-volume" type="range" min="0" max="65" step="1" value="${Math.round(music.volume*100)}" aria-label="Auction music volume"></div><button class="sound-toggle quiet" data-action="effects" aria-pressed="${effects}">Effects ${effects?'on':'off'}</button><button class="sound-toggle quiet" data-action="sound" aria-pressed="${sound}">Sound ${sound?'on':'off'}</button></header>${demo?`<div class="demo-banner"><span><strong>PRACTICE PREVIEW</strong> · Local bids only. Your live auction is untouched.</span><div class="demo-actions"><button data-action="demo-reveal" ${!state.lot?'disabled':''}>Replay reveal</button><button data-action="demo-bid" ${!state.lot?'disabled':''}>Sample bid</button><button data-action="demo-call" ${!state.lot?'disabled':''}>Preview call</button><button data-action="demo-sold" ${!state.lot?'disabled':''}>SOLD preview</button><button data-action="demo-wake">Wake a QB</button><button data-action="load-demo">Load sample</button><button data-action="reset-demo">Reset Draft</button></div></div>`:''}<div class="headline"><div><div class="eyebrow">GFA PRESENTS / THANKSGIVING 2026</div><h1>THE <em>TURKEY BOWL</em> AUCTION</h1></div><div class="event-tag"><strong>FRIDAY, NOVEMBER 20</strong>${available} players available · 12 captains</div></div>${orderMarkup()}${stageMarkup()}${controlsMarkup()}${captainLinksMarkup()}${view==='stream'?'':poolMarkup()}${teamsMarkup()}${bidderPitMarkup()}<div class="activity" aria-label="Recent auction activity">${state.feed.slice(0,5).map(e=>`<div class="feed-item"><strong>${esc(e.kind.toUpperCase())}</strong>${esc(e.text)}<small>${new Date(e.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></div>`).join('')}</div>${hostTools()}<footer class="footer"><span>GFA / TURKEY BOWL AUCTION TOURNAMENT · NOV 20, 2026</span><span><a href="${BOARD}" target="_blank" rel="noopener">Google draft board</a> · <a href="${url('stream')}">Stream view</a> · <a href="${url('host')}${demo?'':'?demo=1'}">Practice preview</a></span></footer></div>`;
    fitStream();
    if(focusId && $(focusId)){const el=$(focusId);el.focus({preventScroll:true});try{if(start!==null)el.setSelectionRange(start,end);}catch(_){} }
  }
  async function refreshMe(){if(demo||accessError)return;try{const res=await fetch('/auction/api/me',{cache:'no-store'});me=await res.json();render();}catch(_){} }
  async function action(payload){if(busy)return;busy=true;render();
    try{
      payload={revision:state.revision,lotId:state.lot?.id,...payload};
      if(demo){demoAction(payload);return;}
      const res=await fetch('/auction/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf||''},body:JSON.stringify(payload)});
      const next=await res.json();if(!res.ok){if(res.status===401)await refreshMe();throw new Error(next.error||'The request could not be completed.');}
      if(next.captains){accept(next);if(['reset','restore_reset'].includes(payload.type))await refreshMe();}else await refreshMe();
      if(payload.type==='claim')toast('Request sent. The host will approve your captain slot.');
      if(payload.type==='sync')toast('Google board synced.');
    }catch(error){toast(error.message||'Connection lost. Please try again.');}
    finally{busy=false;render();}
  }
  function saveDemo(){localStorage.setItem(DEMO_KEY,JSON.stringify(state));channel?.postMessage(state);accept(state);}
  function demoEvent(kind,text,details={}){const e={id:stamp(),kind,text,at:Date.now(),...details};state.lastEvent=e;state.feed=[e,...state.feed].slice(0,40);}
  function nextTurn(){for(let n=1;n<=state.captains.length;n++){const i=(state.turn+n)%state.captains.length;if(state.captains[i].roster.length<6){state.turn=i;state.phase='nominating';return;}}state.phase='complete';}
  function demoAction(a){
    const role=effectiveMe(),host=role.role==='host',lot=state.lot;
    if(['start','reset','restore_reset','pause','call','sold','pass','undo','turn','sync'].includes(a.type)&&!host)throw new Error('Only the practice host can use this control.');
    if(['bid','nominate'].includes(a.type)&&(state.paused||!Number.isInteger(a.amount)||a.amount<10||a.amount%10))throw new Error('Bids must be in $10 steps while the auction is open.');
    if(a.type==='reset'){resetDemo(false);return;}
    if(a.type==='restore_reset'){if(!demoBackup)throw new Error('There is no reset to undo.');const revision=state.revision+1;state=structuredClone(demoBackup);demoBackup=null;state.revision=revision;demoEvent('restore','Previous practice draft restored.');saveDemo();return;}
    if(a.type==='start'){state.phase='nominating';demoEvent('start','The Turkey Bowl auction is open.');}
    else if(a.type==='pause'){state.paused=!state.paused;demoEvent('pause',state.paused?'Auction paused.':'Auction resumed.');}
    else if(a.type==='turn'){if(lot)throw new Error('Finish this player first.');state.turn=state.captains.findIndex(c=>c.id===a.captainId);}
    else if(a.type==='nominate'){
      const c=activeCaptain(),p=player(a.playerId);if(state.phase!=='nominating'||lot||(!host&&role.captainId!==c.id))throw new Error('Wait for your nomination turn.');
      if(!p||p.status!=='available')throw new Error('That player is unavailable.');if(a.amount>c.budget||c.roster.length>=6)throw new Error('That opening bid exceeds the captain’s budget.');
      p.status='nominated';state.lot={id:stamp(),playerId:p.id,nominatorId:c.id,leaderId:c.id,amount:a.amount,bids:{[c.id]:a.amount},openedAt:Date.now(),call:0};state.phase='bidding';demoEvent('nomination',`${c.name} nominates ${p.name} for ${cash(a.amount)}.`,{playerId:p.id,captainId:c.id,amount:a.amount});
    }else if(a.type==='bid'){
      if(!lot)throw new Error('There is no active player.');const c=captain(host?a.captainId:role.captainId);if(a.amount<=lot.amount)throw new Error('The bid must beat the current high bid.');if(a.amount>c.budget||c.roster.length>=6)throw new Error('That bid exceeds the captain’s budget.');lot.bids={...currentBids(),[c.id]:a.amount};lot.amount=a.amount;lot.leaderId=c.id;lot.call=0;demoEvent('bid',`${c.name} bids ${cash(a.amount)}.`,{captainId:c.id,playerId:lot.playerId,amount:a.amount});
    }else if(a.type==='call'){if(lot){lot.call=Math.min(3,lot.call+1);demoEvent('call',['','Going once.','Going twice.','Going three times.'][lot.call]);}}
    else if(a.type==='sold'){
      if(!lot)throw new Error('There is no active player.');const c=captain(lot.leaderId),p=player(lot.playerId);c.budget-=lot.amount;c.roster.push({playerId:p.id,amount:lot.amount});p.status='sold';state.sales.push({playerId:p.id,captainId:c.id,amount:lot.amount,turnBefore:state.turn,nominatorId:lot.nominatorId});state.lot=null;nextTurn();state.round=Math.min(6,Math.floor(state.sales.length/12)+1);demoEvent('sold',`${p.name} sold to ${c.name} for ${cash(lot.amount)}.`,{playerId:p.id,captainId:c.id,amount:lot.amount});
    }else if(a.type==='pass'){if(lot){player(lot.playerId).status='available';state.lot=null;nextTurn();demoEvent('pass','Player returned to the pool.');}}
    else if(a.type==='undo'){if(lot||!state.sales.length)throw new Error('Finish this nomination before undoing a sale.');const sale=state.sales.pop(),c=captain(sale.captainId);c.budget+=sale.amount;c.roster=c.roster.filter(p=>p.playerId!==sale.playerId);player(sale.playerId).status='available';state.turn=sale.turnBefore;state.phase='nominating';state.round=Math.min(6,Math.floor(state.sales.length/12)+1);demoEvent('undo','Last sale undone.');}
    else if(a.type==='sync'){toast('Practice stays local. The live room checks the Google board every 15 seconds.');}
    else if(!['approve','revoke'].includes(a.type))throw new Error('Unavailable in practice.');
    state.revision++;saveDemo();
  }
  let originalSeed;
  function resetDemo(showcase=true){
    if(!showcase&&state)demoBackup=structuredClone(state);
    clearTransientEffects();
    const seed=structuredClone(originalSeed);seed.captains.forEach(c=>{c.budget=c.startingBudget;c.roster=[];});seed.players=seed.players.filter(p=>p.onBoard!==false).map(p=>({...p,status:'available'}));
    seed.demoOnline={...state?.demoOnline};seed.sales=[];seed.feed=[];seed.lastEvent=null;seed.revision=(state?.revision||0)+1;seed.phase=showcase?'nominating':'setup';seed.paused=false;seed.turn=0;seed.round=1;seed.lot=null;state=seed;
    if(!showcase){demoEvent('reset','Practice draft reset. Press Start Draft when ready.');lastEvent=null;saveDemo();return;}
    const p=state.players.find(p=>p.name==='AK41')||state.players[0];p.status='nominated';state.lot={id:stamp(),playerId:p.id,nominatorId:state.captains[0].id,leaderId:state.captains[5].id,amount:170,bids:{[state.captains[0].id]:100,[state.captains[5].id]:170},openedAt:Date.now(),call:0};state.phase='bidding';demoEvent('bid',`${state.captains[5].name} bids $170.`,{playerId:p.id,captainId:state.captains[5].id,amount:170});fields={};lastEvent=null;saveDemo();
  }
  document.addEventListener('input',event=>{const t=event.target;if(t.id==='music-volume'){music.setVolume(Number(t.value)/100);}else if(t.id==='search'){query=t.value;render();}else if(t.id)fields[t.id]=t.value;});
  document.addEventListener('change',event=>{const t=event.target;if(t.id==='available-only'){availableOnly=t.checked;render();}else if(t.id==='demo-captain'){demoCaptain=t.value;delete fields['bid-amount'];render();}else if(t.id){fields[t.id]=t.value;if(t.id==='proxy-captain')render();}});
  document.addEventListener('toggle',event=>{if(event.target.classList?.contains('host-tools'))fields.toolsOpen=event.target.open;},true);
  document.addEventListener('submit',event=>{const f=event.target;if(!f.dataset.form)return;event.preventDefault();if(!f.reportValidity())return;const data=Object.fromEntries(new FormData(f));if('amount'in data)data.amount=Number(data.amount);action({type:f.dataset.form,...data});});
  document.addEventListener('click',event=>{
    const b=event.target.closest('[data-action]');if(!b)return;const type=b.dataset.action;
    if(type==='fullscreen'){toggleStreamFullscreen();}
    else if(type==='filter'){filter=b.dataset.position;render();}
    else if(type==='quick'){fields['bid-amount']=(state.lot?.amount||0)+Number(b.dataset.amount);render();$('bid-amount')?.focus();}
    else if(type==='select-player'){
      const role=effectiveMe();if(!((view==='host'&&role.role==='host')||role.captainId===activeCaptain().id)||state.phase!=='nominating'){toast(`${player(b.dataset.player).name} · ${player(b.dataset.player).position}`);return;}
      fields['nom-player']=b.dataset.player;render();$('nom-player')?.scrollIntoView({behavior:'smooth',block:'center'});$('nom-player')?.focus({preventScroll:true});
    }else if(type==='sound'){sound=!sound;if(sound)beep();render();}
    else if(type==='reset-demo'){resetDemo(false);}
    else if(type==='load-demo'){resetDemo(true);}
    else if(type==='reset'){if(demo||confirm('Reset Draft? This clears all picks and bids, restores starting budgets, and returns to QB 1. Your captain links stay the same.'))action({type:'reset',confirmation:'RESET'});}
    else if(type==='restore_reset'){if(demo||confirm('Restore the draft from before the last reset?'))action({type});}
    else if(type==='copy-captain-link'){copyPrivateLink(b.dataset.captain);}
    else if(type==='copy-all-links'){copyAllPrivateLinks();}
    else if(type==='rotate-link'){const c=captain(b.dataset.captain);if(c&&confirm(`Replace ${c.name}’s private link? Their old link and its sessions will stop working.`))action({type:'rotate_link',captainId:c.id});}
    else if(type==='music'){if(musicBusy)return;if(music.playing){music.stop();render();}else{musicBusy=true;render();music.start().catch(e=>toast(e.message||'Tap Music again to start playback.')).finally(()=>{musicBusy=false;render();});}}
    else if(type==='demo-wake'&&demo){const c=state.captains.find((c,i)=>!(state.demoOnline?.[c.id]??![3,8,11].includes(i)));if(!c){toast('All practice QBs are awake.');return;}state.demoOnline={...state.demoOnline,[c.id]:true};wakeUntil[c.id]=Date.now()+1700;state.revision++;saveDemo();toast(`${c.name} joined the practice room.`);}

    else if(type==='effects'){effects=!effects;if(!effects){['nomination-reveal','sold-overlay','bid-announcement','auction-call'].forEach(id=>$(id).classList.remove('visible'));}render();}
    else if(type==='inspect-captain'){inspectCaptain(b.dataset.captain);}
    else if(type==='close-captain'){$('captain-dialog').close();}
    else if(type==='demo-reveal'&&demo&&state.lot){nominationReveal({playerId:state.lot.playerId,captainId:state.lot.nominatorId,amount:state.lot.bids?.[state.lot.nominatorId]||state.lot.amount});}
    else if(type==='demo-call'&&demo&&state.lot){state.lot.call=(state.lot.call%3)+1;demoEvent('call',['','Going once.','Going twice.','Going three times.'][state.lot.call]);state.revision++;saveDemo();}
    else if(type==='demo-sold'&&demo&&state.lot){soldOverlay({playerId:state.lot.playerId,captainId:state.lot.leaderId,amount:state.lot.amount});}
    else if(type==='demo-bid'&&demo&&state.lot){const amount=state.lot.amount+50,c=state.captains.find(c=>c.id!==state.lot.leaderId&&c.budget>=amount&&c.roster.length<6);if(!c){toast('Reset practice to start with full budgets.');return;}const previous=demoCaptain;demoCaptain=c.id;try{demoAction({type:'bid',captainId:c.id,amount});}catch(e){toast(e.message);}finally{demoCaptain=previous;}}

    else if(type==='approve'||type==='revoke'){if(type==='revoke'&&!confirm('Remove this captain’s access?'))return;action({type,discordId:b.dataset.discord});}
    else if(type==='undo'){if(confirm('Undo the last sale and refund that captain?'))action({type});}
    else if(type==='pass'){if(confirm('Return this player to the pool and move to the next QB?'))action({type});}
    else action({type});
  });
  let socket,retry=1000;
  function connect(){
    if(demo)return;
    socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/auction/live');
    socket.onopen=()=>{connected=true;retry=1000;render();};
    socket.onmessage=e=>{try{accept(JSON.parse(e.data));}catch(_){}};
    socket.onclose=()=>{connected=false;render();setTimeout(connect,retry);retry=Math.min(15000,retry*2);};
    socket.onerror=()=>socket.close();
  }
  async function load(){try{
    if(!demo){const key=new URLSearchParams(location.hash.slice(1)).get('key');if(key){try{const r=await fetch('/auction/api/enter',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key})});const result=await r.json();if(!r.ok)accessError=result.error||'Ask the host for your latest private link.';}catch(_){accessError='The room could not open your link. Open the link again to retry.';}history.replaceState(null,'',location.pathname+location.search);}}
    const response=await fetch('/auction/api/state',{cache:'no-store'});if(!response.ok)throw new Error('The room is temporarily unavailable.');const data=await response.json();
    if(demo){originalSeed=data;connected=true;try{const saved=JSON.parse(localStorage.getItem(DEMO_KEY));if(saved?.captains?.length===12)accept(saved,false);else resetDemo();}catch(_){resetDemo();}channel&&(channel.onmessage=e=>accept(e.data));window.addEventListener('storage',e=>{if(e.key===DEMO_KEY&&e.newValue)accept(JSON.parse(e.newValue));});}
    else{accept(data,false);await refreshMe();connect();setInterval(refreshMe,7000);setInterval(async()=>{if(!connected){try{const r=await fetch('/auction/api/state',{cache:'no-store'});if(r.ok)accept(await r.json());}catch(_){}}},4000);}
  }catch(error){$('app').innerHTML=`<main class="loading"><div class="eyebrow">GFA TURKEY BOWL</div><h1>ROOM CONNECTING</h1><p>${esc(error.message)} Reload to try again.</p></main>`;}}
  document.addEventListener('fullscreenchange',()=>{fittedFullscreen=nativeStreamFullscreen();fitStream();if(view==='stream')render();});
  document.addEventListener('webkitfullscreenchange',()=>{fittedFullscreen=nativeStreamFullscreen();fitStream();if(view==='stream')render();});
  window.addEventListener('resize',fitStream);
  document.addEventListener('keydown',event=>{
    if(view==='stream'&&event.key==='Escape'&&streamFullscreen()){event.preventDefault();toggleStreamFullscreen();return;}
    if(view==='stream'&&event.key.toLowerCase()==='f'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.closest('input,select,textarea,[contenteditable="true"]')){
      event.preventDefault();toggleStreamFullscreen();
    }
  });
  load();
})();
