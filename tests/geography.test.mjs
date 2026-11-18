import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pointInGeometry, pointInNeighborhood, streetEndpoints, scoreStreetLine, searchStreetNames, distance, project, unproject} from '../site/dist/geography.mjs';
import {normalize} from '../site/dist/learning.mjs';
const streets=JSON.parse(fs.readFileSync(new URL('../site/dist/data/streets.json',import.meta.url)));
const quartiers=JSON.parse(fs.readFileSync(new URL('../site/dist/data/map.json',import.meta.url))).quartiers;

test('all 80 official neighborhood centers score inside their true boundaries',()=>{
  for(const q of quartiers)assert.ok(pointInNeighborhood(q.center,q),q.name);
});
test('a remote point misses every neighborhood; boundary vertices count as inside',()=>{
  for(const q of quartiers){assert.equal(pointInNeighborhood([2,48],q),false,q.name);assert.equal(pointInNeighborhood(q.rings[0][0],q),true,q.name);}
});
test('concave polygon bounds do not turn its bounding box into a correct answer',()=>{
  const geometry={type:'Polygon',coordinates:[[[2.3,48.8],[2.32,48.8],[2.32,48.81],[2.31,48.81],[2.31,48.82],[2.3,48.82],[2.3,48.8]]]};
  assert.equal(pointInGeometry([2.305,48.815],geometry),true);assert.equal(pointInGeometry([2.315,48.815],geometry),false);
});
test('polygon holes and disconnected multipolygon parts are respected',()=>{
  const outer=[[2.3,48.8],[2.33,48.8],[2.33,48.83],[2.3,48.83],[2.3,48.8]],hole=[[2.31,48.81],[2.32,48.81],[2.32,48.82],[2.31,48.82],[2.31,48.81]];
  assert.equal(pointInGeometry([2.315,48.815],{type:'Polygon',coordinates:[outer,hole]}),false);
  assert.equal(pointInGeometry([2.305,48.805],{type:'MultiPolygon',coordinates:[[outer,hole]]}),true);
  assert.equal(pointInGeometry([2.31,48.815],{type:'Polygon',coordinates:[outer,hole]}),true);
});
test('the map projection roundtrips clicked locations and uses metre distances',()=>{
  const p=[2.35,48.85],r=unproject(project(p));assert.ok(distance(p,r)<.001);assert.ok(Math.abs(distance(p,[2.35,48.851])-111.195)<.1);
});
test('perfect street endpoints score 1000 points in either drawing direction',()=>{
  for(const s of streets){const pair=streetEndpoints(s);if(!pair)continue;assert.equal(scoreStreetLine(pair,pair).score,1000,s.name);assert.equal(scoreStreetLine([...pair].reverse(),pair).score,1000,s.name);}
});
test('endpoint scoring declines with distance and rejects a misplaced or collapsed line',()=>{
  const target=[[2.3,48.85],[2.33,48.85]],near=target.map(([x,y])=>[x,y+.0005]),far=target.map(([x,y])=>[x,y+.02]);
  const a=scoreStreetLine(near,target),b=scoreStreetLine(far,target);assert.ok(a.score<1000&&a.score>=700);assert.ok(b.score<a.score&&!b.correct);
  assert.ok(scoreStreetLine([[2.315,48.85],[2.315,48.85]],target).score<700);
  const one=scoreStreetLine([target[0],far[1]],target);assert.equal(one.pointsPerEndpoint[0],500);assert.equal(one.errors[0],0);
});
test('terminal selection joins unordered segments and excludes closed loops',()=>{
  const a=[2.3,48.85],b=[2.31,48.85],c=[2.32,48.85];
  const pair=streetEndpoints({lines:[[b,c],[b,a]]});
  assert.ok(pair.some(p=>distance(p,a)<.01));assert.ok(pair.some(p=>distance(p,c)<.01));
  assert.equal(streetEndpoints({lines:[[a,b,c,a]]}),null);
  assert.equal(streetEndpoints({lines:[]}),null);
});
test('Magenta uses the full street extent despite the southern loop and parallel carriageways',()=>{
  const magenta=streets.find(s=>s.id==='11988'),pair=streetEndpoints(magenta);
  const southernEnd=[2.362736,48.868803],northernEnd=[2.349506,48.883725];
  const score=scoreStreetLine([southernEnd,northernEnd],pair);
  assert.equal(score.score,1000);assert.ok(score.errors.every(d=>d<=25));
  assert.ok(distance(...pair)>1900);
  // Previously the southern scoring endpoint was incorrectly 413 m up the road.
  assert.ok(pair.every(p=>distance(p,[2.360041,48.87184])>400));
  const reversed={...magenta,lines:magenta.lines.slice().reverse().map(l=>l.slice().reverse())};
  assert.equal(scoreStreetLine([northernEnd,southernEnd],streetEndpoints(reversed)).score,1000);
});
test('La Fayette uses its full northeastern extent rather than an interior segment endpoint',()=>{
  const lafayette=streets.find(s=>s.name==='rue La Fayette'),pair=streetEndpoints(lafayette);
  const westernEnd=[2.333402,48.87312],easternEnd=[2.369932,48.882667];
  assert.equal(scoreStreetLine([westernEnd,easternEnd],pair).score,1000);
  assert.equal(scoreStreetLine([easternEnd,westernEnd],pair).score,1000);
  assert.ok(distance(...pair)>2850);
  assert.ok(pair.every(p=>distance(p,[2.366501,48.881801])>250));
});
test('every placeable street spans its full geometry, verified independently of the hull algorithm',()=>{
  let checked=0;
  for(const street of streets){
    const pair=streetEndpoints(street);if(!pair)continue;
    const points=[...new Map(street.lines.flat().map(p=>[p.join(','),p])).values()];
    let fullSpan=0;
    // Compare all raw coordinates, without using the production convex hull.
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)fullSpan=Math.max(fullSpan,distance(points[i],points[j]));
    assert.ok(Math.abs(distance(...pair)-fullSpan)<.01,`${street.name}: scoring endpoints miss part of the displayed street`);
    checked++;
  }
  assert.equal(checked,6035);
});
test('a cap loop cannot move the scoring endpoint to an interior junction',()=>{
  const south=[2.3,48.85],middle=[2.3,48.855],north=[2.3,48.86];
  const street={lines:[[south,middle],[middle,north],[south,[2.30001,48.84999],south]]};
  assert.equal(scoreStreetLine([south,north],streetEndpoints(street)).score,1000);
});
test('an internal geometry vertex can define the visible street extent',()=>{
  const left=[2.3,48.85],right=[2.32,48.85],middle=[2.31,48.85];
  const pair=streetEndpoints({lines:[[middle,left,right],[right,[2.315,48.85]]]});
  assert.ok(pair.some(p=>distance(p,left)<.01));assert.ok(pair.some(p=>distance(p,right)<.01));
});
test('each endpoint earns full points throughout the inclusive 25 m allowance',()=>{
  const target=[[2.3,48.85],[2.33,48.85]];
  const northBy=(p,metres)=>[p[0],p[1]+metres/6371000*180/Math.PI];
  for(const metres of [0,1,12,24.9,25]){
    const guess=target.map(p=>northBy(p,metres)),score=scoreStreetLine(guess,target);
    assert.equal(score.score,1000,`${metres} m`);assert.deepEqual(score.pointsPerEndpoint,[500,500]);
    assert.ok(score.errors.every(d=>Math.abs(d-metres)<1e-6));
    assert.equal(scoreStreetLine(guess.slice().reverse(),target).score,1000);
  }
  const beyond=scoreStreetLine(target.map(p=>northBy(p,30)),target);
  assert.ok(beyond.score<1000);
  const oneBeyond=scoreStreetLine([northBy(target[0],20),northBy(target[1],100)],target);
  assert.equal(oneBeyond.pointsPerEndpoint[0],500);assert.ok(oneBeyond.pointsPerEndpoint[1]<500);
});
test('name search includes the whole catalogue and filters without accents',()=>{
  const result=searchStreetNames(streets,'cevennes',normalize);assert.equal(result.total,1);assert.equal(result.matches[0].name,'rue des Cévennes');
  const small=streets.find(s=>s.level===3);assert.ok(searchStreetNames(streets,small.name,normalize).matches.some(s=>s.id===small.id));
  assert.deepEqual(searchStreetNames(streets,'',normalize),{matches:[],total:0});
});
