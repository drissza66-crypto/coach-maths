/**
 * Prépare une photo avant l'envoi :
 * - redimensionnée (les photos de téléphone font souvent 4 000 px et plusieurs Mo) ;
 * - ré-encodée en JPEG, ce qui retire les métadonnées EXIF, dont la position GPS ;
 * - remise à l'endroit selon l'orientation du téléphone.
 */
export async function prepareImage(file: File, maxSide = 2000): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image illisible.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image illisible.'))), 'image/jpeg', 0.85),
  );
}
