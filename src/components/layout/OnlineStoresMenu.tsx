import React, { useRef, useState } from 'react';
import { ShoppingBag, ChevronDown, Check, Clock } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The Online Stores menu in the top bar.
 *
 * Marketplaces were previously one "Online Store" entry inside the *branch*
 * selector, which forced two unrelated ideas — which shop you are looking at,
 * and which branch's stock you are working in — through one control, and had
 * room for exactly one channel. They are separate menus now, and this one grows
 * a row per marketplace.
 *
 * Opens on hover for the mouse, and on click for touch and keyboard, where a
 * hover never happens. Closing is delayed slightly: the gap between the button
 * and the panel is enough to fire mouseleave while the pointer is travelling
 * into the menu, which makes a hover menu feel broken.
 */

export type StoreChannel = 'shopify' | 'flipkart' | 'amazon';

interface Props {
  /** The channel currently being viewed, if any — shown with a tick. */
  active?: StoreChannel | null;
  onSelect: (channel: StoreChannel) => void;
}

const CHANNELS: {
  id: StoreChannel;
  label: string;
  sublabel: string;
  available: boolean;
  dot: string;
}[] = [
  { id: 'shopify', label: 'Shopify', sublabel: 'Orders, stock, catalog', available: true, dot: 'bg-emerald-500' },
  { id: 'flipkart', label: 'Flipkart', sublabel: 'Seller Hub orders', available: true, dot: 'bg-amber-500' },
  { id: 'amazon', label: 'Amazon', sublabel: 'Coming soon', available: false, dot: 'bg-slate-300' },
];

export const OnlineStoresMenu: React.FC<Props> = ({ active, onSelect }) => {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openNow = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const closeSoon = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };

  const choose = (c: (typeof CHANNELS)[number]) => {
    setOpen(false);
    if (!c.available) {
      // Say what will happen rather than doing nothing when clicked.
      toast.info(`${c.label} integration is coming soon`, {
        description: 'Shopify and Flipkart are available today.',
      });
      return;
    }
    onSelect(c.id);
  };

  return (
    <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onFocus={openNow}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 border text-xs font-bold transition-colors ${
          active
            ? 'bg-slate-900 text-white border-slate-900'
            : 'bg-white text-slate-800 border-slate-300 hover:border-slate-400'
        }`}
      >
        <ShoppingBag className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Online Stores</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 w-60 bg-white border border-slate-300 shadow-lg z-50"
          onMouseEnter={openNow}
          onMouseLeave={closeSoon}
        >
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              role="menuitem"
              type="button"
              onClick={() => choose(c)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors border-b border-slate-100 last:border-b-0 ${
                c.available ? 'hover:bg-slate-50' : 'opacity-60 hover:bg-slate-50/60 cursor-default'
              }`}
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${c.dot}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-slate-800">{c.label}</span>
                <span className="block text-[11px] text-slate-500 truncate">{c.sublabel}</span>
              </span>
              {active === c.id ? (
                <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              ) : !c.available ? (
                <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
