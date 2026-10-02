# Upgrading a database that already has bills

Read this before deploying this release over the live Railway database. A new
database (fresh seed or **Reset Demo Data**) needs none of it: the demo data is
already in the corrected shape and marked as fixed.

## Why there is a one-time fix

Older builds changed a bill's stored "part paid" figure every time a receipt
was recorded, deleted, or goods were returned. The cash register reads that
figure as the cash taken on the bill's own day, so older receipts moved money
onto old (sometimes closed) days and some dues were wrong. Older returns also
never recorded the refund, salaries marked Paid never became payments, and bill
lines had no cost at sale. This release stops all of that. The script below
repairs what the older builds already wrote.

What the script does (all of it is in the report it writes):

1. Works out what each bill collected **on its billing day**, from the
   earliest evidence: the stored payment split; else the audit trail's first
   saved copy of the bill; else an **exact replay** of what each older build
   did to the bill on every receipt and return, which must end on the bill's
   stored figures. The replay tries every amount from ₹0 to the bill total
   that could matter (every figure the bill's receipts and returns give, a
   grid across the whole range, and ₹0.02 either side of each hit). It is
   accepted only when exactly **one** amount replays. If several amounts
   replay, or a whole range does (the older builds' updates wiped out every
   trace of it — e.g. a return that zeroed the bill's part-payment), or none
   does, the bill is **not changed** and is listed as `REVIEW` with the
   amounts that fit (see step 4).
2. Freezes that as the bill's payment split. Sets the bill's "owed at billing"
   and recalculates the due exactly as the app does: owed at billing − receipts
   − returns + refunds + store credit already given back on the bill.
3. Receipts whose money was never applied to a bill go on to that bill. Any
   remainder becomes the customer's **store credit**. The same goes for old
   "on account" receipts.
4. **Each old return with no refund recorded was paid back in cash** (your
   decision). The script adds one Cash refund per such return, dated on the
   return day, for what this release would have paid back for it (only the
   part the customer had over-paid). Example: bill 7311 is ₹8,024. ₹5,000 was
   paid and ₹4,012 was returned, so the customer kept goods worth ₹4,012 and
   had paid ₹988 more. That ₹988 is the refund, and the bill then owes ₹0.
5. **Old "Adjust / credit note" refund rows** (an older build booked a credit
   note as a refund payment) are not cash. Each becomes **one** store-credit
   entry for the over-paid part, linked to the bill and the return, and the row
   is removed. Running the script again never adds a second credit or a cash
   refund for it.
6. Whatever a customer paid beyond the (net) bill and never got back — not as
   a refund, not as a credit note — becomes **store credit**. If the bill has
   no customer account, the script links it to the customer with the same
   phone number (creating the account if there is none), exactly as saving the
   bill would. It does this the first time the bill needs to hold credit (the
   unapplied part of a receipt in step 3, a credit note in step 5, or an
   over-payment here), so one `--apply` gives every such bill all its credit.
   If an older build paid back **more** than was over-paid, the bill is left
   unchanged and listed as `REVIEW`.
7. Adds one "Opening Stock" history row for each item and branch whose stock
   history doesn't add up to the stock on hand.
8. **Salaries marked Paid before this release** had no payment row, so they
   never reached the cash register, the Payments Log or the P&L. The script
   adds one payment (money out, to the staff member) per Paid payroll row that
   has none: the row's own amount and payment mode, dated on the India-time day
   it was marked Paid, at the employee's branch. Its note says "backfilled by
   fix-existing-bills". Payroll rows paid ₹0 are only listed.
9. **Cost at sale.** Bill lines saved before this release have no cost, so the
   profit reports used the item's *current* purchase price, and changing it
   re-costed closed months. Each such line gets a cost: the price of the latest
   purchase receipt of that item on or before the bill date, else the item's
   purchase price at the time of the run (a combo: the sum of its parts). The
   report says how many lines came from purchase receipts and by how much cost
   of goods differs from the current-price figure.
10. Staff saved with the login status `active` / `disabled` become `Active` /
    `Inactive`. Quotations with no status become `Converted` (a bill that is
    not voided was made from them) or `Open`.

The script never edits a closed day's stored opening. Running it twice changes
nothing the second time. Each `--apply` run is recorded in the settings table
(`migration:fix-existing-bills`, with the bills still under `REVIEW`); until
that record exists the app refuses to reverse an older return whose refund
isn't recorded yet.

**Running it again after the new backend has been used** is safe and changes
nothing: it prints `Already applied (first run …)` and, at the end, `Already
migrated; nothing to do`. Every bill made or changed in the app since the first
`--apply` (the bill, a receipt or refund on it, a return or a store-credit entry
for it is dated after that run) is the app's and is left exactly as it is
(`skip (kept by the app since the fix)` in the report), and so are receipts
taken since. Bills that were still under `REVIEW` are the exception: give their
amount in `--overrides` and the next `--apply` settles them. A database that was
freshly seeded by this release is already in the corrected shape; the script
says so and leaves its bills alone.

On 20,000 bills and 20,000 receipts it takes about 10 seconds against a local
copy (it prints a progress line as it goes); over the internet to Railway allow
a few minutes.

## Steps

Do steps 3–7 on a **copy** first (made in step 2), then repeat them on live.

1. **Maintenance window: stop the backend.** Tell staff the app is closed.
   In Railway, stop the backend service (remove the active deployment) so
   nothing writes to the database while you work. Leave the UI on Vercel as it
   is for now.
2. **Back up live — this is your rollback point.** From a machine with
   PostgreSQL tools:
   `pg_dump -Fc -f majestronicz-before-upgrade.dump "<Railway DATABASE_URL>"`.
   Keep this file. **Only this backup, taken before anything below, can be
   restored under the previous build** (see Rolling back). To rehearse, create
   a scratch database (local Postgres, or a second Railway Postgres) and
   `pg_restore --no-owner --no-privileges -d "<COPY URL>" majestronicz-before-upgrade.dump`.
3. **Bring the schema up to date.** From `backend/` in this release:
   `DATABASE_URL="<URL>" npx prisma db push --skip-generate`. It only adds
   seven empty columns, the `PoAttachment` table and five indexes (see the
   table under Rolling back; on a large database the indexes take a few
   seconds), and must not ask about data loss. If it does, stop.
4. **Check what needs a decision.**
   `DATABASE_URL="<URL>" npm run fix:existing-bills -- --check`
   It changes nothing and prints only what needs a person (no SQL needed):
   - older "Adjust / credit note" refund rows and the store credit each becomes
     (no action needed; listed so you know);
   - every older bill without a stored split that receipts or returns changed,
     with how its collected-at-billing amount was worked out;
   - every bill marked `REVIEW` (left unchanged until you decide) or `CHECK`
     (changed — read the note).
   It exits with code 3 while anything needs a decision, 0 when nothing does.
   Put your decisions in one JSON file and pass it as `--overrides that.json`
   from now on:
   - **"history replays exactly from more than one amount (₹a, ₹b)"**, **"the
     stored figures come out the same whatever was collected at billing within
     ₹a–₹b"** or **"does not replay"**: the data cannot tell what was collected
     when the bill was made. Find out from the paper bill or that day's cash
     count and add `{ "MZERD26-27/7311": 5000 }`. The listed amounts are only
     the ones that fit the stored figures — do not pick one of them without
     that evidence. (Example: seed bill 7308 after two receipts, a return and a
     receipt of ₹5,000 under the build before last: due 0 for any amount from
     ₹12 to ₹5,524 — it was ₹5,000.)
   - **"an older build paid back ₹X but only ₹Y was over-paid"**: if that cash
     never left the drawer, add `{ "<bill no>": { "trimRefunds": true } }` (the
     older refund rows are cut to the over-paid part); if it did, add
     `{ "<bill no>": { "keepRefunds": true } }` (the customer then owes the
     difference).
   - **`CHECK: … no customer account to hold it`** (no usable phone on the
     bill): pay the amount back, or put the customer's phone on the bill, then
     run again.
   - A bill that needs **both** an amount and a refund decision takes one
     entry with both: `{ "MZERD26-27/7311": { "collectedAtBilling": 5000, "keepRefunds": true } }`
     (or `"trimRefunds": true`). One file holds every bill, e.g.
     `{ "MZCBE26-27/7308": 5000, "MZERD26-27/7311": { "collectedAtBilling": 5000, "keepRefunds": true } }`.
   Amounts are plain numbers (`5000`, not `"5,000"`). The script reads the file
   strictly: a bill number that is not in the database, an amount that is not a
   number of ₹0 or more, a misspelt field or `true`/`false` written as text
   stops the run (exit code 2) and lists every problem — nothing is changed.
   Run `--check` again with `--overrides` until it says "Needs a decision: nothing".
5. **Dry run and review.**
   `DATABASE_URL="<URL>" npm run fix:existing-bills -- --overrides that.json`
   It prints totals and writes `dry-run-*.csv` (one row per bill: method and
   reason, old and new due, collected at billing, receipts, returns, refunds,
   credit notes, action) and a `.json` with more detail into the folder
   `fix-existing-bills-report/` **inside the folder you run the command from**
   (`backend/fix-existing-bills-report/` with `npm run`); the last line prints
   the full path. Add `--out <folder>` to write them elsewhere — keep the
   reports of the live run with the backup. Every run (`--check`, dry run,
   `--apply`) writes its own pair of files, named by mode and time. A dry run
   works inside a transaction that is rolled back, so its progress lines say
   `would write …`; only `--apply` says `written`. Look at:
   - **bills whose due changes** — each is printed with how its collected
     amount was found and the due formula with its figures.
   - `closedDays`: closed days whose closing changes, each with its reasons and
     amounts. These are the only reasons:
     (a) *billing-day cash restored* — an older build's receipt or return had
     rewritten the bill's part-payment, which moved cash onto (or off) its
     billing day; the day goes back to what was really collected on it;
     (b) *backfilled cash refund* for an older return made that day — the
     drawer really paid it out, it was never recorded;
     (c) *backfilled cash salary* paid that day (bank/UPI salaries don't touch
     the drawer) — if it was in fact paid from outside the drawer, change that
     payment's mode after the apply, or remove it from the Payments Log;
     (d) *refund cut on request* (`trimRefunds`).
     If a change is not fully explained by these, the line ends with
     `REVIEW: ₹… of the change is not explained` — stop and ask.
   - `salaries`: every salary payment the script adds, and any it skipped.
   - `openingGaps`: closed days whose stored opening is not what the day before
     carries forward (the previous register day's closing, after the fix, plus
     the cash of any days in between that have no register). Closed days keep
     their stored opening, so each gap is listed, never changed. The causes:
     (a) **the script's own corrections on an earlier day** — a backfilled cash
     salary or refund, billing-day cash restored, an Adjust row removed or a
     refund cut on that earlier day changes its closing, while the next closed
     day keeps the opening it stored back then (e.g. a ₹24,000 salary
     backfilled on 24 Sep shows as a −₹24,000 gap on 25 Sep);
     (b) **refunds backfilled on days that have no register** — an older return
     made on a day nobody opened the cash register (e.g. 7311's ₹988 refund on
     8 Sep) counts in the cash carried forward to the next register day, whose
     stored opening never included it;
     (c) **an older build calculated openings differently** — e.g. it left out a
     legacy part-payment taken in cash (E2E8-6), or the demo data's stored
     openings;
     (d) an opening typed in by hand (opening override) or entries made on a
     past date after the following day was closed.
     A gap does not change any figure by itself. If the cash in the drawer
     today agrees with the app, nothing needs doing; if it doesn't, a Manager
     can override the opening of the first **open** day after the gap.
   - `openDays`: cash-register days that were opened but **never closed**
     (often days staff forgot to close). For such a day the new build does
     not use the opening an older build saved when the register was opened;
     it works the opening out each time the day is shown — the closing of the
     previous register day plus the cash of any days in between that have no
     register. So after the upgrade such a day can show a different opening
     (and closing) than before, also because of the script's corrections on
     earlier days. The console lists them under "day(s) never closed whose
     opening the app shows live"; each `openDays` entry has `storedOpening`
     (what the older build saved), `openingShownAfterFix` (what the app will
     show), `changedByFix` (true when the script's own corrections move it —
     then `openingShownBeforeFix` and `closingBeforeFix` → `closingAfterFix`
     say by how much) and `openingOverridden` (a Manager typed the opening —
     kept as it is). Nothing is changed for them. Open each listed day on the
     copy (step 7, Cash Register, that branch and date): if the figures are
     right, close the day; if the drawer really held something else, a
     Manager overrides that day's opening (an overridden opening is kept,
     like a closed day's).
   - `legacyPendingOrderAdvances`: advances taken before advances became real
     receipts. Nothing is changed. Check them by hand.
6. **Apply.**
   `DATABASE_URL="<URL>" npm run fix:existing-bills -- --apply --i-have-a-backup --overrides that.json`
   It runs in one transaction: all or nothing.
7. **Verify with a dry run.** Run the step-5 command again. It must report
   `billsChanged 0`, `refundRowsCreated 0`, `storeCreditAdded 0`,
   `salaryPaymentsBackfilled 0` and `lineCostsBackfilled 0`, and end with
   `Already migrated; nothing to do`. (Before the new backend runs, this second
   run re-checks every bill from scratch.)
   On the copy, also start this backend against it (and the UI against that
   backend) and look at a few dues (Parties, To Collect), the Cash Register for
   some closed days and today, and Stock history. To do that on your own
   machine, from this release:

   ```
   cd backend
   DATABASE_URL="<COPY URL>" PORT=4000 AUTH_SECRET="<any long local value>" CORS_ORIGINS=http://localhost:5173 npm run dev
   # in a second terminal, at the repository root:
   VITE_API_URL=http://localhost:4000 npm run dev
   ```

   and open http://localhost:5173 (log in with the copy's PINs). Never point
   this at the live `DATABASE_URL`, and don't use the live `AUTH_SECRET`.
8. **Start the new backend** (Railway, this release). Its start-up
   `prisma db push` finds nothing to do. Then deploy the UI (Vercel).
9. **Ask every user to reload** open browser tabs. Old tabs keep the old screens
   and lose the live updates until they are reloaded. Close the maintenance
   window.

Run the script only while the backend is stopped, and before the new backend
takes any receipt or return: it reads the data exactly as the older builds
left it.

## Rolling back

Rolling back means going back to the previous build (the one in production
before this release). The previous build starts with `prisma db push
--skip-generate` (without `--accept-data-loss`), which compares the database
with its own schema. This release added one table, seven columns and five
indexes (from `git diff <previous build> <this release> -- backend/prisma/schema.prisma`):

| Where | Added |
| --- | --- |
| new table `PoAttachment` | supplier-bill files attached to purchase orders (`id`, `poId`, `name`, `mimeType`, `bytes`, `dataUrl`, `uploadedAt`, `uploadedBy`, index on `poId`) |
| `Item` | columns `isArchived`, `archivedAt`, `archivedBy` |
| `Estimate` | column `stateOfSupply` |
| `PurchaseOrder` | column `supplierBills` |
| `User` | column `tokensValidAfter` |
| `AuditLog` | column `branchId` (filled on every logged action) |
| `StockAdjustmentLog` | index on `timestamp` |
| `Invoice` | indexes on `customerId`, on `date` and on `branchId, date` |
| `Payment` | GIN index on `allocations` (`jsonb_path_ops`) |

The previous build refuses to start while the new table or columns hold data
(dropping them would lose it). The five indexes hold no data: the previous
build's start-up `db push` drops them without asking and starts — that is
harmless (only some lookups get slower; upgrading again re-creates them). It
does not understand the corrected data either (it rewrites the part-payment on
the next receipt). Choose one of:

### A. Restore the step-2 backup (everything entered since is lost)

It is the **only** backup the previous build can use — a backup taken after
step 3 already holds the corrected data.

1. Stop the backend (Railway: remove the active deployment).
2. Restore into an **empty** database. `pg_restore --clean` alone is not
   enough: it only replaces what is in the backup, so the `PoAttachment` table
   (not in the backup) stays behind and the previous build refuses to start
   (`You are about to drop the PoAttachment table, which is not empty`).
   Either empty the database first:

   ```
   psql "<DATABASE_URL>" -c 'DROP SCHEMA public CASCADE;' -c 'CREATE SCHEMA public;'
   pg_restore --no-owner --no-privileges -d "<DATABASE_URL>" majestronicz-before-upgrade.dump
   ```

   or (if you cannot drop the schema) restore with `--clean` and then remove
   every table this release added:

   ```
   pg_restore --clean --if-exists --no-owner --no-privileges -d "<DATABASE_URL>" majestronicz-before-upgrade.dump
   psql "<DATABASE_URL>" -c 'DROP TABLE IF EXISTS "PoAttachment";'
   ```

   (`--clean` re-creates every table that is in the backup, so the columns
   added to existing tables go with it.) A brand-new Railway Postgres restored
   from the backup works too — then point the backend's `DATABASE_URL` at it.
3. Check: from the previous build's `backend/`,
   `DATABASE_URL="<DATABASE_URL>" npx prisma db push --skip-generate` must say
   `The database is already in sync with the Prisma schema`.
4. Redeploy the previous build and its UI.

### B. Keep the data entered on this release

1. Stop the backend.
2. In the previous build's `backend/prisma/schema.prisma` add the new table and
   columns, exactly as in this release: the seven columns as optional fields
   (`Item`: `isArchived Boolean?`, `archivedAt String?`, `archivedBy String?`;
   `Estimate`: `stateOfSupply String?`; `PurchaseOrder`: `supplierBills Json?`;
   `User`: `tokensValidAfter Float?`; `AuditLog`: `branchId String?`) and the
   whole `model PoAttachment { … }` block (with its `@@index([poId])`). Check
   from that `backend/`:

   ```
   npx prisma migrate diff --from-schema-datamodel <this release's backend/prisma/schema.prisma> --to-schema-datamodel prisma/schema.prisma --script
   ```

   It must print **only** these five lines (the indexes, dropped harmlessly as
   above) and nothing that drops a table or a column:

   ```
   DROP INDEX "StockAdjustmentLog_timestamp_idx";
   DROP INDEX "Invoice_customerId_idx";
   DROP INDEX "Invoice_date_idx";
   DROP INDEX "Invoice_branchId_date_idx";
   DROP INDEX "Payment_allocations_idx";
   ```

   Then `DATABASE_URL="<DATABASE_URL>" npx prisma db push --skip-generate`
   must not ask about data loss: it says `Your database is now in sync with
   your Prisma schema` (it dropped the five indexes); run it once more and it
   says `The database is already in sync with the Prisma schema`. (To keep the
   indexes, also copy this release's five `@@index` lines into those three
   models — then the diff prints `-- This is an empty migration.` and the
   first push already says the database is in sync.)
3. Redeploy that build. What to expect on it:
   - **Supplier-bill files uploaded on this release can't be opened**: this
     release keeps them in `PoAttachment`, which the previous build never
     reads, so their POs list the file name with no file. Files uploaded on
     the previous build still open. Download any you need before rolling back
     (or roll forward again — they are all still there).
   - The previous build ignores the new columns: archived items show as
     active again, and a PO's list of several supplier bills shows only the
     totals kept on the PO.
   - It rewrites part-payments on new receipts and returns again. When you
     upgrade again: take a new backup, remove the record of the earlier run
     (`psql "<DATABASE_URL>" -c "DELETE FROM \"AppConfig\" WHERE key='migration:fix-existing-bills'"`
     — otherwise the script takes the bills the previous build changed for
     bills of this release and leaves them alone), and repeat steps 3–7.
     A bill whose return was reversed on this release (the refund collected
     back) can then come up as "an older build paid back ₹X but only ₹Y was
     over-paid": if this release showed that bill with a due, that due is the
     difference — use `keepRefunds`.

Never add `--accept-data-loss` to the start-up command just to make a rollback
start. It deletes those columns and their data without asking.
