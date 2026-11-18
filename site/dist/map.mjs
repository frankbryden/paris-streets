import {quartierKey} from './learning.mjs';
import {project, unproject} from './geography.mjs';
import {bindMapInput, zoomView} from './map-input.mjs';
const NS='http://www.w3.org/2000/svg';
const path=points=>points.map((p,i)=>`${i?'L':'M'}${project(p).map(n=>n.toFixed(1)).join(',')}`).join('');
const CITY=[0,0,15400,12300];
function el(tag,attrs={}){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
export class ParisMap {
  constructor(container,data){
    this.container=container;this.data=data;this.view=CITY.slice();this.interaction='pan';this.onGuess=()=>{};this.onPartial=()=>{};
    this.svg=el('svg',{class:'paris-map',role:'img','aria-label':'Unlabelled map of Paris',preserveAspectRatio:'xMidYMid meet'});
    this.svg.append(el('rect',{x:-40000,y:-40000,width:100000,height:100000,fill:'#eaf0ed'}));this.quartierLayer=el('g');
    for(const q of data.quartiers)this.quartierLayer.append(el('path',{d:q.rings.map(r=>path(r)+'Z').join(''),fill:'#f5f7f3',stroke:'#d4dfd9','stroke-width':6,'data-name':q.name}));
    this.svg.append(this.quartierLayer,el('path',{d:data.network.map(path).join(''),fill:'none',stroke:'#c4d1cd','stroke-width':8,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.85}));
    const arrs=new Map();for(const q of data.quartiers){if(!arrs.has(q.arrondissement))arrs.set(q.arrondissement,[]);arrs.get(q.arrondissement).push(project(q.center));}
    this.arrLayer=el('g',{fill:'#9cafa7','font-size':170,'font-family':'Georgia,serif','text-anchor':'middle'});
    for(const[arr,ps]of arrs){const t=el('text',{x:ps.reduce((n,p)=>n+p[0],0)/ps.length,y:ps.reduce((n,p)=>n+p[1],0)/ps.length});t.textContent=arr;this.arrLayer.append(t);}
    this.svg.append(this.arrLayer);this.target=el('g');this.guessLayer=el('g');this.svg.append(this.target,this.guessLayer);container.prepend(this.svg);
    this.controls=document.createElement('div');this.controls.className='map-controls';this.controls.innerHTML='<button type="button" data-map="city" aria-label="Show all Paris">Paris</button><button type="button" data-map="in" aria-label="Zoom in">+</button><button type="button" data-map="out" aria-label="Zoom out">−</button><button type="button" data-map="street" aria-label="Reset map view">⌖</button>';container.append(this.controls);
    this.controls.addEventListener('click',e=>{const act=e.target.closest('button')?.dataset.map;if(act==='city')this.setView(CITY);else if(act==='street')this.resetView();else if(act)this.zoom(act==='in'?.65:1.5);});this.setView(CITY);this.input=bindMapInput(this);
  }
  destroy(){this.onPartial=()=>{};this.input?.destroy();}
  setView(v){this.view=[...v];this.svg.setAttribute('viewBox',v.join(' '));this.arrLayer.style.display=!this.blank&&v[2]>6500?'':'none';this.drawGuess(this.guess);}
  zoom(f){this.setView(zoomView(this.view,f));}
  fit(points,padding=1200){if(!points.length)return this.setView(CITY);const ps=points.map(project),xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y,r=this.container.getBoundingClientRect(),aspect=r.width/r.height||1,vw=Math.max(1800,w+padding,(h+padding)*aspect),vh=vw/aspect;this.setView([x+w/2-vw/2,y+h/2-vh/2,vw,vh]);}
  focus(){if(!this.street)return this.setView(CITY);this.fit((this.street.lines.length?this.street.lines:this.street.outline).flat());}
  resetView(){if(this.hiddenAnswer){if(this.arrondissement)this.fit(this.data.quartiers.filter(q=>q.arrondissement===this.arrondissement).flatMap(q=>q.rings.flat()),500);else this.setView(CITY);}else if(this.neighborhood)this.fit(this.neighborhood.rings.flat(),1000);else this.focus();}
  base(blank,active=[]){this.blank=blank;const valid=new Set(active.map(quartierKey));for(const p of this.quartierLayer.children){const on=valid.has(quartierKey(p.dataset.name));p.setAttribute('fill',on?'#d7e8df':'#f5f7f3');p.setAttribute('stroke',on?'#84a692':blank?'#f5f7f3':'#d4dfd9');}this.arrLayer.style.display=!blank&&this.view[2]>6500?'':'none';}
  show(street,revealed=false,{hideName=false}={}){const changed=this.street?.id!==street?.id;this.street=street;this.neighborhood=null;this.hiddenAnswer=false;this.target.replaceChildren();this.base(false,revealed&&street?street.quartiers:[]);if(!street){this.setView(CITY);return;}this.drawRoute((street.lines.length?street.lines:street.outline).map(path).join(''));if(revealed)this.labelNeighborhoods(street.quartiers);this.svg.setAttribute('aria-label',hideName?'Highlighted street to identify':`Official map highlighting ${street.name}${revealed?` in ${street.quartiers.join(', ')}`:''}`);if(changed)this.focus();}
  drawRoute(d){for(const[stroke,width]of [['#ffffff',12],['#163e57',6]])this.target.append(el('path',{d,fill:'none',stroke,'stroke-width':width,'vector-effect':'non-scaling-stroke','stroke-linecap':'round','stroke-linejoin':'round'}));}
  labelNeighborhoods(names){const valid=new Set(names.map(quartierKey));for(const q of this.data.quartiers.filter(q=>valid.has(quartierKey(q.name)))){const[x,y]=project(q.center),text=el('text',{x,y,fill:'#486e5b','font-size':70,'font-family':'system-ui,sans-serif','text-anchor':'middle','paint-order':'stroke',stroke:'#e4eee7','stroke-width':12,'stroke-linejoin':'round'});text.textContent=q.name;this.target.prepend(text);}}
  showBlank(arrondissement='all'){this.street=null;this.neighborhood=null;this.target.replaceChildren();this.hiddenAnswer=true;this.arrondissement=arrondissement==='all'?null:Number(arrondissement);this.base(true);this.svg.setAttribute('aria-label','Unlabelled map of Paris for placing your answer');this.resetView();}
  revealNeighborhood(q){this.neighborhood=q;this.target.replaceChildren();this.base(false,[q.name]);this.labelNeighborhoods([q.name]);this.svg.setAttribute('aria-label',`Answer: ${q.name} neighborhood`);}
  setInteraction(mode,onGuess=()=>{},onPartial=()=>{}){this.input?.cancel();this.interaction=mode;this.onGuess=onGuess;this.onPartial=onPartial;this.input?.updateCursor();}
  holdDraw(held){this.touchDrawHeld=held;this.input?.releaseDraw();}
  pointFromEvent(e){const matrix=this.svg.getScreenCTM();if(!matrix)return null;const p=this.svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const result=p.matrixTransform(matrix.inverse());return unproject([result.x,result.y]);}
  drawGuess(points){this.guess=points;this.guessLayer.replaceChildren();if(!points?.length)return;const color=this.guessColor||'#bb771c';if(points.length===2)this.guessLayer.append(el('path',{d:path(points),fill:'none',stroke:color,'stroke-width':4,'stroke-dasharray':'8 5','vector-effect':'non-scaling-stroke','stroke-linecap':'round'}));for(const p of points){const[x,y]=project(p),r=Math.max(this.view[2]/this.container.clientWidth,this.view[3]/this.container.clientHeight)*6;this.guessLayer.append(el('circle',{cx:x,cy:y,r,fill:color,stroke:'white','stroke-width':2,'vector-effect':'non-scaling-stroke'}));}}
  clearGuess(){this.input?.cancel();this.guessColor=null;this.drawGuess(null);this.onPartial(false);}
  setGuessResult(correct){this.guessColor=correct?'#3c705a':'#ae4b40';this.drawGuess(this.guess);}
}
