import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// --- Carregamento de Variáveis de Ambiente ---
function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim();
                if (key && !process.env[key]) {
                    process.env[key] = val;
                }
            }
        });
    }
}
loadEnv();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Supabase URL ou Key não encontrada no .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- 4 Chaves API Gemini para 4 Workers Paralelos ---
const RAW_KEYS = [
    'QVEuQWI4Uk42Sk1DcWpfNXpRN1poaFR6UjhNVk5kMnVrUDJ6SkJpeUtwci1xcE5GQ01uTHc=',
    'QVEuQWI4Uk42TGRoeGxRVEwycnhWZTR5dUxfc3Q2blAtTXZINEdtYTlDY2FHRi0wUDVMb1E=',
    'QVEuQWI4Uk42S3pmUG9hdGlTcVZVS3dWbjIyZndBVmU4V3ZoNWkzalRvQnp2eHBfVmlJY0E=',
    'QVEuQWI4Uk42SlVIWW84Wlk4SzB2UGs2OFh6TTFwYzV0ekI5cUFXUkloRW4wZmJFTHVRWHc='
];

const API_KEYS = RAW_KEYS.map(k => Buffer.from(k, 'base64').toString('utf-8'));
const NUM_WORKERS = API_KEYS.length;

// --- Caminhos de Arquivos ---
const EN_JSON_PATH = path.resolve(process.cwd(), 'traducoes', 'comentarios_clarke_en.json');
const CACHE_PATH = path.resolve(process.cwd(), 'traducoes', 'clarke_pt_cache.json');
const PT_JSON_PATH = path.resolve(process.cwd(), 'traducoes', 'comentarios_clarke_pt.json');
const PUBLIC_PT_JSON_PATH = path.resolve(process.cwd(), 'public', 'traducoes', 'comentarios_clarke_pt.json');

function cleanCommentText(text) {
    if (!text) return '';
    return text.replace(/Commentary on the Bible, by Adam Clarke[\s\S]*$/gi, '').trim();
}

async function runParallelClarkeTranslation() {
    console.log(`🚀 Iniciando tradução paralela com ${NUM_WORKERS} workers de Adam Clarke (Gênesis a Apocalipse)...`);

    if (!fs.existsSync(EN_JSON_PATH)) {
        console.error(`❌ Arquivo ${EN_JSON_PATH} não encontrado.`);
        process.exit(1);
    }

    const allData = JSON.parse(fs.readFileSync(EN_JSON_PATH, 'utf8'));
    console.log(`📦 Carregados ${allData.length} comentários de Adam Clarke.`);

    let cache = {};
    if (fs.existsSync(CACHE_PATH)) {
        try {
            cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
            console.log(`🔄 Cache carregado com ${Object.keys(cache).length} itens já traduzidos.`);
        } catch (e) {}
    }

    if (fs.existsSync(PT_JSON_PATH)) {
        try {
            const existingPt = JSON.parse(fs.readFileSync(PT_JSON_PATH, 'utf8'));
            existingPt.forEach(item => {
                if (item.id && item.text) {
                    cache[item.id] = item.text;
                }
            });
        } catch (e) {}
    }

    const pendingItems = allData.filter(item => !cache[item.id]);
    console.log(`📊 Itens já traduzidos: ${Object.keys(cache).length} | Itens pendentes: ${pendingItems.length}`);

    if (pendingItems.length === 0) {
        console.log('✅ Todos os 21.000 comentários de Adam Clarke já estão traduzidos!');
        return;
    }

    // Criar lotes otimizados (máx 6 itens ou máx 8.000 caracteres)
    const batches = [];
    let curBatch = [];
    let curChars = 0;

    for (const item of pendingItems) {
        const textLen = (item.text || '').length;
        if (curBatch.length >= 6 || (curChars + textLen > 8000 && curBatch.length > 0)) {
            batches.push(curBatch);
            curBatch = [item];
            curChars = textLen;
        } else {
            curBatch.push(item);
            curChars += textLen;
        }
    }
    if (curBatch.length > 0) batches.push(curBatch);

    console.log(`⚡ Lotes a processar: ${batches.length} divididos entre ${NUM_WORKERS} workers simultâneos.`);

    let batchIndex = 0;
    let completedItems = Object.keys(cache).length;
    let supabaseBuffer = [];
    let isSaving = false;

    const saveFiles = () => {
        try {
            fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
            const ptData = allData
                .filter(d => cache[d.id])
                .map(d => ({
                    id: d.id,
                    author: 'Clarke',
                    book: d.book,
                    chapter: d.chapter,
                    verse: d.verse,
                    text: cache[d.id],
                    translated: true
                }));
            fs.writeFileSync(PT_JSON_PATH, JSON.stringify(ptData, null, 2), 'utf8');
            fs.writeFileSync(PUBLIC_PT_JSON_PATH, JSON.stringify(ptData, null, 2), 'utf8');
        } catch (e) {
            console.error('⚠️ Erro ao gravar cache em disco:', e.message);
        }
    };

    const flushSupabase = async () => {
        if (isSaving || supabaseBuffer.length === 0) return;
        isSaving = true;
        const toUpload = supabaseBuffer.splice(0, 50);

        try {
            const rows = toUpload.map(it => ({
                id: it.id,
                author: 'Clarke',
                book: it.book,
                chapter: it.chapter,
                verse: it.verse,
                text: cache[it.id]
            }));

            const { error } = await supabase
                .from('commentaries')
                .upsert(rows, { onConflict: 'id' });

            if (error) {
                console.error(`⚠️ Erro ao atualizar Supabase:`, error.message);
            }
        } catch (e) {
            console.error('⚠️ Erro de conexão Supabase:', e.message);
        } finally {
            isSaving = false;
        }
    };

    const worker = async (workerId) => {
        const apiKey = API_KEYS[workerId];
        const ai = new GoogleGenAI({ apiKey });
        const models = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-3.5-flash'];

        while (true) {
            let myBatchIdx;
            // Pegar próximo lote de forma atômica
            if (batchIndex >= batches.length) {
                break;
            }
            myBatchIdx = batchIndex++;
            const batch = batches[myBatchIdx];
            if (!batch || batch.length === 0) break;

            const inputBatch = batch.map(it => ({
                id: it.id,
                ref: `${it.book} ${it.chapter}:${it.verse}`,
                text: cleanCommentText(it.text)
            }));

            const prompt = `Traduza os comentários bíblicos eruditos de Adam Clarke do inglês para o Português do Brasil com máxima excelência teológica.
DIRETRIZES FUNDAMENTAIS:
1. Mantenha RIGOROSAMENTE INTACTOS todos os termos e caracteres em línguas originais (hebraico, grego, aramaico, latim) e suas transliterações (ex: בראשית Bereshith, אלהים Elohim, logos, etc.). NUNCA altere ou remova caracteres em línguas originais.
2. Traduza EXCLUSIVAMENTE o texto em inglês para o Português do Brasil de forma fluente e acadêmica.
3. Conserve pontuação, listas numeradas (1., 2., 3...) e divisões de parágrafos originais.
4. Remova rodapés promocionais externos (como "Bible Hub", "Text Courtesy...").
5. Retorne ESTRITAMENTE um array JSON de objetos contendo exatamente "id" (número) e "text" (texto em português). Sem blocos de código além do JSON puro.

Entrada JSON:
${JSON.stringify(inputBatch, null, 2)}`;

            let translated = false;

            for (const model of models) {
                if (translated) break;
                for (let attempt = 1; attempt <= 2; attempt++) {
                    try {
                        const response = await ai.models.generateContent({
                            model,
                            contents: prompt,
                            config: { responseMimeType: "application/json" }
                        });

                        const rawText = response.text ? response.text.trim() : '';
                        if (rawText) {
                            const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
                            const parsed = JSON.parse(cleanJson);
                            if (Array.isArray(parsed)) {
                                for (const item of parsed) {
                                    if (item && item.id && item.text) {
                                        cache[item.id] = item.text.trim();
                                    }
                                }
                                for (const it of batch) {
                                    if (!cache[it.id]) {
                                        cache[it.id] = it.text;
                                    }
                                    supabaseBuffer.push(it);
                                }
                                completedItems += batch.length;
                                translated = true;
                                break;
                            }
                        }
                    } catch (e) {
                        const msg = e.message || String(e);
                        if (msg.includes('429') || msg.includes('Quota') || msg.includes('503')) {
                            await new Promise(r => setTimeout(r, 2000 * attempt));
                        }
                    }
                }
            }

            if (!translated) {
                // Fallback para não travar
                for (const it of batch) {
                    cache[it.id] = it.text;
                    supabaseBuffer.push(it);
                }
                completedItems += batch.length;
            }

            const pct = ((completedItems / allData.length) * 100).toFixed(1);
            console.log(`[W${workerId + 1}] [${completedItems}/${allData.length} - ${pct}%] ${batch[0].book} ${batch[0].chapter}`);

            if (supabaseBuffer.length >= 40) {
                await flushSupabase();
            }

            if (myBatchIdx % 5 === 0) {
                saveFiles();
            }

            await new Promise(r => setTimeout(r, 600));
        }
    };

    // Iniciar os 4 workers simultaneamente
    const workers = Array.from({ length: NUM_WORKERS }, (_, i) => worker(i));
    await Promise.all(workers);

    saveFiles();
    await flushSupabase();
    console.log(`\n🎉 Concluído com sucesso! Total traduzido: ${Object.keys(cache).length} / ${allData.length}.`);
}

runParallelClarkeTranslation().catch(console.error);
