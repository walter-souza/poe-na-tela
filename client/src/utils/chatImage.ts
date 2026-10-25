export const CHAT_IMAGE_TOPIC = 'chat-image';

// Raster formats only: SVG can carry scripts.
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const MAX_CAPTION_LENGTH = 1000;
export const MAX_RECEIVED_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;

export const isAcceptedImage = (file: File) => ACCEPTED_TYPES.includes(file.type);
export const isAcceptedMime = (mime: string) => ACCEPTED_TYPES.includes(mime);

/**
 * Validates and downscales an image so it fits comfortably in the data channel.
 * Re-encoding through a canvas also drops EXIF metadata (GPS, device info).
 * Animated GIFs are sent untouched when already small, since a canvas would flatten them.
 */
export async function prepareChatImage(file: File): Promise<File> {
  if (!isAcceptedImage(file)) throw new Error('Formato não suportado. Use PNG, JPG, WebP ou GIF.');
  if (file.size > MAX_SOURCE_BYTES) throw new Error('Imagem muito grande (máx. 10 MB).');
  if (file.type === 'image/gif' && file.size <= MAX_RECEIVED_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem.');
  // JPEG has no alpha; paint white so transparent PNGs do not turn black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY)
  );
  if (!blob) throw new Error('Não foi possível processar a imagem.');
  if (blob.size > MAX_RECEIVED_BYTES) throw new Error('Imagem muito grande mesmo após compressão.');
  return new File([blob], 'image.jpg', { type: 'image/jpeg' });
}
