import React, { useState } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  CheckCircle2,
  Users,
  LogIn,
  LogOut,
  Camera,
  AlertTriangle,
} from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { GeoLocationCapture, BRANCHES, BranchScope } from '../../types';
import { PhotoLightboxModal } from './PhotoLightboxModal';
import { AttendanceKioskModal } from './AttendanceKioskModal';

export const AttendanceLogView: React.FC = () => {
  const {
    employees,
    attendanceRecords,
    currentBranch,
    currentUser,
  } = useErp();

  // Filters
  const [selectedMonth, setSelectedMonth] = useState('2026-09');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [branchFilter, setBranchFilter] = useState<BranchScope>(currentBranch);

  // Lightbox modal state
  const [lightboxData, setLightboxData] = useState<{
    isOpen: boolean;
    photoUrl: string | null;
    title: string;
    timestamp?: string;
    date?: string;
    location?: GeoLocationCapture;
  }>({
    isOpen: false,
    photoUrl: null,
    title: '',
  });

  // Kiosk Modal trigger
  const [isKioskOpen, setIsKioskOpen] = useState(false);

  // Employees available based on branch and role
  const branchEmployees = employees.filter((e) => {
    if (currentUser.role === 'Manager') {
      const managerBranch = currentUser.assignedBranchId || 'coimbatore';
      return e.branchId === managerBranch;
    }
    const effectiveScope = branchFilter === 'all' ? null : branchFilter;
    if (effectiveScope && e.branchId !== effectiveScope) return false;
    return true;
  });

  // Filter attendance records
  const filteredRecords = attendanceRecords.filter((rec) => {
    if (!rec.date.startsWith(selectedMonth)) return false;
    if (selectedEmployeeId !== 'all' && rec.employeeId !== selectedEmployeeId) return false;

    // Check branch
    const emp = employees.find((e) => e.id === rec.employeeId);
    if (!emp) return false;

    if (currentUser.role === 'Manager') {
      const managerBranch = currentUser.assignedBranchId || 'coimbatore';
      if (emp.branchId !== managerBranch) return false;
    } else if (branchFilter !== 'all' && emp.branchId !== branchFilter) {
      return false;
    }

    return true;
  });

  // Calculate high-level summary metrics
  const totalShifts = filteredRecords.length;
  const totalHours = filteredRecords.reduce((sum, r) => sum + (r.hoursWorked || 0), 0);
  const averageHoursPerShift = totalShifts > 0 ? (totalHours / totalShifts).toFixed(1) : '0';

  const openLightbox = (
    photoUrl: string,
    title: string,
    timestamp?: string,
    date?: string,
    location?: GeoLocationCapture
  ) => {
    setLightboxData({
      isOpen: true,
      photoUrl,
      title,
      timestamp,
      date,
      location,
    });
  };

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
        {/* Month Selector & Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Select Pay Period / Month
            </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-300 bg-white text-slate-800 focus:outline-hidden focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Staff Filter
            </label>
            <select
              value={selectedEmployeeId}
              onChange={(e) => setSelectedEmployeeId(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium rounded-xl border border-slate-300 bg-white text-slate-800 focus:outline-hidden focus:border-blue-500 min-w-[180px]"
            >
              <option value="all">All Staff ({branchEmployees.length})</option>
              {branchEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.designation})
                </option>
              ))}
            </select>
          </div>

          {currentUser.role !== 'Manager' && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Branch Scope
              </label>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value as BranchScope)}
                className="px-3 py-1.5 text-xs font-medium rounded-xl border border-slate-300 bg-white text-slate-800 focus:outline-hidden focus:border-blue-500"
              >
                <option value="all">All Branches</option>
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Quick Kiosk Launch Button */}
        <button
          onClick={() => setIsKioskOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-xs transition-colors shrink-0"
        >
          <Camera className="h-4 w-4" />
          <span>Clock-In / Out Terminal</span>
        </button>
      </div>

      {/* Summary Stat Pills */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Recorded Shifts</p>
            <p className="text-lg font-black text-slate-900 font-mono">{totalShifts} Days Present</p>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Hours Worked</p>
            <p className="text-lg font-black text-slate-900 font-mono">{totalHours.toFixed(1)} hrs</p>
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Average Shift</p>
            <p className="text-lg font-black text-slate-900 font-mono">{averageHoursPerShift} hrs/day</p>
          </div>
        </div>
      </div>

      {/* Attendance Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 text-xs font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Employee</th>
                <th className="py-3 px-4">Check-In Verification</th>
                <th className="py-3 px-4">Check-Out Verification</th>
                <th className="py-3 px-3 text-right">Hours Worked</th>
                <th className="py-3 px-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <CalendarIcon className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                    <p className="text-sm font-medium text-slate-600">No attendance entries for this period</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Use the Clock-In Terminal to record selfie and GPS verified shifts
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRecords.map((rec) => {
                  const emp = employees.find((e) => e.id === rec.employeeId);
                  const branchObj = BRANCHES.find((b) => b.id === rec.branchId);

                  return (
                    <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Date */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-900">{rec.date}</div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(rec.date).toLocaleDateString('en-GB', { weekday: 'short' })}
                        </div>
                      </td>

                      {/* Employee */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{rec.employeeName}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                          <span>{emp?.designation || 'Staff'}</span>
                          <span className="text-slate-300">•</span>
                          <span className="text-slate-400">{branchObj?.name}</span>
                        </div>
                      </td>

                      {/* Check-In Details */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {/* Thumbnail with click to open lightbox */}
                          <button
                            type="button"
                            onClick={() =>
                              openLightbox(
                                rec.checkInPhoto,
                                `${rec.employeeName} (Check-In)`,
                                rec.checkInTime,
                                rec.date,
                                rec.checkInLocation
                              )
                            }
                            className="relative group h-11 w-11 rounded-lg overflow-hidden border border-slate-300 shadow-2xs shrink-0 cursor-pointer"
                            title="Click to view full photo"
                          >
                            <img
                              src={rec.checkInPhoto}
                              alt="Check-in selfie"
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
                            />
                            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors flex items-center justify-center">
                              <LogIn className="h-3 w-3 text-white drop-shadow-sm" />
                            </div>
                          </button>

                          {/* Time & Map Link */}
                          <div className="space-y-0.5 text-xs">
                            <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                              <Clock className="h-3 w-3 text-blue-600" />
                              <span>{rec.checkInTime}</span>
                            </div>
                            <a
                              href={`https://www.google.com/maps?q=${rec.checkInLocation.latitude},${rec.checkInLocation.longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-1 truncate max-w-[170px]"
                              title={`${rec.checkInLocation.addressHint} (${rec.checkInLocation.latitude.toFixed(4)}, ${rec.checkInLocation.longitude.toFixed(4)})`}
                            >
                              <MapPin className="h-3 w-3 text-rose-500 shrink-0" />
                              <span className="truncate">{rec.checkInLocation.addressHint || 'Map GPS'}</span>
                            </a>
                          </div>
                        </div>
                      </td>

                      {/* Check-Out Details */}
                      <td className="py-3 px-4">
                        {rec.checkOutTime && rec.checkOutPhoto ? (
                          <div className="flex items-center gap-3">
                            {/* Thumbnail */}
                            <button
                              type="button"
                              onClick={() =>
                                openLightbox(
                                  rec.checkOutPhoto!,
                                  `${rec.employeeName} (Check-Out)`,
                                  rec.checkOutTime,
                                  rec.date,
                                  rec.checkOutLocation
                                )
                              }
                              className="relative group h-11 w-11 rounded-lg overflow-hidden border border-slate-300 shadow-2xs shrink-0 cursor-pointer"
                              title="Click to view full photo"
                            >
                              <img
                                src={rec.checkOutPhoto}
                                alt="Check-out selfie"
                                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"
                              />
                              <div className="absolute inset-0 bg-black/20 group-hover:bg-black/0 transition-colors flex items-center justify-center">
                                <LogOut className="h-3 w-3 text-white drop-shadow-sm" />
                              </div>
                            </button>

                            {/* Time & Map Link */}
                            <div className="space-y-0.5 text-xs">
                              <div className="font-mono font-bold text-slate-900 flex items-center gap-1.5">
                                <Clock className="h-3 w-3 text-emerald-600" />
                                <span>{rec.checkOutTime}</span>
                              </div>
                              {rec.checkOutLocation && (
                                <a
                                  href={`https://www.google.com/maps?q=${rec.checkOutLocation.latitude},${rec.checkOutLocation.longitude}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-emerald-700 hover:text-emerald-900 flex items-center gap-1 truncate max-w-[170px]"
                                  title={`${rec.checkOutLocation.addressHint} (${rec.checkOutLocation.latitude.toFixed(4)}, ${rec.checkOutLocation.longitude.toFixed(4)})`}
                                >
                                  <MapPin className="h-3 w-3 text-rose-500 shrink-0" />
                                  <span className="truncate">{rec.checkOutLocation.addressHint || 'Map GPS'}</span>
                                </a>
                              )}
                            </div>
                          </div>
                        ) : (
                          // A missing check-out on a PAST day is a stale shift (needs
                          // correction) — not a live "in progress" one.
                          (rec.date || '') < new Date().toISOString().slice(0, 10) ? (
                            <span className="text-xs text-rose-700 bg-rose-50 px-2 py-1 rounded-md border border-rose-200 font-bold inline-flex items-center gap-1" title="No check-out recorded — correct before running payroll">
                              <AlertTriangle className="h-3 w-3" />
                              <span>Missing check-out</span>
                            </span>
                          ) : (
                            <span className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-md border border-amber-200 font-medium inline-flex items-center gap-1">
                              <Clock className="h-3 w-3 animate-spin" />
                              <span>Shift In Progress</span>
                            </span>
                          )
                        )}
                      </td>

                      {/* Hours Worked */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-900">
                        {rec.hoursWorked ? (
                          <span>{rec.hoursWorked.toFixed(2)} hrs</span>
                        ) : (
                          <span className="text-slate-400 font-sans text-xs italic">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Present</span>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lightbox Modal */}
      <PhotoLightboxModal
        isOpen={lightboxData.isOpen}
        onClose={() => setLightboxData((prev) => ({ ...prev, isOpen: false }))}
        photoUrl={lightboxData.photoUrl}
        title={lightboxData.title}
        timestamp={lightboxData.timestamp}
        date={lightboxData.date}
        location={lightboxData.location}
      />

      {/* Attendance Kiosk Modal */}
      <AttendanceKioskModal
        isOpen={isKioskOpen}
        onClose={() => setIsKioskOpen(false)}
      />
    </div>
  );
};
