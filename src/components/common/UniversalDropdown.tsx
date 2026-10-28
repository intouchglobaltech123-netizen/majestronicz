import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Check, X, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DropdownSubOption {
  value: string;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  /** Shown greyed with a note instead of being selectable. */
  disabled?: boolean;
  disabledNote?: string;
}

export interface DropdownOption {
  value: string | number;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  /**
   * When present the row does not select itself — it opens a flyout to the side
   * on hover (and on click, for touch and keyboard, which never hover). Used by
   * the branch selector's "Online Store" row to hold one marketplace per line
   * without turning the branch list into a list of shops.
   */
  submenu?: DropdownSubOption[];
}

export interface UniversalDropdownProps {
  label?: React.ReactNode;
  value: string | number;
  onChange: (value: any) => void;
  options: DropdownOption[];
  placeholder?: string;
  addNewLabel?: string;
  addNewPlaceholder?: string;
  onAddNew?: (newValue: string) => string | void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  required?: boolean;
  /** Show a type-to-filter search box at the top of the menu (long lists). */
  searchable?: boolean;
  searchPlaceholder?: string;
}

export const UniversalDropdown: React.FC<UniversalDropdownProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select option...',
  addNewLabel = '+ Add New',
  addNewPlaceholder = 'Enter new option...',
  onAddNew,
  disabled = false,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  required = false,
  searchable = false,
  searchPlaceholder = 'Type to search…',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  // Screen position of the row the flyout belongs to. The options list scrolls
  // and clips (max-h-52 overflow-y-auto), so a submenu positioned inside it is
  // cut off the moment it is taller than the remaining space — which is exactly
  // what happened. It is rendered in a portal instead, anchored to the row's
  // rectangle, so it escapes the scroll box entirely.
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);

  const openSubmenuAt = (optValue: string, el: HTMLElement | null) => {
    if (el) {
      const r = el.getBoundingClientRect();
      // Flip to the left of the dropdown when there is no room on the right.
      const width = 224; // w-56
      const left = r.right + width + 8 > window.innerWidth ? r.left - width - 4 : r.right + 4;
      setSubmenuPos({ top: r.top, left });
    }
    setOpenSubmenu(optValue);
  };
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newOptionInput, setNewOptionInput] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The submenu flyout is rendered in a portal on document.body, so it is NOT a
  // DOM child of containerRef. Without excluding it here, a click on the flyout
  // counts as an "outside" click and closes the whole dropdown on mousedown —
  // before the flyout item's onClick can fire, so clicking a submenu item did
  // nothing. Track the flyout element and treat clicks inside it as inside.
  const submenuRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideContainer = containerRef.current?.contains(target);
      const insideSubmenu = submenuRef.current?.contains(target);
      if (!insideContainer && !insideSubmenu) {
        setIsOpen(false);
        setOpenSubmenu(null);
        setIsAddingNew(false);
        setNewOptionInput('');
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus the search box the moment a searchable menu opens, and clear the
  // filter when it closes, so staff can just open and start typing a name.
  useEffect(() => {
    if (isOpen && searchable) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    if (!isOpen) setQuery('');
  }, [isOpen, searchable]);

  // Auto-focus input when "+ Add New" is clicked
  useEffect(() => {
    if (isAddingNew && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isAddingNew]);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  const handleSelect = (val: string | number) => {
    onChange(val);
    setIsOpen(false);
    setIsAddingNew(false);
    setNewOptionInput('');
    setQuery('');
  };

  // Type-to-filter: match the typed text against each option's label/sublabel
  // (and any submenu entry labels), case-insensitively. Off unless `searchable`.
  const q = query.trim().toLowerCase();
  const visibleOptions = searchable && q
    ? options.filter((o) =>
        String(o.label).toLowerCase().includes(q) ||
        String(o.sublabel || '').toLowerCase().includes(q) ||
        (o.submenu || []).some((s) => String(s.label).toLowerCase().includes(q)))
    : options;

  const handleSaveNew = () => {
    const trimmed = newOptionInput.trim();
    if (!trimmed) return;

    // onAddNew may create the record and return its real value/id — select THAT
    // so e.g. a supplier added from the PO form is actually selected, instead of
    // selecting the typed name which isn't a valid id (PUR-3).
    const created = onAddNew ? onAddNew(trimmed) : undefined;
    onChange(created || trimmed);
    setIsAddingNew(false);
    setNewOptionInput('');
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={cn('relative w-full space-y-1.5', className)}>
      {label && (
        <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
          <span>
            {label} {required && <span className="text-rose-500">*</span>}
          </span>
        </label>
      )}

      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setIsOpen((prev) => !prev);
        }}
        className={cn(
          'w-full px-3.5 py-2 rounded-none bg-white border border-slate-300 text-slate-900 text-sm flex items-center justify-between text-left transition-colors focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed',
          isOpen ? 'border-red-600 ring-1 ring-red-600' : 'hover:border-slate-400',
          buttonClassName
        )}
      >
        <span className={cn('truncate', !selectedOption && 'text-slate-400')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-slate-400 transition-transform duration-150 shrink-0 ml-2',
            isOpen && 'rotate-180 text-red-600'
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={cn(
            'absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-300 rounded-none shadow-lg overflow-hidden flex flex-col min-w-[200px]',
            menuClassName
          )}
        >
          {/* Search box (opt-in) */}
          {searchable && (
            <div className="p-1.5 border-b border-slate-200 bg-slate-50">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const first = visibleOptions.find((o) => !o.submenu?.length);
                      if (first) handleSelect(first.value);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      if (query) setQuery('');
                      else setIsOpen(false);
                    }
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-none focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 text-slate-900 placeholder-slate-400 font-medium"
                />
              </div>
            </div>
          )}

          {/* Options List */}
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
            {visibleOptions.length === 0 ? (
              <div className="px-3.5 py-2.5 text-xs text-slate-400 text-center">
                {searchable && q ? 'No matches' : 'No options available'}
              </div>
            ) : (
              visibleOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);

                if (opt.submenu?.length) {
                  const isOpenSub = String(openSubmenu) === String(opt.value);
                  return (
                    <div
                      key={String(opt.value)}
                      className="relative"
                      onMouseEnter={(e) => openSubmenuAt(String(opt.value), e.currentTarget as HTMLElement)}
                      onMouseLeave={() => setOpenSubmenu((cur) => (cur === String(opt.value) ? null : cur))}
                    >
                      <button
                        type="button"
                        onClick={(e) =>
                          openSubmenu === String(opt.value)
                            ? setOpenSubmenu(null)
                            : openSubmenuAt(String(opt.value), (e.currentTarget.parentElement as HTMLElement) || null)
                        }
                        aria-haspopup="menu"
                        aria-expanded={isOpenSub}
                        className={cn(
                          'w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between transition-colors',
                          isSelected ? 'bg-red-50 text-red-900 font-bold' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                        )}
                      >
                        <div className="min-w-0 pr-2 flex items-center gap-2">
                          {opt.icon}
                          <div className="min-w-0">
                            <div className="truncate">{opt.label}</div>
                            {opt.sublabel && (
                              <div className="text-[11px] text-slate-400 font-normal truncate">{opt.sublabel}</div>
                            )}
                          </div>
                        </div>
                        <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-slate-400 shrink-0 ml-2" />
                      </button>

                      {isOpenSub && submenuPos && createPortal(
                        <div
                          ref={submenuRef}
                          role="menu"
                          style={{ position: 'fixed', top: submenuPos.top, left: submenuPos.left }}
                          className="w-56 bg-white border border-slate-300 shadow-lg z-[100]"
                          onMouseEnter={() => setOpenSubmenu(String(opt.value))}
                          onMouseLeave={() => setOpenSubmenu(null)}
                        >
                          {opt.submenu.map((sub) => (
                            <button
                              key={sub.value}
                              role="menuitem"
                              type="button"
                              onClick={() => {
                                if (sub.disabled) return;
                                setOpenSubmenu(null);
                                setIsOpen(false);
                                onChange(sub.value);
                              }}
                              className={cn(
                                'w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 border-b border-slate-100 last:border-b-0 transition-colors',
                                sub.disabled ? 'opacity-60 cursor-default hover:bg-slate-50/60' : 'hover:bg-slate-50'
                              )}
                            >
                              <span className="shrink-0">{sub.icon}</span>
                              <span className="min-w-0 flex-1">
                                <span className="block font-bold text-slate-800 truncate">{sub.label}</span>
                                {(sub.disabled ? sub.disabledNote : sub.sublabel) && (
                                  <span className="block text-[11px] text-slate-400 truncate">
                                    {sub.disabled ? sub.disabledNote : sub.sublabel}
                                  </span>
                                )}
                              </span>
                            </button>
                          ))}
                        </div>,
                        document.body,
                      )}
                    </div>
                  );
                }

                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={cn(
                      'w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between transition-colors',
                      isSelected
                        ? 'bg-red-50 text-red-900 font-bold'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    )}
                  >
                    <div className="min-w-0 pr-2 flex items-center gap-2">
                      {opt.icon}
                      <div className="min-w-0">
                      <div className="truncate">{opt.label}</div>
                      {opt.sublabel && (
                        <div className="text-[11px] text-slate-400 font-normal truncate">
                          {opt.sublabel}
                        </div>
                      )}
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="h-4 w-4 text-red-600 shrink-0 ml-2" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Bottom Row: + Add New / Inline Input */}
          {onAddNew && (
            <div className="border-t border-slate-200 bg-slate-50">
              {isAddingNew ? (
                <div className="p-2 flex items-center gap-1.5">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newOptionInput}
                    onChange={(e) => setNewOptionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSaveNew();
                      } else if (e.key === 'Escape') {
                        setIsAddingNew(false);
                        setNewOptionInput('');
                      }
                    }}
                    placeholder={addNewPlaceholder}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-red-500 rounded-none focus:outline-none focus:ring-1 focus:ring-red-500 text-slate-900 placeholder-slate-400 font-medium"
                  />
                  <button
                    type="button"
                    onClick={handleSaveNew}
                    disabled={!newOptionInput.trim()}
                    className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-none border border-red-700 text-xs font-bold transition-colors shrink-0 shadow-none"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNew(false);
                      setNewOptionInput('');
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-none transition-colors shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingNew(true)}
                  className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-red-700 hover:text-red-800 hover:bg-red-50 flex items-center gap-1.5 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {/* Strip any leading "+" from the label — the Plus icon already shows it. */}
                  <span>{addNewLabel.replace(/^\s*\+\s*/, '')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
