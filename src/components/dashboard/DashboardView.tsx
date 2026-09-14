import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES, BranchId, getInvoicePaymentSplits, Invoice, computeInvoiceFinance } from '../../types';
import { formatCurrency, cn } from '../../lib/utils';
import {
  TrendingUp, TrendingDown, Boxes, AlertTriangle, Building, ArrowRight, ShieldCheck,
  Building2, Layers, ChevronRight, ArrowDownCircle, ArrowUpCircle, Wallet,
  Receipt, ClipboardList, IndianRupee, Trophy, CreditCard, Banknote, Smartphone, Landmark, AlertOctagon, Percent,
} from 'lucide-react';

// Outstanding due on a single invoice — single source of truth.
const invoiceDue = (inv: Invoice): number => computeInvoiceFinance(inv).due;
const netRevenue = (inv: Invoice) => computeInvoiceFinance(inv).net;
const pct = (cur: number, prev: number) => (prev <= 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100));

const MODE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  Cash: { label: 'Cash', icon: Banknote, color: 'bg-emerald-500' },
  UPI: { label: 'UPI', icon: Smartphone, color: 'bg-blue-500' },
  Card: { label: 'Card', icon: CreditCard, color: 'bg-violet-500' },
  'Bank Transfer': { label: 'Bank', icon: Landmark, color: 'bg-cyan-500' },
  'COD-Credit': { label: 'Credit', icon: ClipboardList, color: 'bg-amber-500' },
};

export const DashboardView: React.FC = () => {
  const {
    items, branchStocks, currentBranch, isAllBranches, currentBranchData, switchBranch, setCurrentView,
    currentUser, invoices, purchaseOrders, cashRegisters, enquiries, pendingOrders,
    getItemLastSaleInfo, inventorySettings, navigateToInventoryWithMovementFilter,
  } = useErp();

  const [trendHover, setTrendHover] = useState<number | null>(null);
  const [topMetric, setTopMetric] = useState<'revenue' | 'qty'>('revenue');
  const [trendDays, setTrendDays] = useState<7 | 14 | 30>(14);
  const rootRef = useRef<HTMLDivElement>(null);

  // One-time smooth "tour" scroll (down then back up) after a fresh login,
  // so the user sees there's more below the fold. Runs once per login.
  useEffect(() => {
    let flag: string | null = null;
    try { flag = sessionStorage.getItem('mjz_dashboard_tour'); } catch { /* ignore */ }
    if (flag !== '1') return;
    try { sessionStorage.removeItem('mjz_dashboard_tour'); } catch { /* ignore */ }
    const scroller = rootRef.current?.closest('main') as HTMLElement | null;
    if (!scroller) return;
    const t1 = setTimeout(() => {
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      if (maxScroll < 60) return;
      scroller.scrollTo({ top: maxScroll, behavior: 'smooth' });
      setTimeout(() => scroller.scrollTo({ top: 0, behavior: 'smooth' }), 1600);
    }, 700);
    return () => clearTimeout(t1);
  }, []);

  // Item lookups for cost-of-goods / profit.
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const itemByCode = useMemo(() => new Map(items.map((it) => [it.itemCode, it])), [items]);
  const itemByName = useMemo(() => new Map(items.map((it) => [(it.itemName || '').toLowerCase(), it])), [items]);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const lastMonthDate = new Date(); lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);

  const inScope = (branchId: string) => isAllBranches || branchId === currentBranch;
  const scopedSales = useMemo(
    () => invoices.filter((i) => !i.isVoided && inScope(i.branchId)),
    [invoices, isAllBranches, currentBranch]
  );

  // ---- Money & business KPIs ----
  const money = useMemo(() => {
    const dayTotal = (d: string) => scopedSales.filter((i) => i.date === d).reduce((t, i) => t + netRevenue(i), 0);
    const monthTotal = (m: string) => scopedSales.filter((i) => (i.date || '').startsWith(m)).reduce((t, i) => t + netRevenue(i), 0);
    const salesToday = dayTotal(today);
    const salesYest = dayTotal(yesterday);
    const salesMonth = monthTotal(thisMonth);
    const salesPrevMonth = monthTotal(lastMonth);
    const countToday = scopedSales.filter((i) => i.date === today).length;

    const receivables = scopedSales.reduce((t, i) => t + invoiceDue(i), 0);
    const payables = purchaseOrders
      .filter((p) => inScope(p.branchId) && p.status !== 'Cancelled')
      .reduce((t, p) => t + Math.max(0, (p.totalAmount || 0) - (p.amountPaid || 0)), 0);

    // Cash-in-hand (approx): latest register per in-scope branch (opening − expenses) + today's cash sales.
    const branchesInScope = isAllBranches ? BRANCHES.map((b) => b.id) : [currentBranch];
    let cashInHand = 0;
    for (const bId of branchesInScope) {
      const regs = cashRegisters.filter((r) => r.branchId === bId).sort((a, b) => (a.date < b.date ? 1 : -1));
      const latest = regs[0];
      if (latest) {
        const exp = Array.isArray(latest.expenses) ? latest.expenses.reduce((t: number, e: any) => t + (Number(e?.amount) || 0), 0) : 0;
        cashInHand += (latest.openingAmount || 0) - exp;
      }
    }
    const todayCash = scopedSales
      .filter((i) => i.date === today)
      .reduce((t, i) => t + getInvoicePaymentSplits(i).filter((s) => s.mode === 'Cash').reduce((x, s) => x + s.amount, 0), 0);
    cashInHand += todayCash;

    return { salesToday, salesYest, salesMonth, salesPrevMonth, countToday, receivables, payables, cashInHand };
  }, [scopedSales, purchaseOrders, cashRegisters, isAllBranches, currentBranch, today, yesterday, thisMonth, lastMonth]);

  // ---- Profit / margin (this month): revenue − cost of goods sold ----
  const profit = useMemo(() => {
    const monthInv = scopedSales.filter((i) => (i.date || '').startsWith(thisMonth));
    let revenue = 0, cost = 0;
    for (const i of monthInv) {
      revenue += netRevenue(i);
      for (const li of (i.items || []) as any[]) {
        const it = itemById.get(li.itemId) || itemByCode.get(li.itemCode) || itemByName.get((li.itemName || '').toLowerCase());
        cost += (li.quantity || 0) * (it?.purchasePrice || 0);
      }
    }
    return { value: revenue - cost, margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0 };
  }, [scopedSales, thisMonth, itemById, itemByCode, itemByName]);

  // ---- Inventory health ----
  const inv = useMemo(() => {
    let stockValue = 0, lowStock = 0, deadStock = 0;
    items.forEach((item) => {
      const threshold = item.reorderThreshold ?? 10;
      const qty = isAllBranches
        ? branchStocks.filter((s) => s.itemId === item.id).reduce((s2, s) => s2 + s.quantity, 0)
        : branchStocks.find((s) => s.itemId === item.id && s.branchId === currentBranch)?.quantity ?? 0;
      stockValue += qty * (item.purchasePrice || 0);
      if (qty <= threshold) lowStock++;
      if (getItemLastSaleInfo(item.id, isAllBranches ? 'all' : currentBranch).isDeadStock) deadStock++;
    });
    return { stockValue, lowStock, deadStock, totalItems: items.length };
  }, [items, branchStocks, isAllBranches, currentBranch, getItemLastSaleInfo, inventorySettings]);

  // ---- Sales trend (selectable window) ----
  const trend = useMemo(() => {
    const days: { date: string; label: string; total: number }[] = [];
    for (let i = trendDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const total = scopedSales.filter((x) => x.date === d).reduce((t, x) => t + netRevenue(x), 0);
      days.push({ date: d, label: d.slice(5), total });
    }
    const max = Math.max(1, ...days.map((d) => d.total));
    return { days, max };
  }, [scopedSales, trendDays]);

  // ---- Payment mode split (this month) — ACTUAL collections only ----
  // An invoice contributes only the amount actually received (billed − due − returns),
  // distributed across its real (non-credit) payment modes. Unpaid/credit bills = ₹0.
  const modeSplit = useMemo(() => {
    const map: Record<string, number> = {};
    scopedSales.filter((i) => (i.date || '').startsWith(thisMonth)).forEach((i) => {
      const paid = Math.max(0, netRevenue(i) - invoiceDue(i));
      if (paid <= 0) return;
      const splits = getInvoicePaymentSplits(i).filter((s) => s.mode !== 'COD-Credit');
      const splitTotal = splits.reduce((t, s) => t + s.amount, 0);
      if (splitTotal <= 0) {
        const mode = i.paymentMode && i.paymentMode !== 'COD-Credit' ? i.paymentMode : 'Cash';
        map[mode] = (map[mode] || 0) + paid;
      } else {
        splits.forEach((s) => { map[s.mode] = (map[s.mode] || 0) + paid * (s.amount / splitTotal); });
      }
    });
    const rows = Object.entries(map).map(([mode, amount]) => ({ mode, amount, meta: MODE_META[mode] || { label: mode, icon: Wallet, color: 'bg-slate-400' } }))
      .sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((t, r) => t + r.amount, 0) || 1;
    return { rows, total };
  }, [scopedSales, thisMonth]);

  // ---- Top products (this month) ----
  const topProducts = useMemo(() => {
    const map: Record<string, { name: string; qty: number; revenue: number }> = {};
    scopedSales.filter((i) => (i.date || '').startsWith(thisMonth)).forEach((i) => {
      (i.items || []).forEach((li: any) => {
        const key = li.itemName || li.itemCode || 'Item';
        if (!map[key]) map[key] = { name: key, qty: 0, revenue: 0 };
        map[key].qty += li.quantity || 0;
        map[key].revenue += li.totalAmount || 0;
      });
    });
    const rows = Object.values(map).sort((a, b) => (topMetric === 'revenue' ? b.revenue - a.revenue : b.qty - a.qty)).slice(0, 5);
    const max = Math.max(1, ...rows.map((r) => (topMetric === 'revenue' ? r.revenue : r.qty)));
    return { rows, max };
  }, [scopedSales, thisMonth, topMetric]);

  const recentSales = useMemo(
    () => [...scopedSales].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 6),
    [scopedSales]
  );

  const salesTodayDelta = pct(money.salesToday, money.salesYest);
  const salesMonthDelta = pct(money.salesMonth, money.salesPrevMonth);

  return (
    <div ref={rootRef} className="p-6 space-y-5 w-full">
      {/* Header */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
            {isAllBranches ? <Layers className="h-6 w-6" /> : <Building className="h-6 w-6" />}
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 tracking-tight">
              {isAllBranches ? 'Business Overview — All Branches' : `${currentBranchData?.name} Dashboard`}
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">
              Live snapshot of sales, money flow, and stock health {isAllBranches ? 'across all branches.' : `for ${currentBranchData?.location}.`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isAllBranches && currentUser.role === 'CEO' && (
            <button onClick={() => switchBranch('all')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors">
              ← All Branches
            </button>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-600">
            {currentUser.role === 'CEO' ? <ShieldCheck className="h-4 w-4 text-amber-600" /> : <Building2 className="h-4 w-4 text-blue-600" />}
            <span><strong>{currentUser.name}</strong></span>
          </div>
        </div>
      </div>

      {/* ---- Money KPI row ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard label="Today's Sales" value={formatCurrency(money.salesToday)} sub={`${money.countToday} bill${money.countToday === 1 ? '' : 's'}`}
          icon={IndianRupee} tone="blue" delta={salesTodayDelta} deltaLabel="vs yesterday" onClick={() => setCurrentView('invoices')} />
        <KpiCard label="This Month" value={formatCurrency(money.salesMonth)} sub="net of returns"
          icon={TrendingUp} tone="indigo" delta={salesMonthDelta} deltaLabel="vs last month" onClick={() => setCurrentView('invoices')} />
        <KpiCard label="Profit (Month)" value={formatCurrency(profit.value)} sub={`${profit.margin}% margin`}
          icon={Percent} tone="emerald" onClick={() => setCurrentView('reports')} />
        <KpiCard label="To Collect" value={formatCurrency(money.receivables)} sub="customer dues"
          icon={ArrowDownCircle} tone="amber" onClick={() => setCurrentView('customers')} accent={money.receivables > 0} />
        <KpiCard label="To Pay" value={formatCurrency(money.payables)} sub="supplier dues"
          icon={ArrowUpCircle} tone="rose" onClick={() => setCurrentView('purchases')} accent={money.payables > 0} />
        <KpiCard label="Cash in Hand" value={formatCurrency(money.cashInHand)} sub="approx · registers"
          icon={Wallet} tone="cyan" onClick={() => setCurrentView('cash-register')} />
        <KpiCard label="Stock Value" value={formatCurrency(inv.stockValue)} sub={`${inv.totalItems} items`}
          icon={Boxes} tone="slate" onClick={() => setCurrentView('inventory')} />
      </div>

      {/* ---- Charts row ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sales trend (14 days) */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">Sales — Last {trendDays} Days</h3>
              <p className="text-[11px] text-slate-500">
                Total {formatCurrency(trend.days.reduce((t, d) => t + d.total, 0))} {isAllBranches ? '· all branches' : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg text-[11px] font-bold text-slate-600">
              {([7, 14, 30] as const).map((n) => (
                <button key={n} onClick={() => setTrendDays(n)}
                  className={cn('px-2 py-1 rounded-md transition-colors', trendDays === n ? 'bg-white text-blue-700 shadow-2xs' : 'hover:text-slate-800')}>
                  {n}d
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            {trendHover !== null && (
              <div className="absolute -top-1 z-10 -translate-x-1/2 rounded-lg bg-slate-900 text-white text-[11px] font-semibold px-2 py-1 shadow-lg pointer-events-none"
                style={{ left: `${((trendHover + 0.5) / trend.days.length) * 100}%` }}>
                {trend.days[trendHover].label} · {formatCurrency(trend.days[trendHover].total)}
              </div>
            )}
            <div className="flex items-end gap-1.5 h-40 pt-6">
              {trend.days.map((d, i) => (
                <div key={d.date} className="flex-1 h-full flex flex-col justify-end items-center group"
                  onMouseEnter={() => setTrendHover(i)} onMouseLeave={() => setTrendHover(null)}>
                  <div className={cn('w-full rounded-t-md transition-all cursor-pointer',
                    i === trendHover ? 'bg-blue-600' : d.date === today ? 'bg-blue-400' : 'bg-blue-200 group-hover:bg-blue-300')}
                    style={{ height: `${Math.max(2, (d.total / trend.max) * 100)}%` }} />
                  <span className="text-[8px] text-slate-400 mt-1 h-2.5">{trendDays <= 14 || i % 3 === 0 ? d.label.slice(3) : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Payment mode split */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <h3 className="text-sm font-extrabold text-slate-900 mb-1">Payment Modes</h3>
          <p className="text-[11px] text-slate-500 mb-4">This month · by collection</p>
          {modeSplit.rows.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No sales this month yet.</p>
          ) : (
            <div className="space-y-3">
              {modeSplit.rows.map((r) => {
                const Icon = r.meta.icon;
                const share = Math.round((r.amount / modeSplit.total) * 100);
                return (
                  <div key={r.mode}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="flex items-center gap-1.5 font-semibold text-slate-700"><Icon className="h-3.5 w-3.5 text-slate-400" />{r.meta.label}</span>
                      <span className="font-mono font-bold text-slate-800">{formatCurrency(r.amount)} <span className="text-slate-400 font-sans font-normal">· {share}%</span></span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={cn('h-full rounded-full', r.meta.color)} style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---- Top products + Recent sales ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top products */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5"><Trophy className="h-4 w-4 text-amber-500" /> Top Products</h3>
            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg text-[11px] font-bold text-slate-600">
              <button onClick={() => setTopMetric('revenue')} className={cn('px-2 py-1 rounded-md', topMetric === 'revenue' ? 'bg-white text-blue-700 shadow-2xs' : '')}>Revenue</button>
              <button onClick={() => setTopMetric('qty')} className={cn('px-2 py-1 rounded-md', topMetric === 'qty' ? 'bg-white text-blue-700 shadow-2xs' : '')}>Qty</button>
            </div>
          </div>
          {topProducts.rows.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No sales this month yet.</p>
          ) : (
            <div className="space-y-2.5">
              {topProducts.rows.map((p, idx) => {
                const val = topMetric === 'revenue' ? p.revenue : p.qty;
                return (
                  <div key={p.name} className="flex items-center gap-3">
                    <span className={cn('h-6 w-6 rounded-lg flex items-center justify-center text-[11px] font-black shrink-0',
                      idx === 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500')}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-800 truncate">{p.name}</span>
                        <span className="text-xs font-mono font-bold text-slate-700 shrink-0">{topMetric === 'revenue' ? formatCurrency(p.revenue) : `${p.qty}`}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${(val / topProducts.max) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent sales */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-1.5"><Receipt className="h-4 w-4 text-blue-500" /> Recent Sales</h3>
            <button onClick={() => setCurrentView('invoices')} className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5">View all <ChevronRight className="h-3 w-3" /></button>
          </div>
          {recentSales.length === 0 ? (
            <p className="text-xs text-slate-400 py-8 text-center">No sales recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentSales.map((i) => {
                const due = invoiceDue(i);
                return (
                  <div key={i.id} className="flex items-center justify-between py-2 gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-800 font-mono truncate">{i.invoiceNumber}</p>
                      <p className="text-[11px] text-slate-500 truncate">{i.date} · {i.customerName}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-black text-slate-900 font-mono">{formatCurrency(netRevenue(i))}</p>
                      {due > 0 ? <p className="text-[10px] font-bold text-amber-600">Due {formatCurrency(due)}</p> : <p className="text-[10px] font-semibold text-emerald-600">Paid</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---- Inventory health strip ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <HealthCard label="Low Stock" count={inv.lowStock} unit="items" tone={inv.lowStock > 0 ? 'amber' : 'emerald'}
          icon={AlertTriangle} onClick={() => setCurrentView('inventory')} hint="at or below reorder level" />
        <HealthCard label="Dead Stock" count={inv.deadStock} unit="items" tone={inv.deadStock > 0 ? 'rose' : 'emerald'}
          icon={AlertOctagon} onClick={() => navigateToInventoryWithMovementFilter('not-moving')} hint={`no sale in ${inventorySettings.deadStockThresholdDays}+ days`} />
        <HealthCard label="Open Enquiries" count={enquiries.filter((e) => e.status === 'Follow-up').length + pendingOrders.filter((p) => p.status === 'Waiting').length} unit="active"
          tone="blue" icon={ClipboardList} onClick={() => setCurrentView('enquiries')} hint="enquiries + waiting orders" />
      </div>

      {/* ---- Branch breakdown (all-branches only) ---- */}
      {isAllBranches && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="p-5 border-b border-slate-200 bg-slate-50/60">
            <h2 className="text-base font-extrabold text-slate-900">Branch Performance</h2>
            <p className="text-xs text-slate-500">This month's sales &amp; stock per branch · click a row to focus</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                  <th className="py-3 px-5">Branch</th>
                  <th className="py-3 px-5 text-right">Sales (Month)</th>
                  <th className="py-3 px-5 text-right">To Collect</th>
                  <th className="py-3 px-5 text-right">Stock Value</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {BRANCHES.map((b) => {
                  const bSales = invoices.filter((i) => !i.isVoided && i.branchId === b.id && (i.date || '').startsWith(thisMonth)).reduce((t, i) => t + netRevenue(i), 0);
                  const bRecv = invoices.filter((i) => !i.isVoided && i.branchId === b.id).reduce((t, i) => t + invoiceDue(i), 0);
                  const bStock = items.reduce((t, item) => t + (branchStocks.find((s) => s.itemId === item.id && s.branchId === b.id)?.quantity ?? 0) * (item.purchasePrice || 0), 0);
                  return (
                    <tr key={b.id} onClick={() => switchBranch(b.id as BranchId)} className="hover:bg-blue-50/50 cursor-pointer group">
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-lg bg-slate-100 group-hover:bg-blue-100 border border-slate-200 flex items-center justify-center text-slate-600 group-hover:text-blue-700"><Building className="h-4 w-4" /></div>
                          <div>
                            <p className="font-bold text-slate-900 group-hover:text-blue-700">{b.name}</p>
                            <p className="text-[10px] text-slate-500">{b.location}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-5 text-right font-mono font-bold text-slate-900">{formatCurrency(bSales)}</td>
                      <td className="py-3.5 px-5 text-right font-mono font-semibold text-amber-700">{formatCurrency(bRecv)}</td>
                      <td className="py-3.5 px-5 text-right font-mono text-slate-700">{formatCurrency(bStock)}</td>
                      <td className="py-3.5 px-5 text-right">
                        <span className="inline-flex items-center gap-1 text-blue-600 font-bold group-hover:text-blue-700">View <ArrowRight className="h-3.5 w-3.5" /></span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ---- KPI card ----
const TONES: Record<string, string> = {
  blue: 'bg-blue-50 border-blue-200 text-blue-700', indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700', rose: 'bg-rose-50 border-rose-200 text-rose-700',
  cyan: 'bg-cyan-50 border-cyan-200 text-cyan-700', slate: 'bg-slate-100 border-slate-200 text-slate-600',
  amber: 'bg-amber-50 border-amber-200 text-amber-700',
};

const KpiCard: React.FC<{
  label: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>;
  tone: string; delta?: number; deltaLabel?: string; onClick?: () => void; accent?: boolean;
}> = ({ label, value, sub, icon: Icon, tone, delta, deltaLabel, onClick, accent }) => (
  <button onClick={onClick} className={cn('text-left p-4 rounded-2xl bg-white border shadow-xs transition-all hover:shadow-md hover:-translate-y-0.5',
    accent ? 'border-slate-300' : 'border-slate-200')}>
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <div className={cn('h-7 w-7 rounded-lg border flex items-center justify-center', TONES[tone])}><Icon className="h-3.5 w-3.5" /></div>
    </div>
    <div className="mt-2 text-lg lg:text-xl font-black text-slate-900 tracking-tight font-mono tabular-nums break-words leading-tight">{value}</div>
    <div className="mt-0.5 flex items-center gap-1.5">
      {typeof delta === 'number' && (
        <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-bold px-1 py-0.5 rounded', delta >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50')}>
          {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{Math.abs(delta)}%
        </span>
      )}
      {sub && <span className="text-[10px] text-slate-400">{deltaLabel || sub}</span>}
    </div>
  </button>
);

// ---- Health card ----
const HealthCard: React.FC<{
  label: string; count: number; unit: string; tone: string; hint: string;
  icon: React.ComponentType<{ className?: string }>; onClick?: () => void;
}> = ({ label, count, unit, tone, hint, icon: Icon, onClick }) => (
  <button onClick={onClick} className="text-left p-4 rounded-2xl bg-white border border-slate-200 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all flex items-center gap-3.5">
    <div className={cn('h-11 w-11 rounded-xl border flex items-center justify-center shrink-0', TONES[tone])}><Icon className="h-5 w-5" /></div>
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-black text-slate-900">{count}</span>
        <span className="text-xs text-slate-500 font-semibold">{unit}</span>
      </div>
      <p className="text-xs font-bold text-slate-700">{label}</p>
      <p className="text-[10px] text-slate-400 truncate">{hint}</p>
    </div>
    <ArrowRight className="h-4 w-4 text-slate-300 ml-auto shrink-0" />
  </button>
);
