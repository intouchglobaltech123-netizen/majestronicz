import React from 'react';
import { X, MapPin, Calendar, Clock, ExternalLink } from 'lucide-react';
import { GeoLocationCapture } from '../../types';
import { hasCoords, mapsLink } from '../../lib/geo';

interface PhotoLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  photoUrl: string | null;
  /** M6: photos load on demand — true while fetching the selfie. */
  loading?: boolean;
  title: string;
  timestamp?: string;
  date?: string;
  location?: GeoLocationCapture | null;
}

export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  isOpen,
  onClose,
  photoUrl,
  loading = false,
  title,
  timestamp,
  date,
  location,
}) => {
  if (!isOpen) return null;

  const mapsUrl = mapsLink(location);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 rounded-none w-full max-w-lg overflow-hidden shadow-2xl flex flex-col text-white">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-100">{title}</h3>
            <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
              {date && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  <span>{date}</span>
                </span>
              )}
              {timestamp && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>{timestamp}</span>
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-none transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Photo Container */}
        <div className="relative aspect-4/3 bg-black flex items-center justify-center overflow-hidden">
          {loading ? (
            <span className="text-sm text-slate-400">Loading selfie…</span>
          ) : photoUrl ? (
            <img
              src={photoUrl}
              alt={title}
              className="w-full h-full object-contain"
            />
          ) : (
            <span className="text-sm text-slate-400">No selfie was captured for this entry.</span>
          )}
        </div>

        {/* Footer with Geolocation Details */}
        {location && (
          <div className="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-start gap-2">
              <MapPin className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-200">
                  {location.addressHint || 'Verified Attendance Location'}
                </p>
                <p className="text-[11px] text-slate-400 font-mono">
                  {hasCoords(location)
                    ? `${location.latitude.toFixed(5)}° N, ${location.longitude.toFixed(5)}° E `
                    : 'No GPS coordinates '}
                  {typeof location.accuracy === 'number' ? `(±${Math.round(location.accuracy)}m)` : ''}
                </p>
              </div>
            </div>

            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-none bg-slate-800 hover:bg-slate-700 text-red-400 border border-slate-700 text-xs font-semibold transition-colors"
              >
                <span>View on Map</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
