# SKIP.EXE: VTOP attendance planner

Paste three pages from VIT's VTOP portal, cross off whole days or single classes, and see the projected final attendance of every course update live.

Everything runs in the browser. There's no build step and no tracking. Scrapes and plans live in your browser's `localStorage`. Logging in with Google is optional: it copies your plan to your own row in a Supabase database so it follows you between phone and laptop.

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

## Google login + cloud sync (optional)

Without setup the site stays fully local and the **Log in** button is hidden. To turn it on:

1. Create a Supabase project. In the SQL editor, run the files in `supabase/migrations/` in order (or `supabase db push`). It creates one `planner_state` row per user, locked by row-level security so an account can only read and write its own row.
2. Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID** (Web application). Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Sign In / Providers → **Google**: paste the client ID and secret, enable.
4. Supabase → Authentication → URL Configuration: set **Site URL** to where the site is hosted and add every origin you use to **Redirect URLs** (for example `https://your-site.vercel.app/**` and `http://localhost:5180/**`).
5. Put the project URL and the **anon / publishable** key in `js/config.js`. Never the `service_role` key.

Login needs the site served over http(s); it won't work from `file://`.

Dashboard checklist: only the Google provider enabled (no email or anonymous sign-ins), Redirect URLs listed as exact origins (no `*.vercel.app` wildcards, no localhost in the production project), and RLS shown as enabled on `planner_state`.

How sync behaves:
- `localStorage` stays the working copy. Edits upload about 1.5 s after you stop, and when you switch away from the tab. The planner checks for newer copies when the tab regains focus or the connection comes back. Failed uploads retry with backoff.
- No clocks are compared. The browser remembers which version of your row it last synced and whether it has edits since. An upload only succeeds if the row is still that version. If both this browser and another device changed the plan, the account's version is loaded and you get a notice.
- Data made while signed out is adopted by an account only if that account has nothing saved yet, so it never overwrites an existing plan. Demo data is never uploaded.
- **Log out** removes this browser's copy, which matters on shared lab PCs. It asks again if some edits haven't reached your account. Other devices stay logged in. **Delete all my data** also deletes the row in your account; the Google identity itself stays in Supabase Auth.

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

`tests/planner.test.js` checks the parsers and the counting engine against a real semester's scrapes (`samples/demo-scrapes.js`, which is also the in-app demo). `tests/sync.test.js` checks the cloud sync rules.

```
index.html            all three views (landing, setup, planner)
css/                  theme + planner styles
js/parser.js          VTOP scrape → data (pure, also used by Node)
js/engine.js          projection, skips, breaks (pure, also used by Node)
js/store.js           guarded localStorage (+ change events for sync)
js/config.js          public Supabase URL + anon key (empty = local only)
js/sync.js            sync rules: pull / push / clear (pure, tested)
js/cloud.js           Google login + Supabase sync
js/stickers.js        sticker SVGs for the landing page
js/hero.js            landing preview card + mouse sticker trail
js/setup.js           paste boxes + live parse preview
js/planner-view.js    planner HTML builders (all user text escaped)
js/planner.js         planner state + events
js/app.js             hash router
tools/parse.js        CLI: scrapes → data.json
supabase/migrations/  planner_state table + RLS policies
vercel.json           security headers when hosted on Vercel
fonts/                Space Mono Bold (OFL), used for digits inside the pixel font
```

Not affiliated with VIT. Always confirm the official numbers on VTOP.
