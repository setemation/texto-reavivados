import fs from 'fs';
import path from 'path';
import https from 'https';
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

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = (supabaseUrl && supabaseKey && !supabaseUrl.includes('sua-url-supabase'))
    ? createClient(supabaseUrl, supabaseKey)
    : null;

const AUTHOR_NAME = "Resumo dos Capítulos";

// 66 Books of the Bible with BibleHub slug, Portuguese name, and chapter count
const BIBLE_BOOKS = [
    { slug: "genesis", name: "Gênesis", chapters: 50 },
    { slug: "exodus", name: "Êxodo", chapters: 40 },
    { slug: "leviticus", name: "Levítico", chapters: 27 },
    { slug: "numbers", name: "Números", chapters: 36 },
    { slug: "deuteronomy", name: "Deuteronômio", chapters: 34 },
    { slug: "joshua", name: "Josué", chapters: 24 },
    { slug: "judges", name: "Juízes", chapters: 21 },
    { slug: "ruth", name: "Rute", chapters: 4 },
    { slug: "1_samuel", name: "1 Samuel", chapters: 31 },
    { slug: "2_samuel", name: "2 Samuel", chapters: 24 },
    { slug: "1_kings", name: "1 Reis", chapters: 22 },
    { slug: "2_kings", name: "2 Reis", chapters: 25 },
    { slug: "1_chronicles", name: "1 Crônicas", chapters: 29 },
    { slug: "2_chronicles", name: "2 Crônicas", chapters: 36 },
    { slug: "ezra", name: "Esdras", chapters: 10 },
    { slug: "nehemiah", name: "Neemias", chapters: 13 },
    { slug: "esther", name: "Ester", chapters: 10 },
    { slug: "job", name: "Jó", chapters: 42 },
    { slug: "psalms", name: "Salmos", chapters: 150 },
    { slug: "proverbs", name: "Provérbios", chapters: 31 },
    { slug: "ecclesiastes", name: "Eclesiastes", chapters: 12 },
    { slug: "songs", name: "Cânticos", chapters: 8 },
    { slug: "isaiah", name: "Isaías", chapters: 66 },
    { slug: "jeremiah", name: "Jeremias", chapters: 52 },
    { slug: "lamentations", name: "Lamentações", chapters: 5 },
    { slug: "ezekiel", name: "Ezequiel", chapters: 48 },
    { slug: "daniel", name: "Daniel", chapters: 12 },
    { slug: "hosea", name: "Oséias", chapters: 14 },
    { slug: "joel", name: "Joel", chapters: 3 },
    { slug: "amos", name: "Amós", chapters: 9 },
    { slug: "obadiah", name: "Obadias", chapters: 1 },
    { slug: "jonah", name: "Jonas", chapters: 4 },
    { slug: "micah", name: "Miquéias", chapters: 7 },
    { slug: "nahum", name: "Naum", chapters: 3 },
    { slug: "habakkuk", name: "Habacuque", chapters: 3 },
    { slug: "zephaniah", name: "Sofonias", chapters: 3 },
    { slug: "haggai", name: "Ageu", chapters: 2 },
    { slug: "zechariah", name: "Zacarias", chapters: 14 },
    { slug: "malachi", name: "Malaquias", chapters: 4 },
    { slug: "matthew", name: "Mateus", chapters: 28 },
    { slug: "mark", name: "Marcos", chapters: 16 },
    { slug: "luke", name: "Lucas", chapters: 24 },
    { slug: "john", name: "João", chapters: 21 },
    { slug: "acts", name: "Atos", chapters: 28 },
    { slug: "romans", name: "Romanos", chapters: 16 },
    { slug: "1_corinthians", name: "1 Coríntios", chapters: 16 },
    { slug: "2_corinthians", name: "2 Coríntios", chapters: 13 },
    { slug: "galatians", name: "Gálatas", chapters: 6 },
    { slug: "ephesians", name: "Efésios", chapters: 6 },
    { slug: "philippians", name: "Filipenses", chapters: 4 },
    { slug: "colossians", name: "Colossenses", chapters: 4 },
    { slug: "1_thessalonians", name: "1 Tessalonicenses", chapters: 5 },
    { slug: "2_thessalonians", name: "2 Tessalonicenses", chapters: 3 },
    { slug: "1_timothy", name: "1 Timóteo", chapters: 6 },
    { slug: "2_timothy", name: "2 Timóteo", chapters: 4 },
    { slug: "titus", name: "Tito", chapters: 3 },
    { slug: "philemon", name: "Filemom", chapters: 1 },
    { slug: "hebrews", name: "Hebreus", chapters: 13 },
    { slug: "james", name: "Tiago", chapters: 5 },
    { slug: "1_peter", name: "1 Pedro", chapters: 5 },
    { slug: "2_peter", name: "2 Pedro", chapters: 3 },
    { slug: "1_john", name: "1 João", chapters: 5 },
    { slug: "2_john", name: "2 João", chapters: 1 },
    { slug: "3_john", name: "3 João", chapters: 1 },
    { slug: "jude", name: "Judas", chapters: 1 },
    { slug: "revelation", name: "Apocalipse", chapters: 22 }
];

function fetchHtml(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(fetchHtml(res.headers.location));
            }
            if (res.statusCode !== 200) {
                return resolve(null);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', (err) => resolve(null));
        req.setTimeout(10000, () => {
            req.destroy();
            resolve(null);
        });
    });
}

function decodeHtmlEntities(str) {
    return str
        .replace(/&#8211;/g, '–')
        .replace(/&#8212;/g, '—')
        .replace(/&#8220;/g, '"')
        .replace(/&#8221;/g, '"')
        .replace(/&#8216;/g, "'")
        .replace(/&#8217;/g, "'")
        .replace(/&#8230;/g, '...')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
}

function cleanAndConvertHtml(htmlSection) {
    if (!htmlSection) return '';

    let cleaned = htmlSection.replace(/<script[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');

    // Replace hr with markdown separator
    cleaned = cleaned.replace(/<hr[^>]*>/gi, '\n\n---\n\n');

    // Section headings & lists
    cleaned = cleaned.replace(/<div class="vheading">([\s\S]*?)<\/div>/gi, '');
    cleaned = cleaned.replace(/<span class="hdglist"><b>([\s\S]*?)<\/b><\/span><br\/?>/gi, '\n### $1\n');
    cleaned = cleaned.replace(/<p><b>([\s\S]*?)<\/b><p>/gi, '\n\n### $1\n\n');
    cleaned = cleaned.replace(/<p><b>([\s\S]*?)<\/b><br\/?>/gi, '\n\n### $1\n\n');
    cleaned = cleaned.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');

    // Paragraphs and line breaks
    cleaned = cleaned.replace(/<p>/gi, '\n\n');
    cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');

    // Remove remaining HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, '');

    cleaned = decodeHtmlEntities(cleaned);

    // Normalize spacing and filter out header artifacts
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => {
        if (!l) return false;
        if (l.startsWith('id="leftbox"')) return false;
        if (l.match(/^#?\s*.+?\s+\d+\s+Summary$/i)) return false;
        return true;
    });

    const finalLines = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '' && (finalLines.length === 0 || finalLines[finalLines.length - 1] === '')) {
            continue;
        }
        finalLines.push(lines[i]);
    }

    return finalLines.join('\n').trim();
}

function parseChapterSummaryHtml(html) {
    if (!html) return null;

    let content = '';
    const vheadingMatch = html.match(/<div class="vheading">[\s\S]*?<\/div>/i);
    if (vheadingMatch) {
        const vheadingEndIdx = vheadingMatch.index + vheadingMatch[0].length;
        content = html.substring(vheadingEndIdx);
    } else {
        const leftboxIdx = html.indexOf('<div id="leftbox">');
        if (leftboxIdx !== -1) {
            content = html.substring(leftboxIdx + '<div id="leftbox">'.length);
        } else {
            return null;
        }
    }

    // Stop markers for excluded sections:
    // Topical Bible Verses, Subtopics, Berean Standard Bible, Connections to Additional Scriptures, Prayer Points, Answering Tough Questions
    const stopMarkers = [
        '<div class="vheading2">',
        'Topical Bible Verses',
        'Subtopics',
        'Berean Standard Bible',
        'Connections to Additional Scriptures',
        'Prayer Points',
        'Answering Tough Questions',
        'Bible Study Questions',
        '<div id="botbox"',
        '<div id="foot"'
    ];

    let earliestStop = content.length;
    for (const marker of stopMarkers) {
        const idx = content.indexOf(marker);
        if (idx !== -1 && idx < earliestStop) {
            earliestStop = idx;
        }
    }

    content = content.substring(0, earliestStop);
    return cleanAndConvertHtml(content);
}

async function scrapeAllSummaries() {
    console.log('🚀 Iniciando extração dos Resumos dos Capítulos do BibleHub...');
    const allSummaries = [];
    let successCount = 0;
    let failCount = 0;

    for (const book of BIBLE_BOOKS) {
        console.log(`\n📖 Extraindo ${book.name} (${book.chapters} capítulos)...`);
        for (let ch = 1; ch <= book.chapters; ch++) {
            const url = `https://biblehub.com/chaptersummaries/${book.slug}/${ch}.htm`;
            let html = await fetchHtml(url);
            
            // Retry once if failed
            if (!html) {
                await new Promise(r => setTimeout(r, 500));
                html = await fetchHtml(url);
            }

            const text = parseChapterSummaryHtml(html);
            if (text && text.length > 50) {
                allSummaries.push({
                    author: AUTHOR_NAME,
                    book: book.name,
                    chapter: ch,
                    verse: null,
                    text: text
                });
                successCount++;
                process.stdout.write(`  ✅ Cap. ${ch}/${book.chapters} (${text.length} chars)\r`);
            } else {
                console.warn(`  ⚠️ Falha ao obter ${book.name} ${ch} (${url})`);
                failCount++;
            }
            // Small delay between requests to be respectful to the server
            await new Promise(r => setTimeout(r, 30));
        }
        console.log(`\nConcluído ${book.name}: ${successCount} extraídos até agora.`);
    }

    console.log(`\n========================================`);
    console.log(`📊 Extração concluída! Sucesso: ${successCount}, Falhas: ${failCount}`);

    // Save locally to JSON file
    const outputDir = path.resolve(process.cwd(), 'traducoes');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const jsonPath = path.join(outputDir, 'comentarios_resumo_dos_capitulos_en.json');
    fs.writeFileSync(jsonPath, JSON.stringify(allSummaries, null, 2), 'utf8');
    console.log(`💾 Salvo em: ${jsonPath} (${allSummaries.length} registros)`);

    const publicOutputDir = path.resolve(process.cwd(), 'public', 'traducoes');
    if (!fs.existsSync(publicOutputDir)) {
        fs.mkdirSync(publicOutputDir, { recursive: true });
    }
    const publicJsonPath = path.join(publicOutputDir, 'comentarios_resumo_dos_capitulos_en.json');
    fs.writeFileSync(publicJsonPath, JSON.stringify(allSummaries, null, 2), 'utf8');
    console.log(`💾 Salvo para frontend em: ${publicJsonPath}`);

    // Upload / Sync to Supabase if configured
    if (supabase) {
        console.log(`\n☁️ Enviando resumos para o Supabase...`);
        // Delete existing records for Resumo dos Capítulos to avoid duplicates
        const { error: deleteErr } = await supabase
            .from('commentaries')
            .delete()
            .eq('author', AUTHOR_NAME);

        if (deleteErr) {
            console.error('⚠️ Erro ao remover registros antigos no Supabase:', deleteErr);
        }

        // Insert in batches of 100
        const batchSize = 100;
        let inserted = 0;
        for (let i = 0; i < allSummaries.length; i += batchSize) {
            const batch = allSummaries.slice(i, i + batchSize);
            const { error: insertErr } = await supabase
                .from('commentaries')
                .insert(batch);

            if (insertErr) {
                console.error(`⚠️ Erro ao inserir lote ${i}-${i + batch.length}:`, insertErr.message);
            } else {
                inserted += batch.length;
                process.stdout.write(`  Enviados ${inserted}/${allSummaries.length} para Supabase...\r`);
            }
        }
        console.log(`\n✨ Supabase sincronizado com ${inserted} registros do Resumo dos Capítulos!`);
    } else {
        console.log(`⚠️ Supabase não configurado ou credenciais ausentes. Dados salvos apenas localmente em JSON.`);
    }
}

scrapeAllSummaries().catch(err => {
    console.error('❌ Erro na execução da extração:', err);
});
