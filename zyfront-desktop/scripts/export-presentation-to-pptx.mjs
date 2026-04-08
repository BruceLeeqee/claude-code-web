import fs from 'node:fs/promises';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';

function stripHtml(input) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSlides(html) {
  const matches = [...html.matchAll(/<div\s+class=["']slide["'][^>]*>([\s\S]*?)<\/div>/gi)];
  return matches.map((m) => m[1]);
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    throw new Error('Usage: node scripts/export-presentation-to-pptx.mjs <input.presentation.html> [output.pptx]');
  }

  const inPath = path.resolve(input);
  const html = await fs.readFile(inPath, 'utf8');
  const slides = extractSlides(html);
  if (!slides.length) {
    throw new Error('No slides found. Ensure HTML contains <div class="slide">...</div>.');
  }

  const outPath = process.argv[3]
    ? path.resolve(process.argv[3])
    : inPath.replace(/\.presentation\.html$/i, '.pptx');

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'ZyTrader Desktop';
  pptx.subject = 'Exported from HTML presentation';

  slides.forEach((slideHtml, idx) => {
    const s = pptx.addSlide();
    const text = stripHtml(slideHtml);
    const title = `Slide ${idx + 1}`;

    s.background = { color: '0F172A' };
    s.addText(title, {
      x: 0.5,
      y: 0.3,
      w: 12.3,
      h: 0.5,
      color: 'E2E8F0',
      fontSize: 20,
      bold: true,
    });

    s.addText(text || '(empty slide)', {
      x: 0.6,
      y: 1.0,
      w: 12.0,
      h: 5.8,
      color: 'CBD5E1',
      fontSize: 13,
      valign: 'top',
      breakLine: true,
    });
  });

  await pptx.writeFile({ fileName: outPath });
  console.log(`Exported PPTX: ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
