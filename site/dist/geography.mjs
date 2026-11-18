// A local metre-based projection for drawing; scoring uses geodesic distances.
export const project = p => [(p[0] - 2.225) * 73000, (48.92 - p[1]) * 111000];
export const unproject = p => [p[0] / 73000 + 2.225, 48.92 - p[1] / 111000];

export function distance(a, b) {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function ringLocation(point, ring) {
  const [x, y] = project(point);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = project(ring[j]), [bx, by] = project(ring[i]);
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
    if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < .01) return 'boundary';
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

export function pointInGeometry(point, geometry) {
  const polygonContains = rings => {
    if (!rings.length) return false;
    const outer = ringLocation(point, rings[0]);
    if (outer === 'outside') return false;
    if (outer === 'boundary') return true;
    for (const hole of rings.slice(1)) {
      const location = ringLocation(point, hole);
      if (location === 'boundary') return true;
      if (location === 'inside') return false;
    }
    return true;
  };
  if (geometry?.type === 'Feature') return pointInGeometry(point, geometry.geometry);
  if (geometry?.type === 'Polygon') return polygonContains(geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some(polygonContains);
  return false;
}

export const pointInNeighborhood = (point, quartier) => pointInGeometry(point, quartier.geometry || {type: 'Polygon', coordinates: quartier.rings});

function streetHull(lines) {
  const unique = new Map();
  for (const line of lines) for (const point of line) unique.set(point.join(','), {point, xy: project(point)});
  const points = [...unique.values()].sort((a,b)=>a.xy[0]-b.xy[0] || a.xy[1]-b.xy[1]);
  if (points.length < 3) return points;
  const cross = (a,b,c) => (b.xy[0]-a.xy[0])*(c.xy[1]-a.xy[1]) - (b.xy[1]-a.xy[1])*(c.xy[0]-a.xy[0]);
  const half = vertices => {
    const result = [];
    for (const vertex of vertices) {
      while (result.length > 1 && cross(result.at(-2),result.at(-1),vertex) <= 0) result.pop();
      result.push(vertex);
    }
    return result.slice(0,-1);
  };
  return [...half(points), ...half(points.slice().reverse())];
}

export function streetEndpoints(street) {
  const lines = street.lines || [];
  // Retain the closed-network exclusion, but never use segment terminals as
  // scoring positions: loops and parallel carriageways can hide a road's end.
  const vertices = new Map();
  for (const line of lines) {
    if (line.length < 2) continue;
    for (const p of [line[0], line[line.length - 1]]) {
      const key = project(p).map(n => Math.round(n / 2)).join(',');
      const vertex = vertices.get(key) || {point: p, degree: 0};
      vertex.degree++; vertices.set(key, vertex);
    }
  }
  const terminals = [...vertices.values()].filter(v => v.degree === 1).map(v => v.point);
  if (!terminals.length) return null;
  // The straight-line task uses the full visible span. Its farthest vertices
  // lie on the convex hull, avoiding an all-pairs scan of every map coordinate.
  const hull = streetHull(lines);
  let pair = null, maxDistance = 0;
  for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) {
    const d = distance(hull[i].point, hull[j].point);
    if (d > maxDistance) { maxDistance = d; pair = [hull[i].point, hull[j].point]; }
  }
  // Closed loops have no unique endpoints; they remain available in Name the street.
  return maxDistance > 1 ? pair : null;
}

export const FULL_POINTS_DISTANCE_METERS = 25;

export function scoreStreetLine(guess, endpoints) {
  if (!Array.isArray(guess) || guess.length !== 2 || !endpoints) throw Error('Two endpoints are required');
  const forward = [distance(guess[0], endpoints[0]), distance(guess[1], endpoints[1])];
  const reverse = [distance(guess[0], endpoints[1]), distance(guess[1], endpoints[0])];
  const errors = forward[0] + forward[1] <= reverse[0] + reverse[1] ? forward : reverse;
  const tolerance = Math.max(25, Math.min(250, distance(...endpoints) * .2));
  const pointsPerEndpoint = errors.map(d => Math.round(500 * Math.exp(-Math.max(0, d - FULL_POINTS_DISTANCE_METERS) / tolerance)));
  const score = pointsPerEndpoint.reduce((a, b) => a + b, 0);
  return {score, errors, pointsPerEndpoint, correct: score >= 700};
}

export function searchStreetNames(streets, query, normalize, limit = 50) {
  const key = normalize(query);
  if (!key) return {matches: [], total: 0};
  const matches = streets.filter(s => normalize(s.name).includes(key)).sort((a, b) => {
    const rank = s => normalize(s.name) === key ? 0 : normalize(s.name).startsWith(key) ? 1 : 2;
    return rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr');
  });
  return {matches: matches.slice(0, limit), total: matches.length};
}
