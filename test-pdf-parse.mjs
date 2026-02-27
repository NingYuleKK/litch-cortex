import { PDFParse } from 'pdf-parse';
import fs from 'fs';

const buffer = fs.readFileSync('/home/ubuntu/upload/PicoPico运营策略与集群.pdf');
console.log('=== PDF Parse Test ===');
console.log('Buffer size:', buffer.length, 'bytes');
console.log('Base64 size:', Math.ceil(buffer.length * 4 / 3), 'bytes (~' + (Math.ceil(buffer.length * 4 / 3) / 1024 / 1024).toFixed(1) + ' MB)');

const parser = new PDFParse({ data: buffer });
const result = await parser.getText();
const text = result.text;

console.log('\n=== Text Analysis ===');
console.log('Text length:', text.length);
console.log('Has null bytes:', text.includes('\x00'));

// Test chunkText (same logic as in routers.ts)
function chunkText(text, minSize = 500, maxSize = 800) {
  const results = [];
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  let current = "";
  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (current.length + trimmed.length + 1 <= maxSize) {
      current = current ? current + "\n\n" + trimmed : trimmed;
    } else {
      if (current.length >= minSize) {
        results.push(current);
        current = trimmed;
      } else if (current.length + trimmed.length + 1 <= maxSize * 1.2) {
        current = current ? current + "\n\n" + trimmed : trimmed;
      } else {
        if (current) results.push(current);
        current = trimmed;
      }
    }
  }
  if (current) results.push(current);

  const finalResults = [];
  for (const chunk of results) {
    if (chunk.length <= maxSize * 1.5) {
      finalResults.push(chunk);
    } else {
      const sentences = chunk.split(/(?<=[。！？.!?])\s*/);
      let sub = "";
      for (const sent of sentences) {
        if (sub.length + sent.length + 1 <= maxSize) {
          sub = sub ? sub + sent : sent;
        } else {
          if (sub) finalResults.push(sub);
          sub = sent;
        }
      }
      if (sub) finalResults.push(sub);
    }
  }

  return finalResults.length > 0 ? finalResults : [text.slice(0, maxSize)];
}

console.log('\n=== Chunk Test ===');
const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
console.log('Paragraph count:', paragraphs.length);
console.log('First 5 paragraph lengths:', paragraphs.slice(0, 5).map(p => p.length));

const chunks = chunkText(text);
console.log('Chunk count:', chunks.length);
console.log('First chunk length:', chunks[0]?.length);
console.log('Last chunk length:', chunks[chunks.length - 1]?.length);

// Check rawText size for MySQL mediumtext
console.log('\n=== Database Compatibility ===');
console.log('rawText bytes (UTF-8):', Buffer.byteLength(text, 'utf8'));
console.log('MySQL MEDIUMTEXT limit: 16,777,215 bytes');
console.log('Fits in MEDIUMTEXT:', Buffer.byteLength(text, 'utf8') <= 16777215);

console.log('\n=== Conclusion ===');
console.log('PDF parses OK, chunks OK. Issue is likely in upload transport (31MB Base64 payload).');
