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
if (!fs.existsSync(filePath)) {
    console.error('Arquivo nao encontrado:', filePath);
    process.exit(1);
}

console.log('Lendo andrews_study_bible_comentarios.json...');
const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const records = raw
    .filter(r => r.chapter > 0 && r.text && r.text.trim())
    .map(r => ({
        author:  r.author  || 'Andrews Study Bible',
        book:    r.book_pt || r.book_en || '',
        chapter: r.chapter,
        verse:   (r.verse && r.verse > 0) ? r.verse : null,
        text:    r.text.trim()
    }))
    .filter(r => r.book && r.chapter);

console.log('Registros validos: ' + records.length + ' de ' + raw.length + ' totais.');

const { count, error: countError } = await supabase
    .from('commentaries')
    .select('id', { count: 'exact', head: true })
    .eq('author', 'Andrews Study Bible');

if (countError) {
    console.error('Erro ao verificar registros existentes:', countError.message);
    process.exit(1);
}

if (count > 0) {
    console.log('JA EXISTEM ' + count + ' registros de Andrews Study Bible no banco. Saindo.');
    process.exit(0);
}

const BATCH_SIZE = 500;
let totalUploaded = 0;
let totalErrors = 0;

console.log('Iniciando importacao de ' + records.length + ' registros...');

for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('commentaries').insert(batch);
    if (error) {
        console.error('Erro no lote ' + i + ':', error.message);
        totalErrors += batch.length;
    } else {
        totalUploaded += batch.length;
    }
    const percent = Math.round(((i + batch.length) / records.length) * 100);
    process.stdout.write('[' + percent + '%] ' + totalUploaded + ' enviados...\r');
}

console.log('');
if (totalErrors === 0) {
    console.log('CONCLUIDO! ' + totalUploaded + ' registros inseridos no Supabase.');
} else {
    console.log('Finalizado com erros. Enviados: ' + totalUploaded + ' | Erros: ' + totalErrors);
}
