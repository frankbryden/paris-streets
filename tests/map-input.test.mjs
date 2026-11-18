import test from 'node:test';
import assert from 'node:assert/strict';
import {setMaxListeners} from 'node:events';
import {bindMapInput, screenToWorld, zoomView, pinchView} from '../site/dist/map-input.mjs';
setMaxListeners(0); // One AbortSignal owns all listeners for each map instance.
const rect={left:100,top:20,width:800,height:600};
const initial=[0,0,16000,12000];
const close=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-7,`${a} != ${b}`));
function send(target,type,properties={}){
  const event=new Event(type,{cancelable:true});
  Object.assign(event,{button:0,pointerId:1,pointerType:'mouse',metaKey:false,ctrlKey:false,clientX:400,clientY:300,deltaMode:0,deltaX:0,deltaY:0,...properties});
  target.dispatchEvent(event);return event;
}
function setup(interaction='line'){
  const svg=new EventTarget(),keyboard=new EventTarget(),classes=new Set();
  svg.classList={add(name){classes.add(name);},toggle(name,on){if(on)classes.add(name);else classes.delete(name);},remove(name){classes.delete(name);}};
  svg.getBoundingClientRect=()=>rect;svg.setPointerCapture=()=>{};
  const answers=[],partial=[];
  const map={svg,view:initial.slice(),interaction,guess:null,touchDrawHeld:false,
    pointFromEvent(e){return screenToWorld(this.view,rect,[e.clientX,e.clientY]);},
    setView(v){this.view=v;},drawGuess(g){this.guess=g;},
    onGuess(g){answers.push(g);},onPartial(drawing){partial.push(drawing);},
  };
  const controller=bindMapInput(map,keyboard);
  return {map,svg,keyboard,answers,partial,classes,controller};
}

test('zoom stays anchored to the cursor and clamps at both zoom limits',()=>{
  const cursor=[330,210],anchor=screenToWorld(initial,rect,cursor),view=zoomView(initial,.5,anchor);
  close(screenToWorld(view,rect,cursor),anchor);assert.equal(view[2],8000);
  assert.equal(zoomView(initial,.00001,anchor)[2],450);assert.equal(zoomView(initial,100,anchor)[2],26000);
});
test('pinch keeps the world point beneath the moving midpoint, including a letterboxed view',()=>{
  const start=[250,180],end=[410,300],view=[0,0,10000,16000];
  const next=pinchView(view,rect,start,end,.65);
  close(screenToWorld(next,rect,end),screenToWorld(view,rect,start));
});
test('unmodified street dragging pans and never draws or places an answer',()=>{
  const s=setup();send(s.svg,'pointerdown');send(s.svg,'pointermove',{clientX:460,clientY:330});send(s.svg,'pointerup',{clientX:460,clientY:330});
  close(s.map.view,[-1200,-600,16000,12000]);assert.equal(s.answers.length,0);assert.equal(s.partial.length,0);assert.equal(s.map.guess,null);s.controller.destroy();
});
test('Command and Ctrl each enable drawing only for the held drag',()=>{
  for(const modifier of ['metaKey','ctrlKey']){
    const s=setup();send(s.keyboard,'keydown',{key:modifier==='metaKey'?'Meta':'Control',[modifier]:true});
    assert.ok(s.classes.has('answer-map'));
    send(s.svg,'pointerdown',{[modifier]:true});send(s.svg,'pointermove',{clientX:460,[modifier]:true});send(s.svg,'pointerup',{clientX:460,[modifier]:true});
    assert.equal(s.answers.length,1);assert.equal(s.answers[0].length,2);close(s.map.view,initial);
    send(s.keyboard,'keyup',{key:modifier==='metaKey'?'Meta':'Control'});assert.equal(s.classes.has('answer-map'),false);
    send(s.svg,'pointerdown');send(s.svg,'pointermove',{clientX:480});send(s.svg,'pointerup',{clientX:480});assert.equal(s.answers.length,1);s.controller.destroy();
  }
});
test('releasing the drawing key or losing focus cancels a preview and restores the previous answer',()=>{
  for(const end of ['keyup','blur']){
    const s=setup(),previous=[[1,2],[3,4]];s.map.guess=previous;
    send(s.keyboard,'keydown',{key:'Meta',metaKey:true});send(s.svg,'pointerdown',{metaKey:true});send(s.svg,'pointermove',{metaKey:true,clientX:460});
    send(s.keyboard,end,{key:'Meta'});send(s.svg,'pointerup',{clientX:460});
    assert.equal(s.answers.length,0);assert.deepEqual(s.map.guess,previous);assert.deepEqual(s.partial,[true,false]);s.controller.destroy();
  }
});
test('Safari trackpad gestures use cumulative scale, suppress page zoom and ignore duplicate wheel zoom',()=>{
  const s=setup('point');
  assert.ok(send(s.svg,'gesturestart',{scale:1}).defaultPrevented);
  send(s.svg,'gesturechange',{scale:2});assert.equal(s.map.view[2],8000);
  send(s.svg,'wheel',{ctrlKey:true,deltaY:-50});assert.equal(s.map.view[2],8000);
  send(s.svg,'gesturechange',{scale:4});assert.equal(s.map.view[2],4000);
  send(s.svg,'gestureend');assert.equal(s.answers.length,0);s.controller.destroy();
});
test('Ctrl+wheel pinch zooms the map about its cursor without an answer',()=>{
  const s=setup(),anchor=screenToWorld(initial,rect,[400,300]);
  const event=send(s.svg,'wheel',{ctrlKey:true,deltaY:-30});
  assert.ok(event.defaultPrevented);assert.ok(s.map.view[2]<initial[2]);close(screenToWorld(s.map.view,rect,[400,300]),anchor);assert.equal(s.answers.length,0);s.controller.destroy();
});
test('two-finger touch pinches zoom and neither remaining finger places a neighborhood answer',()=>{
  const s=setup('point');
  send(s.svg,'pointerdown',{pointerType:'touch',pointerId:1,clientX:300});send(s.svg,'pointerdown',{pointerType:'touch',pointerId:2,clientX:500});
  send(s.svg,'pointermove',{pointerType:'touch',pointerId:2,clientX:700});assert.equal(s.map.view[2],8000);
  send(s.svg,'pointerup',{pointerType:'touch',pointerId:2,clientX:700});send(s.svg,'pointermove',{pointerType:'touch',pointerId:1,clientX:320});send(s.svg,'pointerup',{pointerType:'touch',pointerId:1,clientX:320});
  assert.equal(s.answers.length,0);
  send(s.svg,'pointerdown',{pointerType:'touch'});send(s.svg,'pointerup',{pointerType:'touch'});assert.equal(s.answers.length,1);s.controller.destroy();
});
test('a second touch cancels a line preview before pinching and keeps an existing line',()=>{
  const s=setup(),previous=[[1,2],[3,4]];s.map.guess=previous;s.map.touchDrawHeld=true;
  send(s.svg,'pointerdown',{pointerType:'touch',pointerId:1,clientX:300});send(s.svg,'pointermove',{pointerType:'touch',pointerId:1,clientX:400});
  send(s.svg,'pointerdown',{pointerType:'touch',pointerId:2,clientX:500});send(s.svg,'pointermove',{pointerType:'touch',pointerId:2,clientX:600});
  send(s.svg,'pointerup',{pointerType:'touch',pointerId:2});send(s.svg,'pointerup',{pointerType:'touch',pointerId:1});
  assert.equal(s.answers.length,0);assert.deepEqual(s.map.guess,previous);s.controller.destroy();
});
test('a touch hold draws without a persistent tool and releasing it cancels unfinished drawing',()=>{
  const s=setup();s.map.touchDrawHeld=true;
  send(s.svg,'pointerdown',{pointerType:'touch'});send(s.svg,'pointermove',{pointerType:'touch',clientX:460});send(s.svg,'pointerup',{pointerType:'touch',clientX:460});assert.equal(s.answers.length,1);
  send(s.svg,'pointerdown',{pointerType:'touch'});send(s.svg,'pointermove',{pointerType:'touch',clientX:500});s.map.touchDrawHeld=false;s.controller.releaseDraw();send(s.svg,'pointerup',{pointerType:'touch',clientX:500});assert.equal(s.answers.length,1);s.controller.destroy();
});
test('ordinary trackpad scrolling moves the map and cleanup removes global key listeners',()=>{
  const s=setup();send(s.svg,'wheel',{deltaX:10,deltaY:20});close(s.map.view,[200,400,16000,12000]);
  s.controller.destroy();send(s.keyboard,'keydown',{key:'Meta',metaKey:true});assert.equal(s.classes.has('answer-map'),false);
  const before=s.map.view.slice();send(s.svg,'wheel',{ctrlKey:true,deltaY:-50});close(s.map.view,before);
});
