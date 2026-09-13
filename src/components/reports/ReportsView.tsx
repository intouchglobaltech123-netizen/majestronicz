import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BranchScope, BRANCHES } from '../../types';
import {
  BarChart3,
  Receipt,
  PieChart,
  Boxes,
  TrendingUp,
  ShoppingBag,
  Users,
  Calendar,
  Building,
  Landmark,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { SalesReportTab } from './SalesReportTab';
import { GstReportTab } from './GstReportTab';
import { BranchPnlReportTab } from './BranchPnlReportTab';
import { StockValuationReportTab } from './StockValuationReportTab';
import { EnquiryConversionReportTab } from './EnquiryConversionReportTab';
import { PurchaseOrderStatusReportTab } from './PurchaseOrderStatusReportTab';
import { PayrollSummaryReportTab } from './PayrollSummaryReportTab';

export type ReportTabType =
  | 'sales'
  | 'pnl'
  | 'stock-valuation'
  | 'enquiry-conversion'
  | 'purchase-orders'
  | 'gst'
  | 'payroll';

export const ReportsView: React.FC = () => {
  const {
    currentBranch,
    currentUser,
    canViewPayrollReport,
  } = useErp();

  // Active Report Tab
  const [activeTab, setActiveTab] = useState<ReportTabType>('sales');

  // Universal Date Range state (Default to Current Month September 2026)
  const [startDate, setStartDate] = useState<string>('2026-09-01');
  const [endDate, setEndDate] = useState<string>('2026-09-30');
  const [activePreset, setActivePreset] = useState<'month' | 'today' | '30days' | 'all'>('month');

  // Branch scope filter inside reports (inherits global branch by default)
  const managerBranch = currentUser.role === 'Manager' ? (currentUser.assignedBranchId || 'erode-hq') : undefined;
  const [branchScope, setBranchScope] = useState<BranchScope>(() => {
    if (managerBranch) return managerBranch;
    return currentBranch;
  });

  // Date Range Presets
  const applyPreset = (preset: 'month' | 'today' | '30days' | 'all') => {
    setActivePreset(preset);
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (preset === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'month') {
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      // Last day of current month
      const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
      setStartDate(`${year}-${month}-01`);
      setEndDate(`${year}-${month}-${String(lastDay).padStart(2, '0')}`);
    } else if (preset === '30days') {
      const prior = new Date();
      prior.setDate(prior.getDate() - 30);
      setStartDate(prior.toISOString().split('T')[0]);
      setEndDate(today);
    } else if (preset === 'all') {
      setStartDate('2026-01-01');
      setEndDate('2026-12-31');
    }
  };

  // Report tab configuration
  const tabs = [
    { id: 'sales' as const, label: 'Sales Report', icon: Receipt, description: 'Invoices, payment modes, and top products' },
    { id: 'pnl' as const, label: 'Branch-Wise P&L', icon: PieChart, description: 'Sales vs register operating expenses' },
    { id: 'stock-valuation' as const, label: 'Stock Valuation', icon: Boxes, description: 'Physical asset costs and retail margins' },
    { id: 'enquiry-conversion' as const, label: 'Enquiry Conversion', icon: TrendingUp, description: 'Funnel velocity and open pending orders' },
    { id: 'purchase-orders' as const, label: 'PO Procurement', icon: ShoppingBag, description: 'Vendor fulfillment and overdue orders' },
    { id: 'gst' as const, label: 'GST Summary', icon: Landmark, description: 'GSTR-1 / 3B rate-wise & HSN tax report' },
    ...(canViewPayrollReport
      ? [{ id: 'payroll' as const, label: 'Payroll Summary', icon: Users, description: 'Staff compensation and labor spend' }]
      : []),
  ];

  return (
    <div className="p-6 space-y-6 w-full">
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Reports
              </h1>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                Live Analytics
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Operational performance, branch comparisons, and CSV data exports.
            </p>
          </div>
        </div>

        {/* Universal Filter Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2.5 w-full md:w-auto">
          {/* Branch Scope Selector */}
          {currentUser.role === 'CEO' ? (
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700">
              <Building className="h-3.5 w-3.5 text-blue-600" />
              <select
                value={branchScope}
                onChange={(e) => setBranchScope(e.target.value as BranchScope)}
                className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer"
              >
                <option value="all">All Branches</option>
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.shortCode})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-800">
              <Building className="h-3.5 w-3.5 text-blue-600" />
              <span>{BRANCHES.find((b) => b.id === branchScope)?.name || branchScope}</span>
            </div>
          )}

          {/* Quick Date Range Preset Pills */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs font-bold">
            <button
              onClick={() => applyPreset('month')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                activePreset === 'month' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              This Month
            </button>
            <button
              onClick={() => applyPreset('today')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                activePreset === 'today' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Today
            </button>
            <button
              onClick={() => applyPreset('30days')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                activePreset === '30days' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Last 30D
            </button>
            <button
              onClick={() => applyPreset('all')}
              className={cn(
                'px-2.5 py-1 rounded-lg transition-all',
                activePreset === 'all' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              )}
            >
              Full Year
            </button>
          </div>
        </div>
      </div>

      {/* Date Range Precision Inputs */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-slate-600 font-semibold">
          <Calendar className="h-4 w-4 text-blue-600" />
          <span>Active Filter Date Window:</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200">
            <span className="text-[10px] uppercase font-bold text-slate-400">From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setActivePreset('month'); // custom override
              }}
              className="bg-transparent font-bold text-slate-800 text-xs focus:outline-none"
            />
          </div>

          <span className="text-slate-400 font-bold">to</span>

          <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200">
            <span className="text-[10px] uppercase font-bold text-slate-400">To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setActivePreset('month'); // custom override
              }}
              className="bg-transparent font-bold text-slate-800 text-xs focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Report Module Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2.5 px-4 py-3 rounded-2xl text-xs font-bold transition-all shrink-0 border',
                isActive
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs ring-2 ring-blue-500/20'
                  : 'bg-white text-slate-700 hover:text-slate-900 hover:bg-slate-50 border-slate-200'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-white' : 'text-slate-500')} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Tab View Body */}
      <div className="animate-in fade-in duration-200">
        {activeTab === 'sales' && (
          <SalesReportTab
            startDate={startDate}
            endDate={endDate}
            branchScope={branchScope}
          />
        )}

        {activeTab === 'pnl' && (
          <BranchPnlReportTab
            startDate={startDate}
            endDate={endDate}
            branchScope={branchScope}
          />
        )}

        {activeTab === 'stock-valuation' && (
          <StockValuationReportTab
            branchScope={branchScope}
          />
        )}

        {activeTab === 'enquiry-conversion' && (
          <EnquiryConversionReportTab
            startDate={startDate}
            endDate={endDate}
            branchScope={branchScope}
          />
        )}

        {activeTab === 'purchase-orders' && (
          <PurchaseOrderStatusReportTab
            startDate={startDate}
            endDate={endDate}
            branchScope={branchScope}
          />
        )}

        {activeTab === 'gst' && (
          <GstReportTab
            startDate={startDate}
            endDate={endDate}
            branchScope={branchScope}
          />
        )}

        {activeTab === 'payroll' && canViewPayrollReport && (
          <PayrollSummaryReportTab
            branchScope={branchScope}
          />
        )}
      </div>
    </div>
  );
};
