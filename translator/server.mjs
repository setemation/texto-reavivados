import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3001;
const DADOS_DIR = path.resolve(process.cwd(), 'Dados');
const EN_DIR = path.resolve(DADOS_DIR, 'Obras-En');
const PT_DIR = path.resolve(DADOS_DIR, 'Obras-Pt');
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
            if (!fs.existsSync(EN_DIR)) {
                fs.mkdirSync(EN_DIR, { recursive: true });
            }
            const files = fs.readdirSync(EN_DIR).filter(f => f.endsWith('.json'));
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
        const filePath = path.join(EN_DIR, fileName);
        if (fs.existsSync(filePath)) {
            let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

            // Se for arquivo em inglês, verifica se já existe arquivo em português com traduções salvas
            const ptFileName = fileName.endsWith('_en.json') 
                ? fileName.replace(/_en\.json$/, '_pt.json') 
                : fileName.replace(/\.json$/, '_pt.json');
            const ptFilePath = path.join(PT_DIR, ptFileName);
            if (fs.existsSync(ptFilePath)) {
                try {
                    const ptData = JSON.parse(fs.readFileSync(ptFilePath, 'utf8'));
                    const ptMap = new Map();
                    ptData.forEach(d => {
                        if (d && d.id !== undefined && d.translated) {
                            ptMap.set(d.id, d.text);
                            }
                        });
                        data = data.map(item => {
                            if (ptMap.has(item.id)) {
                                return {
                                    ...item,
                                    textOriginal: item.text,
                                    translatedText: ptMap.get(item.id),
                                    translated: true
                                };
                            }
                            return item;
                        });
                    } catch (e) {
                        console.error('Erro ao ler cache pt:', e.message);
                    }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'File not found' }));
        }
        return;
    }

    // API: Save item - Mantém o arquivo em inglês intacto e adiciona/atualiza no arquivo em português
    if (req.method === 'POST' && req.url === '/api/save') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { fileName, item, index } = JSON.parse(body);

                // Determinar o nome do arquivo em português
                let ptFileName = fileName;
                if (fileName.endsWith('_en.json')) {
                    ptFileName = fileName.replace(/_en\.json$/, '_pt.json');
                } else if (!fileName.includes('_pt')) {
                    ptFileName = fileName.replace(/\.json$/, '_pt.json');
                }

                const ptFilePath = path.join(PT_DIR, ptFileName);
                let ptData = [];

                if (fs.existsSync(ptFilePath)) {
                    try {
                        ptData = JSON.parse(fs.readFileSync(ptFilePath, 'utf8'));
                    } catch (e) {
                        ptData = [];
                    }
                } else {
                    // Inicializa a partir do arquivo original se existir, para manter IDs e referências
                    const originalPath = path.join(EN_DIR, fileName);
                    if (fs.existsSync(originalPath)) {
                        try {
                            const origData = JSON.parse(fs.readFileSync(originalPath, 'utf8'));
                            ptData = origData.map(d => ({
                                id: d.id,
                                book: d.book,
                                chapter: d.chapter,
                                verse: d.verse,
                                textOriginal: d.text,
                                text: '',
                                translated: false
                            }));
                        } catch (e) {
                            ptData = [];
                        }
                    }
                }

                const translatedEntry = {
                    id: item.id,
                    book: item.book,
                    chapter: item.chapter,
                    verse: item.verse,
                    text: item.text, // Texto traduzido para português
                    textOriginal: item.textOriginal || item.originalText || '',
                    translated: true
                };

                const existingIdx = ptData.findIndex(d => d.id === item.id);
                if (existingIdx !== -1) {
                    ptData[existingIdx] = translatedEntry;
                } else if (ptData[index] && ptData[index].id === item.id) {
                    ptData[index] = translatedEntry;
                } else {
                    ptData.push(translatedEntry);
                }

                fs.writeFileSync(ptFilePath, JSON.stringify(ptData, null, 2), 'utf8');

                // Também sincroniza com public/traducoes se o diretório existir
                const publicPtDir = path.resolve(process.cwd(), 'public', 'traducoes');
                if (fs.existsSync(publicPtDir)) {
                    fs.writeFileSync(path.join(publicPtDir, ptFileName), JSON.stringify(ptData, null, 2), 'utf8');
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, ptFileName }));
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
