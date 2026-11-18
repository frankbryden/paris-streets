#!/usr/bin/env python3
"""Send a native macOS street reminder using the local app's learning chapter."""
import argparse
import fcntl
import json
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import atomic_json, load_state

LOCAL = ROOT / '.local'
HISTORY = LOCAL / 'reminders.json'
APPLESCRIPT = '''on run argv
    display notification (item 2 of argv) with title (item 1 of argv) subtitle (item 3 of argv)
end run'''


def choose_street(streets, state, history, rng=random):
    settings = state['settings']
    pool = [s for s in streets if s['level'] <= settings['level'] and (
        settings['arrondissement'] == 'all' or int(settings['arrondissement']) in s['arrondissements'])]
    if not pool:
        return None
    recent = history.get('recent', [])[-min(30, max(0, len(pool) - 1)):]
    # Do not filter out the only street in a narrow arrondissement/chapter filter.
    if len(pool) == 1:
        recent = []
    fresh = [s for s in pool if s['id'] not in recent] or pool
    cards = state.get('cards', {})
    now = time.time() * 1000
    weights = [3 if not cards.get(s['id']) else 4 if cards[s['id']].get('due', 0) <= now else 1 for s in fresh]
    return rng.choices(fresh, weights=weights, k=1)[0]


def ensure_server():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=2) as r:
            if json.load(r).get('companion') == 'paris-rue-par-rue':
                return
        raise RuntimeError('Port 8765 is occupied by another app')
    except urllib.error.URLError:
        LOCAL.mkdir(exist_ok=True)
        with (LOCAL / 'server.log').open('a') as log:
            subprocess.Popen([sys.executable, str(ROOT / 'server.py')], cwd=ROOT,
                             stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        for _ in range(20):
            try:
                with urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=.5) as r:
                    if json.load(r).get('companion') == 'paris-rue-par-rue':
                        return
            except (urllib.error.URLError, TimeoutError):
                time.sleep(.1)
        raise RuntimeError('The local learning app could not start; see .local/server.log')


def run(dry_run=False, force=False, start_server=False):
    if start_server:
        ensure_server()
    state = load_state()
    if not state['settings']['reminders'] and not force:
        print('Street reminders are paused.')
        return
    try:
        history = json.loads(HISTORY.read_text())
    except FileNotFoundError:
        history = {}
    if not dry_run and not force and time.time() - history.get('last', 0) < state['settings']['interval'] * 60 - 2:
        return
    streets = json.loads((ROOT / 'site/dist/data/streets.json').read_text())
    street = choose_street(streets, state, history)
    if street is None:
        print('No streets match the selected learning filter.')
        return
    title = street['name']
    message = f"{street['name']} → {' · '.join(street['quartiers'])}"
    subtitle = f"{'f, '.join(str(a) + 'e' for a in street['arrondissements'])}"
    print(message, flush=True)
    if not dry_run:
        subprocess.run(['/usr/bin/osascript', '-e', APPLESCRIPT, '--', title, message, subtitle], check=True, timeout=20)
        atomic_json(HISTORY, {'last': time.time(), 'recent': (history.get('recent', []) + [street['id']])[-30:]})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Print a reminder without sending or recording it')
    parser.add_argument('--force', action='store_true', help='Send once even when paused or within the frequency limit')
    parser.add_argument('--ensure-server', action='store_true', help='Start the local web app if necessary')
    args = parser.parse_args()
    LOCAL.mkdir(exist_ok=True)
    with (LOCAL / 'reminder.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            sys.exit(0)
        run(args.dry_run, args.force, args.ensure_server)
