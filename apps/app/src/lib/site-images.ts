import { EventSiteImageRejected, type EventSiteImageProcessor } from '@pluka/domain';
import sharp from 'sharp';

/**
 * Le réencodage des images d'un site — EVENT_SITE §4.
 *
 * Toute image déposée est décodée puis réécrite en WebP : ce qui en sort est
 * une image, et seulement une image. Les métadonnées — position GPS d'une
 * photo, appareil — ne survivent pas à la réécriture. Le logo garde sa
 * transparence ; la couverture est recadrée au format bandeau ; une photo de
 * galerie garde ses proportions.
 */

/* Assez pour un écran large en densité 2, sans plus. */
const COVER = { width: 2400, height: 1000 } as const;
const LOGO = { width: 640, height: 256 } as const;
const GALLERY = { width: 1800, height: 1800 } as const;

/* Une image plus grande que ceci, décodée, serait une bombe de décompression. */
const MAX_INPUT_PIXELS = 60_000_000;

export const sharpSiteImages: EventSiteImageProcessor = {
  async process(kind, bytes) {
    let pipeline;
    try {
      pipeline = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate();
      const meta = await pipeline.metadata();
      if (meta.width === undefined || meta.height === undefined) throw new Error('dimensions');
    } catch {
      throw new EventSiteImageRejected('Ce fichier n’est pas une image lisible.');
    }

    const resized =
      kind === 'cover'
        ? pipeline.resize({ ...COVER, fit: 'cover', position: 'attention', withoutEnlargement: true })
        : pipeline.resize({
            ...(kind === 'logo' ? LOGO : GALLERY),
            fit: 'inside',
            withoutEnlargement: true,
          });
    const output = await (kind === 'logo'
      ? resized.webp({ quality: 90, alphaQuality: 100 })
      : resized.webp({ quality: 80 })
    ).toBuffer();

    return { bytes: new Uint8Array(output), contentType: 'image/webp', extension: 'webp' };
  },
};
