import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

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

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('❌ GEMINI_API_KEY não encontrada no .env.local');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const STRONGS_FILE = path.resolve(process.cwd(), 'public', 'strongs.json');
const CACHE_FILE = path.resolve(process.cwd(), 'traducoes', 'strongs_pt_cache.json');

async function translateBatch(items) {
    const inputList = items.map(item => ({
        number: item.number,
        description: item.description
    }));

    const prompt = `Traduza para o Português do Brasil com altíssima qualidade lexicográfica e teológica as descrições dos seguintes verbetes do Dicionário Strong (Hebraico e Grego).

REGRAS OBRIGATÓRIAS:
1. Mantenha os termos técnicos lexicográficos de Strong (ex: "raiz primitiva", "por implicação", "figurativo", "causativo", "literal", etc.).
2. Traduza abreviações e conectivos de forma elegante para o padrão dos dicionários bíblicos em português (ex: "Compare names in..." -> "Compare os nomes em...", "from the same as..." -> "da mesma raiz de...").
3. Retorne APENAS um array JSON de objetos com "number" e "description" (com a descrição traduzida em português BR).

Entrada JSON:
${JSON.stringify(inputList, null, 2)}`;

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash'];

    for (const modelName of modelsToTry) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const response = await ai.models.generateContent({
                    model: modelName,
                    contents: prompt,
                    config: {
                        responseMimeType: "application/json"
                    }
                });
                const text = response.text ? response.text.trim() : '';
                if (text) {
                    const cleanJson = text.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
                    const parsed = JSON.parse(cleanJson);
                    if (Array.isArray(parsed)) {
                        return parsed;
                    }
                }
            } catch (e) {
                if (e.message.includes('Quota exceeded') || e.message.includes('429')) {
                    console.warn(`⚠️ Modelo ${modelName} atingiu cota, tentando próximo modelo...`);
                    break; // break attempt loop to switch model
                }
                console.warn(`⚠️ Tentativa ${attempt} no modelo ${modelName} falhou: ${e.message}`);
                await new Promise(r => setTimeout(r, 2000 * attempt));
            }
        }
    }

    return [];
}

async function runStrongsTranslation() {
    console.log('🚀 Iniciando tradução de qualidade dos 14.298 verbetes do Dicionário Strong para Português BR...');

    if (!fs.existsSync(STRONGS_FILE)) {
        console.error(`❌ Arquivo strongs.json não encontrado em: ${STRONGS_FILE}`);
        process.exit(1);
    }

    const strongsList = JSON.parse(fs.readFileSync(STRONGS_FILE, 'utf8'));
    console.log(`📦 Carregados ${strongsList.length} verbetes (Hebraico H1..H8674 + Grego G1..G5624).`);

    let translatedMap = {};
    if (fs.existsSync(CACHE_FILE)) {
        try {
            const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            Object.assign(translatedMap, cache);
            console.log(`ℹ️ Retomando tradução. Verbetes em cache: ${Object.keys(translatedMap).length}`);
        } catch (e) {
            console.warn('⚠️ Erro ao ler cache existente.');
        }
    }

    const BATCH_SIZE = 75;
    const itemsToTranslate = strongsList.filter(item => !translatedMap[item.number]);
    console.log(`🎯 Verbetes pendentes para traduzir: ${itemsToTranslate.length}`);

    let completed = Object.keys(translatedMap).length;

    for (let i = 0; i < itemsToTranslate.length; i += BATCH_SIZE) {
        const batch = itemsToTranslate.slice(i, i + BATCH_SIZE);
        const translatedBatch = await translateBatch(batch);

        translatedBatch.forEach(res => {
            if (res.number && res.description) {
                translatedMap[res.number] = res.description;
            }
        });

        completed = Object.keys(translatedMap).length;
        const pct = ((completed / strongsList.length) * 100).toFixed(1);
        console.log(`  ✅ Progresso: ${completed}/${strongsList.length} verbetes traduzidos (${pct}%)`);

        // Save cache periodically
        if ((i / BATCH_SIZE) % 3 === 0 || completed >= strongsList.length) {
            fs.writeFileSync(CACHE_FILE, JSON.stringify(translatedMap, null, 2), 'utf8');

            const updatedStrongs = strongsList.map(item => ({
                ...item,
                description: translatedMap[item.number] || item.description
            }));

            fs.writeFileSync(STRONGS_FILE, JSON.stringify(updatedStrongs, null, 2), 'utf8');
        }

        await new Promise(r => setTimeout(r, 1200));
    }

    console.log(`\n========================================`);
    console.log(`🎉 Tradução de todos os verbetes do Dicionário Strong concluída!`);

    const finalStrongs = strongsList.map(item => ({
        ...item,
        description: translatedMap[item.number] || item.description
    }));

    fs.writeFileSync(STRONGS_FILE, JSON.stringify(finalStrongs, null, 2), 'utf8');
    fs.writeFileSync(CACHE_FILE, JSON.stringify(translatedMap, null, 2), 'utf8');
    console.log(`💾 public/strongs.json atualizado com sucesso em Português BR!`);
}

runStrongsTranslation().catch(err => {
    console.error('❌ Erro na tradução do Dicionário Strong:', err);
});
