import React, { useState, useEffect } from 'react';
import { Package, Layers, Boxes, ZoomIn } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ImageViewModal } from './ImageViewModal';

export interface ItemImageProps {
  src?: string | null;
  alt?: string;
  subtitle?: string;
  className?: string;
  iconClassName?: string;
  isCombo?: boolean;
  fallbackIcon?: 'package' | 'boxes' | 'layers';
  /** If true, clicking the thumbnail opens a full-resolution lightbox viewer modal */
  previewable?: boolean;
}

export const ItemImage: React.FC<ItemImageProps> = ({
  src,
  alt = 'Item image',
  subtitle,
  className = 'h-9 w-9 rounded-xl',
  iconClassName = 'h-4 w-4',
  isCombo = false,
  fallbackIcon,
  previewable = false,
}) => {
  const [hasError, setHasError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
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
    <>
      <div
        onClick={(e) => {
          if (previewable) {
            e.stopPropagation();
            setPreviewOpen(true);
          }
        }}
        title={previewable ? `${alt} (Click to view full image)` : alt}
        className={cn(
          'relative shrink-0 overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center group/img',
          previewable && 'cursor-zoom-in hover:ring-2 hover:ring-blue-400 hover:opacity-95 transition-all',
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
        {previewable && (
          <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white">
            <ZoomIn className="h-3.5 w-3.5 drop-shadow-sm" />
          </div>
        )}
      </div>

      {previewable && previewOpen && (
        <ImageViewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          src={trimmedSrc}
          title={alt}
          subtitle={subtitle}
        />
      )}
    </>
  );
};
