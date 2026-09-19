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

async function importTranslations() {
    const inputDir = path.resolve(process.cwd(), 'traducoes');
    if (!fs.existsSync(inputDir)) {
        console.error("Pasta 'traducoes' não encontrada.");
        return;
    }

    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.log("Nenhum arquivo .json encontrado na pasta 'traducoes'.");
        return;
    }

    console.log(`Encontrados ${files.length} arquivo(s) para verificar.`);

    for (const file of files) {
        console.log(`\nProcessando ${file}...`);
        const filePath = path.join(inputDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Filtrar apenas os que foram marcados como traduzidos pela nossa ferramenta
        const translatedItems = data.filter(item => item.translated);
        
        if (translatedItems.length === 0) {
            console.log(`Nenhum item traduzido (campo 'translated: true') encontrado em ${file}. Pular.`);
            continue;
        }

        console.log(`${translatedItems.length} itens marcados como traduzidos em ${file}. Iniciando atualização no Supabase...`);
        let successCount = 0;
        let errorCount = 0;

        // Atualizar em lote de 1 em 1 ou pequenos lotes (Supabase suporta upsert de array, mas como só queremos atualizar 'text', faremos individual ou em chunk).
        // Vamos usar loop simples para controle de erros
        for (const item of translatedItems) {
            const { error } = await supabase
                .from('commentaries')
                .update({ text: item.text })
                .eq('id', item.id);
            
            if (error) {
                console.error(`Erro ao atualizar ID ${item.id}:`, error.message);
                errorCount++;
            } else {
                successCount++;
                process.stdout.write(`\rAtualizados: ${successCount} / ${translatedItems.length}`);
            }
        }
        
        console.log(`\nConcluído ${file}. Sucessos: ${successCount}. Erros: ${errorCount}.`);
    }
}

importTranslations();
