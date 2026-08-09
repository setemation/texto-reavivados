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

// --- AUTHOR CONFIG ---
const AUTHOR_MAP = {
    clarke: { name: "Clarke", slug: "clarke" },
    barnes: { name: "Barnes", slug: "barnes" },
    jfb: { name: "JFB", slug: "jfb" },
    calvin: { name: "Calvin", slug: "calvin" },
    cambridge: { name: "Cambridge", slug: "cambridge" },
    gsb: { name: "Geneva", slug: "gsb" },
    mhc: { name: "Matthew Henry", slug: "mhc" },
    gill: { name: "Gill's Exposition", slug: "gill" }
};

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
    { slug: "genesis", chapters: 50 },
    { slug: "exodus", chapters: 40 },
    { slug: "leviticus", chapters: 27 },
    { slug: "numbers", chapters: 36 },
    { slug: "deuteronomy", chapters: 34 },
    { slug: "joshua", chapters: 24 },
    { slug: "judges", chapters: 21 },
    { slug: "ruth", chapters: 4 },
    { slug: "1_samuel", chapters: 31 },
    { slug: "2_samuel", chapters: 24 },
    { slug: "1_kings", chapters: 22 },
    { slug: "2_kings", chapters: 25 },
    { slug: "1_chronicles", chapters: 29 },
    { slug: "2_chronicles", chapters: 36 },
    { slug: "ezra", chapters: 10 },
    { slug: "nehemiah", chapters: 13 },
    { slug: "esther", chapters: 10 },
    { slug: "job", chapters: 42 },
    { slug: "psalms", chapters: 150 },
    { slug: "proverbs", chapters: 31 },
    { slug: "ecclesiastes", chapters: 12 },
    { slug: "songs", chapters: 8 },
    { slug: "isaiah", chapters: 66 },
    { slug: "jeremiah", chapters: 52 },
    { slug: "lamentations", chapters: 5 },
    { slug: "ezekiel", chapters: 48 },
    { slug: "daniel", chapters: 12 },
    { slug: "hosea", chapters: 14 },
    { slug: "joel", chapters: 3 },
    { slug: "amos", chapters: 9 },
    { slug: "obadiah", chapters: 1 },
    { slug: "jonah", chapters: 4 },
    { slug: "micah", chapters: 7 },
    { slug: "nahum", chapters: 3 },
    { slug: "habakkuk", chapters: 3 },
    { slug: "zephaniah", chapters: 3 },
    { slug: "haggai", chapters: 2 },
    { slug: "zechariah", chapters: 14 },
    { slug: "malachi", chapters: 4 },
    { slug: "matthew", chapters: 28 },
    { slug: "mark", chapters: 16 },
    { slug: "luke", chapters: 24 },
    { slug: "john", chapters: 21 },
    { slug: "acts", chapters: 28 },
    { slug: "romans", chapters: 16 },
    { slug: "1_corinthians", chapters: 16 },
    { slug: "2_corinthians", chapters: 13 },
    { slug: "galatians", chapters: 6 },
    { slug: "ephesians", chapters: 6 },
    { slug: "philippians", chapters: 4 },
    { slug: "colossians", chapters: 4 },
    { slug: "1_thessalonians", chapters: 5 },
    { slug: "2_thessalonians", chapters: 3 },
    { slug: "1_timothy", chapters: 6 },
    { slug: "2_timothy", chapters: 4 },
    { slug: "titus", chapters: 3 },
    { slug: "philemon", chapters: 1 },
    { slug: "hebrews", chapters: 13 },
    { slug: "james", chapters: 5 },
    { slug: "1_peter", chapters: 5 },
    { slug: "2_peter", chapters: 3 },
    { slug: "1_john", chapters: 5 },
    { slug: "2_john", chapters: 1 },
    { slug: "3_john", chapters: 1 },
    { slug: "jude", chapters: 1 },
    { slug: "revelation", chapters: 22 }
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
    
    // Remove script, style, and ins (adsense) tags along with their contents
    let text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<ins[\s\S]*?<\/ins>/gi, '');
    
    // First, strip the inner cverse3 spans leaving their content (e.g. {a})
    text = text.replace(/<span\b[^>]*class=["']cverse3["'][^>]*>([\s\S]*?)<\/span>/gi, '$1');

    // Convert italic, bold, and span highlights into bold-italic markdown ***
    text = text
        .replace(/<span\b[^>]*class=["']ital["'][^>]*>([\s\S]*?)<\/span>/gi, '***$1***')
        .replace(/<span\b[^>]*class=["']bld["'][^>]*>([\s\S]*?)<\/span>/gi, '***$1***')
        .replace(/<span\b[^>]*class=["']cverse2?["'][^>]*>([\s\S]*?)<\/span>/gi, '***$1***')
        .replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, '***$1***')
        .replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, '***$1***')
        .replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, '***$1***')
        .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, '***$1***');

    // Normalize newlines and replace break/paragraph tags
    text = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<p\s*\/?>/gi, '\n\n')
        .replace(/<\/p>/gi, '\n\n');
    
    // Strip other HTML tags
    text = text.replace(/<[^>]+>/g, '');
    
    // Decode HTML entities
    text = decodeHtmlEntities(text);
    
    // Clean spaces and trim lines
    text = text.replace(/[ \t]+/g, ' ');
    text = text.split('\n').map(line => line.trim()).join('\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    
    // Filter out remaining JS tracking snippets or adsense functions from the lines
    text = text.split('\n').filter(line => {
        const lower = line.toLowerCase();
        if (lower.includes('(new image())')) return false;
        if (lower.includes('(adsbygoogle')) return false;
        if (lower.includes('window.adsbygoogle')) return false;
        if (lower.includes('google_ad_')) return false;
        return true;
    }).join('\n');
    
    return text.trim();
}

// Parse verse ranges for consolidated commentaries (specifically Matthew Henry's Concise Commentary)
function parseVerseRange(text, defaultVerse) {
    const cleanText = text.trim();
    
    // Pattern 1: "1:3-5" or "12:3-5"
    const matchA = cleanText.match(/^(\d+):(\d+)-(\d+)/);
    if (matchA) {
        const start = parseInt(matchA[2], 10);
        const end = parseInt(matchA[3], 10);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
            const verses = [];
            for (let v = start; v <= end; v++) verses.push(v);
            return verses;
        }
    }
    
    // Pattern 2: "1:1,2" or "1:29,30"
    const matchB = cleanText.match(/^(\d+):(\d+(?:,\d+)+)/);
    if (matchB) {
        const listStr = matchB[2];
        const verses = listStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (verses.length > 0) return verses;
    }
    
    // Pattern 3: "3-5"
    const matchD = cleanText.match(/^(\d+)-(\d+)/);
    if (matchD) {
        const start = parseInt(matchD[1], 10);
        const end = parseInt(matchD[2], 10);
        if (!isNaN(start) && !isNaN(end) && start <= end) {
            const verses = [];
            for (let v = start; v <= end; v++) verses.push(v);
            return verses;
        }
    }
    
    // Pattern 4: "1,2"
    const matchE = cleanText.match(/^(\d+(?:,\d+)+)/);
    if (matchE) {
        const verses = matchE[1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        if (verses.length > 0) return verses;
    }
    
    // Pattern 5: "1:31"
    const matchC = cleanText.match(/^(\d+):(\d+)/);
    if (matchC) {
        const verse = parseInt(matchC[2], 10);
        if (!isNaN(verse)) return [verse];
    }
    
    return [defaultVerse];
}

// Parse a chapter's HTML content and extract verse commentaries
function parseChapterHtml(html, authorName, bookName, chapterNum) {
    const commentaries = [];
    if (!html.includes('class="versenum"')) {
        return commentaries;
    }

    const parts = html.split('<div class="versenum">');
    
    // Index 0 is the introduction or heading of the page.
    if (authorName === "Gill's Exposition" && parts.length > 0) {
        let introHtml = parts[0];
        
        // Strip everything before the title/introduction part starts.
        // Gill's introduction often begins with <div class="chap">
        const chapMatch = introHtml.match(/<div class="chap">([\s\S]*)/);
        if (chapMatch) {
            let introTextRaw = chapMatch[1].trim();
            // Try to stop before the footer or navigation links if any
            const endMatch = introTextRaw.indexOf('<div class="versenum">');
            if (endMatch !== -1) {
                introTextRaw = introTextRaw.substring(0, endMatch);
            }
            
            const introClean = cleanHtml(introTextRaw);
            if (introClean) {
                commentaries.push({
                    author: authorName,
                    book: bookName,
                    chapter: chapterNum,
                    verse: 0,
                    text: introClean
                });
            }
        }
    }

    // Process verse-by-verse
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        
        // Find reference inside <a> e.g. <a href="/ezra/1-1.htm">Ezra 1:1</a>
        const aTagMatch = part.match(/<a\s+href="[^"]+">([^<]+)<\/a>/);
        if (!aTagMatch) continue;
        
        const refText = aTagMatch[1].trim();
        const colonIdx = refText.lastIndexOf(':');
        if (colonIdx === -1) continue;
        
        const verseStr = refText.substring(colonIdx + 1).trim();
        const verseNum = parseInt(verseStr, 10);
        if (isNaN(verseNum)) continue;

        // Verse scripture text is inside <div class="verse">...</div>
        const verseDivMatch = part.match(/<div class="verse">([\s\S]*?)<\/div>/);
        let commentaryStartIdx = 0;
        if (verseDivMatch) {
            commentaryStartIdx = verseDivMatch.index + verseDivMatch[0].length;
        } else {
            commentaryStartIdx = part.indexOf('</a>') + 4;
        }

        // The remaining content up to the end of the part is the commentary
        let commentaryRaw = part.substring(commentaryStartIdx).trim();
        
        // Remove bottom box/footer elements if present in the last part
        const botboxMatch = commentaryRaw.match(/<div\s+id=["']botbox["']/i);
        if (botboxMatch) {
            commentaryRaw = commentaryRaw.substring(0, botboxMatch.index);
        }
        
        const commentaryClean = cleanHtml(commentaryRaw);

        if (commentaryClean) {
            if (authorName === "Matthew Henry") {
                const targetVerses = parseVerseRange(commentaryClean, verseNum);
                targetVerses.forEach(vNum => {
                    commentaries.push({
                        author: authorName,
                        book: bookName,
                        chapter: chapterNum,
                        verse: vNum,
                        text: commentaryClean
                    });
                });
            } else {
                commentaries.push({
                    author: authorName,
                    book: bookName,
                    chapter: chapterNum,
                    verse: verseNum,
                    text: commentaryClean
                });
            }
        }
    }
    return commentaries;
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

async function scrapeBook(authorObj, bookObj) {
    const portName = BOOK_MAPPING[bookObj.slug];
    if (!portName) {
        console.error(`❌ Mapeamento de nome não encontrado para o slug: ${bookObj.slug}`);
        return;
    }

    console.log(`\n📚 [${authorObj.name}] Iniciando raspagem: ${portName} (${bookObj.chapters} capítulos)`);
    
    // 1. Delete existing commentaries for this author and book to avoid duplicates
    console.log(`   🧹 Limpando comentários anteriores de ${authorObj.name} para ${portName}...`);
    const { error: deleteError } = await supabase
        .from('commentaries')
        .delete()
        .eq('author', authorObj.name)
        .eq('book', portName);

    if (deleteError) {
        console.error(`   ❌ Erro ao limpar comentários anteriores: ${deleteError.message}`);
        return;
    }

    const allBookComms = [];
    const chapters = Array.from({ length: bookObj.chapters }, (_, i) => i + 1);

    // 2. Fetch and parse chapters in parallel with concurrency limit of 5
    await mapLimit(5, chapters, async (ch) => {
        const url = `https://biblehub.com/commentaries/${authorObj.slug}/${bookObj.slug}/${ch}.htm`;
        try {
            const html = await fetchUrl(url);
            if (!html) {
                console.warn(`   ⚠️ Capítulo ${ch} não encontrado (404) ou vazio.`);
                return;
            }

            const chapterComms = parseChapterHtml(html, authorObj.name, portName, ch);
            console.log(`   📖 Cap. ${ch}: extraídos ${chapterComms.length} comentários.`);
            allBookComms.push(...chapterComms);
            
            // Short delay per request slot to be polite
            await sleep(100);
        } catch (err) {
            console.error(`   ❌ Erro ao obter Capítulo ${ch}: ${err.message}`);
        }
    });

    // 3. Insert in batches of 100 into the Supabase database
    if (allBookComms.length === 0) {
        console.log(`   ℹ️ Nenhum comentário extraído para ${portName}.`);
        return;
    }

    console.log(`   🚀 Enviando ${allBookComms.length} comentários para o Supabase...`);
    const BATCH_SIZE = 100;
    let totalUploaded = 0;

    for (let i = 0; i < allBookComms.length; i += BATCH_SIZE) {
        const batch = allBookComms.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
            .from('commentaries')
            .insert(batch);

        if (error) {
            console.error(`   ❌ Erro ao enviar lote ${i} a ${i + batch.length}: ${error.message}`);
            return;
        }
        totalUploaded += batch.length;
        console.log(`      Inseridos ${totalUploaded}/${allBookComms.length} comentários...`);
    }

    console.log(`   ✅ Concluído: ${portName} enviado com sucesso!`);
}

// --- MAIN RUNNER ---

async function run() {
    const commentaryCode = process.argv[2];
    const targetBookSlug = process.argv[3];
    
    if (!commentaryCode) {
        console.error("❌ Erro: especifique o código do comentário. Opções: clarke, barnes, jfb, calvin, cambridge");
        console.log("Exemplo: node scripts/scrape_commentary.mjs barnes ezra");
        process.exit(1);
    }
    
    const authorObj = AUTHOR_MAP[commentaryCode.toLowerCase()];
    if (!authorObj) {
        console.error(`❌ Código de comentário inválido: "${commentaryCode}".`);
        console.log("Opções válidas:", Object.keys(AUTHOR_MAP).join(', '));
        process.exit(1);
    }
    
    if (targetBookSlug) {
        // Run single book
        const bookObj = BIBLE_BOOKS.find(b => b.slug.toLowerCase() === targetBookSlug.toLowerCase());
        if (!bookObj) {
            console.error(`❌ Livro slug inválido: "${targetBookSlug}".`);
            console.log("Slugs válidos:", BIBLE_BOOKS.map(b => b.slug).join(', '));
            process.exit(1);
        }
        await scrapeBook(authorObj, bookObj);
    } else {
        // Run all books sequentially
        console.log(`🚀 Iniciando raspagem completa do comentário [${authorObj.name}] para todos os 66 livros da Bíblia...`);
        for (const bookObj of BIBLE_BOOKS) {
            await scrapeBook(authorObj, bookObj);
        }
        console.log(`\n🎉 EXTRAÇÃO COMPLETA DE TODOS OS LIVROS CONCLUÍDA PARA [${authorObj.name}]!`);
    }
}

run().catch(err => {
    console.error("❌ Erro fatal:", err);
    process.exit(1);
});
