import { extractText, getDocumentProxy } from 'unpdf';
import { renderPrompt } from '../../llm/prompts.js';
import type { ImageInput, LLMProvider } from '../../llm/types.js';
import { HttpError } from '../../lib/http.js';

export type AcceptedMime = 'application/pdf' | ImageInput['mimeType'];

/**
 * Type réel du fichier d'après ses premiers octets : on ne fait confiance
 * ni à l'extension ni au type annoncé par le navigateur.
 */
export function sniffMime(data: Buffer): AcceptedMime | null {
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Erreur d'extraction montrée telle quelle à l'utilisateur (422). */
export class ExtractionError extends HttpError {
  constructor(message: string) {
    super(422, message);
  }
}

const MIN_TEXT = 15;

/** Texte d'un PDF, page par page. Un PDF scanné (images seules) n'a pas de texte. */
export async function extractPdf(data: Buffer): Promise<string[]> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    pages = (await extractText(pdf, { mergePages: false })).text as string[];
  } catch {
    throw new ExtractionError('Ce PDF est illisible ou protégé. Essayez de l’enregistrer à nouveau en PDF.');
  }
  if (pages.join('').replace(/\s/g, '').length < MIN_TEXT) {
    throw new ExtractionError(
      'Ce PDF ne contient que des images (document scanné). Importez plutôt des photos des pages, une par une.',
    );
  }
  return pages;
}

/** Texte d'une photo, lu par le modèle de vision du fournisseur d'IA. */
export async function ocrImage(llm: LLMProvider, image: ImageInput, userId: string): Promise<string> {
  const { text } = await llm.vision(image, renderPrompt('ocr.image', {}), { userId, purpose: 'vision' });
  const cleaned = text.trim();
  if (!cleaned || /^ILLISIBLE\.?$/i.test(cleaned) || cleaned.replace(/\s/g, '').length < MIN_TEXT) {
    throw new ExtractionError('Je n’arrive pas à lire cette photo. Reprends-la bien à plat, nette et avec de la lumière.');
  }
  return cleaned;
}

/** Découpe en passages d'environ `max` caractères, sans couper les paragraphes si possible. */
export function chunkPages(pages: string[], max = 900): { page: number; contenu: string }[] {
  const chunks: { page: number; contenu: string }[] = [];
  pages.forEach((raw, i) => {
    const paragraphs = raw
      .replace(/[ \t]+/g, ' ')
      .split(/\n\s*\n|(?<=[.!?:])\s*\n/)
      .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean);
    let current = '';
    const flush = () => {
      if (current.trim()) chunks.push({ page: i + 1, contenu: current.trim() });
      current = '';
    };
    for (const paragraph of paragraphs) {
      const parts = paragraph.length > max ? paragraph.split(/(?<=[.!?;])\s+/) : [paragraph];
      for (const part of parts) {
        if (current && current.length + part.length + 1 > max) flush();
        current += (current ? '\n' : '') + part.slice(0, max * 2);
      }
    }
    flush();
  });
  return chunks;
}
