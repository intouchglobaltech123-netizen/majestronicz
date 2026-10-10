// Staff, attendance, kiosk PINs and payroll.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { post, put, get, api, ok, expectStatus, near, uid, together, sql, loginPin, istToday } from './lib.mjs';

/** A fresh active employee (created by the CEO) so lockouts and payroll rows never collide. */
async function newEmployee(branchId = 'erode-hq', salary = 20800) {
  for (let i = 0; i < 20; i++) {
    const pin = String(1000 + Math.floor(Math.random() * 9000));
    const res = await post('/api/employees', { name: `QA Staff ${uid()}`, designation: 'QA Technician', branchId, monthlySalary: salary, status: 'Active', joinedDate: '2026-01-01', pin });
    if (res.status === 409) continue;
    return { emp: ok(res, 'create employee').employee, pin };
  }
  throw new Error('could not create employee');
}

const draftRow = async (emp, month) => {
  const snap = ok(await post('/api/hrm/payroll-adjustment', { employeeId: emp.id, month, adjustment: 500, reason: 'QA', standardHoursPerMonth: 208 }), 'draft payroll');
  return snap.payrollRecords.find((p) => p.employeeId === emp.id && p.month === month);
};

describe('staff & payroll', () => {
  test('HRM-4 Mark Paid saves the payroll as Paid', async () => {
    const { emp } = await newEmployee();
    const row = await draftRow(emp, '2026-07');
    ok(await post('/api/hrm/payroll-paid', { payrollId: row.id, paymentMode: 'Bank', record: { ...row } }));
    const after = ok(await get('/api/payroll-records')).find((p) => p.id === row.id);
    assert.equal(after.status, 'Paid');
  });

  test('HRM6-3 a Paid payroll row cannot be paid again with a different amount', async () => {
    const { emp } = await newEmployee();
    const row = await draftRow(emp, '2026-06');
    ok(await post('/api/hrm/payroll-paid', { payrollId: row.id, paymentMode: 'Cash', record: { ...row } }));
    const again = await post('/api/hrm/payroll-paid', { payrollId: row.id, paymentMode: 'Bank', record: { ...row, finalPayable: 99999 } });
    expectStatus(again, 409);
    const after = ok(await get('/api/payroll-records')).find((p) => p.id === row.id);
    near(after.finalPayable, row.finalPayable);
    assert.equal(after.paymentMode, 'Cash');
  });

  test('HRM6-3 two people pressing Mark Paid at the same moment pay the row once', async () => {
    const { emp } = await newEmployee();
    const row = await draftRow(emp, '2026-05');
    const results = await together(4, (i) => post('/api/hrm/payroll-paid', { payrollId: row.id, paymentMode: i % 2 ? 'Bank' : 'Cash', record: { ...row, finalPayable: row.finalPayable + i * 1000 } }));
    const wins = results.filter((r) => r.status === 200).length;
    assert.equal(wins, 1, `expected one payment, got ${wins} (${results.map((r) => r.status).join(',')})`);
  });

  test('HRM6-3 a Paid payroll row cannot be adjusted', async () => {
    const { emp } = await newEmployee();
    const row = await draftRow(emp, '2026-03');
    ok(await post('/api/hrm/payroll-paid', { payrollId: row.id, paymentMode: 'Cash', record: { ...row } }));
    expectStatus(await post('/api/hrm/payroll-adjustment', { employeeId: emp.id, month: '2026-03', adjustment: 5000, reason: 'x', standardHoursPerMonth: 208 }), 409);
  });

  test('SEC3-1 payroll records are CEO-only', async () => {
    expectStatus(await get('/api/payroll-records', 'Manager'), 403);
  });

  test('HRM-REG a manager marks the daily register, upserts the day, and validates', async () => {
    const { emp } = await newEmployee('erode-hq');
    const date = istToday();
    let snap = ok(await post('/api/hrm/attendance/mark', { date, branchId: 'erode-hq', marks: [{ employeeId: emp.id, status: 'Absent', notes: 'no show' }] }), 'mark absent');
    let rec = snap.attendanceRecords.find((a) => a.employeeId === emp.id && a.date === date);
    assert.equal(rec.status, 'Absent');
    assert.ok(rec.markedBy, 'who marked it is stamped');
    // re-marking the same day updates it (no duplicate row)
    snap = ok(await post('/api/hrm/attendance/mark', { date, branchId: 'erode-hq', marks: [{ employeeId: emp.id, status: 'Casual Leave' }] }), 're-mark');
    const recs = snap.attendanceRecords.filter((a) => a.employeeId === emp.id && a.date === date);
    assert.equal(recs.length, 1, 'one row per day (upsert)');
    assert.equal(recs[0].status, 'Casual Leave', 'status updated');
    // bad status + future date are refused
    expectStatus(await post('/api/hrm/attendance/mark', { date, branchId: 'erode-hq', marks: [{ employeeId: emp.id, status: 'Banana' }] }), 400, 'bad status');
    expectStatus(await post('/api/hrm/attendance/mark', { date: '2099-01-01', branchId: 'erode-hq', marks: [{ employeeId: emp.id, status: 'Present' }] }), 400, 'future date');
  });

  test('HRM-REG only CEO/Manager mark the register, and a manager only their own branch', async () => {
    const { emp } = await newEmployee('erode-hq');
    const date = istToday();
    expectStatus(await post('/api/hrm/attendance/mark', { date, branchId: 'erode-hq', marks: [{ employeeId: emp.id, status: 'Present' }] }, 'Billing'), 403, 'Billing refused');
    expectStatus(await post('/api/hrm/attendance/mark', { date, branchId: 'erode-hq', marks: [{ employeeId: emp.id, status: 'Present' }] }, 'Manager'), 403, 'Coimbatore manager cannot mark Erode');
  });

  test('HRM3-1 clock-in and clock-out work and record hours', async () => {
    const { emp } = await newEmployee();
    ok(await post('/api/hrm/clock-in', { employeeId: emp.id, location: { lat: 11.34, lng: 77.71 }, customTime: '09:00:00' }), 'in');
    expectStatus(await post('/api/hrm/clock-in', { employeeId: emp.id, customTime: '09:05:00' }), 409, 'second clock-in');
    const snap = ok(await post('/api/hrm/clock-out', { employeeId: emp.id, location: { lat: 11.34, lng: 77.71 }, customTime: '17:30:00' }), 'out');
    const rec = snap.attendanceRecords.find((a) => a.employeeId === emp.id);
    near(rec.hoursWorked, 8.5);
  });

  test('M6 attendance selfies load on demand, not in the bootstrap payload', async () => {
    const { emp } = await newEmployee();
    const photoDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8Af//Z';
    const snap = ok(await post('/api/hrm/clock-in', { employeeId: emp.id, photoDataUrl, location: { lat: 11.34, lng: 77.71 }, customTime: '09:00:00' }), 'clock-in with a selfie');
    const rec = snap.attendanceRecords.find((a) => a.employeeId === emp.id);
    assert.ok(rec && rec.checkInTime, 'the attendance record was created');
    // The start-up payload carries the time but NOT the selfie blob (M6).
    const boot = ok(await get('/api/bootstrap'));
    const bootRec = boot.attendanceRecords.find((a) => a.id === rec.id);
    assert.ok(bootRec, 'the record is in the bootstrap');
    assert.equal(bootRec.checkInPhoto, undefined, 'the selfie is NOT in the bootstrap payload');
    // The selfie is fetched only when someone opens it.
    const got = ok(await get(`/api/attendance/${rec.id}/photo`));
    assert.ok(typeof got.checkInPhoto === 'string' && got.checkInPhoto.startsWith('data:image'), 'the selfie is fetched on demand');
  });

  test('HRM6-1 a check-in without a location is stored and attendance can still be read', async () => {
    const { emp } = await newEmployee();
    ok(await post('/api/hrm/clock-in', { employeeId: emp.id }), 'clock-in without location');
    const rows = ok(await get('/api/attendance-records'));
    const rec = rows.find((a) => a.employeeId === emp.id);
    assert.ok(rec, 'record listed');
    assert.equal(rec.checkInLocation, null);
  });

  test('HRM6-2 a manual clock-in with a nonsense time is refused', async () => {
    const { emp } = await newEmployee();
    expectStatus(await post('/api/hrm/clock-in', { employeeId: emp.id, customTime: 'banana' }), 400);
  });

  test('HRM6-2 a Coimbatore manager cannot clock in Erode staff', async () => {
    const { emp } = await newEmployee('erode-hq');
    expectStatus(await post('/api/hrm/clock-in', { employeeId: emp.id, customTime: '09:00:00' }, 'Manager'), 403);
  });

  test('SEC6-2 the kiosk PIN check locks after 5 wrong tries', async () => {
    const { emp, pin } = await newEmployee();
    const wrong = pin === '0000' ? '0001' : '0000';
    for (let i = 0; i < 5; i++) {
      const r = ok(await post('/api/hrm/verify-pin', { employeeId: emp.id, pin: wrong }), `wrong try ${i + 1}`);
      assert.equal(r.ok, false);
    }
    expectStatus(await post('/api/hrm/verify-pin', { employeeId: emp.id, pin }), 429, 'locked even for the right PIN');
  });

  test('SEC6-2 a Coimbatore manager cannot test an Erode employee\'s PIN', async () => {
    const { emp, pin } = await newEmployee('erode-hq');
    const res = await post('/api/hrm/verify-pin', { employeeId: emp.id, pin }, 'Manager');
    expectStatus(res, 403);
  });

  test('SEC6-2 kiosk PINs are not stored in plain text', { skip: !process.env.DATABASE_URL && 'set DATABASE_URL to run this database check' }, async () => {
    const { emp, pin } = await newEmployee();
    const rows = sql(`select pin from "Employee" where id = '${emp.id.replace(/'/g, "''")}'`);
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0][0], pin, 'employee PIN is stored as typed');
  });

  test('HRM-6 kiosk PINs must be 4 digits', async () => {
    expectStatus(await post('/api/employees', { name: `QA ${uid()}`, designation: 'x', branchId: 'erode-hq', monthlySalary: 1, pin: '12a4' }), 400);
  });
  test('E2E7-6 Mark Paid without a payrollId is refused and changes no payroll row', async () => {
    const { emp } = await newEmployee();
    const draft = await draftRow(emp, '2026-02');
    const before = ok(await get('/api/payroll-records'));
    const res = await post('/api/hrm/payroll-paid', { paymentMode: 'Cash', paymentReference: 'WIPE' });
    expectStatus(res, 400);
    const after = ok(await get('/api/payroll-records'));
    for (const b of before) {
      const a = after.find((x) => x.id === b.id);
      assert.equal(a.status, b.status, `${b.id} status changed`);
      assert.equal(a.paymentReference ?? null, b.paymentReference ?? null, `${b.id} reference changed`);
    }
    assert.equal(after.find((x) => x.id === draft.id).status, 'Draft');
  });

  test('E2E7-6 Mark Paid for an unknown payroll row is a 404', async () => {
    expectStatus(await post('/api/hrm/payroll-paid', { payrollId: `pay-nope-${uid()}`, paymentMode: 'Cash' }), 404);
  });

  test('HRM8-1 a location without coordinates is stored as no location', async () => {
    const { emp } = await newEmployee();
    ok(await post('/api/hrm/clock-in', { employeeId: emp.id, location: { addressHint: 'Verified Branch Premises' }, customTime: '09:00:00' }), 'in');
    ok(await post('/api/hrm/clock-out', { employeeId: emp.id, location: { latitude: 'x', longitude: null }, customTime: '17:00:00' }), 'out');
    const rec = ok(await get('/api/attendance-records')).find((a) => a.employeeId === emp.id);
    assert.equal(rec.checkInLocation, null);
    assert.equal(rec.checkOutLocation, null);
    const { emp: emp2 } = await newEmployee();
    ok(await post('/api/hrm/clock-in', { employeeId: emp2.id, location: { latitude: 11.34, longitude: 77.71, accuracy: 12, addressHint: 'Live' } }), 'with GPS');
    const rec2 = ok(await get('/api/attendance-records')).find((a) => a.employeeId === emp2.id);
    assert.deepEqual(rec2.checkInLocation, { latitude: 11.34, longitude: 77.71, accuracy: 12, addressHint: 'Live' });
  });

  test('HRM6-4 disabling and re-enabling a login keeps clock-in working', async () => {
    const { emp } = await newEmployee();
    let user;
    for (let i = 0; i < 20 && !user; i++) {
      const pin = String(1000 + Math.floor(Math.random() * 9000));
      const r = await post('/api/staff/login', { employeeId: emp.id, role: 'Billing', name: emp.name, pin, assignedBranchId: 'erode-hq' });
      if (r.status === 409) continue;
      user = ok(r, 'enable login');
    }
    ok(await put(`/api/users/${user.id}`, { status: 'disabled' }), 'disable');
    ok(await put(`/api/users/${user.id}`, { status: 'active' }), 're-enable');
    const stored = ok(await get(`/api/employees/${emp.id}`));
    assert.equal(stored.status, 'Active');
    ok(await post('/api/hrm/clock-in', { employeeId: emp.id, customTime: '09:00:00' }), 'clock-in after re-enable');
  });

  // Runs last in this file: it resets the demo data.
  test('HRM3-8 after Reset Demo Data, Billing can still clock in', async () => {
    ok(await post('/api/admin/reseed', {}), 'reseed');
    const res = await api('POST', '/api/attendance/self-clock', { as: 'Billing', body: { photo: null, location: null } });
    ok(res, 'Billing self check-in');
    assert.ok(['in', 'out', 'done'].includes(res.body.action));
  });
});

describe('payroll branch scope', () => {
  test('PAYROLL-BRANCH a Manager with payroll rights acts only on their own branch staff; the CEO on all', async () => {
    const matrix = ok(await get('/api/access-matrix'));
    const original = JSON.parse(JSON.stringify(matrix));
    const m = matrix.matrix || matrix;
    try {
      // Give the Manager role payroll rights for this test only.
      m.Manager.caps = [...new Set([...(m.Manager.caps || []), 'payroll:admin'])];
      ok(await put('/api/access-matrix', m), 'grant payroll:admin to Manager');
      const { emp: erodeEmp } = await newEmployee('erode-hq');
      const { emp: cbeEmp } = await newEmployee('coimbatore');
      const month = '2026-02';
      const adj = (emp) => ({ employeeId: emp.id, month, adjustment: 300, reason: 'QA', standardHoursPerMonth: 208 });

      expectStatus(await post('/api/hrm/payroll-adjustment', adj(erodeEmp), 'Manager'), 403, 'Coimbatore Manager adjusts Erode pay');
      const erodeRow = await draftRow(erodeEmp, month); // CEO may
      expectStatus(await post('/api/hrm/payroll-paid', { payrollId: erodeRow.id, paymentMode: 'Bank', record: { ...erodeRow } }, 'Manager'), 403, 'Coimbatore Manager pays Erode staff');
      // A computed (not yet stored) row for another branch's employee is refused too.
      expectStatus(await post('/api/hrm/payroll-paid', { payrollId: `calc-${uid()}`, paymentMode: 'Bank', record: { ...erodeRow, id: undefined, month: '2026-01', branchId: 'coimbatore' } }, 'Manager'), 403, 'forged branch on a computed row');
      assert.equal(ok(await get('/api/payroll-records')).find((p) => p.id === erodeRow.id).status, 'Draft', 'Erode row untouched');

      const snap = ok(await post('/api/hrm/payroll-adjustment', adj(cbeEmp), 'Manager'), 'own branch adjustment');
      const cbeRow = snap.payrollRecords.find((p) => p.employeeId === cbeEmp.id && p.month === month);
      assert.ok(cbeRow, 'own branch row saved');
      assert.ok(snap.payrollRecords.every((p) => p.branchId === 'coimbatore'), 'the reply carries only Coimbatore payroll');
      ok(await post('/api/hrm/payroll-paid', { payrollId: cbeRow.id, paymentMode: 'Bank', record: { ...cbeRow } }, 'Manager'), 'own branch Mark Paid');
    } finally {
      ok(await put('/api/access-matrix', original.matrix || original), 'restore matrix');
    }
  });
});
