#!/usr/bin/env python3
"""Add/remove only this app's managed cron entry; preserve every other job."""
import argparse
import shlex
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = '# BEGIN paris-streets-v2 reminders'
END = '# END paris-streets-v2 reminders'


def updated_crontab(existing, remove=False):
    if existing.count(START) != existing.count(END) or existing.count(START) > 1:
        raise ValueError('Unexpected reminder markers; inspect crontab before changing it')
    if START in existing:
        before, rest = existing.split(START, 1)
        _, after = rest.split(END, 1)
        existing = before + after.lstrip('\n')
    if remove:
        return existing
    command = f'{shlex.quote(sys.executable)} {shlex.quote(str(ROOT / "scripts/remind.py"))} --ensure-server >> {shlex.quote(str(ROOT / ".local/reminders.log"))} 2>&1'
    return existing.rstrip('\n') + ('\n' if existing.strip() else '') + f'{START}\n*/5 * * * * {command}\n{END}\n'


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--remove', action='store_true')
    p.add_argument('--preview', action='store_true')
    args = p.parse_args()
    current = subprocess.run(['/usr/bin/crontab', '-l'], capture_output=True, text=True)
    if current.returncode and 'no crontab' not in current.stderr.lower():
        raise SystemExit(current.stderr)
    result = updated_crontab(current.stdout, args.remove)
    if args.preview:
        print(result, end='')
    else:
        (ROOT / '.local').mkdir(exist_ok=True)
        backup = ROOT / '.local/crontab-before-install.txt'
        if not backup.exists():
            backup.write_text(current.stdout)
        subprocess.run(['/usr/bin/crontab', '-'], input=result, text=True, check=True)
        print('Street reminders removed.' if args.remove else 'Street reminders installed: every 5 minutes. Other jobs preserved.')
