import React, { useEffect } from 'react';
import { X, Download, ZoomIn } from 'lucide-react';

export interface ImageViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  src?: string | null;
  title?: string;
  subtitle?: string;
}

export const ImageViewModal: React.FC<ImageViewModalProps> = ({
  isOpen,
  onClose,
  src,
  title = 'Image Preview',
  subtitle,
}) => {
  // Close on Escape keypress
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !src) return null;

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const link = document.createElement('a');
      link.href = src;
      const cleanTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      link.download = `${cleanTitle || 'product-image'}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      // Fallback
      window.open(src, '_blank');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl overflow-hidden w-full max-w-2xl border border-slate-200/80 flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/90 shrink-0">
          <div className="min-w-0 pr-4">
            <h3 className="text-sm font-bold text-slate-900 truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-slate-500 font-mono truncate mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              className="h-8 w-8 rounded-xl bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 flex items-center justify-center transition-colors cursor-pointer"
              title="Download full image"
              aria-label="Download full image"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-xl bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-200 hover:border-rose-200 flex items-center justify-center transition-colors cursor-pointer"
              title="Close (Esc)"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Modal Body: Image Container with checkered pattern for transparency */}
        <div className="flex-1 overflow-auto p-4 sm:p-6 flex items-center justify-center bg-slate-900/5 min-h-[260px] max-h-[75vh]">
          <div className="relative max-h-full max-w-full rounded-xl overflow-hidden shadow-sm border border-slate-200/60 bg-white">
            <img
              src={src}
              alt={title}
              className="max-h-[70vh] max-w-full object-contain rounded-xl select-none"
            />
          </div>
        </div>

        {/* Modal Footer / Hint */}
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <span className="flex items-center gap-1.5 font-medium">
            <ZoomIn className="h-3.5 w-3.5 text-blue-500" />
            Full Resolution View
          </span>
          <span>Press <kbd className="px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-mono text-[10px] shadow-2xs">Esc</kbd> or click outside to close</span>
        </div>
      </div>
    </div>
  );
};

