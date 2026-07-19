import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

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

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('sua-url-supabase')) {
    console.error('❌ Erro: Configure as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.local.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('📖 Lendo arquivo naa.md...');
const naaPath = path.resolve(process.cwd(), 'naa.md');
if (!fs.existsSync(naaPath)) {
    console.error('❌ Arquivo naa.md não encontrado no diretório raiz.');
    process.exit(1);
}

const content = fs.readFileSync(naaPath, 'utf8');
const sections = content.split(/^## /m);

const seenKeys = new Set();
const uniqueVerses = [];

for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split(/\r?\n/);
    const header = lines[0].trim();
    
    const match = header.match(/^(.+?)\s+(\d+)$/);
    if (!match) continue;
    
    const book = match[1];
    const chapter = parseInt(match[2], 10);
    const textBody = lines.slice(1).join('\n').replace(/###.*?\r?\n/g, '');
    
    const verseRegex = /(?:^|\s)(\d+)\s/g;
    let vMatch;
    let matches = [];
    while ((vMatch = verseRegex.exec(textBody)) !== null) {
        matches.push({ verse: parseInt(vMatch[1], 10), index: vMatch.index, endHeadIndex: verseRegex.lastIndex });
    }
    
    for (let j = 0; j < matches.length; j++) {
        const vNum = matches[j].verse;
        const startPos = matches[j].endHeadIndex;
        const endPos = (j < matches.length - 1) ? matches[j+1].index : textBody.length;
        const vText = textBody.substring(startPos, endPos).trim().replace(/\s+/g, ' ');
        
        const key = `${book}_${chapter}_${vNum}`;
        if (vText && !seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueVerses.push({
                book,
                chapter,
                verse: vNum,
                text: vText
            });
        }
    }
}

console.log(`✅ Total de versículos únicos extraídos: ${uniqueVerses.length}`);

async function seed() {
    console.log('🚀 Iniciando envio de versículos para o Supabase...');
    const BATCH_SIZE = 500;
    let totalUploaded = 0;
    
    for (let i = 0; i < uniqueVerses.length; i += BATCH_SIZE) {
        const batch = uniqueVerses.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
            .from('verses')
            .upsert(batch, { onConflict: 'book,chapter,verse', ignoreDuplicates: true });
            
        if (error) {
            console.error(`❌ Erro ao enviar lote ${i} a ${i + batch.length}:`, error.message);
            process.exit(1);
        }
        
        totalUploaded += batch.length;
        const percent = Math.round((totalUploaded / uniqueVerses.length) * 100);
        console.log(`   [${percent}%] Enviados ${totalUploaded}/${uniqueVerses.length} versículos...`);
    }
    
    console.log('🎉 Transição concluída com sucesso! Todos os versículos foram carregados no Supabase.');
}

seed().catch(err => {
    console.error('❌ Erro inesperado:', err);
    process.exit(1);
});
