import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Carregar variáveis de ambiente
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
    console.error("Supabase URL or Key not found in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const AUTHORS = [
  'Barnes',
  'Cambridge',
  'Clarke',
  'Comentário Adventista',
  'Geneva',
  "Gill's Exposition",
  'Matthew Henry'
];

async function exportCommentaries() {
    console.log("Iniciando exportação dos comentários...");
    
    const outputDir = path.resolve(process.cwd(), 'traducoes');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const author of AUTHORS) {
        console.log(`Baixando comentários de ${author}...`);
        let allData = [];
        let lastId = 0;
        const limit = 500;
        
        while (true) {
            const { data, error } = await supabase
                .from('commentaries')
                .select('id, book, chapter, verse, text')
                .eq('author', author)
                .gt('id', lastId)
                .order('id', { ascending: true })
                .limit(limit);
            
            if (error) {
                console.error(`Erro ao buscar dados do autor ${author}:`, error);
                break;
            }
            if (!data || data.length === 0) break;
            
            allData = allData.concat(data);
            lastId = data[data.length - 1].id;
            process.stdout.write(`\rBaixados: ${allData.length}`);
        }
        console.log(""); // Nova linha
        
        const safeAuthorName = author.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const fileName = path.join(outputDir, `comentarios_${safeAuthorName}_en.json`);
        fs.writeFileSync(fileName, JSON.stringify(allData, null, 2), 'utf8');
        console.log(`Salvo: ${fileName} (${allData.length} registros)`);
    }
    
    console.log("Exportação concluída com sucesso!");
}

exportCommentaries();
