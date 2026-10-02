# Upgrading a database that already has bills

Read this before deploying this release over the live Railway database. A new
database (fresh seed) needs none of it.

## Why there is a one-time fix

Older builds changed a bill's stored "part paid" figure every time a receipt
was recorded, deleted, or goods were returned. The cash register reads that
figure as the cash taken on the bill's own day, so older receipts moved money
onto old (sometimes closed) days and some dues were wrong. Older returns also
never recorded the refund. This release stops that. The script below repairs
the bills the older builds already changed.

What the script does (all of it is in the report it writes):

1. Works out what each bill collected **on its billing day** from its original
   state, not from later receipts. It uses the stored payment split, the audit
   trail, and a replay of what the older build did.
2. Freezes that as the bill's payment split. Sets the bill's "owed at billing"
   and recalculates the due: owed at billing − receipts − returns + refunds.
3. Receipts whose money was never applied to a bill go on to that bill. Any
   remainder becomes the customer's **store credit**. The same goes for old
   "on account" receipts.
4. **Old returns with no refund row were paid back in cash** (your decision).
   The script adds a Cash refund dated on the return day, for the over-paid
   part only. Example: bill 7311 is ₹8,024. ₹5,000 was paid and ₹4,012 was
   returned, so the customer kept goods worth ₹4,012 and had paid ₹988 more.
   That ₹988 is the refund, and the bill then owes ₹0. Old "Adjusted to credit
   note" refund rows become store credit for the over-paid part.
5. Adds one "Opening Stock" history row for each item and branch whose stock
   history doesn't add up to the stock on hand.

The script never edits a closed day's stored opening. Running it twice changes
nothing the second time. Each `--apply` run is recorded in the settings table
(`migration:fix-existing-bills`).

## Steps

1. **Back up live.** From a machine with PostgreSQL tools:
   `pg_dump -Fc -f majestronicz-before-upgrade.dump "<Railway DATABASE_URL>"`
   Keep this file. It is your way back.
2. **Make a copy to rehearse on.** Create a scratch database (local Postgres,
   or a second Railway Postgres), then
   `pg_restore --no-owner --no-privileges -d "<COPY URL>" majestronicz-before-upgrade.dump`.
3. **Bring the copy's schema up to date.** From `backend/` in this release:
   `DATABASE_URL="<COPY URL>" npx prisma db push --skip-generate`. It only adds
   empty columns and must not ask about data loss. If it does, stop.
4. **Dry run on the copy.**
   `DATABASE_URL="<COPY URL>" npm run fix:existing-bills`
   This changes nothing. It prints totals and writes
   `fix-existing-bills-report/dry-run-*.csv` (one row per bill: old and new
   due, collected at billing, receipts, returns, refunds, action) and a `.json`
   with more detail.
5. **Review the report.**
   - Bills flagged `REVIEW` need a person to check them. Common cases:
     - An older build paid a refund bigger than the over-paid part (the
       customer now owes the difference). If that cash never left the drawer,
       put `{ "MZERD26-27/7315": { "trimRefunds": true } }` in a JSON file and
       pass it with `--overrides that.json`.
     - The script could not work out what was collected at billing. Pass
       `{ "<bill no>": 5000 }` (the amount collected at billing) in the same
       file.
   - `closedDays`: closed days whose closing changes, and why. There are only
     two reasons. (a) An older build's receipts had moved cash onto that day;
     the script puts the day back to what was really collected on it. (b) A
     back-filled cash refund for an old return falls on that day; the drawer
     really paid it out, it just was never recorded.
   - `openingGaps`: closed days whose stored opening doesn't follow from the day
     before, because an older build calculated it differently (e.g. it left out
     a ₹5,000 part-payment). They are left as they are. If you want, a Manager
     can override the opening of the first **open** day after them.
   - `legacyPendingOrderAdvances`: advances taken before advances became real
     receipts. Nothing is changed. Check them by hand.
6. **Apply on the copy and check it.**
   `DATABASE_URL="<COPY URL>" npm run fix:existing-bills -- --apply --i-have-a-backup [--overrides that.json]`
   Then run the same command again. It must report `billsChanged 0`.
   Start this backend against the copy (and the UI against that backend). Look
   at a few dues (Parties, To Collect), the Cash Register for some closed days
   and today, and Stock history.
7. **Deploy the backend** (Railway). On start-up it runs `prisma db push`,
   which adds the new empty columns. Then deploy the UI (Vercel).
8. **Run the fix on live** straight away, before staff take receipts on old
   bills. Do it in a quiet moment (before opening or after closing):
   take a fresh `pg_dump -Fc` backup, run the dry run, compare it with the copy's
   report, then run it with `--apply --i-have-a-backup` (and the same overrides
   file). You can run it from your machine with the live `DATABASE_URL`, or
   from the Railway service shell with `npm run fix:existing-bills -- …`.
9. **Ask every user to reload** open browser tabs. Old tabs keep the old screens
   and lose the live updates until they are reloaded.

## Rolling back

The previous build's start-up runs `prisma db push` without
`--accept-data-loss`. It refuses to drop the columns this release added, so the
old backend **will not start** on the upgraded database. Choose one of these:

- **Restore the backup** taken in step 1 or 8 (`pg_restore --clean --no-owner`
  into the Railway database), then redeploy the previous build. This loses
  anything entered after the backup.
- **Or keep the data:** add the new columns to the previous build's
  `backend/prisma/schema.prisma` (as optional fields, exactly as in this
  release), then redeploy it. The old build will ignore them.

Never add `--accept-data-loss` to the start-up command just to make a rollback
start. It deletes those columns and their data without asking.
