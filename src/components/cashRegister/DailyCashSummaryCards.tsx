import React from 'react';
import { formatCurrency } from '../../lib/utils';
import {
  WalletCards,
  ArrowDownRight,
  TrendingUp,
  CreditCard,
  Edit2,
  Lock,
  Unlock,
  Building,
} from 'lucide-react';

interface Props {
  openingAmount: number;
  isOpeningOverridden?: boolean;
  overrideReason?: string;
  cashSales: number;
  cashExpenses: number;
  gpayExpenses: number;
  closingBalance: number;
  totalDayRevenue: number;
  bankDigitalTotal: number;
  creditTotal: number;
  isClosed: boolean;
  canOverrideOpening: boolean;
  onOpenOverrideModal: () => void;
  branchName: string;
}

export const DailyCashSummaryCards: React.FC<Props> = ({
  openingAmount,
  isOpeningOverridden,
  cashSales,
  cashExpenses,
  gpayExpenses,
  closingBalance,
  totalDayRevenue,
  bankDigitalTotal,
  creditTotal,
  isClosed,
  canOverrideOpening,
  onOpenOverrideModal,
  branchName,
}) => {
  const totalExpenses = cashExpenses + gpayExpenses;

  return (
    <div className="space-y-4">
      {/* HERO CARD: Prominent Physical Drawer Closing Balance */}
      <div className="p-6 rounded-3xl bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 text-white shadow-lg relative overflow-hidden border border-blue-700/50">
        {/* Subtle Background Graphic Rings */}
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute top-0 right-0 p-6 opacity-10">
          <WalletCards className="w-32 h-32" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-extrabold uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-blue-400/20 text-blue-200 border border-blue-400/30 flex items-center gap-1.5">
                {isClosed ? (
                  <>
                    <Lock className="h-3 w-3 text-emerald-400" />
                    <span>LOCKED CLOSING CASH</span>
                  </>
                ) : (
                  <>
                    <Unlock className="h-3 w-3 text-amber-300 animate-pulse" />
                    <span>LIVE PHYSICAL DRAWER COUNT</span>
                  </>
                )}
              </span>
              <span className="text-xs text-blue-200/80 font-medium">
                • {branchName}
              </span>
            </div>

            <h2 className="text-sm font-semibold text-blue-100">
              Drawer Physical Cash (Closing Balance)
            </h2>
            <div className="text-4xl md:text-5xl font-black tracking-tight text-white mt-1">
              {formatCurrency(closingBalance)}
            </div>

            {/* Clear Formula Breakdown Callout */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-mono text-blue-100/90 bg-blue-950/60 backdrop-blur-xs px-3.5 py-2 rounded-xl border border-blue-500/30">
              <span className="text-blue-300 font-semibold">Tally Formula:</span>
              <span>₹{openingAmount.toLocaleString('en-IN')} (Opening)</span>
              <span className="text-emerald-400 font-bold">+</span>
              <span className="text-emerald-300 font-semibold">₹{cashSales.toLocaleString('en-IN')} (Cash Sales)</span>
              <span className="text-rose-400 font-bold">-</span>
              <span className="text-rose-300 font-semibold">₹{cashExpenses.toLocaleString('en-IN')} (Cash Exp)</span>
              <span className="text-blue-300 font-bold">=</span>
              <strong className="text-white font-black underline decoration-blue-400">
                ₹{closingBalance.toLocaleString('en-IN')} In Drawer
              </strong>
            </div>
            <p className="text-[11px] text-blue-200/70 mt-1.5 italic">
              * Excludes HDFC, GPay & Credit sales (they do not sit in the physical drawer).
            </p>
          </div>

          {/* Quick Metrics Pillar */}
          <div className="grid grid-cols-2 gap-3 w-full md:w-auto shrink-0 bg-white/5 backdrop-blur-xs p-4 rounded-2xl border border-white/10">
            <div>
              <span className="text-[10px] text-blue-200 uppercase tracking-wider font-bold block">
                Total Day Sales
              </span>
              <span className="text-lg font-bold text-white block">
                {formatCurrency(totalDayRevenue)}
              </span>
              <span className="text-[10px] text-blue-300/80">All 4 payment modes</span>
            </div>
            <div>
              <span className="text-[10px] text-blue-200 uppercase tracking-wider font-bold block">
                Digital / Bank Total
              </span>
              <span className="text-lg font-bold text-emerald-300 block">
                {formatCurrency(bankDigitalTotal)}
              </span>
              <span className="text-[10px] text-blue-300/80">HDFC + GPay Invoices</span>
            </div>
          </div>
        </div>
      </div>

      {/* SECONDARY ROW OF AUDIT METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Opening Amount */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Opening Amount</span>
            <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Building className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-slate-900 tracking-tight">
              {formatCurrency(openingAmount)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
              {isOpeningOverridden ? (
                <span className="text-amber-700 font-bold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                  Manually Overridden
                </span>
              ) : (
                <span>Carried from yesterday's close</span>
              )}
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">First-day / Audit cash</span>
            {canOverrideOpening && !isClosed && (
              <button
                type="button"
                onClick={onOpenOverrideModal}
                className="text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 transition-colors"
              >
                <Edit2 className="h-3 w-3" />
                <span>Override</span>
              </button>
            )}
          </div>
        </div>

        {/* Card 2: Cash Invoices (Physical Inflow) */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Cash Sales (Drawer Inflow)</span>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-emerald-700 tracking-tight">
              +{formatCurrency(cashSales)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Physical cash collected from bills
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Payment mode:</span>
            <span className="font-bold text-emerald-700 font-mono">CASH ONLY</span>
          </div>
        </div>

        {/* Card 3: Total Expenses (Cash & Digital Outflow) */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Day Expenses</span>
            <div className="h-8 w-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <ArrowDownRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-rose-700 tracking-tight">
              -{formatCurrency(totalExpenses)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Drawer Cash: <strong>{formatCurrency(cashExpenses)}</strong> • GPay: {formatCurrency(gpayExpenses)}
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Impacts drawer:</span>
            <span className="font-bold text-rose-600 font-mono">Cash portion only</span>
          </div>
        </div>

        {/* Card 4: Non-Cash / Credit Outstanding */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">COD / Credit Sales</span>
            <div className="h-8 w-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-2xl font-black text-indigo-900 tracking-tight">
              {formatCurrency(creditTotal)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Accounts receivable / pending collection
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Collected:</span>
            <span className="font-semibold text-indigo-700">Due later</span>
          </div>
        </div>
      </div>
    </div>
  );
};
