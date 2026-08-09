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

async function checkAuthor(author) {
    // Count total commentaries
    const { count, error } = await supabase
        .from('commentaries')
        .select('*', { count: 'exact', head: true })
        .eq('author', author);
        
    if (error) {
        console.error(`Error reading count for ${author}:`, error);
        return;
    }
    
    console.log(`Total [${author}] commentaries in database: ${count}`);
    
    // Get unique books using paging
    const allBooks = new Set();
    let from = 0;
    const limit = 1000;
    let hasMore = true;
    
    while (hasMore) {
        const { data, error: bError } = await supabase
            .from('commentaries')
            .select('book')
            .eq('author', author)
            .range(from, from + limit - 1);
            
        if (bError) {
            console.error("Error reading books:", bError);
            break;
        }
        
        if (data.length === 0) {
            hasMore = false;
        } else {
            data.forEach(row => allBooks.add(row.book));
            from += limit;
        }
    }
    
    console.log(`Unique books for [${author}]: ${allBooks.size} / 66`);
}

async function check() {
    try {
        console.log("Checking final database status...");
        await checkAuthor('Clarke');
        console.log("------------------------");
        await checkAuthor('Barnes');
        console.log("------------------------");
        await checkAuthor('Cambridge');
        console.log("------------------------");
        await checkAuthor('Geneva');
        console.log("------------------------");
        await checkAuthor('Matthew Henry');
    } catch (e) {
        console.error("Error:", e);
    }
}

check();
