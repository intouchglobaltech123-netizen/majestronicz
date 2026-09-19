import React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import { cn, cleanPhoneDigits } from '../../lib/utils';

export interface PhoneInputProps {
  /** The 10-digit phone value or raw phone string. */
  value: string;
  /** Callback fired with the sanitized 10-digit string. */
  onChange: (value: string) => void;
  /** Optional field label above the input. */
  label?: React.ReactNode;
  /** Whether the field is required (renders red asterisk and validates). */
  required?: boolean;
  /** Optional custom error message. */
  error?: string;
  /** Optional helper text below the input. */
  helperText?: React.ReactNode;
  /** Placeholder for the 10 digits (defaults to "98421 00000"). */
  placeholder?: string;
  /** Disabled state. */
  disabled?: boolean;
  /** Auto focus the input. */
  autoFocus?: boolean;
  /** HTML input id. */
  id?: string;
  /** HTML input name. */
  name?: string;
  /** Custom container class. */
  className?: string;
  /** Custom input class. */
  inputClassName?: string;
  /** Size variant: 'sm' for compact forms, 'md' for standard modals. */
  size?: 'sm' | 'md';
  /** Blur handler. */
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Whether to hide the 10-digit counter badge on the right. */
  hideCounter?: boolean;
}

/**
 * Standardized Indian Phone / Mobile Input component.
 * - Always displays +91 country prefix with flag.
 * - Restricts input strictly to digits with a 10-digit maximum.
 * - Seamlessly normalizes pasted numbers (stripping leading +91, 91, 0, spaces, hyphens).
 * - Displays a live digit counter (e.g. 5/10) and green completion badge (✓ 10).
 */
export const PhoneInput: React.FC<PhoneInputProps> = ({
  value,
  onChange,
  label,
  required = false,
  error,
  helperText,
  placeholder = '98421 00000',
  disabled = false,
  autoFocus = false,
  id,
  name,
  className,
  inputClassName,
  size = 'md',
  onBlur,
  hideCounter = false,
}) => {
  const digits = cleanPhoneDigits(value);
  const isComplete = digits.length === 10;
  const hasDigits = digits.length > 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextDigits = cleanPhoneDigits(e.target.value);
    onChange(nextDigits);
  };

  const isSm = size === 'sm';

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label
          htmlFor={id}
          className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-1.5"
        >
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}

      <div
        className={cn(
          'flex items-center rounded-none border bg-white transition-all overflow-hidden focus-within:ring-1',
          error
            ? 'border-rose-400 focus-within:border-rose-600 focus-within:ring-rose-200 bg-rose-50/20'
            : isComplete
            ? 'border-slate-300 focus-within:border-red-600 focus-within:ring-red-100'
            : hasDigits
            ? 'border-amber-400 focus-within:border-red-600 focus-within:ring-red-100'
            : 'border-slate-300 focus-within:border-red-600 focus-within:ring-red-100',
          disabled && 'opacity-60 bg-slate-100 pointer-events-none'
        )}
      >
        {/* Country Code Prefix Badge */}
        <div
          className={cn(
            'flex items-center gap-1.5 bg-slate-100 border-r border-slate-300 select-none shrink-0 font-mono text-slate-800 font-bold',
            isSm ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-xs sm:text-sm'
          )}
          title="India (+91)"
        >
          <span className="text-sm leading-none" role="img" aria-label="India">
            🇮🇳
          </span>
          <span className="tracking-tight text-slate-900">+91</span>
        </div>

        {/* Input Field */}
        <input
          id={id}
          name={name}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={10}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          value={digits}
          onChange={handleChange}
          onBlur={onBlur}
          className={cn(
            'flex-1 min-w-0 bg-transparent text-slate-900 font-mono font-semibold focus:outline-none placeholder:text-slate-400 placeholder:font-sans placeholder:font-normal placeholder:tracking-normal',
            isSm ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-xs sm:text-sm tracking-wider',
            inputClassName
          )}
        />

        {/* Right Status / Digit Counter */}
        {!hideCounter && (
          <div className="shrink-0 pr-2 flex items-center">
            {isComplete ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none bg-emerald-50 text-emerald-800 border border-emerald-300 text-[10px] font-bold font-mono">
                <Check className="h-3 w-3 stroke-[2.5]" />
                <span>10</span>
              </span>
            ) : hasDigits ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-none bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-bold font-mono">
                {digits.length}/10
              </span>
            ) : (
              <span className="text-[10px] text-slate-400 font-mono select-none">
                10 digits
              </span>
            )}
          </div>
        )}
      </div>

      {error ? (
        <p className="text-[11px] text-rose-600 font-medium mt-1 flex items-center gap-1 animate-in fade-in duration-150">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{error}</span>
        </p>
      ) : helperText ? (
        <div className="text-[11px] text-slate-500 mt-1">{helperText}</div>
      ) : null}
    </div>
  );
};

