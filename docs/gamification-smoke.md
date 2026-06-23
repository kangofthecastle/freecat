# Gamification smoke test

Manual end-to-end check of the gamification loop (Home dashboard + Nest screen + the
renderer→IPC→main→DB chain). The GUI cannot be driven headlessly, so run these steps by hand
after building/verifying. Companion to the automated suite (`npm test`, `npx tsc --noEmit`,
`npm run build`), all of which must be green first.

## UI walkthrough

1. **Launch.** `npm run dev`. The app opens on **Home**.
2. **Greeting + first-run state.** Home shows "Welcome back, {name}" (your profile display name,
   or "Student" if the profile fails to load). With no pet yet, the active-pet panel shows the
   "Your first egg is incubating — keep studying to hatch it!" placeholder. Open **Nest** (sidebar
   or the "Visit Nest →" button) and confirm the **Incubator** shows the starter egg at some
   progress %, labelled "Incubating…".
3. **Simulate activity (dev only).** Back on Home, click **Simulate study activity** several times.
   The button is dev-only (`import.meta.env.DEV`). After each click the dashboard refetches state:
   - **Coins** climb (with the coin icon).
   - **XP** climbs; **Level** progress bar fills (and Level increments when it crosses a threshold).
   - **Streak** shows at least `1` with the 🔥.
   - **Daily goal** tile advances `count/goal`; when the goal is met the tile turns green with a ✓.
4. **Egg progresses → hatch.** In the Nest, the Incubator progress bar advances with activity. Once
   it reads ~100% and flips to **Ready to hatch!**, click **Hatch**. One of the six animals (cat,
   dog, pig, frog, capybara, axolotl) appears in the **Collection**, marked **Active**. Return to
   Home — that pet now renders large (size 180) with its mood.
5. **Collection / active pet.** With ≥2 pets, click a non-active pet card → it becomes Active (Home
   reflects it). In the active pet's **Customize** panel, type a name and **Rename**; the label
   updates everywhere (`name` falls back to the species display name when blank).
6. **Shop — buy + equip an accessory.** In the Shop, **Buy** one of the four items (Graduation Cap,
   Reading Glasses, Cozy Scarf, Bow Tie). The button switches to **Owned** and disables. The item
   now appears under **Accessories** for the active pet → **Equip** it and confirm it renders on the
   pet on both Nest and Home; **Remove** unequips it.
7. **Shop — buy a treat.** Click **Buy treat**. The active pet briefly plays the **eating** state
   (a small animated pet appears next to the treat for ~2s). With no active pet, the inline error
   "Hatch a pet first to give it a treat." appears instead.
8. **Error surfaces.** Spend coins down, then attempt a purchase you can't afford → an inline
   message ("Not enough coins yet — keep studying!") appears near that action. Buying an owned item
   is prevented by the disabled "Owned" button.

## DB e2e check (proves the full chain persisted)

With `npm run dev` still running, after simulating activity, inspect the dev database to confirm the
renderer→IPC→main→DB write path actually persisted (not just optimistic UI):

- **DB path:** `~/Library/Application Support/freecat/freecat.db`
- **Open it:** `npx drizzle-kit studio` (then browse the tables), or any sqlite client, e.g.
  `sqlite3 ~/Library/Application\ Support/freecat/freecat.db`.

Confirm:

```sql
-- coins and xp have accrued past zero
SELECT coins, xp FROM gamification_state;          -- expect coins > 0 AND xp > 0

-- the reward loop wrote a ledger entry for activity (amount = +earn / -spend)
SELECT id, amount, reason, kind, created_at
FROM coin_ledger
WHERE reason = 'activity'
ORDER BY id DESC LIMIT 5;                           -- expect ≥1 row

-- today's activity bucket exists (day_key is 'YYYY-MM-DD' in the app timezone)
SELECT * FROM daily_activity
ORDER BY day_key DESC LIMIT 1;                      -- expect a row keyed to today
```

Pass criteria: `gamification_state.coins > 0` and `.xp > 0`, at least one `coin_ledger` row with
`reason='activity'`, and a `daily_activity` row dated today.

> Note: column/table names follow the Drizzle schema in `src/main/db/schema/`; if you used
> `drizzle-kit studio` the same data is visible there without writing SQL.
