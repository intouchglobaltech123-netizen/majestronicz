import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * Renders a QR code for `value` as an <img> (a locally-generated data URL, so it
 * works offline and embeds cleanly in the printed / exported invoice PDF).
 * Renders nothing when there's no value or generation fails.
 */
export const QrCode: React.FC<{ value?: string | null; size?: number; className?: string }> = ({ value, size = 90, className }) => {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    const v = (value || '').trim();
    if (!v) { setUrl(''); return; }
    QRCode.toDataURL(v, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' })
      .then((u) => { if (alive) setUrl(u); })
      .catch(() => { if (alive) setUrl(''); });
    return () => { alive = false; };
  }, [value, size]);
  if (!url) return null;
  return <img src={url} width={size} height={size} className={className} alt="QR code" />;
};
