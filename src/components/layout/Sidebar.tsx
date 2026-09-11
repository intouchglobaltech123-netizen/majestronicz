import React from 'react';
import { useErp, ActiveNavView } from '../../context/ErpContext';
import {
  LayoutDashboard,
  Boxes,
  Layers,
  FileText,
  Barcode,
  ShoppingBag,
  BarChart3,
  ShieldCheck,
  UserCheck,
  Building2,
  Lock,
  Truck,
  Receipt,
  ClipboardList,
  WalletCards,
  Users,
  Clock,
  LogOut,
} from 'lucide-react';
import { MajestroniczLogo } from '../common/MajestroniczLogo';
import { cn } from '../../lib/utils';

export const Sidebar: React.FC = () => {
  const {
    currentUser,
    currentView,
    setCurrentView,
    logout,
    currentBranchData,
    isAllBranches,
    canAccessView,
  } = useErp();

  const navItems: {
    id: ActiveNavView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    visible: boolean;
  }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: canAccessView('dashboard') },
    { id: 'items', label: 'Items', icon: Boxes, visible: canAccessView('items') },
    { id: 'customers', label: 'Customers', icon: UserCheck, visible: canAccessView('customers') },
    { id: 'enquiries', label: 'Enquiries', icon: ClipboardList, visible: canAccessView('enquiries') },
    { id: 'pending-orders', label: 'Pending Orders', icon: Clock, visible: canAccessView('pending-orders') },
    { id: 'estimates', label: 'Quotes', icon: FileText, visible: canAccessView('estimates') },
    { id: 'challans', label: 'Delivery Challan', icon: Truck, visible: canAccessView('challans') },
    { id: 'inventory', label: 'Inventory', icon: Layers, visible: canAccessView('inventory') },
    { id: 'invoices', label: 'Sales', icon: Receipt, visible: canAccessView('invoices') },
    { id: 'barcodes', label: 'Barcode', icon: Barcode, visible: canAccessView('barcodes') },
    { id: 'cash-register', label: 'Cash Register', icon: WalletCards, visible: canAccessView('cash-register') },
    { id: 'purchases', label: 'Purchases', icon: ShoppingBag, visible: canAccessView('purchases') },
    { id: 'hrm', label: 'Attendance', icon: Users, visible: canAccessView('hrm') },
    { id: 'reports', label: 'Reports', icon: BarChart3, visible: canAccessView('reports') },
  ];

  return (
    <aside className="w-68 bg-white border-r border-slate-200 flex flex-col h-screen select-none shrink-0 shadow-xs z-20">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-200">
        <MajestroniczLogo />

        {/* Current Active Branch / Scope Indicator */}
        <div className="mt-4 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2.5">
          <div className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-slate-900 truncate">
                {isAllBranches ? 'All Branches' : currentBranchData?.name}
              </p>
              <span className="text-[9px] uppercase font-semibold text-blue-700 bg-blue-50 px-1 rounded border border-blue-200">
                {isAllBranches ? 'All Branches' : 'Branch'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 truncate">
              {isAllBranches ? 'Erode • Coimbatore • Chennai' : currentBranchData?.location}
            </p>
          </div>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Modules
        </div>

        {navItems
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group text-left',
                  isActive
                    ? 'bg-blue-600 text-white shadow-xs font-semibold'
                    : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-700'
                  )}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
      </div>

      {/* User Session / Role Card */}
      <div className="p-3 border-t border-slate-200 bg-slate-50/70 space-y-2">
        <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500">Active Role</span>
            <span
              className={cn(
                'text-[10px] font-bold px-2 py-0.5 rounded-full border',
                currentUser.role === 'CEO' && 'bg-amber-50 text-amber-700 border-amber-200',
                currentUser.role === 'Manager' && 'bg-blue-50 text-blue-700 border-blue-200',
                currentUser.role === 'Purchase' && 'bg-emerald-50 text-emerald-700 border-emerald-200',
                currentUser.role === 'Sales' && 'bg-violet-50 text-violet-700 border-violet-200',
                currentUser.role === 'Billing' && 'bg-slate-100 text-slate-700 border-slate-200'
              )}
            >
              {currentUser.role}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-xs text-slate-700 shrink-0">
              {currentUser.role === 'CEO' ? (
                <ShieldCheck className="h-4 w-4 text-amber-600" />
              ) : currentUser.role === 'Manager' ? (
                <Building2 className="h-4 w-4 text-blue-600" />
              ) : (
                <Lock className="h-4 w-4 text-slate-600" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-900 truncate">{currentUser.name}</p>
              <p className="text-[10px] text-slate-500 truncate">
                {currentUser.role === 'CEO'
                  ? 'CEO • All Branches'
                  : currentUser.role === 'Manager'
                  ? `Manager • ${currentUser.assignedBranchId || 'Coimbatore'}`
                  : currentUser.role === 'Billing'
                  ? 'Billing Staff'
                  : currentUser.role === 'Purchase'
                  ? 'Purchase Desk'
                  : 'Sales Executive'}
              </p>
            </div>
          </div>

          <button
            onClick={logout}
            className="mt-1 w-full py-1.5 px-2.5 text-xs font-semibold text-slate-700 hover:text-rose-700 bg-slate-50 hover:bg-rose-50 rounded-lg border border-slate-200 hover:border-rose-200 flex items-center justify-center gap-1.5 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
