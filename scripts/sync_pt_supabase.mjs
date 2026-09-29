/**
 * Sincroniza os textos traduzidos para português (pasta Dados/) com o Supabase.
 *
 * Contexto: em produção (Vercel) o app lê APENAS o Supabase. Os arquivos de Dados/
 * são servidos apenas pelo middleware do servidor de dev do Vite
 * (/api/local-commentaries, /api/biblia-sumarizada). Por isso, tudo que é traduzido
 * localmente precisa ser enviado ao Supabase para aparecer online.
 *
 * Convenção de rótulo (igual à UI): comentário em português é identificado pelo autor
 * terminando em " Pt" -> label "<autor> Pt".
 *
 * Uso:
 *   node scripts/sync_pt_supabase.mjs --dry-run   (só relatório, não grava)
 *   node scripts/sync_pt_supabase.mjs             (grava)
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN = process.argv.includes('--dry-run');
const INSERT_CHUNK = 300;

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i <= 0) return;
    const k = t.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim();
  });
}
loadEnv();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local.');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(label, fn, attempts = 5) {
  let lastErr;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (a < attempts) await sleep(400 * a);
    }
  }
  throw new Error(`${label}: ${lastErr?.message || lastErr}`);
}

const loadJson = (rel) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8'));
const bookOf = (item) => item.book || item.book_pt || item.book_en || '';

/** Pares livro -> capítulos presentes nos registros. */
function pairsOf(items) {
  const map = new Map();
  for (const it of items) {
    const b = bookOf(it);
    if (!b) continue;
    const c = Number(it.chapter) || 0;
    if (!map.has(b)) map.set(b, new Set());
    map.get(b).add(c);
  }
  return map;
}

/** Mesmo critério/extração do vite.config.ts para o sumário por capítulo. */
const isChapterRecord = (text) => /^\s*(RESUMO\s*\n\s*)?CAP[IÍ]TULO\b/i.test(text || '');
function firstSection(text) {
  const out = [];
  let seen = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^\s*CAP[IÍ]TULO\b/i.test(line)) {
      if (seen) break;
      seen = true;
    }
    out.push(line);
  }
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join('\n');
}

function toRows(author, items, mapItem) {
  const seen = new Set();
  const rows = [];
  let skipped = 0;
  for (const item of items) {
    const mapped = mapItem(item);
    if (!mapped || !mapped.book || !mapped.text) { skipped++; continue; }
    const key = [mapped.book, mapped.chapter, mapped.verse ?? '', String(mapped.text).slice(0, 120)].join('|');
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    rows.push({ author, ...mapped });
  }
  return { rows, skipped };
}

const plain = (it) => ({
  book: bookOf(it),
  chapter: Number(it.chapter) || 0,
  verse: it.verse === null || it.verse === undefined ? null : Number(it.verse),
  text: it.text,
});

async function countByAuthor(author) {
  const { count, error } = await supabase
    .from('commentaries').select('id', { count: 'exact', head: true }).eq('author', author);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function insertRows(author, rows) {
  if (DRY_RUN) return rows.length;
  let done = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    await withRetry(`inserir ${author}`, async () => {
      const { error } = await supabase.from('commentaries').insert(chunk);
      if (error) throw new Error(error.message);
    });
    done += chunk.length;
    process.stdout.write(`\r   inserindo: ${done}/${rows.length}`);
    await sleep(60);
  }
  process.stdout.write('\n');
  return done;
}

/** Remove (autor, livro, capítulos) em lotes por livro — evita timeout do Supabase. */
async function deletePairs(author, pairs) {
  if (DRY_RUN) {
    let n = 0;
    for (const set of pairs.values()) n += set.size;
    return n;
  }
  let total = 0;
  const books = [...pairs.keys()];
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const chapters = [...pairs.get(book)].sort((a, b) => a - b);
    for (let j = 0; j < chapters.length; j += 100) {
      const slice = chapters.slice(j, j + 100);
      await withRetry(`remover ${author} ${book}`, async () => {
        const { error } = await supabase.from('commentaries').delete()
          .eq('author', author).eq('book', book).in('chapter', slice);
        if (error) throw new Error(error.message);
      });
      total += slice.length;
    }
    process.stdout.write(`\r   removendo: livro ${i + 1}/${books.length} (${total} capítulos)`);
    await sleep(40);
  }
  process.stdout.write('\n');
  return total;
}

async function renameAuthor(from, to) {
  const before = await countByAuthor(from);
  if (!before) return 0;
  if (DRY_RUN) return before;
  await withRetry(`renomear ${from}`, async () => {
    const { error } = await supabase.from('commentaries').update({ author: to }).eq('author', from);
    if (error) throw new Error(error.message);
  });
  return before;
}

/** Corrige nomes de livro corrompidos (mojibake) herdados dos arquivos originais. */
async function fixBookName(author, from, to) {
  if (from === to || DRY_RUN) return 0;
  await withRetry(`corrigir livro ${from}`, async () => {
    const { error } = await supabase.from('commentaries').update({ book: to })
      .eq('author', author).eq('book', from);
    if (error) throw new Error(error.message);
  });
  return 1;
}

/** Guarda uma cópia das linhas atuais do autor antes de qualquer alteração destrutiva. */
async function backupAuthor(author, dir, file) {
  if (DRY_RUN) return 0;
  const all = [];
  let lastId = 0;
  for (let page = 0; page < 500; page++) {
    const chunk = await withRetry(`backup de ${author}`, async () => {
      const res = await supabase.from('commentaries')
        .select('id, author, book, chapter, verse, text')
        .eq('author', author).gt('id', lastId).order('id', { ascending: true }).limit(1000);
      if (res.error) throw new Error(res.error.message);
      return res.data || [];
    });
    if (!chunk.length) break;
    all.push(...chunk);
    lastId = chunk[chunk.length - 1].id;
    process.stdout.write(`\r   backup: ${all.length} registros`);
    if (chunk.length < 1000) break;
    await sleep(50);
  }
  process.stdout.write('\n');
  const target = path.resolve(process.cwd(), dir);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, file), JSON.stringify(all, null, 1));
  return all.length;
}

async function main() {
  console.log(DRY_RUN ? '🔎 MODO DRY-RUN (nada será gravado)\n' : '🚀 SINCRONIZANDO PT -> SUPABASE\n');

  // ------------------------------------------------------------ Cambridge PT
  {
    const author = 'Cambridge Pt';
    const items = loadJson('Dados/Obras-Pt/comentarios_cambridge_pt.json');
    const { rows, skipped } = toRows(author, items, plain);
    console.log(`[Cambridge Pt] local: ${items.length} registros -> ${rows.length} únicos (${skipped} duplicados)`);
    console.log(`   Supabase: "${author}" = ${await countByAuthor(author)} | "Cambridge" (EN) = ${await countByAuthor('Cambridge')}`);
    const ins = await insertRows(author, rows);
    console.log(`   inseridos: ${ins}\n`);
  }

  // --------------------------------------------------------------- Clarke PT
  {
    const author = 'Clarke Pt';
    const items = [
      ...loadJson('Dados/Obras-Pt/clarke_pt.json'),
      ...loadJson('Dados/Obras-Pt/comentarios_clarke_pt.json'),
    ];
    const { rows, skipped } = toRows(author, items, plain);
    const localPairs = pairsOf(items);
    console.log(`[Clarke Pt] local: ${items.length} registros -> ${rows.length} únicos (${skipped} duplicados)`);
    console.log(`   Supabase: "Clarke" = ${await countByAuthor('Clarke')} (texto PT rotulado como EN, com cópias antigas) | "${author}" = ${await countByAuthor(author)}`);
    const bk = await backupAuthor('Clarke', 'Dados/_backup_clarke', 'clarke_supabase_backup.json');
    console.log(`   backup de segurança: ${bk} registros em Dados/_backup_clarke/`);
    console.log('   removendo cópias antigas somente nos capítulos cobertos pelos arquivos locais...');
    const del = await deletePairs('Clarke', localPairs);
    console.log(`   capítulos limpos: ${del}`);
    console.log('   rotulando como PT o que restou (capítulos sem versão local, ex.: Sl 23, Ap 17-22)...');
    const ren = await renameAuthor('Clarke', author);
    console.log(`   renomeados: ${ren}`);
    const ins = await insertRows(author, rows);
    console.log(`   inseridos: ${ins}\n`);
  }

  // -------------------------------------------------------------- Andrews PT
  {
    const author = 'Comentário Bíblico Andrews Pt';
    const items = loadJson('Dados/Obras-Pt/andrews_study_bible_pt.json');
    const { rows, skipped } = toRows(author, items, plain);
    console.log(`[Andrews Pt] local: ${items.length} registros -> ${rows.length} únicos (${skipped} duplicados)`);
    console.log(`   Supabase: "${author}" = ${await countByAuthor(author)} | "Andrews Study Bible" (EN) = ${await countByAuthor('Andrews Study Bible')}`);
    const ins = await insertRows(author, rows);
    console.log(`   inseridos: ${ins}\n`);
  }

  // --------------------------------------------------------------- Barnes PT
  {
    const from = 'comentarios barnes';
    const to = 'comentarios barnes Pt';
    const items = loadJson('Dados/Obras-Pt/comentarios_barnes_pt.json');
    const { rows } = toRows(to, items, plain);
    console.log(`[Barnes Pt] local: ${items.length} registros (${rows.length} únicos)`);
    console.log(`   Supabase: "${from}" = ${await countByAuthor(from)} (texto PT rotulado como EN) | "${to}" = ${await countByAuthor(to)}`);
    const ren = await renameAuthor(from, to);
    console.log(`   renomeados: ${ren}`);
    const badNames = [...new Set(items.map((i) => bookOf(i)))].filter((b) => b.includes('\uFFFD') || b.includes('?'));
    for (const bad of badNames) {
      const applied = await fixBookName(to, bad, 'Efésios');
      console.log(`   nome de livro corrompido "${bad}" -> "Efésios": ${applied ? 'corrigido' : 'pendente'}`);
    }
    console.log('');
  }

  // ------------------------------------------------------- Bíblia Sumarizada
  {
    const author = 'Bíblia Sumarizada Pt';
    const items = [
      ...loadJson('Dados/Extras/biblia_sumarizada.json'),
      ...loadJson('Dados/Extras/biblia_sumarizada_2.json'),
    ].filter((it) => isChapterRecord(it.text));
    const { rows, skipped } = toRows(author, items, (it) => ({
      book: bookOf(it),
      chapter: Number(it.chapter) || 0,
      verse: it.verse === null || it.verse === undefined ? null : Number(it.verse),
      text: firstSection(it.text),
    }));
    console.log(`[Bíblia Sumarizada] local: ${items.length} registros de capítulo -> ${rows.length} únicos (${skipped} duplicados)`);
    console.log(`   Supabase: "${author}" = ${await countByAuthor(author)}`);
    const ins = await insertRows(author, rows);
    console.log(`   inseridos: ${ins}\n`);
  }

  console.log(`[Resumo dos Capítulos] Supabase: ${await countByAuthor('Resumo dos Capítulos')} registros (já em PT, usado na aba Capítulo)`);
  console.log('\n✅ Sincronização concluída.');
}

main().catch((e) => {
  console.error('\n❌ Erro:', e.message);
  process.exit(1);
});
