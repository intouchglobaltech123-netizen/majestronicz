/**
 * Image processing utilities for Item Master and inventory management.
 * 
 * STOPGAP ARCHITECTURE NOTE:
 * Storing images as base64 data URLs in localStorage is a stopgap for the current client-side state.
 * Once migrated to Postgres/Railway backend, this should move to real object storage
 * (S3-compatible, e.g. AWS S3, Cloudflare R2, or MinIO) rather than storing images inline in the database.
 */

export interface ProcessedImageResult {
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  sizeKb: number;
}

/**
 * Resizes and compresses an image file client-side.
 * - Max dimension: 600px (longest edge, aspect ratio preserved)
 * - Compression: JPEG at ~80% quality (0.8)
 * - Transparent backgrounds flattened to clean white
 *
 * @param file The uploaded image File (jpg/png/webp)
 * @param maxDimension Longest edge in pixels (default 600)
 * @param quality Compression quality from 0.0 to 1.0 (default 0.8)
 */
export async function resizeAndCompressImage(
  file: File,
  maxDimension = 600,
  quality = 0.8
): Promise<ProcessedImageResult> {
  return new Promise((resolve, reject) => {
    // 1. Validate MIME type or file extension
    const validMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const hasValidMime = validMimes.includes(file.type.toLowerCase());
    const hasValidExt = /\.(jpe?g|png|webp)$/i.test(file.name);

    if (!hasValidMime && !hasValidExt) {
      reject(
        new Error(
          'Invalid file type. Please upload a JPG, PNG, or WEBP image.'
        )
      );
      return;
    }

    // 2. Read file to data URL
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to convert image to data URL.'));
        return;
      }

      // 3. Load image element
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to parse and load image.'));
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        // 4. Downscale if exceeds maxDimension (do not upscale smaller images)
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        // 5. Draw on Canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context unavailable in browser.'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Fill with white background (prevents transparent PNGs/WEBPs from showing as black in JPEG)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        // Draw downscaled image
        ctx.drawImage(img, 0, 0, width, height);

        // 6. Export as JPEG at 80% quality
        // STOPGAP: Base64 data URL for localStorage persistence.
        // Migrate to S3-compatible object storage once on Postgres/Railway.
        const dataUrl = canvas.toDataURL('image/jpeg', quality);

        // Approximate size calculation
        const base64Content = dataUrl.split(',')[1] || '';
        const sizeBytes = Math.round((base64Content.length * 3) / 4);
        const sizeKb = Math.round(sizeBytes / 1024);

        resolve({
          dataUrl,
          width,
          height,
          sizeBytes,
          sizeKb,
        });
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}
