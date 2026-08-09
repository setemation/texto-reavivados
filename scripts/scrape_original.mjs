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

if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('sua-url-supabase')) {
    console.error('❌ Erro: Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env.local.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- BOOK MAPPING (BibleHub slug -> Portuguese system name) ---
const BOOK_MAPPING = {
    "genesis": "Gênesis",
    "exodus": "Êxodo",
    "leviticus": "Levítico",
    "numbers": "Números",
    "deuteronomy": "Deuteronômio",
    "joshua": "Josué",
    "judges": "Juízes",
    "ruth": "Rute",
    "1_samuel": "1 Samuel",
    "2_samuel": "2 Samuel",
    "1_kings": "1 Reis",
    "2_kings": "2 Reis",
    "1_chronicles": "1 Crônicas",
    "2_chronicles": "2 Crônicas",
    "ezra": "Esdras",
    "nehemiah": "Neemias",
    "esther": "Ester",
    "job": "Jó",
    "psalms": "Salmos",
    "proverbs": "Provérbios",
    "ecclesiastes": "Eclesiastes",
    "songs": "Cânticos",
    "isaiah": "Isaías",
    "jeremiah": "Jeremias",
    "lamentations": "Lamentações",
    "ezekiel": "Ezequiel",
    "daniel": "Daniel",
    "hosea": "Oséias",
    "joel": "Joel",
    "amos": "Amós",
    "obadiah": "Obadias",
    "jonah": "Jonas",
    "micah": "Miquéias",
    "nahum": "Naum",
    "habakkuk": "Habacuque",
    "zephaniah": "Sofonias",
    "haggai": "Ageu",
    "zechariah": "Zacarias",
    "malachi": "Malaquias",
    "matthew": "Mateus",
    "mark": "Marcos",
    "luke": "Lucas",
    "john": "João",
    "acts": "Atos",
    "romans": "Romanos",
    "1_corinthians": "1 Coríntios",
    "2_corinthians": "2 Coríntios",
    "galatians": "Gálatas",
    "ephesians": "Efésios",
    "philippians": "Filipenses",
    "colossians": "Colossenses",
    "1_thessalonians": "1 Tessalonicenses",
    "2_thessalonians": "2 Tessalonicenses",
    "1_timothy": "1 Timóteo",
    "2_timothy": "2 Timóteo",
    "titus": "Tito",
    "philemon": "Filemom",
    "hebrews": "Hebreus",
    "james": "Tiago",
    "1_peter": "1 Pedro",
    "2_peter": "2 Pedro",
    "1_john": "1 João",
    "2_john": "2 João",
    "3_john": "3 João",
    "jude": "Judas",
    "revelation": "Apocalipse"
};

// All 66 books in biblical order with their chapter counts
const BIBLE_BOOKS = [
    { slug: "genesis", chapters: 50, verses: [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26] },
    { slug: "exodus", chapters: 40, verses: [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38] },
    { slug: "leviticus", chapters: 27, verses: [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34] },
    { slug: "numbers", chapters: 36, verses: [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13] },
    { slug: "deuteronomy", chapters: 34, verses: [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12] },
    { slug: "joshua", chapters: 24, verses: [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33] },
    { slug: "judges", chapters: 21, verses: [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25] },
    { slug: "ruth", chapters: 4, verses: [22,23,18,22] },
    { slug: "1_samuel", chapters: 31, verses: [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13] },
    { slug: "2_samuel", chapters: 24, verses: [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25] },
    { slug: "1_kings", chapters: 22, verses: [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53] },
    { slug: "2_kings", chapters: 25, verses: [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30] },
    { slug: "1_chronicles", chapters: 29, verses: [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30] },
    { slug: "2_chronicles", chapters: 36, verses: [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23] },
    { slug: "ezra", chapters: 10, verses: [11,70,13,24,17,22,28,36,15,44] },
    { slug: "nehemiah", chapters: 13, verses: [11,20,32,23,19,19,73,18,38,39,36,47,31] },
    { slug: "esther", chapters: 10, verses: [22,23,15,17,14,14,10,17,32,3] },
    { slug: "job", chapters: 42, verses: [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17] },
    { slug: "psalms", chapters: 150, verses: [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6] },
    { slug: "proverbs", chapters: 31, verses: [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31] },
    { slug: "ecclesiastes", chapters: 12, verses: [18,26,22,16,20,12,29,17,18,20,10,14] },
    { slug: "songs", chapters: 8, verses: [17,17,11,16,16,13,13,14] },
    { slug: "isaiah", chapters: 66, verses: [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24] },
    { slug: "jeremiah", chapters: 52, verses: [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34] },
    { slug: "lamentations", chapters: 5, verses: [22,22,66,22,22] },
    { slug: "ezekiel", chapters: 48, verses: [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35] },
    { slug: "daniel", chapters: 12, verses: [21,49,30,37,31,28,28,27,27,21,45,13] },
    { slug: "hosea", chapters: 14, verses: [11,23,5,19,15,11,16,14,17,15,12,14,16,9] },
    { slug: "joel", chapters: 3, verses: [20,32,21] },
    { slug: "amos", chapters: 9, verses: [15,16,15,13,27,14,17,14,15] },
    { slug: "obadiah", chapters: 1, verses: [21] },
    { slug: "jonah", chapters: 4, verses: [17,10,10,11] },
    { slug: "micah", chapters: 7, verses: [16,13,12,13,15,16,20] },
    { slug: "nahum", chapters: 3, verses: [15,13,19] },
    { slug: "habakkuk", chapters: 3, verses: [17,20,19] },
    { slug: "zephaniah", chapters: 3, verses: [18,15,20] },
    { slug: "haggai", chapters: 2, verses: [15,23] },
    { slug: "zechariah", chapters: 14, verses: [21,13,10,14,11,15,14,23,17,12,17,14,9,21] },
    { slug: "malachi", chapters: 4, verses: [14,17,18,6] },
    { slug: "matthew", chapters: 28, verses: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20] },
    { slug: "mark", chapters: 16, verses: [45,28,35,41,43,53,37,38,50,52,33,44,37,72,47,20] },
    { slug: "luke", chapters: 24, verses: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53] },
    { slug: "john", chapters: 21, verses: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25] },
    { slug: "acts", chapters: 28, verses: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31] },
    { slug: "romans", chapters: 16, verses: [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27] },
    { slug: "1_corinthians", chapters: 16, verses: [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24] },
    { slug: "2_corinthians", chapters: 13, verses: [24,17,18,18,21,18,16,24,15,18,33,21,14] },
    { slug: "galatians", chapters: 6, verses: [24,21,29,31,26,18] },
    { slug: "ephesians", chapters: 6, verses: [23,22,21,32,33,24] },
    { slug: "philippians", chapters: 4, verses: [30,30,21,23] },
    { slug: "colossians", chapters: 4, verses: [29,23,25,18] },
    { slug: "1_thessalonians", chapters: 5, verses: [10,20,13,18,28] },
    { slug: "2_thessalonians", chapters: 3, verses: [12,17,18] },
    { slug: "1_timothy", chapters: 6, verses: [20,15,16,16,25,21] },
    { slug: "2_timothy", chapters: 4, verses: [18,26,17,22] },
    { slug: "titus", chapters: 3, verses: [16,15,15] },
    { slug: "philemon", chapters: 1, verses: [25] },
    { slug: "hebrews", chapters: 13, verses: [14,18,19,16,14,20,28,13,28,39,40,29,25] },
    { slug: "james", chapters: 5, verses: [27,26,18,17,20] },
    { slug: "1_peter", chapters: 5, verses: [25,25,22,19,14] },
    { slug: "2_peter", chapters: 3, verses: [21,22,18] },
    { slug: "1_john", chapters: 5, verses: [10,29,24,21,21] },
    { slug: "2_john", chapters: 1, verses: [13] },
    { slug: "3_john", chapters: 1, verses: [14] },
    { slug: "jude", chapters: 1, verses: [25] },
    { slug: "revelation", chapters: 22, verses: [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21] }
];

// --- HELPERS ---

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchUrl(url, retries = 3) {
    return new Promise((resolve, reject) => {
        const request = () => {
            https.get(url, (res) => {
                if (res.statusCode === 404) {
                    resolve(null); // Return null for 404
                    return;
                }
                if (res.statusCode !== 200) {
                    if (retries > 0) {
                        console.warn(`⚠️ URL ${url} retornou status ${res.statusCode}. Tentando novamente (${retries} restantes)...`);
                        setTimeout(() => fetchUrl(url, retries - 1).then(resolve).catch(reject), 1000);
                    } else {
                        reject(new Error(`Status HTTP inválido: ${res.statusCode}`));
                    }
                    return;
                }

                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => resolve(data));
            }).on('error', (err) => {
                if (retries > 0) {
                    console.warn(`⚠️ Falha na conexão para ${url}: ${err.message}. Retentando...`);
                    setTimeout(() => fetchUrl(url, retries - 1).then(resolve).catch(reject), 1000);
                } else {
                    reject(err);
                }
            });
        };
        request();
    });
}

function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&ldquo;/g, '"')
        .replace(/&rdquo;/g, '"')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function cleanHtml(html) {
    if (!html) return '';
    let text = html.replace(/<[^>]+>/g, ' ');
    text = decodeHtmlEntities(text);
    return text.replace(/\s+/g, ' ').trim();
}

// Extract rows from the interlinear table
function parseInterlinearVerse(html) {
    const tableMatch = html.match(/<table[^>]*class=["']maintext["'][^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return null;
    
    const tableHtml = tableMatch[1];
    const rows = tableHtml.split(/<tr[^>]*>/i).filter(r => r.trim());
    
    const words = [];
    
    // Skip row 0 which is usually header
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row.includes('<td')) continue;
        
        const cols = row.split(/<td[^>]*>/i);
        if (cols.length < 5) continue; // Note: cols[0] is everything before first <td>
        
        let strongs = '';
        let original = '';
        let translit = '';
        let english = '';
        let morphology = '';
        
        // Parse Strong's
        const strongsHtml = cols[1];
        const strongsMatch = strongsHtml.match(/<a[^>]*>(\d+)/i);
        if (strongsMatch) strongs = strongsMatch[1];
        
        // Parse Hebrew/Greek
        const origHtml = cols[2];
        const parts = origHtml.split(/<br\s*\/?>/i);
        if (parts.length > 0) {
            original = cleanHtml(parts[0]);
        }
        if (parts.length > 1) {
            translit = cleanHtml(parts[1]);
        }
        
        // Parse English
        english = cleanHtml(cols[3]);
        
        // Parse Morphology
        morphology = cleanHtml(cols[4]);
        
        if (original || english) {
            words.push({
                strongs,
                original,
                translit,
                english,
                morphology
            });
        }
    }
    
    return words.length > 0 ? words : null;
}

// Concurrency-limited promise pool helper
async function mapLimit(limit, array, fn) {
    const results = [];
    const executing = [];
    for (const item of array) {
        const p = Promise.resolve().then(() => fn(item));
        results.push(p);
        if (limit <= array.length) {
            const e = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= limit) {
                await Promise.race(executing);
            }
        }
    }
    return Promise.all(results);
}

// --- SCRAPING FUNCTION ---

async function scrapeBook(bookObj) {
    const portName = `Original_${BOOK_MAPPING[bookObj.slug]}`;
    if (!portName) {
        console.error(`❌ Mapeamento de nome não encontrado para o slug: ${bookObj.slug}`);
        return;
    }

    console.log(`\n📚 Iniciando raspagem: ${portName} (${bookObj.chapters} capítulos)`);
    
    console.log(`   🧹 Limpando dados anteriores para ${portName}...`);
    const { error: deleteError } = await supabase
        .from('verses')
        .delete()
        .eq('book', portName);

    if (deleteError) {
        console.error(`   ❌ Erro ao limpar dados anteriores: ${deleteError.message}`);
        return;
    }

    const allBookVerses = [];
    
    // Create an array of {ch, v} for all verses in the book
    const verseList = [];
    for (let c = 1; c <= bookObj.chapters; c++) {
        const vCount = bookObj.verses[c - 1];
        for (let v = 1; v <= vCount; v++) {
            verseList.push({ ch: c, v: v });
        }
    }

    let processedCount = 0;
    // Fetch and parse verses in parallel with concurrency limit of 5
    await mapLimit(5, verseList, async ({ch, v}) => {
        const url = `https://biblehub.com/text/${bookObj.slug}/${ch}-${v}.htm`;
        try {
            const html = await fetchUrl(url);
            if (!html) {
                console.warn(`   ⚠️ ${bookObj.slug} ${ch}:${v} não encontrado (404) ou vazio.`);
                return;
            }

            const words = parseInterlinearVerse(html);
            if (words) {
                allBookVerses.push({
                    book: portName,
                    chapter: ch,
                    verse: v,
                    text: JSON.stringify(words)
                });
            } else {
                 console.warn(`   ⚠️ Falha ao extrair tabela de ${url}.`);
            }
            
            processedCount++;
            if (processedCount % 50 === 0) {
                console.log(`      ... processado ${processedCount}/${verseList.length} versículos.`);
            }

            // Short delay per request slot to be polite
            await sleep(50);
        } catch (err) {
            console.error(`   ❌ Erro ao obter ${bookObj.slug} ${ch}:${v}: ${err.message}`);
        }
    });

    // Sort verses before inserting
    allBookVerses.sort((a, b) => {
        if (a.chapter !== b.chapter) return a.chapter - b.chapter;
        return a.verse - b.verse;
    });

    // Insert in batches of 100 into the Supabase database
    if (allBookVerses.length === 0) {
        console.log(`   ℹ️ Nenhum versículo extraído para ${portName}.`);
        return;
    }

    console.log(`   🚀 Enviando ${allBookVerses.length} versículos para o Supabase...`);
    const BATCH_SIZE = 100;
    let totalUploaded = 0;

    for (let i = 0; i < allBookVerses.length; i += BATCH_SIZE) {
        const batch = allBookVerses.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
            .from('verses')
            .insert(batch);

        if (error) {
            console.error(`   ❌ Erro ao enviar lote ${i} a ${i + batch.length}: ${error.message}`);
            return;
        }
        totalUploaded += batch.length;
        console.log(`      Inseridos ${totalUploaded}/${allBookVerses.length} versículos...`);
    }

    console.log(`   ✅ Concluído: ${portName} enviado com sucesso!`);
}

// --- MAIN RUNNER ---

async function run() {
    const targetBookSlug = process.argv[2];
    
    if (targetBookSlug) {
        // Run single book
        const bookObj = BIBLE_BOOKS.find(b => b.slug.toLowerCase() === targetBookSlug.toLowerCase());
        if (!bookObj) {
            console.error(`❌ Livro slug inválido: "${targetBookSlug}".`);
            console.log("Slugs válidos:", BIBLE_BOOKS.map(b => b.slug).join(', '));
            process.exit(1);
        }
        await scrapeBook(bookObj);
    } else {
        // Run all books sequentially
        console.log(`🚀 Iniciando raspagem completa do texto Original (Interlinear) para todos os 66 livros da Bíblia...`);
        for (const bookObj of BIBLE_BOOKS) {
            await scrapeBook(bookObj);
        }
        console.log(`\n🎉 EXTRAÇÃO COMPLETA DE TODOS OS LIVROS CONCLUÍDA!`);
    }
}

run().catch(err => {
    console.error("❌ Erro fatal:", err);
    process.exit(1);
});
