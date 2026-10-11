import React, { useState } from 'react';
import { useErp } from '../../context/ErpContext';
import { BRANCHES, BranchScope } from '../../types';
import { MapPin, Clock, Menu, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { UniversalDropdown } from '../common/UniversalDropdown';
import { ShopifyMark, FlipkartMark, AmazonMark } from '../common/StoreLogos';
import { toast } from 'sonner';
import { SelfAttendanceModal } from '../hrm/SelfAttendanceModal';
import { GlobalSearch } from './GlobalSearch';
import { NotificationCenter } from './NotificationCenter';

interface TopBarProps {
  /** Backward compatibility / navigation open */
  navOpen?: boolean;
  onOpenNav?: () => void;
  onToggleNav?: () => void;
  isNavCollapsed?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onOpenNav,
  onToggleNav,
  isNavCollapsed = false,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const {
    currentBranch,
    isAllBranches,
    switchBranch,
    currentUser,
    currentView,
    navigateToTab,
  } = useErp();

  const [isSelfAttendanceOpen, setIsSelfAttendanceOpen] = useState(false);

  return (
    <header className="h-13 bg-white border-b border-slate-300 px-3 sm:px-4 flex items-center justify-between gap-2 relative shrink-0 z-40 shadow-none">
      {/* Left: Mobile Menu (< lg only) + Global Branch Switcher */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* 3-line Menu toggle button (shows on desktop ONLY when navbar is minimized, and on mobile) */}
        <button
          type="button"
          onClick={onToggleNav || onOpenNav}
          aria-label="Expand navigation menu"
          title="Expand navigation menu (Ctrl+B)"
          className={cn(
            'h-8 w-8 shrink-0 rounded-none border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer transition-colors',
            !isNavCollapsed && 'lg:hidden'
          )}
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="hidden sm:flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 mr-1">
          <MapPin className="h-3.5 w-3.5 text-red-700" />
          <span>Branch:</span>
        </div>

        {/* Branch Selector Dropdown — also holds the Online Store context */}
        <div className="w-36 sm:w-56 min-w-0">
          <UniversalDropdown
            value={
              currentView === 'shopify'
                ? '__store_shopify__'
                : currentView === 'flipkart'
                  ? '__store_flipkart__'
                  : isAllBranches
                    ? 'all'
                    : currentBranch
            }
            onChange={(v) => {
              // Marketplace rows come from the "Online Store" flyout; everything
              // else is a branch.
              if (v === '__store_shopify__') { navigateToTab('shopify', 'orders'); return; }
              if (v === '__store_flipkart__') { navigateToTab('flipkart', 'orders'); return; }
              if (v === '__store_amazon__') {
                toast.info('Amazon integration is coming soon', { description: 'Shopify and Flipkart are available today.' });
                return;
              }
              switchBranch(v as BranchScope);
            }}
            options={[
              ...(currentUser.role === 'CEO' ? [{ value: 'all', label: 'All Branches', sublabel: 'Erode · Coimbatore · Chennai' }] : []),
              ...BRANCHES.filter((b) =>
                currentUser.role === 'CEO' ? true : b.id === (currentUser.assignedBranchId || 'coimbatore')
              // value MUST be the branch id — switchBranch() and the `value` prop
              // above both work in branch ids. Using the display name here made
              // switchBranch receive "Erode HQ (HQ)", producing "undefined Dashboard",
              // ₹0 and all-out-of-stock, and adjustments saved to a bogus branch (INV2-1).
              ).map((b) => ({ value: b.id, label: b.name + (b.isHq ? ' (HQ)' : ''), sublabel: b.location })),
              // Last row: hovering it opens the marketplaces to the side, so one
              // row holds every channel instead of the list growing per shop.
              ...(currentUser.role === 'CEO' || currentUser.role === 'Manager'
                ? [{
                    value: '__online_store__',
                    label: '🛒 Online Store',
                    sublabel: 'Shopify · Flipkart · Amazon',
                    submenu: [
                      { value: '__store_shopify__', label: 'Shopify', sublabel: 'Orders, stock, catalog', icon: <ShopifyMark /> },
                      { value: '__store_flipkart__', label: 'Flipkart', sublabel: 'Seller Hub orders', icon: <FlipkartMark /> },
                      { value: '__store_amazon__', label: 'Amazon', icon: <AmazonMark />, disabled: true, disabledNote: 'Coming soon' },
                    ],
                  }]
                : []),
            ]}
            buttonClassName="w-full px-2.5 py-1.5 rounded-none bg-white border border-slate-300 text-xs font-bold text-slate-800"
          />
        </div>

      </div>

      {/* Center: Global search (Vyapar-style) */}
      <GlobalSearch />

      {/* Right: Actions, Full Screen, Notifications & Role Profile */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* My Attendance — self check-in/out */}
        <button
          type="button"
          onClick={() => setIsSelfAttendanceOpen(true)}
          title="My Attendance — check in / out"
          className="hidden lg:inline-flex items-center gap-1.5 h-8 px-2.5 rounded-none border border-slate-300 bg-slate-50 text-slate-800 hover:bg-slate-100 font-bold text-xs transition-colors cursor-pointer"
        >
          <Clock className="h-3.5 w-3.5 text-slate-600" />
          <span>Attendance</span>
        </button>

        {/* Full Screen Toggle Button */}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen Mode (Esc / F11)' : 'Enter Full Screen Mode (F11)'}
            aria-label={isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-none border text-xs font-bold transition-colors cursor-pointer',
              isFullscreen
                ? 'border-red-600 bg-red-50 text-red-800 hover:bg-red-100'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50 hover:text-red-700'
            )}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5 text-red-700" />
                <span className="hidden sm:inline">Exit Full</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5 text-red-700" />
                <span className="hidden sm:inline">Full Screen</span>
              </>
            )}
          </button>
        )}


        <NotificationCenter />
      </div>

      {/* Self attendance (My Attendance) */}
      <SelfAttendanceModal isOpen={isSelfAttendanceOpen} onClose={() => setIsSelfAttendanceOpen(false)} />
    </header>
  );
};

