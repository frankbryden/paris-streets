export const LEVELS = [
  {name: 'Les grands axes', description: 'The streets that give Paris its shape.', short: 'Major routes'},
  {name: 'Les grandes traversées', description: 'Connect the city, one avenue at a time.', short: 'City connections'},
  {name: 'La vie de quartier', description: 'Find your bearings in everyday Paris.', short: 'Neighborhood streets'},
  {name: 'Les petites découvertes', description: 'Passages, villas and the streets less travelled.', short: 'Hidden Paris'},
];
export const DAY = 86400000;
export const MODES = [
  {id: 'place-neighborhood', name: 'Place the neighborhood', description: 'Find a point inside the named quartier.'},
  {id: 'place-street', name: 'Place the street', description: 'Draw the street from one end to the other.'},
  {id: 'name-street', name: 'Name the street', description: 'Recognize the highlighted street and search for its name.'},
];
export const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const quartierKey = s => ({chapelle:'lachapelle',sainteavoye:'sainteavoie',pontdeflandres:'pontdeflandre'}[normalize(s)] || normalize(s));
export const learningQuartiers = street => street.quartiers.filter(q=>q!=='Hors Paris');
export const dateKey = (time = Date.now()) => {
  const d = new Date(time); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
export function initialState() {
  return {version: 1, cards: {}, modeCards: {}, activity: {}, settings: {goal: 10, level: 0, arrondissement: 'all', reminders: true, interval: 5, mode: 'place-neighborhood'}, updated: 0};
}
export function cleanState(raw) {
  const base = initialState();
  if (!raw || typeof raw !== 'object') return base;
  const state = {...base, ...raw, cards: raw.cards || {}, modeCards: raw.modeCards || {}, activity: raw.activity || {}, settings: {...base.settings, ...raw.settings}};
  if (!MODES.some(m=>m.id===state.settings.mode)) state.settings.mode = base.settings.mode;
  return state;
}
export function known(state, id) { return (state.cards[id]?.streak || 0) >= 2; }
export function unlockedLevel(streets, state) {
  let unlocked = 0;
  for (let level = 0; level < 3; level++) {
    const group = streets.filter(s => s.level === level);
    if (group.length && group.filter(s => known(state, s.id)).length >= Math.ceil(group.length * .7)) unlocked = level+1;
    else break;
  }
  return unlocked;
}
export function eligible(streets, settings) {
  return streets.filter(s => s.level <= Number(settings.level) && (settings.arrondissement === 'all' || s.arrondissements.includes(Number(settings.arrondissement))));
}
export function nextCard(streets, state, excluded = [], now = Date.now()) {
  const pool = eligible(streets, state.settings);
  const candidates = pool.filter(s => !excluded.includes(s.id));
  const due = candidates.filter(s => state.cards[s.id]?.due <= now).sort((a,b) => state.cards[a.id].due - state.cards[b.id].due);
  if (due.length) return due[0];
  return candidates.find(s => !state.cards[s.id]) || null;
}
export function grade(state, id, correct, now = Date.now()) {
  const old = state.cards[id] || {streak: 0, reviews: 0, interval: 0};
  const streak = correct ? old.streak+1 : 0;
  const interval = correct ? [1,3,7,14,30,60][Math.min(streak-1,5)] : 0;
  const card = {...old, streak, reviews: old.reviews+1, correct: (old.correct || 0)+(correct ? 1 : 0), interval,
    last: now, due: now + (correct ? interval*DAY : 10*60000)};
  const key = dateKey(now);
  return {...state, cards: {...state.cards, [id]: card}, activity: {...state.activity, [key]: (state.activity[key] || 0)+1}, updated: now};
}
export function nextModeCard(pool, state, mode, excluded = [], now = Date.now()) {
  const cards = state.modeCards?.[mode] || {};
  const candidates = pool.filter(s=>!excluded.includes(String(s.id)));
  const due = candidates.filter(s=>cards[s.id]?.due <= now).sort((a,b)=>cards[a.id].due-cards[b.id].due);
  return due[0] || candidates.find(s=>!cards[s.id]) || null;
}
export function gradeMode(state, mode, id, correct, score, now = Date.now()) {
  const previous = state.modeCards?.[mode] || {};
  const result = grade({...state, cards: previous}, id, correct, now);
  const card = {...result.cards[id], points: (previous[id]?.points || 0)+score,
    bestScore: Math.max(previous[id]?.bestScore || 0, score), lastScore: score};
  return {...state, cards: mode === 'place-neighborhood' ? state.cards : grade(state,id,correct,now).cards,
    modeCards: {...state.modeCards, [mode]: {...result.cards, [id]: card}}, activity: result.activity, updated: now};
}
export function streakDays(state, now = Date.now()) {
  let d = new Date(now); d.setHours(12,0,0,0);
  if (!state.activity[dateKey(d)]) d.setDate(d.getDate()-1);
  let n = 0;
  while(state.activity[dateKey(d)]) { n++; d.setDate(d.getDate()-1); }
  return n;
}
