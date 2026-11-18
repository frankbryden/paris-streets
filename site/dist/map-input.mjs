// Keep the point beneath the cursor / pinch midpoint fixed as the view changes.
export function screenToWorld(view, rect, point) {
  const unit = Math.max(view[2] / rect.width, view[3] / rect.height);
  const left = (rect.width - view[2] / unit) / 2, top = (rect.height - view[3] / unit) / 2;
  return [view[0] + (point[0] - rect.left - left) * unit, view[1] + (point[1] - rect.top - top) * unit];
}
export function zoomView(view, factor, anchor = [view[0] + view[2] / 2, view[1] + view[3] / 2]) {
  const width = Math.max(450, Math.min(26000, view[2] * factor)), ratio = width / view[2];
  return [anchor[0] + (view[0] - anchor[0]) * ratio, anchor[1] + (view[1] - anchor[1]) * ratio, width, view[3] * ratio];
}
export function pinchView(view, rect, start, current, factor) {
  const anchor = screenToWorld(view, rect, start), next = zoomView(view, factor, anchor);
  const position = screenToWorld(next, rect, current);
  return [next[0] + anchor[0] - position[0], next[1] + anchor[1] - position[1], next[2], next[3]];
}

export function bindMapInput(map, keyboard = window) {
  const svg = map.svg, abort = new AbortController(), pointers = new Map();
  let single = null, pinch = null, safariGesture = null, suppressSingle = false, held = false, lastPointer = null;
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, {...options, signal: abort.signal});
  const rect = () => svg.getBoundingClientRect();
  const xy = e => [e.clientX, e.clientY];
  const drawHeld = e => map.touchDrawHeld || held || e?.metaKey || e?.ctrlKey;
  const cursor = () => {
    svg.classList.toggle('answer-map', map.interaction === 'point' || map.interaction === 'line' && (held || map.touchDrawHeld));
  };
  const cancelSingle = () => {
    const old = single; single = null; svg.classList.remove('dragging');
    if (old?.kind === 'draw') { map.drawGuess(old.previous); map.onPartial(false); }
  };
  const cancel = () => { cancelSingle(); pointers.clear(); pinch = null; safariGesture = null; suppressSingle = false; };
  const pair = () => {
    const [a, b] = [...pointers.values()];
    return {mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], distance: Math.hypot(a[0] - b[0], a[1] - b[1])};
  };
  const gesturePoint = e => {
    const r = rect();
    if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY) && e.clientX >= r.left && e.clientX <= r.left+r.width && e.clientY >= r.top && e.clientY <= r.top+r.height) return xy(e);
    return lastPointer || [r.left+r.width/2, r.top+r.height/2];
  };
  listen(keyboard, 'keydown', e => { held = !!(e.metaKey || e.ctrlKey); cursor(); });
  listen(keyboard, 'keyup', e => {
    held = !!(e.metaKey || e.ctrlKey);
    if (single?.kind === 'draw' && !held && !map.touchDrawHeld) cancelSingle();
    cursor();
  });
  listen(keyboard, 'blur', () => { held = false; map.touchDrawHeld = false; cancel(); cursor(); });
  listen(svg, 'pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); lastPointer = xy(e); pointers.set(e.pointerId, xy(e)); svg.setPointerCapture(e.pointerId);
    if (pointers.size >= 2) {
      cancelSingle(); suppressSingle = true;
      const p = pair(); pinch = {...p, view: map.view.slice()};
      return;
    }
    if (suppressSingle || safariGesture) return;
    const point = map.pointFromEvent(e); if (!point) return;
    const kind = map.interaction === 'line' ? drawHeld(e) ? 'draw' : 'pan' : map.interaction;
    single = {id: e.pointerId, point, client: xy(e), view: map.view.slice(), kind, moved: false, previous: map.guess?.map(p=>p.slice()) || null};
    if (kind === 'draw') { map.drawGuess([point]); map.onPartial(true); }
    else if (kind === 'pan') svg.classList.add('dragging');
  });
  listen(svg, 'pointermove', e => {
    lastPointer = xy(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, xy(e));
    if (pinch && pointers.size >= 2) {
      e.preventDefault(); const p = pair();
      if (p.distance > 0 && pinch.distance > 0) map.setView(pinchView(pinch.view, rect(), pinch.mid, p.mid, pinch.distance / p.distance));
      return;
    }
    if (!single || single.id !== e.pointerId || safariGesture) return;
    if (Math.hypot(e.clientX - single.client[0], e.clientY - single.client[1]) > 5) single.moved = true;
    if (single.kind === 'draw') {
      if (!drawHeld(e)) { cancelSingle(); cursor(); return; }
      const p = map.pointFromEvent(e); if (p) map.drawGuess([single.point, p]);
    } else if (single.kind === 'pan' || single.kind === 'point' && single.moved) {
      const r = rect(), unit = Math.max(single.view[2] / r.width, single.view[3] / r.height);
      map.setView([single.view[0] - (e.clientX - single.client[0]) * unit, single.view[1] - (e.clientY - single.client[1]) * unit, single.view[2], single.view[3]]);
    }
  });
  const endPointer = (e, cancelled = false) => {
    const wasPinch = suppressSingle || !!pinch || !!safariGesture;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (wasPinch || cancelled) cancelSingle();
    else if (single?.id === e.pointerId) {
      const g = single, p = map.pointFromEvent(e); single = null;
      if (g.kind === 'point' && !g.moved && p) { map.drawGuess([p]); map.onGuess(p); }
      else if (g.kind === 'draw') {
        if (g.moved && p && drawHeld(e)) { map.drawGuess([g.point,p]); map.onGuess([g.point,p]); }
        else { map.drawGuess(g.previous); map.onPartial(false); }
      }
    }
    if (!pointers.size) suppressSingle = false;
    svg.classList.remove('dragging'); cursor();
  };
  listen(svg, 'pointerup', e => endPointer(e));
  listen(svg, 'pointercancel', e => endPointer(e, true));
  listen(svg, 'lostpointercapture', e => { if (pointers.has(e.pointerId)) endPointer(e, true); });
  // Safari on macOS sends GestureEvents; other trackpads commonly send Ctrl+wheel.
  listen(svg, 'gesturestart', e => {
    e.preventDefault(); cancelSingle(); suppressSingle = pointers.size > 0;
    safariGesture = {view: map.view.slice(), mid: gesturePoint(e), scale: e.scale > 0 ? e.scale : 1};
  }, {passive: false});
  listen(svg, 'gesturechange', e => {
    e.preventDefault(); if (!safariGesture || pointers.size >= 2 || !(e.scale > 0)) return;
    map.setView(pinchView(safariGesture.view, rect(), safariGesture.mid, gesturePoint(e), safariGesture.scale/e.scale));
  }, {passive: false});
  listen(svg, 'gestureend', e => { e.preventDefault(); safariGesture = null; if (!pointers.size) suppressSingle = false; }, {passive: false});
  listen(svg, 'wheel', e => {
    e.preventDefault();
    if (safariGesture || pinch) return;
    cancelSingle();
    const r = rect(), unit = Math.max(map.view[2]/r.width, map.view[3]/r.height), multiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
    if (e.ctrlKey) {
      const factor = Math.exp(Math.max(-100,Math.min(100,e.deltaY*multiplier))*.01);
      map.setView(zoomView(map.view, factor, screenToWorld(map.view,r,xy(e))));
    } else {
      const [x,y,w,h] = map.view; map.setView([x+e.deltaX*multiplier*unit,y+e.deltaY*multiplier*unit,w,h]);
    }
  }, {passive: false});
  cursor();
  return {
    cancel,
    updateCursor: cursor,
    releaseDraw: () => { if (single?.kind === 'draw' && !held && !map.touchDrawHeld) cancelSingle(); cursor(); },
    destroy: () => { cancel(); abort.abort(); },
  };
}
