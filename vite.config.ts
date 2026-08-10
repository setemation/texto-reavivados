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
