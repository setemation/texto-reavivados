import path from 'path';
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
