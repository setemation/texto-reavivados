import fs from 'fs';
import path from 'path';

let hebrewCache = null;

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { book, chapter } = req.query;

  if (!book || !chapter) {
    return res.status(400).json({ error: 'Missing book or chapter parameter' });
  }

  try {
    const bookNum = parseInt(book, 10);
    const chapNum = parseInt(chapter, 10);

    if (!hebrewCache) {
      console.log('[Hebrew Bible] Loading CSV file into memory...');
      hebrewCache = {};
      const filePath = path.join(process.cwd(), 'OpenHebrewBible-master', '007-BHS-8-layer-interlinear', 'BHSA-8-layer-interlinear.csv');
      
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent.split('\n');
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          const parts = line.split('\t');
          if (parts.length > 1) {
            const refCol = parts[1];
            const startIdx = refCol.indexOf('〔');
            const endIdx = refCol.indexOf('〕');
            if (startIdx !== -1 && endIdx !== -1) {
              const sub = refCol.substring(startIdx + 1, endIdx);
              const segments = sub.split('｜');
              if (segments.length >= 4) {
                const bNum = segments[1];
                const cNum = segments[2];
                const vNum = parseInt(segments[3], 10);
                const key = `${bNum}:${cNum}`;
                if (!hebrewCache[key]) hebrewCache[key] = [];

                hebrewCache[key].push({
                  sort: parseInt(parts[0], 10),
                  verse: vNum,
                  word: parts[2],
                  translit: parts[3],
                  phonetic: parts[4],
                  lexeme: parts[5],
                  lexemeId: parts[6],
                  strong: parts[7],
                  morphCode: parts[8],
                  morphDetail: parts[9],
                  gloss: parts[10],
                  bsb: parts[11]
                });
              }
            }
          }
        }
        console.log('[Hebrew Bible] Loaded successfully.');
      } else {
        console.error('[Hebrew Bible] File not found:', filePath);
        return res.status(500).json({ error: 'Hebrew Bible CSV file not found on server' });
      }
    }

    const key = `${bookNum}:${chapNum}`;
    const data = hebrewCache[key] || [];
    return res.status(200).json({ data });
  } catch (e) {
    console.error('[Hebrew Bible] Error:', e.message);
    return res.status(500).json({ error: `Server error: ${e.message}` });
  }
}
