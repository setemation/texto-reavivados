import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3001;
const TRADUCOES_DIR = path.resolve(process.cwd(), 'traducoes');
const PUBLIC_DIR = path.resolve(process.cwd(), 'translator/public');

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Static files
    if (req.method === 'GET' && !req.url.startsWith('/api')) {
        let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const mimeType = {
                '.html': 'text/html',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.json': 'application/json'
            }[ext] || 'text/plain';
            
            res.writeHead(200, { 'Content-Type': mimeType });
            res.end(fs.readFileSync(filePath));
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
        return;
    }

    // API: List files
    if (req.method === 'GET' && req.url === '/api/files') {
        try {
            if (!fs.existsSync(TRADUCOES_DIR)) {
                fs.mkdirSync(TRADUCOES_DIR, { recursive: true });
            }
            const files = fs.readdirSync(TRADUCOES_DIR).filter(f => f.endsWith('.json'));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(files));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // API: Load file
    if (req.method === 'GET' && req.url.startsWith('/api/file/')) {
        const fileName = decodeURIComponent(req.url.replace('/api/file/', ''));
        const filePath = path.join(TRADUCOES_DIR, fileName);
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(fs.readFileSync(filePath, 'utf8'));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'File not found' }));
        }
        return;
    }

    // API: Save item
    if (req.method === 'POST' && req.url === '/api/save') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { fileName, item, index } = JSON.parse(body);
                const filePath = path.join(TRADUCOES_DIR, fileName);
                
                if (fs.existsSync(filePath)) {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (data[index] && data[index].id === item.id) {
                        data[index] = item; // Update translated item
                        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    } else {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'Index mismatch' }));
                    }
                } else {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'File not found' }));
                }
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // API: Proxy Ollama (so we don't worry about CORS on Ollama itself)
    if (req.method === 'POST' && req.url === '/api/ollama') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const reqOllama = http.request('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, (resOllama) => {
                res.writeHead(resOllama.statusCode, resOllama.headers);
                resOllama.pipe(res);
            });
            reqOllama.on('error', (e) => {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Ollama is not running on localhost:11434' }));
            });
            reqOllama.write(body);
            reqOllama.end();
        });
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n\n✅ Servidor de Tradução rodando em http://0.0.0.0:${PORT}`);
    console.log(`Para acessar a interface, abra esse link no seu navegador.\n\n`);
});
