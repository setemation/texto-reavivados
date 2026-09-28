import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { exec } from 'child_process';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'ollama-launcher',
          configureServer(server) {
            // Auto-start Translator server (port 3001)
            try {
              const translatorServerPath = path.resolve(__dirname, 'translator', 'server.mjs');
              exec(`node "${translatorServerPath}"`, (err) => {
                if (err && !err.killed) console.log('[Translator Launcher] Note:', err.message);
              });
              console.log('[Translator Launcher] Servidor de Tradução inicializado na porta 3001.');
            } catch (e: any) {
              console.error('[Translator Launcher] Erro ao iniciar:', e.message);
            }

            server.middlewares.use('/api/start-ollama', (req, res, next) => {
              if (req.method !== 'POST') return next();
              res.setHeader('Content-Type', 'application/json');
              const batPath = path.resolve(__dirname, 'Iniciar-Ollama.bat');
              // Run the bat file in a new detached process so Ollama starts in background
              exec(`cmd /c start "" "${batPath}"`, (error) => {
                if (error) {
                  console.error('[Ollama Launcher] Error:', error.message);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: `Erro ao iniciar Ollama: ${error.message}` }));
                } else {
                  console.log('[Ollama Launcher] Iniciar-Ollama.bat executado com sucesso.');
                  res.statusCode = 200;
                  res.end(JSON.stringify({ message: 'Ollama iniciado! Aguarde alguns segundos...' }));
                }
              });
            });

            // Cache for Hebrew Bible data
            let hebrewCache: any = null;
            server.middlewares.use('/api/hebrew-bible', (req, res, next) => {
              if (req.method !== 'GET') return next();
              
              const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
              const bookNumStr = urlObj.searchParams.get('book');
              const chapNumStr = urlObj.searchParams.get('chapter');
              
              if (!bookNumStr || !chapNumStr) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Missing book or chapter parameter' }));
              }
              
              try {
                const bookNum = parseInt(bookNumStr, 10);
                const chapNum = parseInt(chapNumStr, 10);
                
                if (!hebrewCache) {
                  console.log('[Hebrew Bible] Loading CSV file into memory...');
                  hebrewCache = {};
                  const filePath = path.resolve(__dirname, 'OpenHebrewBible-master', '007-BHS-8-layer-interlinear', 'BHSA-8-layer-interlinear.csv');
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
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json');
                    return res.end(JSON.stringify({ error: 'Hebrew Bible CSV file not found on server' }));
                  }
                }
                
                const key = `${bookNum}:${chapNum}`;
                const data = hebrewCache[key] || [];
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ data }));
              } catch (e: any) {
                console.error('[Hebrew Bible] Error:', e.message);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `Server error: ${e.message}` }));
              }
            });

            // Cache for Local Commentaries (Dados/Obras-Pt and Dados/Obras-En)
            let localCache: Record<string, any[]> | null = null;
            function normalizeBook(name: string): string {
              if (!name) return '';
              const clean = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");
              if (clean === 'salmo') return 'salmos';
              if (clean === 'cantico' || clean === 'canticos' || clean === 'cantares') return 'canticos';
              return clean;
            }

            function loadLocalCommentaries() {
              const cache: Record<string, any[]> = {};
              const ptDir = path.resolve(__dirname, 'Dados', 'Obras-Pt');
              const enDir = path.resolve(__dirname, 'Dados', 'Obras-En');

              const dirs = [
                { dir: ptDir, lang: 'pt' },
                { dir: enDir, lang: 'en' }
              ];

              for (const { dir, lang } of dirs) {
                if (!fs.existsSync(dir)) continue;
                const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
                for (const file of files) {
                  try {
                    const filePath = path.join(dir, file);
                    const raw = fs.readFileSync(filePath, 'utf8');
                    const data = JSON.parse(raw);
                    if (!Array.isArray(data)) continue;

                    let fileAuthor = '';
                    const lower = file.toLowerCase();
                    if (lower.includes('faithlife')) fileAuthor = 'Faithlife Study Bible';
                    else if (lower.includes('andrews')) fileAuthor = 'Andrews Study Bible';
                    else if (lower.includes('cambridge')) fileAuthor = 'Cambridge';
                    else if (lower.includes('clarke')) fileAuthor = 'Clarke';
                    else if (lower.includes('barnes')) fileAuthor = 'Albert Barnes';
                    else if (lower.includes('geneva')) fileAuthor = 'Geneva Bible';
                    else if (lower.includes('gill')) fileAuthor = "John Gill's Exposition";
                    else if (lower.includes('adventista_i') || lower.includes('adventista_1')) fileAuthor = 'Comentário Bíblico Adventista I';
                    else if (lower.includes('comentario_biblico_adventista')) fileAuthor = 'Comentário Bíblico Adventista';
                    else if (lower.includes('adventista')) fileAuthor = 'Comentário Adventista';
                    else if (lower.includes('resumo')) fileAuthor = 'Resumo dos Capítulos';

                    for (const item of data) {
                      const bookName = item.book || item.book_pt || item.book_en || '';
                      if (!bookName) continue;
                      const norm = normalizeBook(bookName);
                      const chap = item.chapter !== undefined ? item.chapter : 0;
                      const key = `${norm}:${chap}`;
                      if (!cache[key]) cache[key] = [];

                      const author = item.author || fileAuthor || (lang === 'pt' ? 'Comentário Pt' : 'Commentary En');
                      const authorKey = `${author} ${lang === 'pt' ? 'Pt' : 'En'}`;

                      cache[key].push({
                        id: item.id || `${lang}_${norm}_${chap}_${item.verse ?? 0}_${cache[key].length}`,
                        author,
                        lang,
                        authorKey,
                        book: bookName,
                        chapter: chap,
                        verse: item.verse ?? null,
                        verse_ref: item.verse_ref || null,
                        text: item.text || ''
                      });
                    }
                    console.log(`[Local Commentaries] Loaded ${file} (${data.length} records, lang: ${lang}).`);
                  } catch (err: any) {
                    console.error(`[Local Commentaries] Error loading ${file}:`, err.message);
                  }
                }
              }
              return cache;
            }

            server.middlewares.use('/api/reload-commentaries', (req, res) => {
              localCache = null;
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, reloaded: true }));
            });

            server.middlewares.use('/api/local-commentaries', (req, res, next) => {
              if (req.method !== 'GET') return next();
              
              const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
              const bookParam = urlObj.searchParams.get('book');
              const chapterParam = urlObj.searchParams.get('chapter');
              
              if (!bookParam) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ error: 'Missing book parameter' }));
              }
              
              try {
                if (!localCache) {
                  console.log('[Local Commentaries] Indexing commentaries from Dados/ into memory cache...');
                  localCache = loadLocalCommentaries();
                }

                const normBook = normalizeBook(bookParam);
                const chap = parseInt(chapterParam || '0', 10);
                const key = `${normBook}:${chap}`;
                const data = (localCache && localCache[key]) || [];

                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ data }));
              } catch (e: any) {
                console.error('[Local Commentaries] Error:', e.message);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `Server error: ${e.message}` }));
              }
            });

            // Sumário por capítulo (Bíblia Sumarizada) - Dados/Extras/biblia_sumarizada*.json
            // Retorna apenas a seção do capítulo pedido (cada registro é uma janela de vários capítulos).
            let sumarizadaCache: Record<string, Record<number, string>> | null = null;

            function loadSumarizada() {
              const cache: Record<string, Record<number, string>> = {};
              const dir = path.resolve(__dirname, 'Dados', 'Extras');
              if (!fs.existsSync(dir)) {
                console.error('[Sumarizada] Directory not found:', dir);
                return cache;
              }

              const files = fs.readdirSync(dir)
                .filter((f) => /^biblia_sumarizada.*\.json$/i.test(f))
                .sort();

              if (!files.length) {
                console.error('[Sumarizada] Nenhum biblia_sumarizada*.json encontrado em', dir);
                return cache;
              }

              const isChapterRecord = (t: string) => /^\s*(RESUMO\s*\n\s*)?CAP[IÍ]TULO\b/i.test(t || '');
              const firstSection = (text: string) => {
                const lines = String(text || '').split(/\r?\n/);
                const out: string[] = [];
                let seenHeading = false;
                for (const line of lines) {
                  if (/^\s*CAP[IÍ]TULO\b/i.test(line)) {
                    if (seenHeading) break;
                    seenHeading = true;
                  }
                  out.push(line);
                }
                while (out.length && !out[0].trim()) out.shift();
                while (out.length && !out[out.length - 1].trim()) out.pop();
                return out.join('\n');
              };

              for (const file of files) {
                try {
                  const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
                  if (!Array.isArray(data)) continue;

                  let added = 0;
                  for (const item of data) {
                    if (!isChapterRecord(item.text)) continue; // ignora introduções de livro
                    const bookName = item.book_pt || item.book || item.book_en || '';
                    if (!bookName) continue;
                    const key = normalizeBook(bookName);
                    const chap = parseInt(item.chapter, 10);
                    if (Number.isNaN(chap)) continue;
                    if (!cache[key]) cache[key] = {};
                    if (!cache[key][chap]) {
                      cache[key][chap] = firstSection(item.text);
                      added++;
                    }
                  }
                  console.log('[Sumarizada] Loaded ' + file + ' (' + added + ' capítulos).');
                } catch (err: any) {
                  console.error('[Sumarizada] Error loading ' + file + ':', err.message);
                }
              }

              console.log('[Sumarizada] Indexed ' + Object.keys(cache).length + ' books.');
              return cache;
            }

            server.middlewares.use('/api/biblia-sumarizada', (req, res, next) => {
              if (req.method !== 'GET') return next();

              const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
              const books = urlObj.searchParams.getAll('book');
              const chapterParam = urlObj.searchParams.get('chapter');

              res.setHeader('Content-Type', 'application/json; charset=utf-8');

              if (!books.length || !chapterParam) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ error: 'Missing book or chapter parameter' }));
              }

              try {
                if (!sumarizadaCache) {
                  console.log('[Sumarizada] Indexing Dados/Extras/biblia_sumarizada.json...');
                  sumarizadaCache = loadSumarizada();
                }

                const chap = parseInt(chapterParam, 10);
                let text: string | null = null;
                for (const book of books) {
                  const entry = sumarizadaCache[normalizeBook(book)];
                  if (entry && entry[chap]) { text = entry[chap]; break; }
                }

                res.statusCode = 200;
                res.end(JSON.stringify({ text }));
              } catch (e: any) {
                console.error('[Sumarizada] Error:', e.message);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: `Server error: ${e.message}` }));
              }
            });
          }
        }
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
