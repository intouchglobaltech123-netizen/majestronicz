# QA regression suite

Automated checks to run before every deploy. They do not change any application code.

- `qa/api/` holds API tests. They use Node's built-in test runner and `fetch`. No extra packages.
- `qa/smoke/smoke.mjs` is a browser smoke test. It uses the preinstalled Playwright.
- `qa/run.sh` does everything in one go: reset a throwaway database, seed it, start the backend, run the tests, stop the backend.

Each test creates its own data through the API (its own items, bills, POs, staff and cash days). Each test name starts with the finding ID from the QA report, for example `SAL3-1 a quote converts to an invoice only once`.

## Quick start

You need Node 22 and a local Postgres.

```bash
# Wipes and reseeds the database named in QA_DATABASE_URL. Use a throwaway one.
QA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/majestronicz_qa qa/run.sh

# Also run the browser smoke test (starts the frontend too):
QA_SMOKE=1 QA_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/majestronicz_qa qa/run.sh

# Only some tests:
QA_TEST_FILTER="SAL3-1|CRM6" QA_DATABASE_URL=... qa/run.sh
```

`run.sh` refuses a database whose name does not contain `qa` or `test`, and a database that is not on localhost. It never reads `backend/.env`. Logs and the TAP report go to `qa/.logs/`.

Settings: `QA_PORT` (backend, default 4100), `QA_FRONTEND_PORT` (default 5199), `QA_AUTH_SECRET` (a dummy local value by default), `QA_PLAYWRIGHT` (path to Playwright's `index.mjs`).

## Running by hand

```bash
# 1. A throwaway database with the demo data
cd backend
npm ci && npx prisma generate
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/majestronicz_qa npx prisma db push --force-reset --accept-data-loss
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/majestronicz_qa AUTH_SECRET=local-qa-secret-1234 npm run seed

# 2. The backend, with a local secret (never the production one)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/majestronicz_qa PORT=4100 AUTH_SECRET=local-qa-secret-1234 npx tsx src/index.ts

# 3. In another terminal, from the repo root
QA_API_URL=http://127.0.0.1:4100 QA_AUTH_SECRET=local-qa-secret-1234 \
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/majestronicz_qa \
node --test --test-concurrency=1 qa/api/*.test.mjs

# 4. Optional smoke test (frontend pointed at the same backend)
VITE_API_URL=http://127.0.0.1:4100 npx vite --port 5199 --strictPort --host 127.0.0.1   # start the backend with CORS_ORIGINS=http://127.0.0.1:5199
QA_FRONTEND_URL=http://127.0.0.1:5199 QA_API_URL=http://127.0.0.1:4100 node qa/smoke/smoke.mjs
```

Node 22 needs the file glob (`qa/api/*.test.mjs`); a bare folder name does not work.

`QA_AUTH_SECRET` is optional. With it, one extra token test runs. `DATABASE_URL` is optional. With it, one extra database check runs (through `psql`). Without them those tests are skipped.

Run against a freshly seeded database. Tests use random past dates for cash days, so a re-run without a reset also works.

## What each file covers

| File | Covers |
|---|---|
| `api/auth-roles.test.mjs` | Login, forged and edited tokens, removed generic routes, role limits, branch scoping of reads and edits, PIN change rate limit, recurring templates, cross-branch payments |
| `api/sales-quotes.test.mjs` | Quote conversion (incl. 5 at once), overselling (incl. at once), invoice numbers, edits, returns, voids, deletes, combos, credit bills, closed days, refunds |
| `api/customers-receipts.test.mjs` | Receipts and dues (one source of truth), simultaneous receipts, receipt branch, closed-day lock, customer master rules |
| `api/cash-register.test.mjs` | Carry-forward of cash sales, down-payments, receipts and expenses; deposit approval; day close; recurring approvals; vendor cash leaving the drawer |
| `api/purchases.test.mjs` | PO totals and validation, receiving (damaged, missing, duplicate lines, at once), cancel/delete rules, Edit Prices, payments (incl. at once) |
| `api/stock-ledger.test.mjs` | Stock history matches stock after every kind of change, transfers, branch rules, item delete rules |
| `api/reports-arithmetic.test.mjs` | GST split, discount before GST, grand total identity, amount in words, splits and dues add up, IGST, invalid values |
| `api/staff-payroll.test.mjs` | Mark Paid (incl. at once), payroll locks, clock-in/out, kiosk PIN lockout and branch check |
| `api/inventory-items.test.mjs` | Combo sales/returns/edits use stored parts, combo API validation, challans follow transfers (numbers, receive, locks), item archive, unique names, required HSN, linked vendors, stock history reads per branch, shared 90-day sales figures, quantity rules |
| `smoke/inventory-ui.mjs` | Optional browser checks of the challan, transfer, archive, combo-saving, low-stock badge and Purchase inventory screens (run by hand, like smoke.mjs) |
| `smoke/barcode-pages.mjs` | Optional: prints every barcode label preset to PDF through the Barcode Generator and counts the pages |
| `smoke/smoke.mjs` | Logs in as each role and opens every sidebar screen. Fails on page errors, the "Something went wrong" screen, or API responses of 500 and above. It first adds a check-in without a location (HRM6-1). |
| `run.sh` | Reset, seed, start, test, stop. |
| `../.github/workflows/qa.yml` | The same in GitHub Actions with a Postgres service and a dummy secret. |

## Expected failures (still open on cf9b5b4)

These tests check the correct behaviour for findings that are not fixed yet. They are EXPECTED to fail until the fix lands. When one starts passing, the fix works. Do not change a test to make it pass. Fix the app.

On cf9b5b4: 143 tests, 98 pass, 45 fail. The smoke test passes for all five roles.

Auth & roles
- SEC2-3 the Sales role cannot read customer payments
- SEC2-3 the live update stream needs a login
- SEC6-1 changing your own PIN does not reveal that another person uses it
- CASH4-1 a Coimbatore manager cannot approve another branch's recurring expense
- CASH4-1 Billing cannot create recurring expense templates
- SAL4-11 a Coimbatore manager cannot edit an Erode quote
- PUR6-1 Billing (no purchase rights) cannot reduce a vendor payable through Parties

Sales & quotes
- SAL5-3 void after a partial return of an item on two lines restores the rest of the stock
- SAL5-3 delete after a partial return of an item on two lines restores the rest of the stock
- INV3-3 a combo sale takes the stored combo parts, not the parts sent by the browser
- QA8-1 (new) editing a paid cash bill to a higher total records the new payment instead of a hidden due
- SAL6-1 a return on a part-cash part-credit bill reduces what is owed before taking cash from the drawer
- SEC-6 Billing cannot void or permanently delete a bill
- SAL4-9 deleting the newest bill does not let its number be reused

Customers & receipts
- CRM6-5 a receipt date in another format does not skip the closed-day lock
- CRM4-4 money received above what is owed is not stored as unexplained cash
- CRM5-6 creating a customer cannot set made-up purchase totals
- CRM-21 a customer with invoices cannot be deleted

Cash register
- CASH6-2 an expense cannot be dated in the future
- CASH3-5 cash paid to a vendor while receiving stock leaves the drawer too

Purchases
- PUR5-2 a PO with a negative quantity or price is refused
- PUR5-2 a PO for a vendor that does not exist is refused
- PUR3-1 the same item twice in one receipt does not double the stock
- PUR3-6 a PO with a payment cannot be deleted
- PUR3-6 a received PO cannot be cancelled (and then deleted)
- PUR2-9 "Pay now" while receiving cannot exceed what is owed
- PUR6-1 a Parties vendor payment cannot settle a cancelled PO
- PUR2-8 a zero price at receipt does not set the PO total to zero

Stock & ledger
- INV2-4 opening stock on a new item writes a stock-history row
- INV2-4 editing a bill writes stock history that adds up
- INV2-4 deleting a live bill writes stock history that adds up
- INV2-4 a direct stock set (/stock/update) writes stock history
- INV2-4 an adjustment below zero logs the change that really happened
- INV6-4 /stock/location refuses an unknown branch
- INV-5 an item whose stock is in transit cannot be deleted
- INV4-5 a Coimbatore manager cannot create opening stock in another branch

Reports arithmetic
- RPT4-3 an inter-state sale is stored as IGST, not CGST + SGST
- SAL-17 an overall discount above 100% is refused
- SAL-17 a negative unit price is refused
- SAL4-5 a GST rate that is not a real slab is refused

Staff & payroll
- HRM6-3 two people pressing Mark Paid at the same moment pay the row once
- HRM6-2 a manual clock-in with a nonsense time is refused
- HRM6-2 a Coimbatore manager cannot clock in Erode staff
- SEC6-2 a Coimbatore manager cannot test an Erode employee's PIN
- SEC6-2 kiosk PINs are not stored in plain text (runs only with DATABASE_URL)

`QA8-1` is new. It was found while writing this suite: editing a cash bill to a higher total keeps the old cash split, so the bill shows money owed that the customer already paid.

Every other test guards a fix that is already in (a FIXED item, or the fixed part of a partly fixed item). If one of those fails, it is a regression.

## Notes

- The backend rate-limits failed logins per IP (5 tries). The suite makes one deliberate wrong login, then logs in successfully, which resets the counter.
- Some locks live in backend memory (kiosk PIN lockout, PIN-change limit). The tests use freshly created staff for these, so re-runs do not collide.
- The suite runs files one at a time (`--test-concurrency=1`). Tests inside a file that check simultaneous requests fire them with `Promise.all`.
- Nothing contacts production, Railway, Vercel or any third-party API. The smoke test blocks every host except the local frontend and backend.
