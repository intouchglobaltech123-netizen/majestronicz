import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Package, Layers } from 'lucide-react';
import { useErp } from '../../context/ErpContext';
import { Item, ComboItem, BranchId, BRANCHES } from '../../types';
import { cn, formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';
import { ItemImage } from './ItemImage';

export interface ItemSearchDropdownProps {
  value: string;
  onChange: (value: string) => void;
  onSelectItem: (item: Item) => void;
  onSelectCombo?: (combo: ComboItem) => void;
  includeCombos?: boolean;
  selectedBranchId?: BranchId | 'all';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  dropdownWidth?: string;
  showClearButton?: boolean;
  onClear?: () => void;
  autoFocus?: boolean;
  required?: boolean;
  lockOutOfStock?: boolean;
}

type SearchEntry =
  | { type: 'product'; item: Item; stockQty: number; isLocked: boolean; isLowStock: boolean }
  | { type: 'combo'; combo: ComboItem; availQty: number; isLocked: boolean };

export const ItemSearchDropdown: React.FC<ItemSearchDropdownProps> = ({
  value,
  onChange,
  onSelectItem,
  onSelectCombo,
  includeCombos = false,
  selectedBranchId,
  placeholder = 'Search item or combo by name, code, or HSN...',
  disabled = false,
  className = '',
  inputClassName = '',
  dropdownWidth = 'w-[520px] sm:w-[580px] max-w-[calc(100vw-2rem)]',
  showClearButton = true,
  onClear,
  autoFocus = false,
  required = false,
  lockOutOfStock = false,
}) => {
  const { items: masterItems, branchStocks, combos, getComboAvailability, currentBranch } = useErp();
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const effectiveBranchId = selectedBranchId ?? (currentBranch === 'all' ? 'erode-hq' : currentBranch);
  const targetBranch = BRANCHES.find((b) => b.id === effectiveBranchId) || BRANCHES[0];

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getStockCount = (itemId: string): number => {
    if (effectiveBranchId === 'all') {
      return branchStocks
        .filter((s) => s.itemId === itemId)
        .reduce((sum, s) => sum + s.quantity, 0);
    }
    const stock = branchStocks.find(
      (s) => s.itemId === itemId && s.branchId === effectiveBranchId
    );
    return stock?.quantity ?? 0;
  };

  // Filter matching products
  const filteredProducts = useMemo(() => {
    return masterItems.filter((item: Item) => {
      if (!value || !value.trim()) return true;
      const q = value.toLowerCase().trim();
      return (
        (item.itemName && item.itemName.toLowerCase().includes(q)) ||
        (item.itemCode && item.itemCode.toLowerCase().includes(q)) ||
        (item.itemHSN && String(item.itemHSN).includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q))
      );
    }).slice(0, 12);
  }, [masterItems, value]);

  // Filter matching combos
  const filteredCombos = useMemo(() => {
    if (!includeCombos) return [];
    return combos.filter((combo: ComboItem) => {
      if (!value || !value.trim()) return true;
      const q = value.toLowerCase().trim();
      return (
        combo.comboName.toLowerCase().includes(q) ||
        combo.comboCode.toLowerCase().includes(q) ||
        (combo.description && combo.description.toLowerCase().includes(q))
      );
    }).slice(0, 8);
  }, [combos, value, includeCombos]);

  // Unified list of entries for keyboard navigation
  const allEntries = useMemo<SearchEntry[]>(() => {
    const productEntries: SearchEntry[] = filteredProducts.map((item) => {
      const stockQty = getStockCount(item.id);
      const isOutOfStock = stockQty <= 0;
      return {
        type: 'product',
        item,
        stockQty,
        isLocked: lockOutOfStock && isOutOfStock,
        isLowStock: !isOutOfStock && stockQty <= (item.reorderThreshold ?? 10),
      };
    });

    const comboEntries: SearchEntry[] = filteredCombos.map((combo) => {
      const availQty = getComboAvailability(combo, effectiveBranchId);
      return {
        type: 'combo',
        combo,
        availQty,
        isLocked: lockOutOfStock && availQty <= 0,
      };
    });

    return [...productEntries, ...comboEntries];
  }, [filteredProducts, filteredCombos, branchStocks, effectiveBranchId, lockOutOfStock, getComboAvailability]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < allEntries.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : allEntries.length - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < allEntries.length) {
        const entry = allEntries[highlightedIndex];
        if (entry.type === 'product') {
          if (entry.isLocked) {
            toast.error('Out of stock at this branch', {
              description: `"${entry.item.itemName}" currently has 0 available stock at ${targetBranch.name}.`,
            });
            return;
          }
          handleSelectProduct(entry.item);
        } else {
          if (entry.isLocked) {
            toast.error('Combo out of stock at this branch', {
              description: `"${entry.combo.comboName}" currently has 0 available kits at ${targetBranch.name} due to depleted component stock.`,
            });
            return;
          }
          handleSelectCombo(entry.combo);
        }
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleSelectProduct = (item: Item) => {
    onSelectItem(item);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleSelectCombo = (combo: ComboItem) => {
    if (onSelectCombo) {
      onSelectCombo(combo);
    } else {
      // Fallback: convert combo representation if parent only expects Item
      const convertedItem: Item = {
        id: combo.id,
        itemCode: combo.comboCode,
        itemName: combo.comboName,
        itemHSN: 'COMBO',
        category: 'Combos & Bundles',
        unit: 'SET',
        salePrice: combo.comboPrice,
        salePriceTaxMode: 'without',
        wholesalePrice: 0,
        minWholesaleQty: 1,
        purchasePrice: 0,
        gstTaxSlab: 18,
        createdAt: combo.createdAt || new Date().toISOString(),
        updatedAt: combo.updatedAt || new Date().toISOString(),
      };
      onSelectItem(convertedItem);
    }
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    if (onClear) onClear();
    setIsOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          autoFocus={autoFocus}
          className={cn(
            'w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white transition-all',
            showClearButton && value ? 'pr-8' : '',
            inputClassName
          )}
        />
        {showClearButton && value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200/50 transition-colors"
            title="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div
          className={cn(
            'absolute z-50 left-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden max-h-80 flex flex-col',
            dropdownWidth
          )}
          style={{ maxWidth: '95vw' }}
        >
          {/* Header Row */}
          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider grid grid-cols-12 gap-2 shrink-0">
            <span className="col-span-6">Item / Combo Description</span>
            <span className="col-span-3 text-right">Price</span>
            <span className="col-span-3 text-right">Availability ({targetBranch.shortCode || targetBranch.name})</span>
          </div>

          {/* Results List */}
          <div className="overflow-y-auto divide-y divide-slate-100 flex-1">
            {allEntries.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 flex flex-col items-center gap-1.5">
                <Package className="h-5 w-5 text-slate-300" />
                <span>No matching products or combos found</span>
              </div>
            ) : (
              <>
                {/* SECTION 1: PRODUCTS */}
                {filteredProducts.length > 0 && (
                  <div>
                    <div className="bg-slate-100/90 px-3 py-1 border-b border-slate-200 text-[11px] font-black text-slate-600 uppercase tracking-wider flex items-center justify-between sticky top-0 z-10">
                      <div className="flex items-center gap-1.5">
                        <Package className="h-3 w-3 text-blue-600" />
                        <span>Products ({filteredProducts.length})</span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-normal">Catalog inventory</span>
                    </div>

                    {filteredProducts.map((item, pIdx) => {
                      const entryIdx = pIdx;
                      const entry = allEntries[entryIdx];
                      const isHighlighted = entryIdx === highlightedIndex;
                      const stockQty = entry.type === 'product' ? entry.stockQty : 0;
                      const isLocked = entry.isLocked;
                      const isLowStock = entry.type === 'product' && entry.isLowStock;
                      const isOutOfStock = stockQty <= 0;

                      const branchStockRecord =
                        effectiveBranchId !== 'all'
                          ? branchStocks.find((s) => s.itemId === item.id && s.branchId === effectiveBranchId)
                          : undefined;
                      const rackLoc = branchStockRecord?.location?.trim();

                      return (
                        <button
                          key={item.id}
                          type="button"
                          title={isLocked ? `Out of stock at ${targetBranch.name} — cannot be selected` : undefined}
                          onClick={(e) => {
                            if (isLocked) {
                              e.preventDefault();
                              e.stopPropagation();
                              toast.error('Out of stock at this branch', {
                                description: `"${item.itemName}" currently has 0 available stock at ${targetBranch.name}.`,
                              });
                              return;
                            }
                            handleSelectProduct(item);
                          }}
                          onMouseEnter={() => {
                            if (!isLocked) setHighlightedIndex(entryIdx);
                          }}
                          className={cn(
                            'w-full text-left p-2.5 transition-colors grid grid-cols-12 gap-2 items-center text-xs relative select-none',
                            isLocked
                              ? 'bg-rose-50/80 hover:bg-rose-100/70 border-l-2 border-l-rose-500 cursor-not-allowed'
                              : isHighlighted
                              ? 'bg-blue-50/80 cursor-pointer'
                              : 'hover:bg-slate-50 cursor-pointer'
                          )}
                        >
                          {/* Item Details */}
                          <div className="col-span-6 min-w-0 flex items-center gap-2.5">
                            <ItemImage
                              src={item.imageUrl}
                              alt={item.itemName}
                              className="h-8 w-8 rounded-lg shrink-0"
                              iconClassName="h-3.5 w-3.5"
                              fallbackIcon="boxes"
                            />
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  'font-bold truncate',
                                  isLocked ? 'text-rose-900' : 'text-slate-900'
                                )}
                              >
                                {item.itemName}
                              </p>
                              <div
                                className={cn(
                                  'flex items-center gap-1.5 mt-0.5 text-[11px]',
                                  isLocked ? 'text-rose-700/80' : 'text-slate-500'
                                )}
                              >
                                <span
                                  className={cn(
                                    'font-mono font-medium',
                                    isLocked ? 'text-rose-800 font-semibold' : 'text-slate-500'
                                  )}
                                >
                                  {item.itemCode}
                                </span>
                                <span className={isLocked ? 'text-rose-300' : 'text-slate-300'}>•</span>
                                <span className={cn('truncate', isLocked ? 'text-rose-700' : 'text-slate-400')}>
                                  {item.category}{item.subcategory ? ` / ${item.subcategory}` : ''}
                                </span>
                                <span className={isLocked ? 'text-rose-300' : 'text-slate-300'}>•</span>
                                <span className={cn('font-mono', isLocked ? 'text-rose-700' : 'text-slate-400')}>
                                  HSN: {item.itemHSN}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Sale Price */}
                          <div className="col-span-3 text-right shrink-0">
                            <p
                              className={cn(
                                'font-mono font-bold',
                                isLocked ? 'text-rose-900' : 'text-slate-900'
                              )}
                            >
                              {formatCurrency(item.salePrice)}
                            </p>
                            <span
                              className={cn(
                                'text-[11px] block',
                                isLocked ? 'text-rose-600' : 'text-slate-400'
                              )}
                            >
                              {item.salePriceTaxMode === 'with' ? 'Incl. Tax' : 'Pre-Tax'} ({item.gstTaxSlab}%)
                            </span>
                          </div>

                          {/* Stock Status Badge */}
                          <div className="col-span-3 text-right shrink-0">
                            <span
                              className={cn(
                                'inline-block px-1.5 py-0.5 rounded text-[11px] font-bold',
                                isOutOfStock
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : isLowStock
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              )}
                            >
                              {isOutOfStock
                                ? 'Out of Stock'
                                : `Stock: ${stockQty} · ${rackLoc ? `Rack ${rackLoc}` : item.unit || 'PCS'}`}
                            </span>
                            {rackLoc && (
                              <span className="block text-[11px] font-mono text-slate-500 mt-0.5">
                                Rack: {rackLoc}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* SECTION 2: COMBOS */}
                {includeCombos && filteredCombos.length > 0 && (
                  <div>
                    <div className="bg-purple-50 px-3 py-1 border-y border-purple-200 text-[11px] font-black text-purple-800 uppercase tracking-wider flex items-center justify-between sticky top-0 z-10">
                      <div className="flex items-center gap-1.5">
                        <Layers className="h-3 w-3 text-purple-600" />
                        <span>Combos & Bundles ({filteredCombos.length})</span>
                      </div>
                      <span className="text-[11px] text-purple-600 font-normal">Live computed availability</span>
                    </div>

                    {filteredCombos.map((combo, cIdx) => {
                      const entryIdx = filteredProducts.length + cIdx;
                      const entry = allEntries[entryIdx];
                      const isHighlighted = entryIdx === highlightedIndex;
                      const availQty = entry.type === 'combo' ? entry.availQty : 0;
                      const isLocked = entry.isLocked;
                      const isOutOfStock = availQty <= 0;

                      // Component summary
                      const componentSummary = combo.components
                        .map((comp) => {
                          const it = masterItems.find((i) => i.id === comp.itemId);
                          return `${comp.quantity}x ${it?.itemName || 'Item'}`;
                        })
                        .join(', ');

                      return (
                        <button
                          key={combo.id}
                          type="button"
                          title={isLocked ? `Combo out of stock at ${targetBranch.name} due to component stock` : undefined}
                          onClick={(e) => {
                            if (isLocked) {
                              e.preventDefault();
                              e.stopPropagation();
                              toast.error('Combo out of stock at this branch', {
                                description: `"${combo.comboName}" currently has 0 available kits at ${targetBranch.name} due to depleted component stock.`,
                              });
                              return;
                            }
                            handleSelectCombo(combo);
                          }}
                          onMouseEnter={() => {
                            if (!isLocked) setHighlightedIndex(entryIdx);
                          }}
                          className={cn(
                            'w-full text-left p-2.5 transition-colors grid grid-cols-12 gap-2 items-center text-xs relative select-none',
                            isLocked
                              ? 'bg-rose-50/80 hover:bg-rose-100/70 border-l-2 border-l-rose-500 cursor-not-allowed'
                              : isHighlighted
                              ? 'bg-purple-50/80 cursor-pointer'
                              : 'hover:bg-purple-50/40 cursor-pointer'
                          )}
                        >
                          {/* Combo Details */}
                          <div className="col-span-6 min-w-0 flex items-center gap-2.5">
                            <ItemImage
                              src={combo.imageUrl}
                              alt={combo.comboName}
                              isCombo={true}
                              className="h-8 w-8 rounded-lg shrink-0"
                              iconClassName="h-3.5 w-3.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={cn(
                                    'font-bold truncate',
                                    isLocked ? 'text-rose-900' : 'text-slate-900'
                                  )}
                                >
                                  {combo.comboName}
                                </span>
                                <span className="px-1.5 py-0.2 rounded text-[11px] font-bold uppercase bg-purple-100 text-purple-700 border border-purple-200 shrink-0">
                                  Combo
                                </span>
                              </div>
                              <div
                                className={cn(
                                  'flex items-center gap-1.5 mt-0.5 text-[11px]',
                                  isLocked ? 'text-rose-700/80' : 'text-slate-500'
                                )}
                              >
                                <span
                                  className={cn(
                                    'font-mono font-bold',
                                    isLocked ? 'text-rose-800' : 'text-purple-700'
                                  )}
                                >
                                  {combo.comboCode}
                                </span>
                                <span>•</span>
                                <span className="truncate text-slate-500" title={componentSummary}>
                                  {componentSummary}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Combo Price */}
                          <div className="col-span-3 text-right shrink-0">
                            <p
                              className={cn(
                                'font-mono font-bold',
                                isLocked ? 'text-rose-900' : 'text-purple-900'
                              )}
                            >
                              {formatCurrency(combo.comboPrice)}
                            </p>
                            <span className="text-[11px] text-slate-400 block">
                              Bundle Price (Pre-Tax)
                            </span>
                          </div>

                          {/* Computed Availability Badge */}
                          <div className="col-span-3 text-right shrink-0">
                            <span
                              className={cn(
                                'inline-block px-1.5 py-0.5 rounded text-[11px] font-bold font-mono',
                                isOutOfStock
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : 'bg-purple-100 text-purple-800 border border-purple-200'
                              )}
                            >
                              {isOutOfStock ? '0 Available' : `Stock: ${availQty} Kits`}
                            </span>
                            <span className="block text-[11px] text-slate-400 mt-0.5">
                              Live component stock
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
