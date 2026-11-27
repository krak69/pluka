import { AvatarImageRejected, type AvatarImageProcessor } from '@pluka/domain';
import sharp from 'sharp';

/**
 * Le réencodage d'une photo de profil — 03_PRIVACY_RLS §54.1 ; 0115.
 *
 * Comme les images d'un site (`site-images.ts`) : la photo est décodée puis
 * réécrite en WebP, si bien que ses métadonnées — position GPS, appareil — ne
 * survivent pas. Elle est recadrée au carré sur ce qui attire l'œil (un
 * visage, le plus souvent), à une taille qui suffit à un rond de 96 px en
 * densité 3.
 */

const SIZE = 384;

/* Une image plus grande que ceci, décodée, serait une bombe de décompression. */
const MAX_INPUT_PIXELS = 60_000_000;

export const sharpAvatarImages: AvatarImageProcessor = {
  async process(bytes) {
    let pipeline;
    try {
      pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
      const meta = await pipeline.metadata();
      if (meta.width === undefined || meta.height === undefined) throw new Error('dimensions');
    } catch {
      throw new AvatarImageRejected();
    }

    const output = await pipeline
      .resize({ width: SIZE, height: SIZE, fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();

    return { bytes: new Uint8Array(output), contentType: 'image/webp' };
  },
};
