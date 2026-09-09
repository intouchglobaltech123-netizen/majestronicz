import React, { useState, useEffect } from 'react';
import { Package, Layers, Boxes } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ItemImageProps {
  src?: string | null;
  alt?: string;
  className?: string;
  iconClassName?: string;
  isCombo?: boolean;
  fallbackIcon?: 'package' | 'boxes' | 'layers';
}

export const ItemImage: React.FC<ItemImageProps> = ({
  src,
  alt = 'Item image',
  className = 'h-9 w-9 rounded-xl',
  iconClassName = 'h-4 w-4',
  isCombo = false,
  fallbackIcon,
}) => {
  const [hasError, setHasError] = useState(false);
  const trimmedSrc = src?.trim();

  // Reset error status if src prop changes
  useEffect(() => {
    setHasError(false);
  }, [trimmedSrc]);

  if (!trimmedSrc || hasError) {
    const defaultIcon = isCombo ? 'layers' : 'package';
    const chosenIcon = fallbackIcon || defaultIcon;

    return (
      <div
        className={cn(
          'flex items-center justify-center shrink-0 border overflow-hidden transition-colors',
          isCombo
            ? 'bg-purple-50 border-purple-200/80 text-purple-500'
            : 'bg-slate-100 border-slate-200 text-slate-400',
          className
        )}
        title={alt}
      >
        {chosenIcon === 'layers' ? (
          <Layers className={cn('shrink-0', iconClassName)} />
        ) : chosenIcon === 'boxes' ? (
          <Boxes className={cn('shrink-0', iconClassName)} />
        ) : (
          <Package className={cn('shrink-0', iconClassName)} />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center',
        className
      )}
    >
      <img
        src={trimmedSrc}
        alt={alt}
        onError={() => setHasError(true)}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
  );
};
