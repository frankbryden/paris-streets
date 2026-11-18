# Paris, rue par rue

A map-based way to learn Paris streets and their official administrative neighborhoods. It starts with 54 curated major streets, then 200 connecting routes, 1,300 neighborhood streets and 4,610 smaller discoveries.

## Open the app

The local companion is at **http://127.0.0.1:8765**. It saves progress on this Mac and shares the selected chapter and arrondissement with native reminders. The cron reminder starts the companion automatically if it is not running. To start it immediately:

```sh
python3 scripts/remind.py --dry-run --ensure-server
```

Or run `python3 server.py` in a terminal. No installation or third-party packages are needed (Python 3.10+ and a modern browser).

The [private hosted app](https://paris-rue-par-rue.datadoghq.chatgpt.site) saves progress in its browser. Use Settings → Export / Import to transfer progress between the hosted and local versions or between devices. Reminders while the browser is closed are provided by the Mac companion, not a browser timer. Mac must be awake and macOS must allow Script Editor notifications; Focus can silence them.

## Learn

Choose one of three modes. Multiple choice is no longer used.

- **Place the neighborhood** (default): the quartier name is shown on a plaque. Click a point on an unlabelled map. Anything inside the official polygon, including its boundary, counts as correct. Boundaries are revealed after checking.
- **Place the street**: the street name is shown. Drag normally to move the map. Hold Command (⌘) or Ctrl while dragging to draw a straight street line; release the modifier to pan again. The actual street stays hidden until checking. Releasing the modifier before finishing cancels the unfinished line and keeps any previous answer.
- **Name the street**: an unnamed street is highlighted. Search the dropdown across all 6,164 streets, select one, then check. Accents are optional. No candidate names appear before you type.

Street placement awards up to 500 points per endpoint (1,000 total), using the better pairing of the two endpoint directions. Every endpoint within 25 metres earns all 500 points. Beyond that allowance, each endpoint gets `round(500 × exp(-max(0, distance - 25) / tolerance))`, where distance is in metres and tolerance is 20% of the street's end-to-end distance, limited to 25–250 metres. At least 700 points counts as a successful review. Neighborhood placement and correct naming award 1,000 points; incorrect or revealed answers award zero.

Street placement uses the farthest pair of coordinates on the convex hull of the full official centerline geometry. This scores the visible span of the street instead of internal segment ends, which can be misleading when a boulevard has parallel carriageways or small end loops. Open centerline networks, including roads capped by a loop at one end, are eligible; wholly closed networks are excluded. The snapshot has 6,035 placeable streets. Closed loops and streets without usable centerlines remain available in Name the street and Explore.

Each mode has its own spaced repetition history, points, and scores. Earlier progress is preserved. Correct answers return after 1, 3, 7, 14, 30 and 60 days; missed or revealed answers return after 10 minutes. Two consecutive correct reviews make a place familiar. Street chapters still progress from major routes to smaller streets and unlock at 70% familiarity; chapters can also be selected manually. Neighborhood mode covers all 80 quartiers, with an optional arrondissement filter.

Default goal: 10 questions per day. Progress saves after each answer. The Progress page shows totals by mode. Export/import includes all mode histories and accepts older backups.

Keyboard: Enter checks an answer or advances after feedback; Space reveals the answer. In Name the street, use Up/Down to browse filtered names and Enter to select, then Enter again to check. Pinch the trackpad or use two fingers on a touchscreen to zoom the map around the pinch position. Two-finger trackpad scrolling pans it. Zoom gestures never submit answers. On touchscreens, hold the momentary “Hold to draw” button with one finger and draw on the map with another; there is no persistent drawing tool. All modes support touch. Offline use is available after the first complete load in browsers supporting service workers.

## Native Mac reminders

The schedule matches the existing département reminder: every five minutes. Installation preserves other cron entries, backs up the original in `.local/crontab-before-install.txt`, and is safe to repeat.

```sh
python3 scripts/install_reminders.py --preview
python3 scripts/install_reminders.py
python3 scripts/remind.py --dry-run
python3 scripts/remind.py --force
```

Notifications show `rue des Cévennes → Javel`, together with the arrondissement. They draw from the selected chapter and earlier chapters, respect the arrondissement filter, prioritize new/due streets, and avoid recent repeats. Passive notifications never mark a street as learned.

In the **local app’s Settings**, reminders can be paused or changed to every 5, 15, 30 or 60 minutes. The cron job still checks every five minutes and sends only when the selected interval has elapsed. Logs and local progress are in `.local/`, which is never part of the hosted site.

Remove only this app’s scheduled reminder:

```sh
python3 scripts/install_reminders.py --remove
```

## Official data

Snapshot: 11 November 2026. Open Licence / Licence Ouverte 2.0, City of Paris.

- [Dénominations des emprises des voies actuelles](https://opendata.paris.fr/explore/dataset/denominations-emprises-voies-actuelles/): names, administrative neighborhoods, dimensions, start/end and history.
- [Filaire de voies](https://opendata.paris.fr/explore/dataset/voie/): centerlines.
- [Quartiers administratifs](https://opendata.paris.fr/explore/dataset/quartier_paris/): neighborhood boundaries.

The snapshot combines 6,625 nomenclature records into 6,164 named streets with neighborhood information. Unnamed coded roads and records without usable arrondissement/neighborhood data are omitted. Duplicate names merge neighborhoods and arrondissements. Normalized name matching connects 6,157 streets to centerlines; the remaining seven use official street footprints. A few official neighborhood spelling differences are reconciled for quiz distractors and map highlights. “Hors Paris,” when present in the original street record, is retained.

The first chapter is curated. Subsequent ranking uses length + 12 × width (capped at 60 m), with a 700-point bonus for avenues, boulevards and cours. This is a learning heuristic, not an official importance ranking. Streets in earlier chapters remain available for review.

Refresh the full snapshot from the public APIs:

```sh
python3 scripts/build_data.py
```

The web app is dependency-free HTML/CSS/JavaScript in `site/dist`. Its map is drawn directly from the official vectors, without a map tile provider. Optional Google Fonts fall back to installed fonts offline. `site/.openai/hosting.json` identifies the private hosted Site.

## Verification

```sh
node --test tests/learning.test.mjs tests/geography.test.mjs tests/map-input.test.mjs
python3 -m unittest discover -s tests -p 'test_*.py'
```

Tests cover all neighborhood centers and boundaries, polygon holes and concavity, reversible endpoint scoring across all placeable streets, full-catalogue name search, independent review schedules, legacy migration, notification filters, cron preservation, local persistence and request validation.
