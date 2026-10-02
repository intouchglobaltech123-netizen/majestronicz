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
   stored figures. If the history can't be replayed to exactly one answer, the
   bill is **not changed** and is listed as `REVIEW` (see step 4).
2. Freezes that as the bill's payment split. Sets the bill's "owed at billing"
   and recalculates the due: owed at billing − receipts − returns + refunds.
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
   bill would. If an older build paid back **more** than was over-paid, the bill
   is left unchanged and listed as `REVIEW`.
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
(`migration:fix-existing-bills`); until that record exists the app refuses to
reverse an older return whose refund isn't recorded yet.

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
   empty columns and must not ask about data loss. If it does, stop.
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
   - **"history replays exactly from more than one amount"** or **"does not
     replay"**: find out what was collected when the bill was made (the paper
     bill, that day's cash count) and add `{ "MZERD26-27/7311": 5000 }`.
   - **"an older build paid back ₹X but only ₹Y was over-paid"**: if that cash
     never left the drawer, add `{ "<bill no>": { "trimRefunds": true } }` (the
     older refund rows are cut to the over-paid part); if it did, add
     `{ "<bill no>": { "keepRefunds": true } }` (the customer then owes the
     difference).
   - **`CHECK: … no customer account to hold it`** (no usable phone on the
     bill): pay the amount back, or put the customer's phone on the bill, then
     run again.
   Run `--check` again with `--overrides` until it says "Needs a decision: nothing".
5. **Dry run and review.**
   `DATABASE_URL="<URL>" npm run fix:existing-bills -- --overrides that.json`
   It prints totals and writes `fix-existing-bills-report/dry-run-*.csv` (one
   row per bill: method and reason, old and new due, collected at billing,
   receipts, returns, refunds, credit notes, action) and a `.json` with more
   detail. Look at:
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
   - `openingGaps`: closed days whose stored opening doesn't follow from the day
     before, because an older build calculated it differently. They are left as
     they are. If you want, a Manager can override the opening of the first
     **open** day after them.
   - `legacyPendingOrderAdvances`: advances taken before advances became real
     receipts. Nothing is changed. Check them by hand.
6. **Apply.**
   `DATABASE_URL="<URL>" npm run fix:existing-bills -- --apply --i-have-a-backup --overrides that.json`
   It runs in one transaction: all or nothing.
7. **Verify with a dry run.** Run the step-5 command again. It must report
   `billsChanged 0`, `refundRowsCreated 0`, `storeCreditAdded 0`,
   `salaryPaymentsBackfilled 0` and `lineCostsBackfilled 0`.
   On the copy, also start this backend against it (and the UI against that
   backend) and look at a few dues (Parties, To Collect), the Cash Register for
   some closed days and today, and Stock history.
8. **Start the new backend** (Railway, this release). Its start-up
   `prisma db push` finds nothing to do. Then deploy the UI (Vercel).
9. **Ask every user to reload** open browser tabs. Old tabs keep the old screens
   and lose the live updates until they are reloaded. Close the maintenance
   window.

Run the script only while the backend is stopped, and before the new backend
takes any receipt or return: it reads the data exactly as the older builds
left it.

## Rolling back

The previous build starts with `prisma db push --skip-generate` (without
`--accept-data-loss`). Against the upgraded database that push tries to remove
the columns this release added:

- while all of them are still empty it **drops them without asking** and starts;
- as soon as any of them holds data it **refuses, and the backend does not
  start**. This release fills one of them (the audit trail's branch) on every
  logged action, so once the new backend has been used, expect a refusal.

The previous build also does not understand the corrected data (it rewrites
the part-payment again on the next receipt). So:

- **Restore the backup from step 2** (`pg_restore --clean --if-exists --no-owner`
  into the Railway database), then redeploy the previous build. It is the
  **only** backup the previous build can use — a backup taken after step 3
  already holds the corrected data. Restoring it loses everything entered after
  it was taken.
- **Or keep the data:** add the new columns to the previous build's
  `backend/prisma/schema.prisma` (as optional fields, exactly as in this
  release), then redeploy it. It ignores them, but it will rewrite
  part-payments on new receipts again; when you upgrade again, run the script
  again.

Never add `--accept-data-loss` to the start-up command just to make a rollback
start. It deletes those columns and their data without asking.
