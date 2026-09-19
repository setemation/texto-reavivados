import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

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

// Workers configurados com chaves ativas e modelos compatíveis
const WORKER_CONFIGS = [
    { name: 'IASD Marco', key: Buffer.from('QVEuQWI4Uk42TGRoeGxRVEwycnhWZTR5dUxfc3Q2blAtTXZINEdtYTlDY2FHRi0wUDVMb1E=', 'base64').toString('utf-8'), models: ['gemini-2.5-flash', 'gemini-3.6-flash'] },
    { name: 'Pessoal', key: Buffer.from('QVEuQWI4Uk42S3pmUG9hdGlTcVZVS3dWbjIyZndBVmU4V3ZoNWkzalRvQnp2eHBfVmlJY0E=', 'base64').toString('utf-8'), models: ['gemini-2.5-flash', 'gemini-3.6-flash'] },
    { name: 'Jozy', key: Buffer.from('QVEuQWI4Uk42SlVIWW84Wlk4SzB2UGs2OFh6TTFwYzV0ekI5cUFXUkloRW4wZmJFTHVRWHc=', 'base64').toString('utf-8'), models: ['gemini-3.6-flash'] }
];

const NUM_WORKERS = WORKER_CONFIGS.length;

const EN_JSON_PATH = path.resolve(process.cwd(), 'traducoes', 'comentarios_clarke_en.json');
const CACHE_PATH = path.resolve(process.cwd(), 'traducoes', 'clarke_pt_cache.json');
const PT_JSON_PATH = path.resolve(process.cwd(), 'traducoes', 'comentarios_clarke_pt.json');
const PUBLIC_PT_JSON_PATH = path.resolve(process.cwd(), 'public', 'traducoes', 'comentarios_clarke_pt.json');
const CHECKPOINT_PATH = path.resolve(process.cwd(), 'traducoes', 'clarke_checkpoint.json');

function cleanCommentText(text) {
    if (!text) return '';
    return text.replace(/Commentary on the Bible, by Adam Clarke[\s\S]*$/gi, '').trim();
}

async function runParallelClarkeTranslation() {
    console.log(`🚀 Iniciando tradução contínua de Adam Clarke com ${NUM_WORKERS} workers e persistência total...`);

    const allData = JSON.parse(fs.readFileSync(EN_JSON_PATH, 'utf8'));

    let cache = {};
    if (fs.existsSync(CACHE_PATH)) {
        try {
            cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
        } catch (e) {}
    }

    const pendingItems = allData.filter(item => !cache[item.id]);
    console.log(`📊 Itens já traduzidos e validados: ${Object.keys(cache).length} / ${allData.length} (${((Object.keys(cache).length / allData.length) * 100).toFixed(1)}%)`);
    console.log(`⏳ Itens pendentes: ${pendingItems.length}`);

    if (pendingItems.length === 0) {
        console.log('✅ Todos os 21.000 comentários de Adam Clarke estão 100% traduzidos!');
        return;
    }

    // Criar lotes de até 4 comentários (máx 5.000 caracteres para respostas ultra rápidas)
    const batches = [];
    let curBatch = [];
    let curChars = 0;

    for (const item of pendingItems) {
        const textLen = (item.text || '').length;
        if (curBatch.length >= 4 || (curChars + textLen > 5000 && curBatch.length > 0)) {
            batches.push(curBatch);
            curBatch = [item];
            curChars = textLen;
        } else {
            curBatch.push(item);
            curChars += textLen;
        }
    }
    if (curBatch.length > 0) batches.push(curBatch);

    console.log(`⚡ Lotes a processar: ${batches.length} entre ${NUM_WORKERS} workers.`);

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

            const currentPending = allData.filter(d => !cache[d.id]);
            const translatedCount = Object.keys(cache).length;
            const booksSummary = {};
            ptData.forEach(d => {
                booksSummary[d.book] = (booksSummary[d.book] || 0) + 1;
            });

            const checkpoint = {
                timestamp: new Date().toISOString(),
                totalCommentaries: allData.length,
                translatedCount,
                pendingCount: currentPending.length,
                percentage: `${((translatedCount / allData.length) * 100).toFixed(2)}%`,
                nextItemToTranslate: currentPending[0] ? {
                    id: currentPending[0].id,
                    book: currentPending[0].book,
                    chapter: currentPending[0].chapter,
                    verse: currentPending[0].verse
                } : null,
                booksSummary
            };
            fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2), 'utf8');
        } catch (e) {
            console.error('⚠️ Erro ao salvar cache e checkpoint:', e.message);
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

            await supabase.from('commentaries').upsert(rows, { onConflict: 'id' });
        } catch (e) {
            console.error('⚠️ Erro de sincronização Supabase:', e.message);
        } finally {
            isSaving = false;
        }
    };

    const worker = async (workerId) => {
        const cfg = WORKER_CONFIGS[workerId];
        const ai = new GoogleGenAI({ apiKey: cfg.key });

        while (true) {
            if (batchIndex >= batches.length) break;
            const myBatchIdx = batchIndex++;
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

            for (const model of cfg.models) {
                if (translated) break;
                for (let attempt = 1; attempt <= 3; attempt++) {
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
                                    if (cache[it.id]) {
                                        supabaseBuffer.push(it);
                                    }
                                }
                                completedItems += batch.length;
                                translated = true;
                                break;
                            }
                        }
                    } catch (e) {
                        const msg = e.message || String(e);
                        if (msg.includes('404')) {
                            break; // Modelo não suportado para esta chave, tenta próximo modelo
                        }
                        if (msg.includes('429') || msg.includes('Quota')) {
                            console.log(`\n⏳ [W${workerId + 1} - ${cfg.name}] Cota atingida. Aguardando 25s para retomar...`);
                            await new Promise(r => setTimeout(r, 25000));
                        } else if (msg.includes('503') || msg.includes('overloaded') || msg.includes('500') || msg.includes('fetch failed')) {
                            console.log(`\n⚠️ [W${workerId + 1} - ${cfg.name}] Modelo ${model} instável. Tentativa ${attempt}/3 em ${attempt * 3}s...`);
                            await new Promise(r => setTimeout(r, attempt * 3000));
                        } else {
                            await new Promise(r => setTimeout(r, 3000));
                        }
                    }
                }
            }

            if (!translated) {
                // Se falhar todas as tentativas, recoloca na fila para não perder nenhum comentário
                batches.push(batch);
            } else {
                const pct = ((completedItems / allData.length) * 100).toFixed(1);
                console.log(`[W${workerId + 1} - ${cfg.name}] [${completedItems}/${allData.length} - ${pct}%] ${batch[0].book} ${batch[0].chapter}:${batch[0].verse}`);

                if (supabaseBuffer.length >= 30) {
                    await flushSupabase();
                }

                if (myBatchIdx % 4 === 0) {
                    saveFiles();
                }
            }

            // Pacing de 2.5s por worker para respeitar o limite de RPM
            await new Promise(r => setTimeout(r, 2500));
        }
    };

    const workers = Array.from({ length: NUM_WORKERS }, (_, i) => worker(i));
    await Promise.all(workers);

    saveFiles();
    await flushSupabase();
    console.log(`\n🎉 Processo finalizado! Total: ${Object.keys(cache).length} / ${allData.length}.`);
}

runParallelClarkeTranslation().catch(console.error);
