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
  const channel = demo && 'BroadcastChannel' in window ? new BroadcastChannel(DEMO_KEY) : null;
  const captain = id => state.captains.find(c => c.id === id);
  const player = id => state.players.find(p => p.id === id);
  const activeCaptain = () => state.captains[state.turn];
  const effectiveMe = () => demo ? (view === 'host' ? {role:'host',name:'Practice host'} : {role:'captain',name:'Practice captain',captainId:demoCaptain || state.captains[0].id}) : me;
  const stamp = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4500); }
  function beep(sold = false) {
    if (!sound) return;
    try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); const at=audioContext.currentTime;
      [sold?523:660, sold?659:880, ...(sold?[784]:[])].forEach((f,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain();o.frequency.value=f;g.gain.setValueAtTime(.04,at+i*.10);g.gain.exponentialRampToValueAtTime(.001,at+i*.10+.18);o.connect(g).connect(audioContext.destination);o.start(at+i*.1);o.stop(at+i*.1+.2);});
    } catch (_) {}
  }
  function soldOverlay(event) {
    const p=player(event.playerId),c=captain(event.captainId); if(!p||!c)return;
    $('sold-overlay').innerHTML=`<div class="sold-card"><div class="eyebrow">THE TURKEY BOWL AUCTION</div><div class="stamp">SOLD!</div><h2>${esc(p.name)}</h2><p>TO ${esc(c.name)} · <strong>${cash(event.amount)}</strong></p></div>`;
    $('sold-overlay').classList.add('visible');clearTimeout(overlayTimer);overlayTimer=setTimeout(()=>$('sold-overlay').classList.remove('visible'),3200);beep(true);
  }
  function accept(next, animate=true) {
    if(!next || !Array.isArray(next.captains))return;
    if(state && next.revision < state.revision && !demo)return;
    if(lastLot !== (next.lot?.id || null)){delete fields['bid-amount'];delete fields['nom-player'];}lastLot=next.lot?.id || null;
    state=next;
    if(animate && lastEvent && next.lastEvent?.id!==lastEvent){if(next.lastEvent?.kind==='sold')soldOverlay(next.lastEvent);else if(next.lastEvent?.kind==='bid')beep();}
    lastEvent=next.lastEvent?.id || lastEvent;render();
  }
  function options(values, selected) {return values.map(v=>`<option value="${esc(v.id)}" ${v.id===selected?'selected':''}>${esc(v.name)}</option>`).join('');}
  function link(v,label){return `<a href="${url(v)}" ${v===view?'class="active" aria-current="page"':''}>${label}</a>`;}
  function orderMarkup(){return `<section class="order" aria-label="Nomination order"><div class="order-heading"><strong>NOMINATION ORDER</strong><span>Left to right on your Google board · repeats each round</span></div><div class="order-list">${state.captains.map((c,i)=>`<div class="order-item ${i===state.turn?'current':''} ${c.roster.length>=state.slots?'full':''}"><small>${String(i+1).padStart(2,'0')}</small>${esc(c.name)}</div>`).join('')}</div></section>`;}
  function stageMarkup(){
    const lot=state.lot,p=lot&&player(lot.playerId),lead=lot&&captain(lot.leaderId),turn=activeCaptain();
    const latest=state.sales.at(-1),previous=latest&&player(latest.playerId);
    const title=p?.name || (state.phase==='setup'?'THE TABLE IS SET':state.phase==='complete'?'TEAMS ARE LOCKED':`${turn.name} IS UP`);
    const initials=p?p.name.replace(/[^a-zA-Z0-9]/g,'').slice(0,2).toUpperCase():'GFA';
    return `<section class="stage-grid" aria-label="Live auction"><div class="stage"><div class="stage-top"><span class="pill">${state.paused?'PAUSED':lot?'ON THE AUCTION BLOCK':state.phase==='setup'?'DRAFT NIGHT LOBBY':state.phase==='complete'?'DRAFT COMPLETE':'NEXT NOMINATION'}</span><span class="round">ROUND ${state.round} / 6</span></div><div class="player-feature"><div class="player-mark" aria-hidden="true">${esc(initials)}</div><div><div class="eyebrow">${p?esc(p.position)+' / AVAILABLE TO DRAFT':'12 CAPTAINS. ONE TURKEY BOWL.'}</div><h2>${esc(title)}</h2><p class="muted">${p?'Nominated by '+esc(captain(lot.nominatorId).name):state.phase==='setup'?'The live auction begins when the host opens the room.':state.phase==='complete'?'All twelve teams have filled their six draft slots.':'Choose a player from the board. Let the bidding begin.'}</p></div></div><div class="stage-footer"><span>ON THE CLOCK <strong>${esc(turn.name)}</strong></span><span>${state.sales.length} / ${state.captains.length*state.slots} DRAFTED</span></div></div><div class="bid-panel"><div class="bid-panel-inner"><div><div class="eyebrow">${lot?'CURRENT HIGH BID':'LAST PLAYER SOLD'}</div><div class="bid-value">${lot?cash(lot.amount):latest?cash(latest.amount):'—'}</div></div><div><div class="leader-name">${lead?esc(lead.name):latest?esc(captain(latest.captainId).name):'Waiting for kickoff'}</div><p class="hint">${lot?cash(lead.budget)+' remaining · '+lead.roster.length+'/6 drafted':previous?esc(previous.name):'November 20, 2026'}</p></div></div><div><div class="call-stage">${[1,2,3].map(n=>`<span class="${lot?.call>=n?'lit':''}"></span>`).join('')}</div><p class="call-label">${state.paused?'Auction paused by the host':lot?['Bidding is open','Going once…','Going twice…','Final call!'][lot.call]:'Any bid in $10 steps. Make your move.'}</p></div></div></section>`;
  }
  function nominationForm(){
    const available=state.players.filter(p=>p.status==='available').sort((a,b)=>a.name.localeCompare(b.name));
    return `<form data-form="nominate"><label for="nom-player">Player from the board</label><select id="nom-player" name="playerId" required><option value="">Select a player</option>${options(available,fields['nom-player'])}</select><div class="field-row"><div><label for="opening-amount">Opening bid</label><input id="opening-amount" name="amount" type="number" min="10" step="10" max="${activeCaptain().budget}" value="${esc(fields['opening-amount'] || 10)}" inputmode="numeric" required></div><button class="primary" ${state.phase!=='nominating'||state.paused||busy?'disabled':''}>Nominate</button></div></form>`;
  }
  function bidForm(host=false){
    const own=captain(effectiveMe().captainId),lot=state.lot;
    const choice=fields['proxy-captain'] || own?.id || state.captains[0].id, target=host?captain(choice):own;
    return `<form data-form="bid">${host?`<label for="proxy-captain">Bid on behalf of a QB</label><select id="proxy-captain" name="captainId">${options(state.captains,choice)}</select>`:''}<label for="bid-amount">Your bid · any multiple of $10</label><div class="bid-form"><input id="bid-amount" name="amount" aria-label="Bid amount in dollars" type="number" min="${(lot?.amount||0)+10}" step="10" max="${target?.budget||0}" inputmode="numeric" value="${esc(fields['bid-amount'] ?? (lot?.amount||0)+10)}" required><button class="primary" ${!lot||state.paused||!target||target.roster.length>=6||busy?'disabled':''}>Place bid</button></div><div class="quick-bids">${[10,50,100].map(n=>`<button type="button" data-action="quick" data-amount="${n}" ${!lot?'disabled':''}>+${cash(n)}</button>`).join('')}</div><p class="hint">${target?cash(target.budget)+' remaining. ':''}Enter any higher bid in $10 steps within your budget.</p></form>`;
  }
  function controlsMarkup(){
    if(view==='stream')return '';
    const user=effectiveMe(),isHost=user.role==='host';
    if(view==='host'&&isHost){return `<section class="control-desk"><div class="flex between"><div class="control-title">HOST DESK</div><span class="hint">${esc(user.name)}</span></div><div class="control-grid"><div class="control-section"><h3>${esc(activeCaptain().name)}’S NOMINATION</h3><p class="hint">Submit their choice here if they tell you the name.</p>${nominationForm()}</div><div class="control-section"><h3>RUN THE ROOM</h3><p class="hint">Every new bid clears the auction call.</p><div class="button-row">${state.phase==='setup'?`<button class="primary" data-action="start" ${busy?'disabled':''}>Start auction</button>`:`<button data-action="pause">${state.paused?'Resume':'Pause'}</button>`}<button data-action="call" ${!state.lot||busy?'disabled':''}>${['Going once','Going twice','Final call','Final call'][state.lot?.call||0]}</button></div><div class="button-row"><button class="primary" data-action="sold" ${!state.lot||busy?'disabled':''}>SOLD ${state.lot?cash(state.lot.amount):''}</button><button class="quiet" data-action="pass" ${!state.lot||busy?'disabled':''}>Pass player</button></div></div><div class="control-section"><h3>PROXY BID</h3>${bidForm(true)}</div></div></section>`;}
    if(isHost&&view!=='host')return `<section class="control-desk"><div class="flex between wrap"><div><div class="control-title">YOU’RE THE HOST</div><p class="hint">Open your host desk to run nominations, bids and sales.</p></div><a class="button primary" href="${url('host')}">Open host desk</a></div></section>`;
    if(user.role==='captain'){
      const own=captain(user.captainId);if(!own)return '';
      const ownTurn=own.id===activeCaptain().id;
      return `<section class="control-desk captain-controls"><div class="flex between"><div><div class="control-title">${esc(own.name.toUpperCase())} / CAPTAIN CONTROLS</div><p class="hint">${cash(own.budget)} remaining · ${own.roster.length} of 6 players drafted</p></div></div>${demo?`<label for="demo-captain">Practice as a captain</label><select id="demo-captain">${options(state.captains,own.id)}</select>`:''}${state.lot?bidForm():ownTurn&&state.phase==='nominating'?`<div class="notice">You’re on the clock. Nominate here, or tell the host your player.</div>${nominationForm()}`:`<p class="nomination-prompt hint">${state.phase==='setup'?'The host will open the auction shortly.':state.phase==='complete'?'The auction has finished.':esc(activeCaptain().name)+' is choosing the next player.'} Browse the full board below.</p>`}</section>`;
    }
    if(user.role==='pending')return `<section class="control-desk"><div class="control-title">CAPTAIN REQUEST SENT</div><p class="hint">Waiting for the host to approve you as ${esc(captain(user.captainId)?.name||'a captain')}. You can browse the board while you wait.</p></section>`;
    if(user.role==='unassigned')return `<section class="control-desk captain-controls"><div class="control-title">WELCOME, ${esc(user.name)}</div><p class="hint">Choose your QB name. The host approves your slot before you can bid.</p><form data-form="claim"><label for="claim-captain">Your captain slot</label><div class="field-row"><div><select id="claim-captain" name="captainId">${options(state.captains,fields['claim-captain'])}</select></div><button class="primary">Request access</button></div></form></section>`;
    return `<section class="control-desk"><div class="flex between wrap"><div><div class="control-title">${view==='host'?'HOST ACCESS':'DRAFTING TONIGHT?'}</div><p class="hint">${view==='host'?'Connect with your GFA organizer Discord account.':'Connect Discord, choose your QB name, and get approved by the host to bid.'}</p></div><a class="button primary" href="/auction/login?view=${view}">Connect Discord</a></div></section>`;
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
  function teamsMarkup(){return `<section id="teams"><div class="section-header"><div><div class="eyebrow">12 QBS / 6 PICKS EACH</div><h2>THE TEAMS</h2></div><span class="hint">Remaining auction budget</span></div><div class="teams">${state.captains.map((c,i)=>`<article class="team c${i} ${i===state.turn?'on-clock':''}"><div class="team-head"><span>${esc(c.name)}<small>${i===state.turn?'ON THE CLOCK':'QB / CAPTAIN'}</small></span><span>${c.roster.length}/6</span></div><div class="team-budget">${cash(c.budget)}<small>OF ${cash(c.startingBudget)} REMAINING</small></div><div class="team-roster">${Array.from({length:6},(_,n)=>{const pick=c.roster[n],p=pick&&player(pick.playerId);return `<div class="roster-slot ${pick?'':'empty-slot'}"><span>${pick?esc(p?.name):'Open slot'}</span><small>${pick?cash(pick.amount):'—'}</small></div>`;}).join('')}</div></article>`).join('')}</div></section>`;}
  function hostTools(){if(effectiveMe().role!=='host'||view!=='host')return '';
    return `<details class="host-tools" ${fields.toolsOpen?'open':''}><summary>Captain access & room settings</summary><p class="hint">Approve only the Discord account that belongs to each QB. New approvals appear on their device automatically.</p><div class="requests">${(me.requests||[]).map(r=>`<div class="request"><span class="name">${esc(r.display_name)}<small>${esc(captain(r.captain_id)?.name)} · ${r.approved?'Approved':'Waiting for approval'}</small></span>${!r.approved?`<button class="primary" data-action="approve" data-discord="${esc(r.discord_id)}">Approve</button>`:''}<button data-action="revoke" data-discord="${esc(r.discord_id)}">${r.approved?'Revoke':'Decline'}</button></div>`).join('')||'<p class="hint">No captain requests yet.</p>'}</div><div class="tool-actions"><button data-action="sync">Sync board now</button><button data-action="undo" ${!state.sales.length||state.lot?'disabled':''}>Undo last sale</button><a class="button" href="/auction/export.csv">Export drafted teams</a><a class="button" href="${BOARD}" target="_blank" rel="noopener">Open Google board</a></div><form data-form="turn"><label for="turn-captain">Change nomination turn</label><div class="field-row"><div><select id="turn-captain" name="captainId">${options(state.captains,fields['turn-captain']||activeCaptain().id)}</select></div><button ${state.lot?'disabled':''}>Set turn</button></div></form><p class="hint">Google controls player names, positions and QB order. This room records bids, teams and budgets. Completed picks stay recorded if their names are removed from Google.</p></details>`;
  }
  function render(){if(!state)return;
    const focused=document.activeElement, focusId=focused?.id, start=focused?.selectionStart, end=focused?.selectionEnd;
    const user=effectiveMe(),available=state.players.filter(p=>p.status==='available').length;
    document.body.classList.toggle('stream',view==='stream');
    $('app').innerHTML=`<div class="shell"><header class="topbar"><a href="https://officialgfa.com" aria-label="GFA home"><img class="logo" src="https://officialgfa.com/assets/thanksgiving-gfa.webp" alt="GFA"></a><div class="brand">GFA LIVE AUCTION<small>TURKEY BOWL / 2026</small></div><nav class="navigation" aria-label="Auction views">${link('captain','Draft room')}${link('host','Host desk')}${link('stream','Stream view')}<a href="#teams">Teams</a></nav><span class="spacer"></span><span class="connection ${connected?'':'offline'}">${demo?'PRACTICE':connected?'LIVE ROOM':'RECONNECTING'}</span><span class="account">${esc(user.name||'Spectator')}</span><button class="sound-toggle quiet" data-action="sound" aria-pressed="${sound}">Sound ${sound?'on':'off'}</button></header>${demo?`<div class="demo-banner"><span><strong>PRACTICE PREVIEW</strong> · Local bids only. Your live auction is untouched.</span><button data-action="reset-demo">Reset practice</button></div>`:''}<div class="headline"><div><div class="eyebrow">GFA PRESENTS / THANKSGIVING 2026</div><h1>THE <em>TURKEY BOWL</em> AUCTION</h1></div><div class="event-tag"><strong>FRIDAY, NOVEMBER 20</strong>${available} players available · 12 captains</div></div>${orderMarkup()}${stageMarkup()}${controlsMarkup()}${view==='stream'?'':poolMarkup()}${teamsMarkup()}<div class="activity" aria-label="Recent auction activity">${state.feed.slice(0,5).map(e=>`<div class="feed-item"><strong>${esc(e.kind.toUpperCase())}</strong>${esc(e.text)}<small>${new Date(e.at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</small></div>`).join('')}</div>${hostTools()}<footer class="footer"><span>GFA / TURKEY BOWL AUCTION TOURNAMENT · NOV 20, 2026</span><span><a href="${BOARD}" target="_blank" rel="noopener">Google draft board</a> · <a href="${url('stream')}">Stream view</a> · <a href="${url('host')}${demo?'':'?demo=1'}">Practice preview</a></span></footer></div>`;
    if(focusId && $(focusId)){const el=$(focusId);el.focus({preventScroll:true});try{if(start!==null)el.setSelectionRange(start,end);}catch(_){} }
  }
  async function refreshMe(){if(demo)return;try{const res=await fetch('/auction/api/me',{cache:'no-store'});me=await res.json();render();}catch(_){} }
  async function action(payload){if(busy)return;busy=true;render();
    try{
      payload={revision:state.revision,lotId:state.lot?.id,...payload};
      if(demo){demoAction(payload);return;}
      const res=await fetch('/auction/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf||''},body:JSON.stringify(payload)});
      const next=await res.json();if(!res.ok){if(res.status===401)await refreshMe();throw new Error(next.error||'The request could not be completed.');}
      if(next.captains)accept(next);else await refreshMe();
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
    if(['start','pause','call','sold','pass','undo','turn','sync'].includes(a.type)&&!host)throw new Error('Only the practice host can use this control.');
    if(['bid','nominate'].includes(a.type)&&(state.paused||!Number.isInteger(a.amount)||a.amount<10||a.amount%10))throw new Error('Bids must be in $10 steps while the auction is open.');
    if(a.type==='start'){state.phase='nominating';demoEvent('start','The Turkey Bowl auction is open.');}
    else if(a.type==='pause'){state.paused=!state.paused;demoEvent('pause',state.paused?'Auction paused.':'Auction resumed.');}
    else if(a.type==='turn'){if(lot)throw new Error('Finish this player first.');state.turn=state.captains.findIndex(c=>c.id===a.captainId);}
    else if(a.type==='nominate'){
      const c=activeCaptain(),p=player(a.playerId);if(state.phase!=='nominating'||lot||(!host&&role.captainId!==c.id))throw new Error('Wait for your nomination turn.');
      if(!p||p.status!=='available')throw new Error('That player is unavailable.');if(a.amount>c.budget||c.roster.length>=6)throw new Error('That opening bid exceeds the captain’s budget.');
      p.status='nominated';state.lot={id:stamp(),playerId:p.id,nominatorId:c.id,leaderId:c.id,amount:a.amount,call:0};state.phase='bidding';demoEvent('nomination',`${c.name} nominates ${p.name} for ${cash(a.amount)}.`,{playerId:p.id,captainId:c.id,amount:a.amount});
    }else if(a.type==='bid'){
      if(!lot)throw new Error('There is no active player.');const c=captain(host?a.captainId:role.captainId);if(a.amount<=lot.amount)throw new Error('The bid must beat the current high bid.');if(a.amount>c.budget||c.roster.length>=6)throw new Error('That bid exceeds the captain’s budget.');lot.amount=a.amount;lot.leaderId=c.id;lot.call=0;demoEvent('bid',`${c.name} bids ${cash(a.amount)}.`,{captainId:c.id,playerId:lot.playerId,amount:a.amount});
    }else if(a.type==='call'){if(lot){lot.call=Math.min(3,lot.call+1);demoEvent('call',['','Going once.','Going twice.','Final call.'][lot.call]);}}
    else if(a.type==='sold'){
      if(!lot)throw new Error('There is no active player.');const c=captain(lot.leaderId),p=player(lot.playerId);c.budget-=lot.amount;c.roster.push({playerId:p.id,amount:lot.amount});p.status='sold';state.sales.push({playerId:p.id,captainId:c.id,amount:lot.amount,turnBefore:state.turn,nominatorId:lot.nominatorId});state.lot=null;nextTurn();state.round=Math.min(6,Math.floor(state.sales.length/12)+1);demoEvent('sold',`${p.name} sold to ${c.name} for ${cash(lot.amount)}.`,{playerId:p.id,captainId:c.id,amount:lot.amount});
    }else if(a.type==='pass'){if(lot){player(lot.playerId).status='available';state.lot=null;nextTurn();demoEvent('pass','Player returned to the pool.');}}
    else if(a.type==='undo'){if(lot||!state.sales.length)throw new Error('Finish this nomination before undoing a sale.');const sale=state.sales.pop(),c=captain(sale.captainId);c.budget+=sale.amount;c.roster=c.roster.filter(p=>p.playerId!==sale.playerId);player(sale.playerId).status='available';state.turn=sale.turnBefore;state.phase='nominating';state.round=Math.min(6,Math.floor(state.sales.length/12)+1);demoEvent('undo','Last sale undone.');}
    else if(a.type==='sync'){toast('Practice stays local. The live room checks the Google board every 15 seconds.');}
    else if(!['approve','revoke'].includes(a.type))throw new Error('Unavailable in practice.');
    state.revision++;saveDemo();
  }
  let originalSeed;
  function resetDemo(){
    const seed=structuredClone(originalSeed);seed.captains.forEach(c=>{c.budget=c.startingBudget;c.roster=[];});seed.players=seed.players.filter(p=>p.onBoard!==false).map(p=>({...p,status:'available'}));
    seed.sales=[];seed.feed=[];seed.lastEvent=null;seed.revision=0;seed.phase='nominating';seed.paused=false;seed.turn=0;seed.round=1;seed.lot=null;state=seed;
    const p=state.players.find(p=>p.name==='AK41')||state.players[0];p.status='nominated';state.lot={id:stamp(),playerId:p.id,nominatorId:state.captains[0].id,leaderId:state.captains[5].id,amount:170,call:0};state.phase='bidding';demoEvent('bid',`${state.captains[5].name} bids $170.`,{playerId:p.id,captainId:state.captains[5].id,amount:170});fields={};lastEvent=null;saveDemo();
  }
  document.addEventListener('input',event=>{const t=event.target;if(t.id==='search'){query=t.value;render();}else if(t.id)fields[t.id]=t.value;});
  document.addEventListener('change',event=>{const t=event.target;if(t.id==='available-only'){availableOnly=t.checked;render();}else if(t.id==='demo-captain'){demoCaptain=t.value;delete fields['bid-amount'];render();}else if(t.id){fields[t.id]=t.value;if(t.id==='proxy-captain')render();}});
  document.addEventListener('toggle',event=>{if(event.target.classList?.contains('host-tools'))fields.toolsOpen=event.target.open;},true);
  document.addEventListener('submit',event=>{const f=event.target;if(!f.dataset.form)return;event.preventDefault();if(!f.reportValidity())return;const data=Object.fromEntries(new FormData(f));if('amount'in data)data.amount=Number(data.amount);action({type:f.dataset.form,...data});});
  document.addEventListener('click',event=>{
    const b=event.target.closest('[data-action]');if(!b)return;const type=b.dataset.action;
    if(type==='filter'){filter=b.dataset.position;render();}
    else if(type==='quick'){fields['bid-amount']=(state.lot?.amount||0)+Number(b.dataset.amount);render();$('bid-amount')?.focus();}
    else if(type==='select-player'){
      const role=effectiveMe();if(!((view==='host'&&role.role==='host')||role.captainId===activeCaptain().id)||state.phase!=='nominating'){toast(`${player(b.dataset.player).name} · ${player(b.dataset.player).position}`);return;}
      fields['nom-player']=b.dataset.player;render();$('nom-player')?.scrollIntoView({behavior:'smooth',block:'center'});$('nom-player')?.focus({preventScroll:true});
    }else if(type==='sound'){sound=!sound;if(sound)beep();render();}
    else if(type==='reset-demo'){resetDemo();}
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
    const response=await fetch('/auction/api/state',{cache:'no-store'});if(!response.ok)throw new Error('The room is temporarily unavailable.');const data=await response.json();
    if(demo){originalSeed=data;connected=true;try{const saved=JSON.parse(localStorage.getItem(DEMO_KEY));if(saved?.captains?.length===12)accept(saved,false);else resetDemo();}catch(_){resetDemo();}channel&&(channel.onmessage=e=>accept(e.data));window.addEventListener('storage',e=>{if(e.key===DEMO_KEY&&e.newValue)accept(JSON.parse(e.newValue));});}
    else{accept(data,false);await refreshMe();connect();setInterval(refreshMe,7000);setInterval(async()=>{if(!connected){try{const r=await fetch('/auction/api/state',{cache:'no-store'});if(r.ok)accept(await r.json());}catch(_){}}},4000);}
  }catch(error){$('app').innerHTML=`<main class="loading"><div class="eyebrow">GFA TURKEY BOWL</div><h1>ROOM CONNECTING</h1><p>${esc(error.message)} Reload to try again.</p></main>`;}}
  load();
})();
