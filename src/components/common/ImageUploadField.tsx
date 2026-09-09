import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, X, RefreshCw, Loader2, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { resizeAndCompressImage } from '../../lib/imageUtils';
import { toast } from 'sonner';

/**
 * STOPGAP ARCHITECTURE NOTE:
 * Storing images as base64 data URLs in localStorage is a stopgap for the current client-side state.
 * Once migrated to Postgres/Railway backend, this should move to real object storage
 * (S3-compatible, e.g. AWS S3 or Cloudflare R2) rather than storing images inline in the database.
 */

export interface ImageUploadFieldProps {
  value?: string;
  onChange: (dataUrl: string) => void;
  disabled?: boolean;
  label?: string;
  sublabel?: string;
  altText?: string;
  className?: string;
}

export const ImageUploadField: React.FC<ImageUploadFieldProps> = ({
  value,
  onChange,
  disabled = false,
  label = 'Product Image',
  sublabel = 'JPG, PNG, or WEBP (automatically optimized to max 600px)',
  altText = 'Product thumbnail preview',
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (disabled) return;

    // Validate type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const hasValidMime = validTypes.includes(file.type.toLowerCase());
    const hasValidExt = /\.(jpe?g|png|webp)$/i.test(file.name);

    if (!hasValidMime && !hasValidExt) {
      toast.error('Invalid image file', {
        description: 'Please upload a JPG, PNG, or WEBP image file.',
      });
      return;
    }

    try {
      setIsProcessing(true);
      const result = await resizeAndCompressImage(file, 600, 0.8);
      onChange(result.dataUrl);
      toast.success('Image optimized & uploaded', {
        description: `${result.width}×${result.height}px (~${result.sizeKb} KB) JPEG ready for storage.`,
      });
    } catch (err: any) {
      toast.error('Could not process image', {
        description: err.message || 'An error occurred while compressing the image.',
      });
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled && !isProcessing) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled || isProcessing) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleTriggerBrowse = () => {
    if (!disabled && !isProcessing && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleRemove = () => {
    if (disabled) return;
    onChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    toast.info('Product image removed');
  };

  const hasImage = Boolean(value && value.trim());

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* Label & Instructions */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <span>{label}</span>
          <span className="text-slate-400 font-normal">(Optional)</span>
        </label>
        <span className="text-[10px] text-slate-400 font-normal hidden sm:inline">
          {sublabel}
        </span>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileInputChange}
        disabled={disabled || isProcessing}
        className="hidden"
      />

      {/* Upload Box / Live Thumbnail Preview Card */}
      {hasImage ? (
        /* Image Preview State */
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center gap-3.5 min-w-0">
            {/* Live Thumbnail Preview */}
            <div className="relative h-14 w-14 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden shrink-0 flex items-center justify-center">
              <img
                src={value}
                alt={altText}
                className="h-full w-full object-contain p-0.5"
                onError={(e) => {
                  // Fallback on broken image link
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>

            {/* Info & Status */}
            <div className="min-w-0 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-800">Product Image Uploaded</span>
                <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.2 rounded-md">
                  Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                {value?.startsWith('data:image')
                  ? 'Optimized client-side JPEG (max 600px)'
                  : 'Web image source link'}
              </p>
            </div>
          </div>

          {/* Action Buttons: Replace & Remove */}
          {!disabled && (
            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              <button
                type="button"
                onClick={handleTriggerBrowse}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50"
                title="Replace image with a new file"
              >
                {isProcessing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
                )}
                <span>Replace</span>
              </button>

              <button
                type="button"
                onClick={handleRemove}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50/70 hover:bg-rose-100/80 text-rose-700 text-xs font-semibold transition-colors disabled:opacity-50"
                title="Remove product image"
              >
                <X className="h-3.5 w-3.5" />
                <span>Remove</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Empty / Dropzone State */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleTriggerBrowse}
          className={cn(
            'relative rounded-xl border-2 border-dashed p-4 flex flex-col items-center justify-center text-center transition-all cursor-pointer select-none',
            isDragging
              ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20'
              : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300',
            disabled && 'opacity-60 cursor-not-allowed hover:border-slate-200 hover:bg-slate-50/50'
          )}
        >
          {isProcessing ? (
            <div className="flex flex-col items-center gap-2 py-1 text-slate-600">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              <span className="text-xs font-semibold">Resizing & compressing image (max 600px)...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <div className="h-9 w-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mb-0.5">
                {isDragging ? (
                  <Upload className="h-4 w-4 animate-bounce" />
                ) : (
                  <ImageIcon className="h-4 w-4" />
                )}
              </div>
              <div className="text-xs font-semibold text-slate-700">
                <span className="text-blue-600 hover:underline">Click to browse</span> or drag and drop image
              </div>
              <p className="text-[11px] text-slate-400">
                JPG, PNG, or WEBP • Resized client-side to max 600px
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
