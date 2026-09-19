import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
    const envPath = path.resolve(__dirname, '..', '.env.local');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim();
                if (key && !process.env[key]) process.env[key] = val;
            }
        });
    }
}
loadEnv();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Supabase URL ou Key nao encontrados no .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const filePath = path.resolve(__dirname, '..', 'traducoes', 'andrews_study_bible_comentarios.json');
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const ch0 = raw
    .filter(r => r.chapter === 0 && r.text && r.text.trim())
    .map(r => ({
        author:  r.author || 'Andrews Study Bible',
        book:    r.book_pt,
        chapter: 0,
        verse:   null,
        text:    (r.verse_ref && r.verse_ref !== '0') ? `**${r.verse_ref.trim()}**\n\n${r.text.trim()}` : r.text.trim()
    }));

console.log(`Encontrados ${ch0.length} registros de introdução (capítulo 0).`);

// Verificar quantos ja existem no banco
const { count, error: countErr } = await supabase
    .from('commentaries')
    .select('id', { count: 'exact', head: true })
    .eq('author', 'Andrews Study Bible')
    .eq('chapter', 0);

if (countErr) {
    console.error('Erro ao verificar Supabase:', countErr.message);
    process.exit(1);
}

if (count > 0) {
    console.log(`Ja existem ${count} registros de capitulo 0 no Supabase. Deletando para reimportar limpo...`);
    const { error: delErr } = await supabase
        .from('commentaries')
        .delete()
        .eq('author', 'Andrews Study Bible')
        .eq('chapter', 0);
    if (delErr) {
        console.error('Erro ao deletar:', delErr.message);
        process.exit(1);
    }
}

// Inserir registros
const { error: insertErr } = await supabase.from('commentaries').insert(ch0);
if (insertErr) {
    console.error('Erro ao inserir:', insertErr.message);
    process.exit(1);
}

console.log(`SUCESSO! ${ch0.length} registros de capítulo 0 (introduções) inseridos no Supabase!`);
