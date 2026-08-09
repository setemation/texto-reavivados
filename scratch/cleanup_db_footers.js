import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts[1].trim();
    }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const FOOTER_PATTERNS = [
    /The Geneva Bible Translation Notes[\s\S]*$/gi,
    /Concise Commentary on the Whole Bible[\s\S]*$/gi,
    /Notes on the Bible by Albert Barnes[\s\S]*$/gi,
    /Adam Clarke's Commentary[\s\S]*$/gi
];

async function cleanup() {
    console.log("Starting database footer cleanup...");
    
    // We fetch in chunks of 500
    let hasMore = true;
    let offset = 0;
    const limit = 500;
    let totalUpdated = 0;
    
    while (hasMore) {
        const { data, error } = await supabase
            .from('commentaries')
            .select('id, text')
            .range(offset, offset + limit - 1);
            
        if (error) {
            console.error("Error reading commentaries:", error);
            break;
        }
        
        if (data.length === 0) {
            hasMore = false;
            break;
        }
        
        console.log(`Checking rows ${offset} to ${offset + data.length}...`);
        
        const updates = [];
        for (const row of data) {
            let cleanText = row.text;
            let modified = false;
            
            for (const pattern of FOOTER_PATTERNS) {
                if (pattern.test(cleanText)) {
                    cleanText = cleanText.replace(pattern, '').trim();
                    modified = true;
                }
            }
            
            if (modified) {
                updates.push({ id: row.id, text: cleanText });
            }
        }
        
        if (updates.length > 0) {
            console.log(`Found ${updates.length} rows to update in this chunk.`);
            // Update each modified row
            for (const update of updates) {
                const { error: updateError } = await supabase
                    .from('commentaries')
                    .update({ text: update.text })
                    .eq('id', update.id);
                    
                if (updateError) {
                    console.error(`Error updating row ${update.id}:`, updateError);
                } else {
                    totalUpdated++;
                }
            }
            console.log(`Updated ${updates.length} rows successfully.`);
        }
        
        offset += limit;
        // Safety check to prevent infinite loop
        if (offset > 150000) {
            break;
        }
    }
    
    console.log(`🎉 Cleanup completed! Total rows updated: ${totalUpdated}`);
}

cleanup();
