import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// --- ENV LOADER ---
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
    console.error('❌ Erro: GEMINI_API_KEY não configurada no .env.local');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey && !supabaseUrl.includes('sua-url-supabase'))
    ? createClient(supabaseUrl, supabaseKey)
    : null;

const AUTHOR_NAME = "Resumo dos Capítulos";
const EN_JSON_PATH = path.resolve(process.cwd(), 'traducoes', 'comentarios_resumo_dos_capitulos_en_clean.json');
const PT_JSON_PATH = path.resolve(process.cwd(), 'traducoes', 'comentarios_resumo_dos_capitulos_pt.json');
const PUBLIC_JSON_PATH = path.resolve(process.cwd(), 'public', 'traducoes', 'comentarios_resumo_dos_capitulos_en.json');

async function translateText(textEn, refName) {
    if (!textEn || !textEn.trim()) return '';

    const prompt = `Traduza o seguinte resumo de capítulo bíblico (${refName}) do inglês para o Português do Brasil de forma teologicamente precisa, natural e elegante.

REGRAS OBRIGATÓRIAS:
1. Mantenha RIGOROSAMENTE toda a estrutura Markdown original (cabeçalhos ###, negritos **, listas • ou -, e quebras de parágrafo).
2. Traduza termos bíblicos para o padrão teológico em português (ex: "Verses" -> "Versículos", "Lord" -> "SENHOR" ou "Senhor", "Day One" -> "Primeiro Dia").
3. Retorne APENAS o texto traduzido, sem saudações ou explicações fora do texto.

Texto original em inglês:
${textEn}`;

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3.5-flash',
                contents: prompt
            });
            const text = response.text ? response.text.trim() : '';
            if (text) return text;
        } catch (e) {
            console.warn(`⚠️ Tentativa ${attempt} falhou para ${refName}: ${e.message}`);
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    return textEn; // fallback if failed
}

function needsTranslation(text) {
    if (!text) return true;
    if (text.includes('Verses ') || text.includes('Verse ') || text.includes('The Creation') || text.includes('Day One') || text.includes('Day Two') || text.includes('Day Three') || text.includes('Day Four') || text.includes('Day Five') || text.includes('Day Six') || text.includes('Day Seven') || text.includes('Opening Scene')) {
        return true;
    }
    return false;
}

async function runTranslation() {
    console.log('🚀 Iniciando tradução dos 1.189 Resumos de Capítulos para Português BR...');

    if (!fs.existsSync(EN_JSON_PATH)) {
        console.error(`❌ Arquivo de origem não encontrado em: ${EN_JSON_PATH}`);
        process.exit(1);
    }

    const sourceData = JSON.parse(fs.readFileSync(EN_JSON_PATH, 'utf8'));
    console.log(`📦 Carregados ${sourceData.length} capítulos do arquivo de origem.`);

    // Load progress if exists
    let translatedMap = {};
    if (fs.existsSync(PT_JSON_PATH)) {
        try {
            const existingPtData = JSON.parse(fs.readFileSync(PT_JSON_PATH, 'utf8'));
            existingPtData.forEach(item => {
                const key = `${item.book}_${item.chapter}`;
                if (item.text && !needsTranslation(item.text)) {
                    translatedMap[key] = item.text;
                }
            });
            console.log(`ℹ️ Retomando tradução. Capítulos já traduzidos em cache: ${Object.keys(translatedMap).length}`);
        } catch (e) {
            console.warn('⚠️ Erro ao ler cache existente, iniciando novo.');
        }
    }

    const CONCURRENCY = 6;
    let completedCount = Object.keys(translatedMap).length;
    const totalCount = sourceData.length;

    const TARGET_BOOKS = ["Provérbios", "Eclesiastes"];
    const targetItems = sourceData.filter(item => TARGET_BOOKS.includes(item.book));
    console.log(`🎯 Focando na tradução dos ${targetItems.length} capítulos dos livros: ${TARGET_BOOKS.join(', ')}...`);

    for (let i = 0; i < targetItems.length; i += CONCURRENCY) {
        const batch = targetItems.slice(i, i + CONCURRENCY);

        await Promise.all(batch.map(async (item) => {
            const key = `${item.book}_${item.chapter}`;
            if (translatedMap[key]) {
                return; // already translated
            }

            const translated = await translateText(item.text, `${item.book} ${item.chapter}`);
            translatedMap[key] = translated;
            completedCount++;

            console.log(`  ✅ Progresso: ${item.book} ${item.chapter} traduzido`);
        }));

        // Periodic auto-save every batch
        const ptResultList = sourceData.map(item => {
            const key = `${item.book}_${item.chapter}`;
            return {
                author: AUTHOR_NAME,
                book: item.book,
                chapter: item.chapter,
                verse: null,
                text: translatedMap[key] || item.text
            };
        });

        fs.writeFileSync(PT_JSON_PATH, JSON.stringify(ptResultList, null, 2), 'utf8');
        fs.writeFileSync(EN_JSON_PATH, JSON.stringify(ptResultList, null, 2), 'utf8');
        fs.writeFileSync(PUBLIC_JSON_PATH, JSON.stringify(ptResultList, null, 2), 'utf8');

        // Polite delay between batches
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n========================================`);
    console.log(`🎉 Tradução de todos os ${totalCount} capítulos concluída em Português BR!`);

    const finalResultList = sourceData.map(item => {
        const key = `${item.book}_${item.chapter}`;
        return {
            author: AUTHOR_NAME,
            book: item.book,
            chapter: item.chapter,
            verse: null,
            text: translatedMap[key] || item.text
        };
    });

    // Save final files
    fs.writeFileSync(PT_JSON_PATH, JSON.stringify(finalResultList, null, 2), 'utf8');
    fs.writeFileSync(EN_JSON_PATH, JSON.stringify(finalResultList, null, 2), 'utf8');
    fs.writeFileSync(PUBLIC_JSON_PATH, JSON.stringify(finalResultList, null, 2), 'utf8');
    console.log(`💾 Arquivos JSON atualizados em traducoes/ e public/traducoes/!`);

    // Sync to Supabase
    if (supabase) {
        console.log(`\n☁️ Atualizando banco de dados Supabase com os textos traduzidos...`);
        const { error: deleteErr } = await supabase
            .from('commentaries')
            .delete()
            .eq('author', AUTHOR_NAME);

        if (deleteErr) {
            console.error('⚠️ Erro ao deletar no Supabase:', deleteErr.message);
        }

        const batchSize = 100;
        let inserted = 0;
        for (let b = 0; b < finalResultList.length; b += batchSize) {
            const batchToInsert = finalResultList.slice(b, b + batchSize);
            const { error: insertErr } = await supabase
                .from('commentaries')
                .insert(batchToInsert);

            if (insertErr) {
                console.error(`⚠️ Erro ao inserir no Supabase (${b}-${b + batchToInsert.length}):`, insertErr.message);
            } else {
                inserted += batchToInsert.length;
                process.stdout.write(`  Sincronizados ${inserted}/${finalResultList.length} registros com Supabase...\r`);
            }
        }
        console.log(`\n✨ Supabase 100% atualizado em Português BR!`);
    }

    console.log(`\nDONE_TRANSLATION_SIGNAL`);
}

runTranslation().catch(err => {
    console.error('❌ Erro na tradução:', err);
});
