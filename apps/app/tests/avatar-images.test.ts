import { AvatarImageRejected } from '@pluka/domain';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { sharpAvatarImages } from '@/lib/avatar-images';

/**
 * Le réencodage d'une photo de profil — 03_PRIVACY_RLS §54.1 ; 0115.
 *
 * Ce qui sort est un WebP carré, sans les métadonnées de l'original (position
 * GPS comprise) : c'est lui que d'autres participants verront.
 */

async function photo(width: number, height: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 52, b: 44 } },
  })
    .jpeg()
    .withExifMerge({ IFD0: { Copyright: 'Alice', ImageDescription: 'Chez moi' } })
    .toBuffer();
  return new Uint8Array(buffer);
}

describe('une photo de profil', () => {
  it('sort en WebP carré de 384 px, sans les métadonnées de l’original', async () => {
    const input = await photo(3000, 2000);
    // L'original porte bien des métadonnées : sinon le test ne prouverait rien.
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await sharpAvatarImages.process(input);
    const meta = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe('image/webp');
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([384, 384]);
    expect(meta.exif).toBeUndefined();
    // Assez léger pour le bucket (un mégaoctet au plus, 0115).
    expect(result.bytes.length).toBeLessThan(1024 * 1024);
  });

  it('une petite photo est agrandie au carré plutôt que laissée de travers', async () => {
    const meta = await sharp(
      (await sharpAvatarImages.process(await photo(120, 90))).bytes,
    ).metadata();

    expect([meta.width, meta.height]).toEqual([384, 384]);
  });

  it('ce qui n’est pas une image est refusé', async () => {
    await expect(
      sharpAvatarImages.process(new TextEncoder().encode('<script>alert(1)</script>')),
    ).rejects.toBeInstanceOf(AvatarImageRejected);
  });
});
