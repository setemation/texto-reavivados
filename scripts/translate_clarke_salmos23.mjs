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
    console.error('Supabase URL or Key not found in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const apiKey = Buffer.from('QVEuQWI4Uk42Sk1DcWpfNXpRN1poaFR6UjhNVk5kMnVrUDJ6SkJpeUtwci1xcE5GQ01uTHc=', 'base64').toString('utf-8');
const ai = new GoogleGenAI({ apiKey });

async function translateClarkeSalmos23() {
    console.log('Buscando comentários de Clarke sobre Salmos 23 no Supabase...');
    const { data: rows, error } = await supabase
        .from('commentaries')
        .select('*')
        .eq('book', 'Salmos')
        .eq('chapter', 23)
        .eq('author', 'Clarke')
        .order('verse', { ascending: true });

    if (error) {
        console.error('Erro no Supabase:', error);
        return;
    }

    console.log('Encontrados ' + rows.length + ' comentários para Salmos 23.');

    const translatedResults = [];

    for (const r of rows) {
        console.log('\n========================================');
        console.log('Traduzindo Versículo ' + r.verse + ' (ID ' + r.id + ')...');

        let cleanText = r.text.replace(/Commentary on the Bible, by Adam Clarke[\s\S]*$/gi, '').trim();

        const prompt = 'Traduza o seguinte comentário bíblico erudito de Adam Clarke sobre Salmos 23:' + r.verse + ' do inglês para o Português do Brasil com excelente erudição teológica, precisão e fluência.\n\n' +
'DIRETRIZES FUNDAMENTAIS:\n' +
'1. Mantenha intactos todos os caracteres hebraicos, gregos, e transliterações (por exemplo: בנאות דשא binoth deshe, במעגלי צדק bemageley tsedek, שבטך shibtecha, ומשענתך umishantecha, מימר meymar, ושבתי veshabti, לארך ימים leorech yamim, etc.).\n' +
'2. Para citações do Antigo Saltério em inglês médio (Old Psalter), preserve a citação arcaica e adicione/forneça sua elucidação clara em português para que o leitor compreenda perfeitamente o rico sentido pretendido por Clarke.\n' +
'3. Preserve integralmente a numeração de itens (1., 2., 3...) e quebras de parágrafo.\n' +
'4. Mantenha as referências bíblicas no padrão em português (ex: Isaías 8:6, Mateus 26:6).\n' +
'5. NÃO inclua notas ou propagandas de rodapé de sites (ex: Bible Hub, Text Courtesy...).\n' +
'6. Retorne ESTRITAMENTE o texto em português traduzido, sem introduções ou comentários adicionais.\n\n' +
'Texto original em inglês:\n' + cleanText;

        let translated = '';
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt
                });
                translated = response.text ? response.text.trim() : '';
                if (translated) break;
            } catch (e) {
                console.warn('Tentativa ' + attempt + ' falhou para o verso ' + r.verse + ': ' + e.message);
                await new Promise(res => setTimeout(res, 2000 * attempt));
            }
        }

        if (!translated) {
            console.error('Falha ao traduzir verso ' + r.verse + '.');
            continue;
        }

        console.log('Texto traduzido (prévia):');
        console.log(translated.substring(0, 180) + '...\n');

        const { error: updErr } = await supabase
            .from('commentaries')
            .update({ text: translated })
            .eq('id', r.id);

        if (updErr) {
            console.error('Erro ao atualizar Supabase ID ' + r.id + ':', updErr.message);
        } else {
            console.log('✅ Supabase atualizado com sucesso para verso ' + r.verse + ' (ID ' + r.id + ').');
        }

        translatedResults.push({
            ...r,
            text: translated,
            translated: true
        });
    }

    const clarkeEnPath = path.resolve(process.cwd(), 'traducoes', 'comentarios_clarke_en.json');
    if (fs.existsSync(clarkeEnPath)) {
        console.log('\nAtualizando traducoes/comentarios_clarke_en.json...');
        const allClarke = JSON.parse(fs.readFileSync(clarkeEnPath, 'utf8'));
        for (const tr of translatedResults) {
            const idx = allClarke.findIndex(item => item.id === tr.id);
            if (idx !== -1) {
                allClarke[idx].text = tr.text;
                allClarke[idx].translated = true;
            }
        }
        fs.writeFileSync(clarkeEnPath, JSON.stringify(allClarke, null, 2), 'utf8');
        console.log('✅ traducoes/comentarios_clarke_en.json atualizado.');
    }

    const clarkePtPath = path.resolve(process.cwd(), 'traducoes', 'comentarios_clarke_pt.json');
    let existingPt = [];
    if (fs.existsSync(clarkePtPath)) {
        try {
            existingPt = JSON.parse(fs.readFileSync(clarkePtPath, 'utf8'));
        } catch(e) {}
    }
    for (const tr of translatedResults) {
        const idx = existingPt.findIndex(item => item.id === tr.id);
        if (idx !== -1) {
            existingPt[idx] = tr;
        } else {
            existingPt.push(tr);
        }
    }
    fs.writeFileSync(clarkePtPath, JSON.stringify(existingPt, null, 2), 'utf8');
    console.log('✅ traducoes/comentarios_clarke_pt.json salvo (' + existingPt.length + ' itens).');

    console.log('\n🎉 Tradução de Adam Clarke para Salmos 23 finalizada com sucesso!');
}

translateClarkeSalmos23();
