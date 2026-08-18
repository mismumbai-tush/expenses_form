/**
 * Helper utility to safely process, compress, and prepare receipt images/documents
 * for expense submissions without exceeding network payload or reverse proxy limits.
 */

export interface ProcessedFile {
  base64: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
}

/**
 * Compresses an image client-side to ensure sharp legibility for receipts while reducing payload size by 90-95%.
 */
export async function processReceiptFile(file: File): Promise<ProcessedFile> {
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|heic|heif)$/i.test(file.name);

  // If it's not an image (e.g. PDF)
  if (!isImage) {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error(`File "${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Please upload a document under 10MB.`);
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read file document.'));
      reader.onload = () => {
        resolve({
          base64: reader.result as string,
          fileName: file.name,
          fileType: file.type || 'application/pdf',
          sizeBytes: file.size
        });
      };
      reader.readAsDataURL(file);
    });
  }

  // If it's an image, resize & compress using Canvas
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read receipt image.'));
    reader.onload = (event) => {
      const rawDataUrl = event.target?.result as string;
      const img = new Image();

      img.onerror = () => {
        // If image loading fails, fallback to raw base64 if within reasonable size
        if (file.size > 8 * 1024 * 1024) {
          reject(new Error(`Image "${file.name}" is too large and could not be compressed. Please upload a smaller image.`));
          return;
        }
        resolve({
          base64: rawDataUrl,
          fileName: file.name,
          fileType: file.type || 'image/jpeg',
          sizeBytes: file.size
        });
      };

      img.onload = () => {
        try {
          const MAX_DIM = 1600; // Optimal resolution for bills & receipts (all text crisp & legible)
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;

          if (width > height) {
            if (width > MAX_DIM) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            }
          } else {
            if (height > MAX_DIM) {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({
              base64: rawDataUrl,
              fileName: file.name,
              fileType: file.type || 'image/jpeg',
              sizeBytes: file.size
            });
            return;
          }

          // Fill solid white background so transparent PNGs don't render black on JPG conversion
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          // Export as JPEG at 0.82 quality (great text clarity with small ~150-350KB payload)
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
          const cleanFileName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';

          resolve({
            base64: compressedDataUrl,
            fileName: cleanFileName,
            fileType: 'image/jpeg',
            sizeBytes: Math.round((compressedDataUrl.length * 3) / 4)
          });
        } catch {
          resolve({
            base64: rawDataUrl,
            fileName: file.name,
            fileType: file.type || 'image/jpeg',
            sizeBytes: file.size
          });
        }
      };

      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Safely executes a fetch request and parses JSON response, preventing uncaught SyntaxErrors
 * when reverse proxies or servers return plain text/HTML error responses (e.g. 413, 502).
 */
export async function safeFetchJson<T = any>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const rawText = await response.text();

  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    // Non-JSON response received (e.g., HTML 413 "Request Entity Too Large", 502 Bad Gateway)
    if (response.status === 413 || rawText.toLowerCase().includes('entity too large') || rawText.toLowerCase().includes('payload too large')) {
      throw new Error('Upload payload is too large. Please ensure receipt photos or attachments are under 10MB.');
    }
    if (response.status === 502 || response.status === 504) {
      throw new Error('Server is taking too long to respond. Please try again in a few moments.');
    }
    const cleanSnippet = rawText.replace(/<[^>]*>?/gm, '').trim().slice(0, 150);
    throw new Error(cleanSnippet || `Server returned error status (${response.status})`);
  }

  if (!response.ok && data?.error) {
    throw new Error(data.error);
  }

  return data as T;
}
