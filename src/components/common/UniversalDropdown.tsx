import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DropdownOption {
  value: string | number;
  label: string;
  sublabel?: string;
}

export interface UniversalDropdownProps {
  label?: React.ReactNode;
  value: string | number;
  onChange: (value: any) => void;
  options: DropdownOption[];
  placeholder?: string;
  addNewLabel?: string;
  addNewPlaceholder?: string;
  onAddNew?: (newValue: string) => void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  required?: boolean;
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
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newOptionInput, setNewOptionInput] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsAddingNew(false);
        setNewOptionInput('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
  };

  const handleSaveNew = () => {
    const trimmed = newOptionInput.trim();
    if (!trimmed) return;

    if (onAddNew) {
      onAddNew(trimmed);
    }
    onChange(trimmed);
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
          'w-full px-3.5 py-2 rounded-xl bg-white border border-slate-300 text-slate-900 text-sm flex items-center justify-between text-left transition-colors focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed',
          isOpen ? 'border-blue-600 ring-1 ring-blue-600' : 'hover:border-slate-400',
          buttonClassName
        )}
      >
        <span className={cn('truncate', !selectedOption && 'text-slate-400')}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-slate-400 transition-transform duration-150 shrink-0 ml-2',
            isOpen && 'rotate-180 text-blue-600'
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className={cn(
            'absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100 min-w-[200px]',
            menuClassName
          )}
        >
          {/* Options List */}
          <div className="max-h-52 overflow-y-auto divide-y divide-slate-100">
            {options.length === 0 ? (
              <div className="px-3.5 py-2.5 text-xs text-slate-400 text-center">
                No options available
              </div>
            ) : (
              options.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={cn(
                      'w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between transition-colors',
                      isSelected
                        ? 'bg-blue-50/80 text-blue-900 font-bold'
                        : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                    )}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="truncate">{opt.label}</div>
                      {opt.sublabel && (
                        <div className="text-[11px] text-slate-400 font-normal truncate">
                          {opt.sublabel}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="h-4 w-4 text-blue-600 shrink-0 ml-2" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Bottom Row: + Add New / Inline Input */}
          {onAddNew && (
            <div className="border-t border-slate-200 bg-slate-50/90">
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
                    className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-blue-500 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-900 placeholder-slate-400 font-medium"
                  />
                  <button
                    type="button"
                    onClick={handleSaveNew}
                    disabled={!newOptionInput.trim()}
                    className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors shrink-0 shadow-xs"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNew(false);
                      setNewOptionInput('');
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingNew(true)}
                  className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-blue-600 hover:text-blue-800 hover:bg-blue-50/60 flex items-center gap-1.5 transition-colors"
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
