#!/usr/bin/env python3
"""Local Paris learning app and progress storage. No third-party dependencies."""
import argparse
import json
import math
import os
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'site/dist'
STATE_FILE = ROOT / '.local/progress.json'
LOCK = threading.Lock()


def initial_state():
    return {'version': 1, 'cards': {}, 'modeCards': {}, 'activity': {}, 'settings': {
        'goal': 10, 'level': 0, 'arrondissement': 'all', 'reminders': True, 'interval': 5,
        'mode': 'place-neighborhood'}, 'updated': 0}


def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except FileNotFoundError:
        return initial_state()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix='.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def valid_state(data, street_ids):
    if not isinstance(data, dict) or data.get('version') != 1:
        return False
    settings, cards, activity = (data.get(k) for k in ('settings', 'cards', 'activity'))
    if not all(isinstance(v, dict) for v in (settings, cards, activity)):
        return False
    if settings.get('level') not in range(4) or settings.get('goal') not in (5, 10, 15, 20, 30):
        return False
    if settings.get('arrondissement') not in ['all'] + [str(n) for n in range(1, 21)]:
        return False
    if settings.get('interval') not in (5, 15, 30, 60) or not isinstance(settings.get('reminders'), bool):
        return False
    modes = {'place-neighborhood', 'place-street', 'name-street'}
    if settings.get('mode', 'place-neighborhood') not in modes:
        return False
    def valid_cards(group, allowed_ids):
        if not isinstance(group, dict):
            return False
        for key, card in group.items():
            if key not in allowed_ids or not isinstance(card, dict):
                return False
            for field in ('streak', 'reviews', 'correct', 'due'):
                val = card.get(field)
                if not isinstance(val, (int, float)) or not math.isfinite(val) or val < 0:
                    return False
            for field in ('points', 'lastScore', 'bestScore'):
                val = card.get(field, 0)
                if not isinstance(val, (int, float)) or not math.isfinite(val) or val < 0:
                    return False
                if field != 'points' and val > 1000:
                    return False
        return True
    if not valid_cards(cards, street_ids):
        return False
    mode_cards = data.get('modeCards', {})
    if not isinstance(mode_cards, dict) or any(mode not in modes for mode in mode_cards):
        return False
    for mode, group in mode_cards.items():
        allowed = {str(n) for n in range(1, 81)} if mode == 'place-neighborhood' else street_ids
        if not valid_cards(group, allowed):
            return False
    import re
    if any(not re.fullmatch(r'\d{4}-\d{2}-\d{2}', k) or not isinstance(v, int) or v < 0 for k, v in activity.items()):
        return False
    return isinstance(data.get('updated'), (int, float)) and math.isfinite(data['updated']) and data['updated'] >= 0


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    def allowed(self):
        # Avoid cross-origin requests and DNS-rebinding against the loopback app.
        host = self.headers.get('Host', '')
        expected = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        origin = self.headers.get('Origin')
        return host in expected and (not origin or origin in {'http://' + h for h in expected})

    def respond_json(self, value, status=200):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.allowed():
            self.respond_json({'error': 'Local requests only'}, 403)
            return
        path = urlsplit(self.path).path
        if path == '/api/health':
            self.respond_json({'companion': 'paris-rue-par-rue'})
        elif path == '/api/state':
            with LOCK:
                self.respond_json({'companion': 'paris-rue-par-rue', 'state': load_state()})
        elif path.startswith('/api/'):
            self.respond_json({'error': 'Not found'}, 404)
        else:
            super().do_GET()

    def do_PUT(self):
        if not self.allowed():
            self.respond_json({'error': 'Local requests only'}, 403)
            return
        if self.path != '/api/state':
            self.respond_json({'error': 'Not found'}, 404)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 2_000_000:
                raise ValueError('Invalid request size')
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise ValueError('JSON required')
            data = json.loads(self.rfile.read(length))
            if not valid_state(data, self.server.street_ids):
                raise ValueError('Invalid progress data')
            with LOCK:
                atomic_json(STATE_FILE, data)
            self.respond_json({'saved': True})
        except (ValueError, TypeError, KeyError) as error:
            self.respond_json({'error': str(error)}, 400)

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    server.street_ids = {s['id'] for s in json.loads((DIST / 'data/streets.json').read_text())}
    print(f'Paris, rue par rue · http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
