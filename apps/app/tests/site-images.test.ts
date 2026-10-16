import { EventSiteImageRejected } from '@pluka/domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { sharpSiteImages } from '@/lib/site-images';

/**
 * Le réencodage des images d'un site — EVENT_SITE §4.
 *
 * Ce qui sort est un WebP aux dimensions bornées, sans les métadonnées de
 * l'original ; ce qui n'est pas une image est refusé.
 */

async function photo(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 52, b: 44 } },
  })
    .jpeg()
    .withExifMerge({ IFD0: { Copyright: 'Photographe', ImageDescription: 'Col du Test' } })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe('la couverture', () => {
  it('est recadrée en bandeau, en WebP, sans les métadonnées de l’original', async () => {
    const input = await photo(4000, 3000);
    // L'original porte bien des métadonnées : sinon le test ne prouverait rien.
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await sharpSiteImages.process('cover', input);
    const meta = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe('image/webp');
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([2400, 1000]);
    expect(meta.exif).toBeUndefined();
  });

  it('n’est pas agrandie quand elle est petite', async () => {
    const result = await sharpSiteImages.process('cover', await photo(800, 600));
    const meta = await sharp(result.bytes).metadata();

    expect(meta.width).toBeLessThanOrEqual(800);
  });
});

describe('le logo', () => {
  it('tient dans son cadre et garde sa transparence', async () => {
    const png = await sharp({
      create: { width: 2000, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const result = await sharpSiteImages.process('logo', new Uint8Array(png));
    const meta = await sharp(result.bytes).metadata();

    expect(meta.width).toBeLessThanOrEqual(640);
    expect(meta.height).toBeLessThanOrEqual(256);
    expect(meta.hasAlpha).toBe(true);
  });
});

describe('un fichier qui n’est pas une image', () => {
  it('est refusé', async () => {
    const svg = new TextEncoder().encode('<svg onload="alert(1)"></svg><script>alert(1)</script>');
    await expect(sharpSiteImages.process('logo', new TextEncoder().encode('pas une image'))).rejects.toBeInstanceOf(
      EventSiteImageRejected,
    );
    await expect(sharpSiteImages.process('logo', svg)).rejects.toBeInstanceOf(EventSiteImageRejected);
  });
});
