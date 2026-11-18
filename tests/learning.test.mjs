import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initialState, grade, DAY, known, nextCard, cleanState, nextModeCard, gradeMode, eligible, unlockedLevel, dateKey, streakDays} from '../site/dist/learning.mjs';
const streets=JSON.parse(fs.readFileSync(new URL('../site/dist/data/streets.json',import.meta.url)));
const quartiers=JSON.parse(fs.readFileSync(new URL('../site/dist/data/map.json',import.meta.url))).quartiers;

test('Cévennes is in Javel, with map geometry and the 15th arrondissement',()=>{
  const s=streets.find(s=>s.name==='rue des Cévennes');
  assert.deepEqual(s.quartiers,['Javel']);assert.deepEqual(s.arrondissements,[15]);assert.ok(s.lines.length);
});
test('catalogue has unique IDs, progressive ranks, and geometry for every street',()=>{
  assert.equal(new Set(streets.map(s=>s.id)).size,streets.length);
  assert.equal(streets.filter(s=>s.level===0).length,54);
  streets.forEach((s,i)=>{assert.equal(s.rank,i);assert.ok(s.quartiers.length);assert.ok(s.lines.length||s.outline.length);assert.equal(s.center.length,2);if(i)assert.ok(s.level>=streets[i-1].level);});
});
test('correct recalls increase intervals; a lapse returns in 10 minutes and resets familiarity',()=>{
  let state=initialState(),now=1000000000000;
  for(const days of [1,3,7,14,30,60,60]){state=grade(state,'test',true,now);assert.equal(state.cards.test.due,now+days*DAY);now=state.cards.test.due;}
  assert.ok(known(state,'test'));state=grade(state,'test',false,now);
  assert.equal(state.cards.test.due,now+600000);assert.equal(known(state,'test'),false);assert.equal(state.cards.test.reviews,8);assert.equal(state.cards.test.correct,7);
});
test('due reviews take priority and future cards do not repeat early',()=>{
  let state=initialState();const now=Date.now();state=grade(state,streets[5].id,false,now-700000);
  assert.equal(nextCard(streets,state,[],now).id,streets[5].id);
  assert.equal(nextCard(streets,state,[streets[5].id],now).id,streets[0].id);
  state=grade(state,streets[0].id,true,now);assert.equal(nextCard(streets,state,[streets[5].id],now).id,streets[1].id);
});
test('arrondissement and chapter filters restrict learning together',()=>{
  const settings={...initialState().settings,arrondissement:'15',level:0};const pool=eligible(streets,settings);
  assert.ok(pool.length);assert.ok(pool.every(s=>s.level===0&&s.arrondissements.includes(15)));
  assert.ok(!pool.some(s=>s.name==='rue des Cévennes'));
});
test('a chapter opens only after 70% of the previous chapter is familiar',()=>{
  let state=initialState();const major=streets.filter(s=>s.level===0),n=Math.ceil(major.length*.7);
  for(const s of major.slice(0,n-1))state.cards[s.id]={streak:2};assert.equal(unlockedLevel(streets,state),0);
  state.cards[major[n-1].id]={streak:2};assert.equal(unlockedLevel(streets,state),1);
});
test('day streak uses consecutive local calendar dates',()=>{
  const now=new Date(2026,10,11,22).getTime(),state=initialState();
  state.activity['2026-11-10']=4;state.activity['2026-11-09']=3;assert.equal(streakDays(state,now),2);
  state.activity[dateKey(now)]=1;assert.equal(streakDays(state,now),3);
});

test('older progress migrates without losing cards, activity or reminder preferences',()=>{
  const old={version:1,cards:{old:{streak:2,reviews:2,correct:2,due:123}},activity:{'2026-11-11':2},settings:{goal:20,level:1,arrondissement:'15',reminders:false,interval:30},updated:123};
  const result=cleanState(old);assert.deepEqual(result.cards,old.cards);assert.deepEqual(result.activity,old.activity);assert.equal(result.settings.mode,'place-neighborhood');assert.equal(result.settings.reminders,false);assert.deepEqual(result.modeCards,{});
});
test('modes schedule independent reviews and count an answer once in daily activity',()=>{
  let state=initialState();const now=1794432000000,id=streets[0].id;
  state=gradeMode(state,'place-street',id,true,900,now);
  assert.equal(state.activity[dateKey(now)],1);assert.equal(state.cards[id].reviews,1);
  assert.equal(state.modeCards['place-street'][id].lastScore,900);
  assert.equal(nextModeCard(streets,state,'name-street',[],now).id,id);
  assert.notEqual(nextModeCard(streets,state,'place-street',[],now).id,id);
  state=gradeMode(state,'place-neighborhood','1',true,1000,now);
  assert.equal(state.activity[dateKey(now)],2);assert.equal(Object.keys(state.cards).length,1);
  assert.equal(state.modeCards['place-neighborhood']['1'].streak,1);
});
test('scores accumulate within a mode while review accuracy and due dates follow success',()=>{
  let state=initialState();const now=Date.now();state=gradeMode(state,'place-street','a',true,850,now);
  state=gradeMode(state,'place-street','a',false,200,now+DAY);
  const card=state.modeCards['place-street'].a;assert.equal(card.points,1050);assert.equal(card.bestScore,850);assert.equal(card.lastScore,200);assert.equal(card.streak,0);assert.equal(card.due,now+DAY+600000);
});
