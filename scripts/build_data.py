#!/usr/bin/env python3
"""Build the offline learning catalogue from the City of Paris exports (stdlib only)."""
import argparse
import datetime as dt
import json
import re
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'site/dist/data'
BASE = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/'
SOURCES = {
    'streets': 'denominations-emprises-voies-actuelles',
    'centerlines': 'voie',
    'quartiers': 'quartier_paris',
}
# A deliberately curated introduction; all subsequent ordering uses dimensions.
MAJOR = [
    'avenue des Champs-Élysées', 'rue de Rivoli', 'boulevard Saint-Germain',
    'boulevard Saint-Michel', 'boulevard Haussmann', 'avenue de l’Opéra',
    'rue de Rennes', 'rue de Vaugirard', 'rue Saint-Honoré', 'rue du Faubourg Saint-Honoré',
    'boulevard de Sébastopol', 'boulevard de Strasbourg', 'rue La Fayette',
    'boulevard de Magenta', 'rue de la République', 'avenue de la République',
    'rue du Faubourg Saint-Antoine', 'rue Saint-Antoine', 'rue de Lyon',
    'boulevard Diderot', 'avenue Daumesnil', 'cours de Vincennes', 'boulevard Voltaire',
    'avenue Jean Jaurès', 'avenue de Flandre', 'boulevard de Clichy',
    'boulevard de Rochechouart', 'rue de Clichy', 'rue de Rome', 'rue de Saint-Lazare',
    'rue Saint-Lazare', 'avenue de Wagram', 'avenue des Ternes', 'avenue Victor Hugo',
    'avenue Foch', 'avenue Kléber', 'avenue d’Iéna', 'rue de Passy',
    'avenue de Versailles', 'rue de la Convention', 'rue Lecourbe', 'rue du Commerce',
    'avenue de Suffren', 'avenue de La Bourdonnais', 'rue Saint-Dominique',
    'boulevard Raspail', 'boulevard du Montparnasse', 'avenue du Maine',
    'avenue du Général Leclerc', 'avenue du Général-Leclerc', 'avenue d’Italie',
    'avenue des Gobelins', 'rue Monge', 'rue Mouffetard', 'rue des Écoles',
    'rue de Belleville', 'rue de Ménilmontant', 'rue des Pyrénées',
]


def normalize(value):
    value = unicodedata.normalize('NFKD', value.casefold())
    return re.sub(r'[^a-z0-9]', '', ''.join(c for c in value if not unicodedata.combining(c)))


def rounded(coords):
    if coords and isinstance(coords[0], (int, float)):
        return [round(n, 6) for n in coords[:2]]
    return [rounded(c) for c in coords]


def geometry(record, field):
    value = record.get(field) or {}
    return value.get('geometry', value)


def lines(geom):
    if geom.get('type') == 'LineString':
        return [rounded(geom['coordinates'])]
    if geom.get('type') == 'MultiLineString':
        return rounded(geom['coordinates'])
    return []


def polygon_rings(geom):
    if geom.get('type') == 'Polygon':
        return rounded(geom['coordinates'])
    if geom.get('type') == 'MultiPolygon':
        return [rounded(p[0]) for p in geom['coordinates'] if p]
    return []


def build(raw):
    index = defaultdict(list)
    network = []
    for r in raw['centerlines']:
        line = lines(geometry(r, 'geom'))
        index[normalize(r.get('l_longmin') or '')].extend(line)
        network.extend(line)
    grouped = {}
    excluded = 0
    for r in raw['streets']:
        name = (r.get('typo_min') or '').strip()
        quarters = r.get('quartier') or []
        if not name or not quarters or re.match(r'^(voie|passage)\s+[a-z]{1,3}[/ -]\d', name, re.I):
            excluded += 1
            continue
        key = normalize(name)
        arr = sorted({int(re.search(r'\d+', a).group()) for a in r.get('arrdt') or [] if re.search(r'\d+', a)})
        if not arr:
            excluded += 1
            continue
        if key in grouped:
            old = grouped[key]
            old['quartiers'] = sorted(set(old['quartiers'] + quarters))
            old['arrondissements'] = sorted(set(old['arrondissements'] + arr))
            old['length'] = max(old['length'], r.get('longueur') or 0)
            old['width'] = max(old['width'], r.get('largeur') or 0)
            old['outline'].extend(polygon_rings(geometry(r, 'geo_shape')))
            continue
        grouped[key] = {
            'id': str(r['id']), 'name': name, 'quartiers': sorted(set(quarters)),
            'arrondissements': arr, 'length': r.get('longueur') or 0,
            'width': r.get('largeur') or 0, 'type': r.get('typvoie') or '',
            'start': r.get('debut') or '', 'end': r.get('fin') or '',
            'history': r.get('historique') or '', 'origin': r.get('orig') or '',
            'center': rounded([r['geo_point_2d']['lon'], r['geo_point_2d']['lat']]) if r.get('geo_point_2d') else None,
            'lines': index.get(key, []), 'outline': polygon_rings(geometry(r, 'geo_shape')),
        }
    major_keys = {normalize(n): i for i, n in enumerate(MAJOR)}
    streets = list(grouped.values())
    def score(s):
        # Boulevards and long, wide roads form the next navigation framework.
        bonus = 700 if s['type'] in ('boulevard', 'avenue', 'cours') else 0
        return s['length'] + min(s['width'], 60) * 12 + bonus
    streets.sort(key=lambda s: (0, major_keys[normalize(s['name'])]) if normalize(s['name']) in major_keys else (1, -score(s), s['name']))
    major_count = sum(normalize(s['name']) in major_keys for s in streets)
    for i, s in enumerate(streets):
        s['rank'] = i
        s['level'] = 0 if i < major_count else 1 if i < major_count + 200 else 2 if i < major_count + 1500 else 3
        if s['lines']:
            s['outline'] = []
    quartiers = []
    for r in raw['quartiers']:
        quartiers.append({'id': int(r['c_qu']), 'name': r['l_qu'], 'arrondissement': r['c_ar'],
                          'center': rounded([r['geom_x_y']['lon'], r['geom_x_y']['lat']]),
                          'rings': polygon_rings(geometry(r, 'geom'))})
    OUT.mkdir(parents=True, exist_ok=True)
    def save(name, data):
        (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    save('streets.json', streets)
    save('map.json', {'network': network, 'quartiers': quartiers})
    save('meta.json', {'downloaded': dt.date.today().isoformat(), 'streetCount': len(streets),
                      'rawRecords': len(raw['streets']), 'excludedRecords': excluded,
                      'levels': [sum(s['level'] == i for s in streets) for i in range(4)],
                      'centerlineMatches': sum(bool(s['lines']) for s in streets),
                      'sources': {k: f'https://opendata.paris.fr/explore/dataset/{v}/' for k, v in SOURCES.items()},
                      'license': 'Open Licence / Licence Ouverte 2.0',
                      'ranking': 'Curated major routes, then length + 12 × width (capped at 60 m) + 700 for avenues, boulevards and cours. This is a learning order, not an official importance ranking.'})
    print(f"Built {len(streets)} streets; levels {[sum(s['level']==i for s in streets) for i in range(4)]}; {sum(bool(s['lines']) for s in streets)} centerline matches.")
    for s in streets:
        if 'cevennes' in normalize(s['name']):
            print(s['name'], s['quartiers'], s['arrondissements'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, help='Directory with paris-{streets,centerlines,quartiers}-raw.json')
    args = parser.parse_args()
    raw = {}
    for key, dataset in SOURCES.items():
        if args.cache:
            raw[key] = json.loads((args.cache / f'paris-{key}-raw.json').read_text())
        else:
            with urllib.request.urlopen(BASE + dataset + '/exports/json', timeout=180) as response:
                raw[key] = json.load(response)
    build(raw)
