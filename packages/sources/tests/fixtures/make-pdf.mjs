import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/**
 * Générateur des PDF de référence — provenance des fixtures binaires.
 *
 * Un PDF committé est illisible en revue : on ne voit ni ce qu'il contient, ni
 * pourquoi il est malformé. Ce script est donc la source de vérité, et les
 * fichiers qu'il produit sont committés à côté de lui.
 *
 * Relancer :
 *
 *   node packages/sources/tests/fixtures/make-pdf.mjs
 *
 * Les PDF sont écrits à la main plutôt qu'avec une bibliothèque : il faut
 * pouvoir produire des documents volontairement hostiles — xref faux, flux
 * tronqué, chiffrement déclaré — qu'aucun générateur correct n'accepterait
 * d'émettre.
 */

const ENCODER = new TextEncoder();

/** Assemble les objets, calcule la table xref et rend les octets du fichier. */
function buildPdf(objects, { trailerExtra = '', brokenXref = false } = {}) {
  const parts = [];
  const offsets = [];
  let length = 0;

  function push(chunk) {
    const bytes = typeof chunk === 'string' ? ENCODER.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  }

  push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');

  objects.forEach((body, index) => {
    offsets[index] = length;
    push(`${index + 1} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else push(body);
    push('\nendobj\n');
  });

  const xrefOffset = length;
  push(`xref\n0 ${objects.length + 1}\n`);
  push('0000000000 65535 f \n');

  for (const offset of offsets) {
    // Un xref faux : les décalages ne pointent nulle part. pdf.js doit alors
    // reconstruire le document, ou échouer proprement.
    const value = brokenXref ? 999999 : offset;
    push(`${String(value).padStart(10, '0')} 00000 n \n`);
  }

  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\n`);
  push(`startxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

/** Un flux de contenu, éventuellement compressé — §13 « flux compressés ». */
function stream(content, { compress = false } = {}) {
  const raw = ENCODER.encode(content);
  const data = compress ? deflateSync(raw) : Buffer.from(raw);
  const filter = compress ? ' /Filter /FlateDecode' : '';
  const header = ENCODER.encode(`<< /Length ${data.length}${filter} >>\nstream\n`);
  const footer = ENCODER.encode('\nendstream');

  return Buffer.concat([Buffer.from(header), Buffer.from(data), Buffer.from(footer)]);
}

/** Texte positionné : chaque `Td` place une ligne, comme un vrai générateur. */
function page(lines) {
  const body = lines
    .map(({ text, size = 12, x = 72, y }) =>
      [`BT`, `/F1 ${size} Tf`, `1 0 0 1 ${x} ${y} Tm`, `(${escape(text)}) Tj`, `ET`].join('\n'),
    )
    .join('\n');

  return body;
}

function escape(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// ============================================================
// Règlement de référence : deux pages, flux compressés, titres
// ============================================================

const PAGE_ONE = page([
  { text: 'Reglement 2026', size: 20, y: 720 },
  { text: 'Depart', size: 15, y: 680 },
  { text: 'Le depart sera donne le 20 juin 2026 a 7h10 depuis Adelboden.', y: 655 },
  { text: 'Parcours', size: 15, y: 615 },
  { text: 'Le parcours mesure 70 km pour 4600 m D+.', y: 590 },
]);

const PAGE_TWO = page([
  { text: 'Assistance', size: 15, y: 720 },
  { text: "L'assistance personnelle est autorisee uniquement a Lenk.", y: 695 },
  { text: 'Les accompagnateurs restent sur le parking indique.', y: 675 },
]);

const reference = buildPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
  stream(PAGE_ONE, { compress: true }),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  stream(PAGE_TWO, { compress: true }),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
]);

// ============================================================
// PDF scanné : une image, aucune couche texte (§14)
// ============================================================

const scanned = buildPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
  stream('q 595 0 0 842 0 0 cm /Im1 Do Q'),
  Buffer.concat([
    Buffer.from(
      ENCODER.encode(
        '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\n',
      ),
    ),
    Buffer.from([0x00, 0xff, 0xff, 0x00]),
    Buffer.from(ENCODER.encode('\nendstream')),
  ]),
]);

// ============================================================
// PDF chiffré : le dictionnaire /Encrypt suffit à le déclarer
// ============================================================

const encrypted = buildPdf(
  [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    stream('BT /F1 12 Tf 72 720 Td (secret) Tj ET'),
    '<< /Filter /Standard /V 1 /R 2 /O <28BF4E5E4E758A4164004E56FFFA0108> /U <28BF4E5E4E758A4164004E56FFFA0108> /P -1 >>',
  ],
  { trailerExtra: '/Encrypt 5 0 R /ID [<0102030405060708> <0102030405060708>] ' },
);

// ============================================================
// PDF avec JavaScript embarqué : il ne doit jamais s'exécuter
// ============================================================

const withJavaScript = buildPdf([
  '<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R /Names << /JavaScript << /Names [(pwn) 5 0 R] >> >> >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>',
  stream(page([{ text: 'Barriere horaire a Iffigenalp: 16h20', y: 720 }])),
  '<< /S /JavaScript /JS (globalThis.PWNED = true; app.alert("pwn");) >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
]);

// ============================================================
// PDF malformé : table xref mensongère
// ============================================================

const brokenXref = buildPdf(
  [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    stream(page([{ text: 'Ravitaillement a Lenk', y: 720 }])),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ],
  { brokenXref: true },
);

// ============================================================
// Barrières horaires : le même tableau que l'équivalent HTML
// ============================================================
//
// Les colonnes sont posées à des abscisses fixes, comme le ferait n'importe
// quel générateur : c'est ainsi qu'un tableau existe dans un PDF — il n'y a
// aucune balise, seulement des gouttières. La détection de §13 doit les
// retrouver, pour que l'extraction de §84 lise les mêmes barrières que depuis
// le HTML.
//
// Le tableau est en page 2 : `page_number` doit valoir 2, ce qu'une fixture
// d'une seule page ne prouverait pas.

const BARRIERES_PAGE_ONE = page([
  { text: 'Reglement 2026', size: 20, y: 720 },
  { text: 'Assistance', size: 15, y: 680 },
  { text: "L'assistance personnelle est autorisee uniquement a Lenk.", y: 655 },
]);

/** Une ligne de tableau : trois cellules, à trois abscisses distinctes. */
function row(cells, y) {
  return cells.map(([text, x], index) => ({ text, x, y, size: index === undefined ? 12 : 12 }));
}

const BARRIERES_PAGE_TWO = page([
  { text: 'Barrieres horaires', size: 15, y: 720 },
  ...row(
    [
      ['Point', 72],
      ['Distance', 220],
      ['Barriere (arrivee)', 340],
    ],
    680,
  ),
  ...row(
    [
      ['Iffigenalp', 72],
      ['32 km', 220],
      ['16h20', 340],
    ],
    660,
  ),
  ...row(
    [
      ['Adelboden', 72],
      ['58 km', 220],
      ['21h45', 340],
    ],
    640,
  ),
  { text: 'Tout coureur hors barriere est mis hors course.', y: 600 },
]);

const barrieres = buildPdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
  stream(BARRIERES_PAGE_ONE, { compress: true }),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  stream(BARRIERES_PAGE_TWO, { compress: true }),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
]);

const here = new URL('.', import.meta.url);

for (const [name, bytes] of [
  ['reglement.pdf', reference],
  ['scanned.pdf', scanned],
  ['encrypted.pdf', encrypted],
  ['javascript.pdf', withJavaScript],
  ['broken-xref.pdf', brokenXref],
  ['barrieres.pdf', barrieres],
]) {
  writeFileSync(new URL(name, here), bytes);
  console.log(`${name} — ${bytes.length} octets`);
}
