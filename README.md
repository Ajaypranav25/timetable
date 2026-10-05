# SKIP.EXE: VTOP attendance planner

Paste three pages from VIT's VTOP portal, cross off whole days or single classes, and see the projected final attendance of every course update live.

Everything runs in the browser. There's no backend, no build step and no tracking. Scrapes and plans are stored only in your browser's `localStorage`.

## Use it

Open `index.html` directly, or host the folder on any static host (GitHub Pages, Vercel, Netlify). Then:

1. **Setup** page: paste your scrapes. Each box says where to start and stop copying:
   | Box | VTOP page | Start copying at | Stop at |
   |---|---|---|---|
   | Attendance | Academics → Class Attendance | header `Sl.No. Class Group Course Detail …` | last course row (`… 84% -`) |
   | Time Table | Academics → Time Table | grid header `THEORY Start 08:00 …` | Sunday lab row `LAB L83 … L94 -` |
   | Calendar | Academics → Academic Calendar (General (Semester)) | month heading `OCTOBER 2026` | last date of the month; paste every remaining month into the same box |

   Copying a whole page with Ctrl+A also works.
2. Set the date you copied the attendance, then press **Build my planner**.
3. Tap a date to skip the whole day. Tap ⋮ on a date to skip single classes. Past days (between the copy date and today) can be marked as missed.

## Counting rules

- 1 theory period = 1 class. Each lab slot = 1 class, so an `L7+L8` session counts 2, the way VTOP counts it.
- Future classes = every instructional day from the attendance copy date (optionally the day after) up to the last theory day / last lab day (set separately), mapped through day-order substitutions (for example "Saturday · Monday day order").
- Projected % = (attended + future classes not skipped) ÷ (total + all future classes).
- Bands: ≥ 77% safe, 75–77% warning, < 75% danger. VTOP passes 74.01%+, which is shown, but the skip budgets plan around 75% and your custom target.
- Embedded theory and embedded lab are separate courses.

## Update next semester

Re-paste the three pages on the Setup page. Or, from the command line:

```bash
node tools/parse.js --attendance att.txt --timetable tt.txt --calendar cal.txt --snapshot 2026-10-05 --out data.json
```

then use **Import data.json** on the Setup page. The planner's **Export data.json** button produces the same format.

## Develop

```bash
npm test   # node:test, no dependencies
```

`tests/planner.test.js` checks the parsers and the counting engine against a real semester's scrapes (`samples/demo-scrapes.js`, which is also the in-app demo).

```
index.html            all three views (landing, setup, planner)
css/                  theme + planner styles
js/parser.js          VTOP scrape → data (pure, also used by Node)
js/engine.js          projection, skips, breaks (pure, also used by Node)
js/store.js           guarded localStorage
js/setup.js           paste boxes + live parse preview
js/planner-view.js    planner HTML builders (all user text escaped)
js/planner.js         planner state + events
js/app.js             hash router
tools/parse.js        CLI: scrapes → data.json
```

Not affiliated with VIT. Always confirm the official numbers on VTOP.
