// Staff, attendance, kiosk PINs and payroll.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { post, get, ok, expectStatus, near, uid, together, sql } from './lib.mjs';

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

  test('HRM3-1 clock-in and clock-out work and record hours', async () => {
    const { emp } = await newEmployee();
    ok(await post('/api/hrm/clock-in', { employeeId: emp.id, location: { lat: 11.34, lng: 77.71 }, customTime: '09:00:00' }), 'in');
    expectStatus(await post('/api/hrm/clock-in', { employeeId: emp.id, customTime: '09:05:00' }), 409, 'second clock-in');
    const snap = ok(await post('/api/hrm/clock-out', { employeeId: emp.id, location: { lat: 11.34, lng: 77.71 }, customTime: '17:30:00' }), 'out');
    const rec = snap.attendanceRecords.find((a) => a.employeeId === emp.id);
    near(rec.hoursWorked, 8.5);
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
});
