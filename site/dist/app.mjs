import {LEVELS, MODES, DAY, normalize, dateKey, initialState, cleanState, known, unlockedLevel, eligible, nextModeCard, gradeMode, streakDays} from './learning.mjs';
import {ParisMap} from './map.mjs';
import {pointInNeighborhood, streetEndpoints, scoreStreetLine, searchStreetNames} from './geography.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => n.toLocaleString('en-GB');
const KEY = 'paris-rue-par-rue-v1';
const local = ['localhost','127.0.0.1'].includes(location.hostname);
let state, streets, mapData, meta, map, current, guess=null, result=null, nameSelection=null, modePools={}, revealed=false, answered=false, view='learn', session=[], sessionCorrect=0, continuePastGoal=false, selectedStreet, search='', filter='all', localConnected=false, saveQueue=Promise.resolve(), storageOK=true;
const settingsIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m10 3-1 3-3 1-2 3 2 3v4l3 1 1 3h4l1-3 3-1 2-3-2-3V7l-3-1-1-3z"/><circle cx="12" cy="12" r="3"/></svg>';
const north = '<svg viewBox="0 0 20 30"><path d="M10 2 3 26l7-6 7 6Z" fill="#69877b"/><path d="M10 2v18l7 6Z" fill="#eaf0ed"/></svg>N';

function toast(message) {
  $('.toast')?.remove();const e=document.createElement('div');e.className='toast';e.setAttribute('role','status');e.textContent=message;document.body.append(e);setTimeout(()=>e.remove(),4500);
}
function persist() {
  state.updated=Date.now();
  try{localStorage.setItem(KEY,JSON.stringify(state));}catch{if(storageOK)toast('Browser storage is full or unavailable. Export your progress in settings.');storageOK=false;}
  if(localConnected){const snapshot=JSON.stringify(state);saveQueue=saveQueue.catch(()=>{}).then(async()=>{const res=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot});if(!res.ok)throw Error('save');}).catch(()=>toast('Could not save to the Mac companion. Keep it running; browser progress is saved.'));}
}
function arrOptions(value='all') {return `<option value="all" ${value==='all'?'selected':''}>All Paris</option>`+Array.from({length:20},(_,i)=>`<option value="${i+1}" ${String(value)===String(i+1)?'selected':''}>${i+1}${i===0?'st':i===1?'nd':i===2?'rd':'th'} arrondissement</option>`).join('');}
function dueLabel(id,cards=state.cards) {const c=cards[id];if(!c)return 'New street';const days=Math.ceil((c.due-Date.now())/DAY);return days<=0?'Due for review':`In ${days} day${days===1?'':'s'}`;}
function details(street) {
  return `<div class="details"><div class="meta"><span>${street.arrondissements.map(a=>a+'e').join(', ')} arrondissement${street.arrondissements.length>1?'s':''}</span>${street.length?`<span>${num(street.length)} m long</span>`:''}</div>${street.start?`<p><b>From</b> ${esc(street.start)}</p>`:''}${street.end?`<p><b>To</b> ${esc(street.end)}</p>`:''}${street.origin||street.history?`<details><summary>The story behind the street</summary><div class="history">${street.origin?`<p>${esc(street.origin)}</p>`:''}${street.history?`<p>${esc(street.history)}</p>`:''}</div></details>`:''}</div>`;
}
function header() {
  const today=state.activity[dateKey()]||0;
  return `<header class="header"><a class="brand" href="#learn" aria-label="Paris, rue par rue home"><img src="icon.svg" alt=""><span><strong>Paris, rue par rue</strong><small>A little more Paris, every day.</small></span></a><nav class="nav" aria-label="Main navigation">${[['learn','Learn'],['explore','Explore'],['progress','Your progress']].map(([key,label])=>`<button type="button" data-view="${key}" class="${view===key?'active':''}" ${view===key?'aria-current="page"':''}>${label}</button>`).join('')}</nav><div class="header-right"><div class="daily-mini"><strong>${today} / ${state.settings.goal}</strong> today<div class="mini-track"><i style="width:${Math.min(today/state.settings.goal*100,100)}%"></i></div></div><button type="button" class="icon-button" id="settings" aria-label="Learning and reminder settings">${settingsIcon}</button></div></header>`;
}
function footer() {return `<footer class="footer"><span>${num(streets.length)} streets. 80 neighborhoods. One city to get to know.</span><span>${localConnected?'Saved on your Mac':'Saved in this browser'} &nbsp; · &nbsp; <button type="button" id="sources">Data & sources</button></span></footer>`;}
function intro(title, subtitle, withFilter=false) {
  return `<section class="intro"><div><h1>${title}</h1><p>${subtitle}</p></div>${withFilter?`<label class="filter"><span>Where to wander</span><select id="arr-filter" aria-label="Filter by arrondissement">${arrOptions(view==='explore'?filter:state.settings.arrondissement)}</select></label>`:''}</section>`;
}
function mapMarkup() {return `<section class="map-wrap" aria-label="Street map"><div class="map-top"><div class="map-note"><i></i><span id="map-legend">The street you’re learning</span></div><div class="north" aria-hidden="true">${north}</div></div><div class="map-street" id="map-caption"></div><div class="map-credit"><span>City of Paris · Official street geometries</span><a href="${meta.sources.centerlines}" target="_blank" rel="noopener">Paris Open Data ↗</a></div></section>`;}
function pathMarkup() {
  return `<section class="learning-path" aria-label="Learning path"><div class="path-heading"><h2>Your path through Paris</h2><span>From the familiar to the unexpected</span></div><div class="path-grid">${LEVELS.map((level,i)=>{const group=streets.filter(s=>s.level===i),count=group.filter(s=>known({cards:modeCards()},s.id)).length;return `<button type="button" data-level="${i}" class="path-item ${Number(state.settings.level)===i?'selected':''}" title="Study ${esc(level.short)}"><span class="step">${i+1}</span><span style="flex:1"><strong>${level.name}</strong><small>${num(group.length)} streets · ${count} familiar</small><span class="path-bar"><i style="width:${count/group.length*100}%"></i></span></span></button>`;}).join('')}</div></section>`;
}
function mode() {return state.settings.mode;}
function modeCards() {return state.modeCards[mode()] || {};}
function modePool() {
  if(mode()==='place-neighborhood') return mapData.quartiers.filter(q=>state.settings.arrondissement==='all'||q.arrondissement===Number(state.settings.arrondissement)).sort((a,b)=>a.id-b.id);
  const pool=eligible(streets,state.settings);
  return mode()==='place-street'?pool.filter(s=>modePools[s.id]):pool;
}
function modeMarkup() {return `<div class="mode-picker" role="group" aria-label="Practice mode">${MODES.map(m=>`<button type="button" data-mode="${m.id}" aria-pressed="${mode()===m.id}" class="${mode()===m.id?'selected':''}">${m.name}</button>`).join('')}</div>`;}
function lessonMarkup() {
  if(!current){
    const pool=modePool(),cards=modeCards(),next=pool.filter(s=>cards[s.id]).sort((a,b)=>cards[a.id].due-cards[b.id].due)[0],goal=(state.activity[dateKey()]||0)>=state.settings.goal;
    return `<div class="empty"><div class="empty-symbol">✦</div><h2>${goal?'A little more Paris, learned.':'You’re all caught up.'}</h2><p>${session.length?`${sessionCorrect} of ${session.length} answers correct this session. `:''}${next?`Your next review is ${new Date(cards[next.id].due).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}.`:'Try another arrondissement or chapter.'}</p><button type="button" class="primary" id="keep-learning">${goal?'Keep wandering':'Check for new places'}</button><button type="button" class="quiet-button" data-view="explore">Explore the map</button></div>`;
  }
  const neighborhood=mode()==='place-neighborhood',naming=mode()==='name-street';
  const label=neighborhood?'Administrative quartier':LEVELS[current.level].short;
  const plaque=naming&&!revealed?`<div class="mystery-street"><span class="mystery-line" aria-hidden="true">⌁</span><h2>What’s this street called?</h2><p>Follow the highlighted street on the map.</p></div>`:`<div class="plaque" lang="fr"><span class="street-type">${neighborhood?'Quartier':esc(current.type||'voie')}</span><h2>${esc(neighborhood?current.name:current.name.replace(new RegExp('^'+(current.type||'')+'\\s*','i'),'').replace(/^./,c=>c.toUpperCase()))}</h2></div>`;
  const top=`<div class="lesson-top"><span>${label} / ${session.length+(answered?0:1)}</span><span class="status-pill">${answered?'Reviewed':modeCards()[current.id]?'Review':'New'}</span></div>${plaque}`;
  if(revealed){
    const answer=neighborhood?`${current.arrondissement}e arrondissement`:current.quartiers.join(' · ');
    return `${top}<div role="status" class="result-panel ${result.correct?'success':'miss'}"><strong>${result.correct?'Bien joué.':'A place to remember.'}</strong><div class="score-number">${num(result.score)} <small>/ 1,000 points</small></div><p>${esc(result.message)}</p>${result.errors?`<div class="endpoint-scores">${result.errors.map((d,i)=>`<span>Endpoint ${i+1}<b>${Math.round(d)} m away</b><small>${result.pointsPerEndpoint[i]} / 500 points</small></span>`).join('')}</div>`:''}</div><p class="answer-line"><strong>${esc(current.name)}</strong><br>${esc(answer)}</p>${neighborhood?'<p class="saved-note">The shaded area shows the official boundary. A point anywhere inside it counts.</p>':details(current)}<div class="lesson-bottom"><button type="button" class="primary full" id="next">Next ${neighborhood?'neighborhood':'street'} <span aria-hidden="true">↗</span></button><p class="hint-keys">Enter for the next question</p></div>`;
  }
  let task;
  if(neighborhood)task=`<h2 class="question">Where is ${esc(current.name)}?<small>Click a point inside this neighborhood on the unlabelled map. Drag to move the map.</small></h2><p id="guess-status" class="guess-status" role="status">Choose your point on the map.</p>`;
  else if(!naming)task=`<h2 class="question">Draw this street on the map.<small><span class="desktop-draw-help">Hold <kbd>⌘ Command</kbd> (or <kbd>Ctrl</kbd>) and drag from one end to the other. Release the key to return to moving the map.</span><span class="touch-draw-help">Hold the “Hold to draw” button with one finger and draw with another. Use two fingers on the map to pinch and move.</span></small></h2><p id="guess-status" class="guess-status" role="status">Drag to move the map. Hold Command to draw.</p><p class="scoring-note">Within 25 m of an endpoint earns the full 500 points. Beyond that, points decrease with distance. Either direction counts. 700 / 1,000 counts as a successful review.</p>`;
  else task=`<form id="name-form"><label class="question" for="name-search">Name the highlighted street.<small>Search all ${num(streets.length)} streets. Accents are optional.</small></label><div class="street-combobox"><input id="name-search" type="search" autocomplete="off" placeholder="Type a street name…" role="combobox" aria-autocomplete="list" aria-controls="name-options" aria-expanded="false"><div id="name-options" class="name-options" role="listbox" aria-label="Matching street names" hidden></div></div><p class="saved-note" id="name-count" aria-live="polite">Names appear only when you start typing.</p></form>`;
  return `${top}${task}<div class="lesson-bottom"><button type="button" class="primary full" id="check-answer" ${naming?'':'disabled'}>Check ${naming?'name':neighborhood?'point':'line'}</button>${!naming?'<button type="button" class="quiet-button" id="clear-guess" disabled>Clear and try again</button>':''}<button type="button" class="quiet-button reveal-answer" id="reveal">Show the answer</button><p class="hint-keys">Space to reveal · Enter to check</p></div>`;
}
function chooseNext({ignoreGoal=false}={}) {
  revealed=false;answered=false;guess=null;result=null;nameSelection=null;
  const done=(state.activity[dateKey()]||0)>=state.settings.goal;
  current=done&&!ignoreGoal?null:nextModeCard(modePool(),state,mode(),session);
}
function drawLearn() {
  map?.destroy();
  const m=MODES.find(m=>m.id===mode());
  $('#app').innerHTML=`<div class="shell">${header()}${intro('Get to know your Paris.',m.description,true)}${modeMarkup()}<main class="workspace practice-workspace"><section class="lesson" aria-label="${m.name} quiz">${lessonMarkup()}</section>${mapMarkup()}</main>${mode()==='place-neighborhood'?neighborhoodProgress():pathMarkup()}${footer()}</div>`;
  map=new ParisMap($('.map-wrap'),mapData);
  if(current){if(mode()==='name-street')map.show(current,revealed,{hideName:!revealed});else map.showBlank(state.settings.arrondissement);if(revealed)revealMap();else configureMap();}else map.showBlank();
  updateMapCaption();bindCommon();bindLesson();
  $$('[data-mode]').forEach(b=>b.addEventListener('click',()=>{state.settings.mode=b.dataset.mode;session=[];sessionCorrect=0;continuePastGoal=false;persist();chooseNext({ignoreGoal:true});drawLearn();}));
  $$('[data-level]').forEach(b=>b.addEventListener('click',()=>{state.settings.level=Number(b.dataset.level);session=[];sessionCorrect=0;persist();chooseNext({ignoreGoal:true});drawLearn();}));
}
function neighborhoodProgress(){const pool=mapData.quartiers,cards=modeCards(),count=pool.filter(q=>(cards[q.id]?.streak||0)>=2).length;return `<section class="learning-path"><div class="path-heading"><h2>Your neighborhood bearings</h2><span>${count} of ${pool.length} neighborhoods familiar</span></div><span class="path-bar"><i style="width:${count/pool.length*100}%"></i></span></section>`;}
function configureMap(){
  if(mode()==='name-street'){map.setInteraction('pan');return;}
  map.setInteraction(mode()==='place-neighborhood'?'point':'line',value=>{guess=value;$('#check-answer').disabled=false;$('#clear-guess').disabled=false;$('#guess-status').textContent=mode()==='place-neighborhood'?'Point placed. Click elsewhere to adjust it, then check.':'Line drawn. Hold Command and drag to redraw, or check your answer.';},drawing=>{
    guess=drawing?null:map.guess?.length===2?map.guess:null;
    $('#check-answer').disabled=!guess;$('#clear-guess').disabled=!guess&&!drawing;
    $('#guess-status').textContent=drawing?'Drawing… release the mouse or lift your drawing finger to finish.':guess?'Your previous line is kept. Hold Command and drag to redraw.':'Drag to move the map. Hold Command to draw.';
  });
  if(mode()==='place-street'){
    const button=document.createElement('button');button.type='button';button.className='touch-draw-hold';button.textContent='Hold to draw';button.setAttribute('aria-label','Hold with one finger, then draw on the map with another');button.setAttribute('aria-pressed','false');
    $('.map-wrap').append(button);
    button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);button.setAttribute('aria-pressed','true');map.holdDraw(true);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>{button.setAttribute('aria-pressed','false');map.holdDraw(false);});
  }
}
function updateMapCaption(){if(!$('#map-caption'))return;const naming=mode()==='name-street';$('#map-caption').textContent=!current?'There’s always another corner of Paris.':revealed?current.name:mode()==='place-neighborhood'?'Place a point. Neighborhood boundaries are hidden.':naming?'Identify the highlighted street.':'Drag or scroll to move. Pinch to zoom. Hold ⌘ to draw.';$('#map-legend').textContent=revealed?'Answer & your guess':naming?'The street to identify':'Unlabelled Paris';}
function bindLesson(){
  $('#check-answer')?.addEventListener('click',submitGuess);
  $('#reveal')?.addEventListener('click',()=>reveal());
  $('#next')?.addEventListener('click',()=>{chooseNext({ignoreGoal:continuePastGoal});drawLearn();});
  $('#keep-learning')?.addEventListener('click',()=>{continuePastGoal=true;session=[];sessionCorrect=0;chooseNext({ignoreGoal:true});drawLearn();});
  $('#clear-guess')?.addEventListener('click',()=>{guess=null;map.clearGuess();$('#check-answer').disabled=true;$('#clear-guess').disabled=true;$('#guess-status').textContent=mode()==='place-neighborhood'?'Choose your point on the map.':'Drag to move the map. Hold Command to draw.';});
  if($('#name-search'))bindStreetSearch();
}
function submitGuess(){
  if(!current||answered)return;
  if(mode()==='place-neighborhood'){
    if(!guess)return;const correct=pointInNeighborhood(guess,current);finishAnswer({correct,score:correct?1000:0,message:correct?'Your point is inside the official boundary.':'Your point is outside the official boundary.'});
  }else if(mode()==='place-street'){
    if(!guess||guess.length!==2)return;const score=scoreStreetLine(guess,modePools[current.id]);finishAnswer({...score,message:score.correct?'You’ve found the street’s position.':'Compare your line with the actual street, then try it again later.'});
  }else{
    const input=$('#name-search'),name=input.value;
    const chosen=nameSelection||streets.find(s=>normalize(s.name)===normalize(name));
    if(!chosen){toast('Choose a street from the filtered dropdown.');input.focus();return;}
    const correct=chosen.id===current.id;finishAnswer({correct,score:correct?1000:0,message:correct?'You recognized the highlighted street.':`You chose ${chosen.name}. The highlighted street is ${current.name}.`});
  }
}
function finishAnswer(value){
  if(answered||!current)return;result=value;state=gradeMode(state,mode(),String(current.id),value.correct,value.score);answered=true;revealed=true;session.push(String(current.id));if(value.correct)sessionCorrect++;
  if(mode()!=='place-neighborhood'){const unlock=unlockedLevel(streets,{...state,cards:modeCards()});if(unlock>state.settings.level){state.settings.level=unlock;toast(`A new chapter: ${LEVELS[unlock].name}.`);}}
  persist();$('.lesson').innerHTML=lessonMarkup();bindLesson();revealMap();updateMapCaption();
  const mini=$('.daily-mini');if(mini)mini.replaceWith(document.createRange().createContextualFragment(header()).querySelector('.daily-mini'));
}
function revealMap(){map.setInteraction('pan');if(mode()==='place-neighborhood')map.revealNeighborhood(current);else map.show(current,true);if(guess&&mode()!=='name-street'){map.drawGuess(mode()==='place-neighborhood'?[guess]:guess);map.setGuessResult(result.correct);}}
function reveal(){if(!current||revealed)return;finishAnswer({correct:false,score:0,message:'Answer revealed. This question will return in 10 minutes.'});}
function bindStreetSearch(){
  const input=$('#name-search'),list=$('#name-options'),count=$('#name-count');let matches=[],active=-1;
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');};
  const choose=street=>{nameSelection=street;input.value=street.name;close();count.textContent='Street selected. Check your answer when ready.';input.focus();};
  const highlight=()=>{$$('[role="option"]',list).forEach((e,i)=>{e.classList.toggle('active',i===active);e.setAttribute('aria-selected',i===active);});if(active>=0){input.setAttribute('aria-activedescendant',`name-option-${active}`);list.children[active]?.scrollIntoView({block:'nearest'});}};
  const update=()=>{nameSelection=null;const found=searchStreetNames(streets,input.value,normalize);matches=found.matches;active=-1;list.innerHTML=matches.map((s,i)=>`<button type="button" role="option" aria-selected="false" id="name-option-${i}" data-name-index="${i}" tabindex="-1">${esc(s.name)}</button>`).join('');list.hidden=!matches.length;input.setAttribute('aria-expanded',matches.length?'true':'false');input.removeAttribute('aria-activedescendant');count.textContent=!input.value.trim()?'Names appear only when you start typing.':found.total?`${num(found.total)} match${found.total===1?'':'es'}${found.total>matches.length?' · Keep typing to narrow the list.':''}`:'No matching streets. Try a shorter name.';$$('[data-name-index]',list).forEach(b=>b.addEventListener('click',()=>choose(matches[Number(b.dataset.nameIndex)])));};
  input.addEventListener('input',update);
  input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!matches.length)return;list.hidden=false;input.setAttribute('aria-expanded','true');active=e.key==='ArrowDown'?Math.min(active+1,matches.length-1):Math.max(active-1,0);highlight();}else if(e.key==='Escape')close();else if(e.key==='Enter'){e.preventDefault();if(!list.hidden&&active>=0)choose(matches[active]);else submitGuess();}});
  $('#name-form').addEventListener('submit',e=>{e.preventDefault();submitGuess();});
  input.addEventListener('blur',()=>setTimeout(close,150));
}
function drawExplore() {
  $('#app').innerHTML=`<div class="shell">${header()}${intro('Follow your curiosity.','Every street has a neighborhood. Some have a story, too.',true)}<main class="workspace explore-layout"><section class="explore-side" aria-label="Browse streets"><div class="search-box"><input type="search" id="street-search" placeholder="Try Cévennes, Javel or a street name…" aria-label="Search streets or neighborhoods" value="${esc(search)}"><p id="result-count"></p></div><div class="street-list" id="street-list"></div><div class="explore-detail" id="explore-detail"></div></section>${mapMarkup()}</main>${footer()}</div>`;
  map?.destroy();map=new ParisMap($('.map-wrap'),mapData);map.show(selectedStreet,true);bindCommon();renderList();
  $('#street-search').addEventListener('input',e=>{search=e.target.value;renderList();});
}
function renderList() {
  const query=normalize(search);
  const matches=streets.filter(s=>(filter==='all'||s.arrondissements.includes(Number(filter)))&&(!query||normalize(s.name+' '+s.quartiers.join(' ')).includes(query)));
  $('#result-count').textContent=`${num(matches.length)} street${matches.length===1?'':'s'}${matches.length>80?' · First 80 shown; type to narrow down.':''}`;
  $('#street-list').innerHTML=matches.slice(0,80).map(s=>`<button type="button" class="street-row ${selectedStreet?.id===s.id?'selected':''}" data-street="${esc(s.id)}"><strong>${esc(s.name)}</strong><small>${esc(s.quartiers.join(' · '))} &nbsp; ${s.arrondissements.map(a=>a+'e').join(', ')}</small></button>`).join('')||'<div class="empty"><p>No streets found. Try a shorter name or another arrondissement.</p></div>';
  $$('[data-street]').forEach(b=>b.addEventListener('click',()=>selectStreet(streets.find(s=>s.id===b.dataset.street))));
  if(!selectedStreet&&matches.length)selectStreet(matches[0]);else renderExploreDetail();
}
function selectStreet(street) {selectedStreet=street;map.show(street,true);$$('[data-street]').forEach(b=>b.classList.toggle('selected',b.dataset.street===street.id));renderExploreDetail();}
function renderExploreDetail() {
  const s=selectedStreet;if(!s)return;
  $('#explore-detail').innerHTML=`<h3>${esc(s.name)}</h3><p><strong>${esc(s.quartiers.join(' · '))}</strong></p><p class="saved-note">${known(state,s.id)?'Familiar':state.cards[s.id]?'Learning':'Not yet studied'} · ${dueLabel(s.id)}</p>${details(s)}<button type="button" class="quiet-button" id="study-this">Study this street</button>`;
  $('#map-caption').textContent=`${s.name} · ${s.arrondissements.map(a=>a+'e').join(', ')}`;$('#map-legend').textContent='Street & neighborhood';
  $('#study-this').addEventListener('click',()=>{state.settings.mode='name-street';persist();current=s;guess=null;result=null;nameSelection=null;revealed=false;answered=false;setView('learn',false);});
}
function drawProgress() {
  map?.destroy();map=null;
  const streetCards=Object.values(state.cards),cards=streetCards.concat(Object.values(state.modeCards['place-neighborhood']||{})),familiar=streets.filter(s=>known(state,s.id)).length,reviews=cards.reduce((n,c)=>n+c.reviews,0),correct=cards.reduce((n,c)=>n+(c.correct||0),0),due=modePool().filter(s=>modeCards()[s.id]?.due<=Date.now()).length;
  const days=Array.from({length:14},(_,i)=>{const d=new Date();d.setDate(d.getDate()-13+i);return {key:dateKey(d),label:d.toLocaleDateString('en-GB',{weekday:'short'}),date:d.getDate()};});
  const upcoming=modePool().filter(s=>modeCards()[s.id]).sort((a,b)=>modeCards()[a.id].due-modeCards()[b.id].due).slice(0,6);
  $('#app').innerHTML=`<div class="shell">${header()}${intro('Paris is becoming familiar.','A street remembered is another connection made.')}<main class="progress-page"><section class="stats" aria-label="Learning statistics"><div class="stat"><strong>${num(familiar)}</strong><span>streets familiar</span></div><div class="stat"><strong>${num(streetCards.length)}</strong><span>streets discovered</span></div><div class="stat"><strong>${streakDays(state)}</strong><span>day streak</span></div><div class="stat"><strong>${reviews?Math.round(correct/reviews*100)+'%':'—'}</strong><span>recall accuracy</span></div></section><section class="progress-section"><h2>Practice in three ways</h2>${MODES.map(m=>{const cards=Object.values(state.modeCards[m.id]||{}),reviews=cards.reduce((n,c)=>n+c.reviews,0),points=cards.reduce((n,c)=>n+(c.points||0),0);return `<div class="mode-progress-row"><strong>${m.name}</strong><span>${cards.length} studied · ${num(reviews)} reviews · ${num(points)} points</span></div>`;}).join('')}<p>Each mode has its own review schedule. Your earlier learning progress is preserved.</p></section><section class="progress-section"><h2>A little Paris, every day</h2><div class="week">${days.map(d=>`<div class="day ${state.activity[d.key]?'active':''} ${d.key===dateKey()?'today':''}" title="${d.key}: ${state.activity[d.key]||0} reviews"><b>${state.activity[d.key]||'–'}</b><small>${d.label} ${d.date}</small></div>`).join('')}</div><p>Today: ${state.activity[dateKey()]||0} of ${state.settings.goal} reviews. A place becomes familiar after two consecutive successful reviews in a mode.</p></section><section class="progress-section"><h2>Your path through Paris</h2><p>${mode()==='place-neighborhood'?'Place the street':MODES.find(m=>m.id===mode()).name}</p>${LEVELS.map((l,i)=>{const pool=streets.filter(s=>s.level===i),cards=state.modeCards[mode()==='place-neighborhood'?'place-street':mode()]||{},n=pool.filter(s=>known({cards},s.id)).length;return `<div class="level-progress"><span>${i+1}</span><div><strong>${l.name}</strong><span class="path-bar"><i style="width:${n/pool.length*100}%"></i></span></div><span>${num(n)} / ${num(pool.length)}</span></div>`;}).join('')}<p>Start with the major routes. Your next chapter opens automatically when 70% of the current chapter is familiar in the street mode you’re practising. You can also choose any chapter yourself.</p></section><section class="progress-section"><p>${MODES.find(m=>m.id===mode()).name}</p><h2>${due?`${due} ${mode()==='place-neighborhood'?'neighborhood':'street'}${due===1?' is':'s are'} ready for review`:'Your next encounters'}</h2>${upcoming.length?upcoming.map(s=>`<div class="review-row"><strong>${esc(s.name)}</strong><span>${dueLabel(s.id,modeCards())}</span></div>`).join(''):'<p>Your first places will appear here after you try a lesson.</p>'}<div style="margin-top:20px"><button type="button" class="primary" data-view="learn">${due?'Review places':'Start a question'}</button></div></section></main>${footer()}</div>`;bindCommon();
}
function setView(next, pick=true) {view=next;history.replaceState(null,'','#'+view);if(view==='learn'){if(pick)chooseNext();drawLearn();}else if(view==='explore')drawExplore();else drawProgress();window.scrollTo({top:0,behavior:'instant'});}
function bindCommon() {
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('.brand').addEventListener('click',e=>{e.preventDefault();setView('learn');});
  $('#settings').addEventListener('click',settingsDialog);$('#sources').addEventListener('click',sourcesDialog);
  $('#arr-filter')?.addEventListener('change',e=>{if(view==='learn'){state.settings.arrondissement=e.target.value;session=[];persist();chooseNext({ignoreGoal:true});drawLearn();}else{filter=e.target.value;selectedStreet=null;renderList();}});
}
function dialog(title, content, footer='') {
  $('dialog')?.remove();const e=document.createElement('dialog');e.innerHTML=`<div class="dialog-top"><h2>${title}</h2><button type="button" aria-label="Close dialog">×</button></div>${content}${footer}`;
  document.body.append(e);$('.dialog-top button',e).addEventListener('click',()=>e.close());e.addEventListener('click',event=>{if(event.target===e){const r=e.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)e.close();}});e.showModal();return e;
}
function settingsDialog() {
  const d=dialog('Make it a daily habit.',`<form id="settings-form"><label class="setting-row"><span>Daily learning goal<small>A small, regular dose of Paris.</small></span><select name="goal">${[5,10,15,20,30].map(n=>`<option value="${n}" ${state.settings.goal===n?'selected':''}>${n} questions</option>`).join('')}</select></label><label class="setting-row"><span>Mac reminders<small>${localConnected?'Uses the local app’s progress and current chapter.':'Managed by the Mac companion.'}</small></span><input class="toggle" type="checkbox" name="reminders" ${state.settings.reminders?'checked':''} ${localConnected?'':'disabled'}></label><label class="setting-row"><span>Reminder frequency</span><select name="interval" ${localConnected?'':'disabled'}>${[5,15,30,60].map(n=>`<option value="${n}" ${state.settings.interval===n?'selected':''}>Every ${n} minutes</option>`).join('')}</select></label><p class="setting-note">${localConnected?'Mac notifications teach a street and its neighborhood even when this tab is closed. They follow your current chapter and arrondissement. Your Mac must be awake and allow notifications from Script Editor.':'For notifications while the app is closed, use the <a href="http://127.0.0.1:8765" target="_blank" rel="noopener">Mac companion</a>. Reminder settings and progress are shared with the local app. This hosted version saves progress in this browser; use export/import to transfer it.'}</p><label class="setting-row"><span>Save your progress<small>Move your learning between browsers or back it up.</small></span></label><div class="data-actions"><button type="button" class="secondary" id="export-progress">Export progress</button><button type="button" class="secondary" id="import-progress">Import progress</button></div><input type="file" id="import-file" accept="application/json,.json" hidden><div class="dialog-footer"><button type="submit" class="primary">Save settings</button></div></form>`);
  $('#settings-form').addEventListener('submit',e=>{e.preventDefault();const f=new FormData(e.target);state.settings.goal=Number(f.get('goal'));if(localConnected){state.settings.reminders=f.get('reminders')==='on';state.settings.interval=Number(f.get('interval'));}persist();d.close();if(view==='learn')drawLearn();else if(view==='progress')drawProgress();toast('Settings saved.');});
  $('#export-progress').addEventListener('click',()=>{const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));a.href=url;a.download=`paris-progress-${dateKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('#import-progress').addEventListener('click',()=>$('#import-file').click());
  $('#import-file').addEventListener('change',async e=>{
    try{const f=e.target.files[0];if(!f)return;if(f.size>2000000)throw Error('size');const data=JSON.parse(await f.text());
      if(data.version!==1||!data.cards||typeof data.cards!=='object'||Array.isArray(data.cards)||!data.settings||!data.activity)throw Error('format');
      const ids=new Set(streets.map(s=>s.id));for(const [id,c] of Object.entries(data.cards))if(!ids.has(id)||!c||!['streak','reviews','due','correct'].every(k=>Number.isFinite(c[k])&&c[k]>=0))throw Error('card');
      if(![5,10,15,20,30].includes(data.settings.goal)||![0,1,2,3].includes(data.settings.level)||!['all',...Array.from({length:20},(_,i)=>String(i+1))].includes(String(data.settings.arrondissement)))throw Error('settings');
      if(![5,15,30,60].includes(data.settings.interval)||typeof data.settings.reminders!=='boolean'||Object.entries(data.activity).some(([k,v])=>!/^\d{4}-\d{2}-\d{2}$/.test(k)||!Number.isInteger(v)||v<0))throw Error('activity');
      if(data.settings.mode!==undefined&&!MODES.some(m=>m.id===data.settings.mode))throw Error('mode');
      if(data.modeCards!==undefined){
        if(!data.modeCards||typeof data.modeCards!=='object'||Array.isArray(data.modeCards))throw Error('modes');
        const quartierIds=new Set(mapData.quartiers.map(q=>String(q.id)));
        for(const [mode,group] of Object.entries(data.modeCards)){
          if(!MODES.some(m=>m.id===mode)||!group||typeof group!=='object'||Array.isArray(group))throw Error('mode');
          const allowed=mode==='place-neighborhood'?quartierIds:ids;
          for(const [id,c] of Object.entries(group))if(!allowed.has(id)||!c||!['streak','reviews','due','correct'].every(k=>Number.isFinite(c[k])&&c[k]>=0)||['points','bestScore','lastScore'].some(k=>c[k]!==undefined&&(!Number.isFinite(c[k])||c[k]<0||(k!=='points'&&c[k]>1000))))throw Error('mode card');
        }
      }
      const imported=cleanState(data);const count=Object.keys(imported.cards).length;
      const confirmDialog=dialog('Import your progress?',`<p class="setting-note">This file contains ${count} studied streets, plus any mode-specific progress. It will replace the progress currently saved here.</p><div class="dialog-footer"><button type="button" class="primary" id="confirm-import">Replace with imported progress</button></div>`);
      $('#confirm-import').addEventListener('click',()=>{state=imported;persist();confirmDialog.close();session=[];sessionCorrect=0;setView(view);toast('Progress imported.');});
    }catch{toast('That file is not a valid Paris progress backup.');}
  });
}
function sourcesDialog() {dialog('Drawn from the real Paris.',`<p class="setting-note">${num(streets.length)} named streets from the City of Paris. Neighborhoods are the city’s 80 official administrative quartiers. A street may belong to several; every listed neighborhood is shown.</p><a class="source-link" href="${meta.sources.streets}" target="_blank" rel="noopener">Street names, neighborhoods & history ↗</a><a class="source-link" href="${meta.sources.centerlines}" target="_blank" rel="noopener">Official street centerlines ↗</a><a class="source-link" href="${meta.sources.quartiers}" target="_blank" rel="noopener">Administrative neighborhood boundaries ↗</a><p class="setting-note">Downloaded ${esc(meta.downloaded)}. ${esc(meta.license)}. The map works without external map tiles. ${num(meta.centerlineMatches)} streets have a matching centerline; the others use their official footprint.</p><p class="setting-note">The first 54 major streets are curated. Later chapters are ordered by length, width and road type, rather than an official measure of importance. Unnamed numbered roads and entries without neighborhood data are left out.</p><p class="setting-note">Correct reviews are scheduled after 1, 3, 7, 14, 30 and 60 days. Missed or revealed questions return after 10 minutes. Each practice mode has its own review schedule. Street placement scores the full visible span of the centerline, with up to 500 points per endpoint in either direction. Each endpoint within 25 m earns full points. Closed routes remain available in Name the street. Notifications are passive reminders and do not count as successful reviews.</p>`);}

document.addEventListener('keydown',e=>{
  if($('dialog[open]')||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||view!=='learn'||!current||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.code==='Space'&&!revealed){e.preventDefault();reveal();}
  if(e.key==='Enter'){e.preventDefault();if(revealed&&answered)$('#next')?.click();else submitGuess();}
});
async function init() {
  try{
    [streets,mapData,meta]=await Promise.all(['streets','map','meta'].map(async name=>{const r=await fetch(`data/${name}.json`);if(!r.ok)throw Error(name);return r.json();}));
    modePools=Object.fromEntries(streets.map(s=>[s.id,streetEndpoints(s)]));
    try{state=cleanState(JSON.parse(localStorage.getItem(KEY)||'null'));}catch{state=initialState();storageOK=false;}
    if(local){try{const r=await fetch('/api/state');if(r.ok){const result=await r.json();if(result.companion==='paris-rue-par-rue'){localConnected=true;const saved=cleanState(result.state);if(saved.updated>=state.updated)state=saved;else persist();}}}catch{}}
    const requested=location.hash.slice(1);view=['learn','explore','progress'].includes(requested)?requested:'learn';
    setView(view);if(!storageOK)toast('Browser storage is unavailable. Export progress before closing.');
    if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
  }catch(error){$('#app').innerHTML='<div class="loading"><h1>The map couldn’t unfold.</h1><p>Check your connection, then try again.</p><button class="primary" id="retry">Try again</button></div>';$('#retry').addEventListener('click',()=>location.reload());console.error(error);}
}
init();
