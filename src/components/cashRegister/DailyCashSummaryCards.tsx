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
  Smartphone,
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
      {/* HERO CARD: Clean Light-Themed Physical Drawer Closing Balance */}
      <div className="p-6 rounded-3xl bg-white border border-slate-200 shadow-xs relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                className={`text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                  isClosed
                    ? 'bg-slate-100 text-slate-700 border-slate-300'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                {isClosed ? (
                  <>
                    <Lock className="h-3 w-3 text-slate-600" />
                    <span>Locked Closing Cash</span>
                  </>
                ) : (
                  <>
                    <Unlock className="h-3 w-3 text-blue-600 animate-pulse" />
                    <span>Live Physical Drawer Count</span>
                  </>
                )}
              </span>
              <span className="text-xs text-slate-500 font-medium">
                • {branchName}
              </span>
            </div>

            <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-500">
              Drawer Physical Cash (Closing Balance)
            </h2>
            <div className="text-3xl lg:text-4xl font-bold tracking-tight text-blue-600 mt-1">
              {formatCurrency(closingBalance)}
            </div>

            {/* Clear Formula Breakdown Callout (Light Theme) */}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-mono bg-slate-50 border border-slate-200/80 px-3.5 py-2 rounded-xl text-slate-600">
              <span className="font-bold text-slate-700">Tally Formula:</span>
              <span className="font-semibold text-slate-800">
                ₹{openingAmount.toLocaleString('en-IN')} (Opening)
              </span>
              <span className="text-emerald-600 font-bold">+</span>
              <span className="font-semibold text-emerald-700">
                ₹{cashSales.toLocaleString('en-IN')} (Cash Sales)
              </span>
              <span className="text-rose-600 font-bold">-</span>
              <span className="font-semibold text-rose-700">
                ₹{cashExpenses.toLocaleString('en-IN')} (Cash Exp)
              </span>
              <span className="text-slate-400 font-bold">=</span>
              <span className="font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                ₹{closingBalance.toLocaleString('en-IN')} In Drawer
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 italic">
              * Excludes HDFC, GPay &amp; Credit sales (they do not sit in the physical drawer).
            </p>
          </div>

          <div className="hidden lg:flex items-center justify-center p-4 rounded-xl bg-blue-50/60 border border-blue-100 text-blue-600 shrink-0">
            <WalletCards className="w-16 h-16 opacity-80" />
          </div>
        </div>

        {/* Collection mix — how today's revenue splits across channels */}
        {(() => {
          const total = Math.max(1, cashSales + bankDigitalTotal + creditTotal);
          const seg = [
            { label: 'Cash', amount: cashSales, color: 'bg-emerald-500', text: 'text-emerald-700' },
            { label: 'Digital / Bank', amount: bankDigitalTotal, color: 'bg-purple-500', text: 'text-purple-700' },
            { label: 'Credit', amount: creditTotal, color: 'bg-indigo-500', text: 'text-indigo-700' },
          ];
          return (
            <div className="mt-5 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Today's Collection Mix</span>
                <span className="text-[11px] font-bold text-slate-700 font-mono">{formatCurrency(cashSales + bankDigitalTotal + creditTotal)}</span>
              </div>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
                {seg.map((s) => (
                  <div key={s.label} className={s.color} style={{ width: `${(s.amount / total) * 100}%` }} title={`${s.label}: ${formatCurrency(s.amount)}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
                {seg.map((s) => (
                  <span key={s.label} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                    <span className={`h-2 w-2 rounded-full ${s.color}`} />
                    {s.label} <span className={`font-mono font-bold ${s.text}`}>{formatCurrency(s.amount)}</span>
                    <span className="text-slate-400">· {Math.round((s.amount / total) * 100)}%</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      {/* CONSOLIDATED ROW OF 5 AUDIT STAT CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Opening Amount */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Opening Amount</span>
            <div className="h-8 w-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Building className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              {formatCurrency(openingAmount)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
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

        {/* Card 2: Cash Sales (Physical Inflow) */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Cash Sales (Drawer Inflow)</span>
            <div className="h-8 w-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold text-emerald-700 tracking-tight">
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

        {/* Card 3: Total Day Expenses */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Total Day Expenses</span>
            <div className="h-8 w-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
              <ArrowDownRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold text-rose-700 tracking-tight">
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

        {/* Card 4: COD / Credit Sales */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">COD / Credit Sales</span>
            <div className="h-8 w-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold text-indigo-900 tracking-tight">
              {formatCurrency(creditTotal)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Accounts receivable / pending
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Collected:</span>
            <span className="font-semibold text-indigo-700">Due later</span>
          </div>
        </div>

        {/* Card 5: Digital / Bank Total */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Digital / Bank Total</span>
            <div className="h-8 w-8 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
              <Smartphone className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xl sm:text-2xl font-bold text-purple-700 tracking-tight">
              {formatCurrency(bankDigitalTotal)}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              HDFC + GPay Invoices
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Payment route:</span>
            <span className="font-semibold text-purple-700">Bank deposit</span>
          </div>
        </div>
      </div>
    </div>
  );
};
