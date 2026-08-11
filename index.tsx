import React, { useState, useCallback, Fragment, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { supabase, isSupabaseConfigured } from './supabase';

// --- Helper Components ---
const LoadingSpinner = () => <div className="loading-container"><div className="loader"></div></div>;
const ErrorMessage = ({ message }) => <div className="error-message">{message}</div>;
const handleAddClick = (e, eventName, detail) => {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
    const btn = e.currentTarget;
    btn.style.backgroundColor = '#4caf50';
    btn.style.color = 'white';
    btn.innerText = 'Adicionado!';
};

const parseBold = (text = '') => {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, index) =>
        index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>
    );
};

const formatGeminiError = (e: any, defaultMessage: string): string => {
    console.error(e);
    const msg = e?.message || e?.toString() || '';
    if (msg.includes('spending cap') || msg.includes('RESOURCE_EXHAUSTED') || e?.status === 429 || msg.includes('429')) {
        return 'Limite de cota excedido no Google AI Studio (Erro 429). Acesse https://ai.studio/spend para ajustar seu limite de gastos ou insira uma nova API Key.';
    }
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('TypeError') || msg.includes('network error')) {
        return 'Erro de Conexão: Não foi possível conectar ao Ollama local. Certifique-se de que o Ollama está rodando no seu computador e que as permissões CORS foram ativadas (com a variável OLLAMA_ORIGINS="*").';
    }
    return `${defaultMessage} (Detalhes: ${msg})`;
};

const parseAIJsonArray = (jsonStr: string): any[] => {
    let cleanStr = jsonStr.trim();
    if (cleanStr.startsWith('```json')) {
        cleanStr = cleanStr.substring(7);
    }
    if (cleanStr.endsWith('```')) {
        cleanStr = cleanStr.substring(0, cleanStr.length - 3);
    }
    cleanStr = cleanStr.trim();

    const parsed = JSON.parse(cleanStr);
    if (Array.isArray(parsed)) {
        return parsed;
    }
    
    if (typeof parsed === 'object' && parsed !== null) {
        for (const key of Object.keys(parsed)) {
            if (Array.isArray(parsed[key])) {
                return parsed[key];
            }
        }
    }
    throw new Error("O JSON retornado não é um array e não contém nenhuma lista.");
};

// --- Ollama Launcher Button ---
const OllamaStartButton = () => {
    const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
    const [msg, setMsg] = useState('');

    const handleStart = async () => {
        setStatus('loading');
        setMsg('');
        try {
            const res = await fetch('/api/start-ollama', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setStatus('ok');
                setMsg(data.message || 'Ollama iniciado!');
            } else {
                setStatus('error');
                setMsg(data.error || 'Erro ao iniciar Ollama.');
            }
        } catch (e) {
            setStatus('error');
            setMsg('Não foi possível contatar o servidor.');
        }
        setTimeout(() => setStatus('idle'), 4000);
    };

    const colors: Record<string, string> = { idle: '#1565c0', loading: '#757575', ok: '#2e7d32', error: '#c62828' };

    return (
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <button
                onClick={handleStart}
                disabled={status === 'loading'}
                title="Iniciar Ollama com CORS habilitado"
                style={{
                    background: 'none', border: 'none', cursor: status === 'loading' ? 'wait' : 'pointer',
                    fontSize: '16px', padding: '2px 4px', color: colors[status], lineHeight: 1,
                    transition: 'transform 0.3s',
                    animation: status === 'loading' ? 'spin 1s linear infinite' : 'none'
                }}
            >
                ⚙️
            </button>
            {msg && (
                <span style={{
                    position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                    backgroundColor: status === 'ok' ? '#e8f5e9' : '#ffebee',
                    color: status === 'ok' ? '#2e7d32' : '#c62828',
                    border: `1px solid ${status === 'ok' ? '#a5d6a7' : '#ef9a9a'}`,
                    borderRadius: '4px', padding: '4px 8px', fontSize: '0.7rem',
                    whiteSpace: 'nowrap', zIndex: 100, marginTop: '4px', boxShadow: '0 2px 6px rgba(0,0,0,0.15)'
                }}>
                    {msg}
                </span>
            )}
        </span>
    );
};

// --- API Wrapper ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const generateAIContent = async ({ prompt, isJson = false, config }: { prompt: string; isJson?: boolean; config?: any }): Promise<string> => {
    const provider = localStorage.getItem('ai_provider') || 'ollama';
    if (provider === 'ollama') {
        const model = localStorage.getItem('ollama_model') || 'qwen2.5:14b';
        const url = localStorage.getItem('ollama_url') || 'http://localhost:11434';
        
        const body: any = {
            model: model,
            prompt: prompt,
            stream: false
        };
        if (isJson) {
            body.format = 'json';
        }
        
        const res = await fetch(`${url}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (!res.ok) {
            throw new Error(`Ollama local respondeu com erro ${res.status}. Certifique-se de que o Ollama está rodando no seu computador e que você já baixou o modelo '${model}' (rode 'ollama pull ${model}' no terminal).`);
        }
        const data = await res.json();
        return data.response;
    } else {
        const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: prompt,
            config: config || (isJson ? { responseMimeType: "application/json" } : undefined)
        });
        return response.text;
    }
};

// --- Supabase & Local Bible Helper ---
let cachedBibleText = null;
const fetchBibleTextLocal = async () => {
    if (cachedBibleText) return cachedBibleText;
    try {
        const response = await fetch('/naa.md');
        if (!response.ok) throw new Error('Falha ao carregar naa.md');
        cachedBibleText = await response.text();
        return cachedBibleText;
    } catch (e) {
        console.error(e);
        return null;
    }
};

// Normalize book names to match naa.md format (e.g., "Salmos" -> "Salmo")
const normalizeBookName = (book: string): string => {
    const lower = book.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '');
    const map: Record<string, string> = {
        'genesis': 'Gênesis',
        'exodo': 'Êxodo',
        'levitico': 'Levítico',
        'numeros': 'Números',
        'deuteronomio': 'Deuteronômio',
        'josue': 'Josué',
        'juizes': 'Juízes',
        'rute': 'Rute',
        '1samuel': '1Samuel',
        '2samuel': '2Samuel',
        '1reis': '1Reis',
        '2reis': '2Reis',
        '1cronicas': '1Crônicas',
        '2cronicas': '2Crônicas',
        'esdras': 'Esdras',
        'neemias': 'Neemias',
        'ester': 'Ester',
        'jo': 'Jó',
        'salmo': 'Salmo',
        'salmos': 'Salmo',
        'proverbios': 'Provérbios',
        'eclesiastes': 'Eclesiastes',
        'cantico': 'Cântico',
        'canticos': 'Cântico',
        'cantares': 'Cântico',
        'canticodoscanticos': 'Cântico',
        'isaias': 'Isaías',
        'jeremias': 'Jeremias',
        'lamentacoes': 'Lamentações',
        'ezequiel': 'Ezequiel',
        'daniel': 'Daniel',
        'oseias': 'Oseias',
        'joel': 'Joel',
        'amos': 'Amós',
        'obadias': 'Obadias',
        'jonas': 'Jonas',
        'miqueias': 'Miqueias',
        'naum': 'Naum',
        'habacuque': 'Habacuque',
        'sofonias': 'Sofonias',
        'ageu': 'Ageu',
        'zacarias': 'Zacarias',
        'malaquias': 'Malaquias',
        'mateus': 'Mateus',
        'marcos': 'Marcos',
        'lucas': 'Lucas',
        'joao': 'João',
        'atos': 'Atos',
        'romanos': 'Romanos',
        '1corintios': '1Coríntios',
        '2corintios': '2Coríntios',
        'galatas': 'Gálatas',
        'efesios': 'Efésios',
        'filipenses': 'Filipenses',
        'colossenses': 'Colossenses',
        '1tessalonicenses': '1Tessalonicenses',
        '2tessalonicenses': '2Tessalonicenses',
        '1timoteo': '1Timóteo',
        '2timoteo': '2Timóteo',
        'tito': 'Tito',
        'filemom': 'Filemom',
        'hebreus': 'Hebreus',
        'tiago': 'Tiago',
        '1pedro': '1Pedro',
        '2pedro': '2Pedro',
        '1joao': '1João',
        '2joao': '2João',
        '3joao': '3João',
        'judas': 'Judas',
        'apocalipse': 'Apocalipse',
        'sabedoria': 'Sabedoria de Salomão'
    };
    return map[lower] || book;
};

const extractVersesFromRefLocal = (bibleText: string, ref: string, defaultVersesStr = '') => {
    const match = ref.match(/^(.+?)\s+(\d+):?(.*)$/);
    if (!match) return "Referência inválida.";

    let book = match[1].trim();
    book = book.replace(/^(\d)\s+/, '$1');
    book = normalizeBookName(book);
    const chapter = match[2];
    
    let versesStr = (defaultVersesStr || match[3] || '').trim();

    if (versesStr.includes(':')) {
        versesStr = versesStr.substring(versesStr.lastIndexOf(':') + 1);
    } else {
        const vMatch = versesStr.match(/(?:versos?|vs?\.?|vers[íi]culos?)\s*(.*)/i);
        if (vMatch) versesStr = vMatch[1];
    }

    const escapedBook = book.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`##\\s+${escapedBook}\\s+${chapter}\\r?\\n([\\s\\S]*?)(?:\\r?\\n##\\s|$)`, 'i');
    const chapterMatch = bibleText.match(regex);

    if (!chapterMatch) return `Capítulo não encontrado: ${book} ${chapter}`;

    const chapterText = chapterMatch[1].replace(/###.*?\r?\n/g, '');

    const versesDict: Record<number, string> = {};
    const verseRegex = /(?:^|\s)(\d+)\s/g;
    let vMatch: RegExpExecArray | null;
    let lastIndex = 0;
    let currentVerse: number | null = null;

    while ((vMatch = verseRegex.exec(chapterText)) !== null) {
        if (currentVerse !== null) {
            versesDict[currentVerse] = chapterText.substring(lastIndex, vMatch.index).trim();
        }
        currentVerse = parseInt(vMatch[1], 10);
        lastIndex = verseRegex.lastIndex;
    }
    if (currentVerse !== null) {
        versesDict[currentVerse] = chapterText.substring(lastIndex).trim();
    }

    if (!versesStr) return chapterText;

    const verseNumbers = new Set<number>();
    const parts = versesStr.replace(/\b(?:a|ao)\b/gi, '-').split(/[,;&]|(?:\s+e\s+)/i);
    parts.forEach(part => {
        const cleanPart = part.replace(/[^\d\-]/g, '');
        if (!cleanPart) return;

        if (cleanPart.includes('-')) {
            const [start, end] = cleanPart.split('-').map(s => parseInt(s, 10));
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = start; i <= end; i++) verseNumbers.add(i);
            }
        } else {
            const num = parseInt(cleanPart, 10);
            if (!isNaN(num)) verseNumbers.add(num);
        }
    });

    let resultText: string[] = [];
    const sorted = Array.from(verseNumbers).sort((a, b) => a - b);
    sorted.forEach(v => {
        if (versesDict[v]) {
            resultText.push(`**${v}** ${versesDict[v]}`);
        }
    });

    return resultText.length > 0 ? resultText.join(' ') : "Versículos não encontrados no texto.";
};

const getBibleTextFromRef = async (ref: string, defaultVersesStr = ''): Promise<string> => {
    const match = ref.match(/^(.+?)\s+(\d+):?(.*)$/);
    if (!match) return "Referência inválida.";

    let book = match[1].trim();
    book = book.replace(/^(\d)\s+/, '$1');
    book = normalizeBookName(book);
    const chapter = parseInt(match[2], 10);
    
    let versesStr = (defaultVersesStr || match[3] || '').trim();

    if (versesStr.includes(':')) {
        versesStr = versesStr.substring(versesStr.lastIndexOf(':') + 1);
    } else {
        const vMatch = versesStr.match(/(?:versos?|vs?\.?|vers[íi]culos?)\s*(.*)/i);
        if (vMatch) versesStr = vMatch[1];
    }

    if (isSupabaseConfigured()) {
        try {
            if (!versesStr) {
                const { data, error } = await supabase
                    .from('verses')
                    .select('verse, text')
                    .eq('book', book)
                    .eq('chapter', chapter)
                    .order('verse', { ascending: true });

                if (!error && data && data.length > 0) {
                    return data.map((v: { verse: number; text: string }) => `**${v.verse}** ${v.text}`).join('\n');
                }
            } else {
                const verseNumbers = new Set<number>();
                const parts = versesStr.replace(/\b(?:a|ao)\b/gi, '-').split(/[,;&]|(?:\s+e\s+)/i);
                parts.forEach(part => {
                    const cleanPart = part.replace(/[^\d\-]/g, '');
                    if (!cleanPart) return;

                    if (cleanPart.includes('-')) {
                        const [start, end] = cleanPart.split('-').map(s => parseInt(s, 10));
                        if (!isNaN(start) && !isNaN(end)) {
                            for (let i = start; i <= end; i++) verseNumbers.add(i);
                        }
                    } else {
                        const num = parseInt(cleanPart, 10);
                        if (!isNaN(num)) verseNumbers.add(num);
                    }
                });

                const sortedVerses = Array.from(verseNumbers).sort((a, b) => a - b);
                if (sortedVerses.length > 0) {
                    const { data, error } = await supabase
                        .from('verses')
                        .select('verse, text')
                        .eq('book', book)
                        .eq('chapter', chapter)
                        .in('verse', sortedVerses)
                        .order('verse', { ascending: true });

                    if (!error && data && data.length > 0) {
                        return data.map((v: { verse: number; text: string }) => `**${v.verse}** ${v.text}`).join(' ');
                    }
                }
            }
        } catch (e) {
            console.warn('Falha ao consultar Supabase, buscando via naa.md local...', e);
        }
    }

    const bibleText = await fetchBibleTextLocal();
    if (!bibleText) return "Falha ao carregar texto bíblico.";
    return extractVersesFromRefLocal(bibleText, ref, defaultVersesStr);
};

const fetchCommentaries = async (refStr: string): Promise<any[]> => {
    if (!isSupabaseConfigured()) return [];
    try {
        const match = refStr.trim().match(/^(.+?)\s+(\d+):?(.*)$/);
        if (!match) return [];
        const book = match[1].trim();
        const chapter = parseInt(match[2], 10);
        
        const { data, error } = await supabase
            .from('commentaries')
            .select('author, text, verse')
            .eq('book', book)
            .eq('chapter', chapter)
            .neq('author', 'Resumo dos Capítulos');
            
        if (error) {
            console.error('Erro ao buscar comentários do Supabase:', error);
            return [];
        }
        return data || [];
    } catch (e) {
        console.error('Erro ao buscar comentários:', e);
        return [];
    }
};

const getBookVariants = (rawBook: string): string[] => {
    const b = rawBook.trim().toLowerCase();
    const variants = new Set<string>([rawBook.trim()]);

    if (b === 'salmo' || b === 'salmos' || b === 'sl') {
        variants.add('Salmos');
        variants.add('Salmo');
        variants.add('Sl');
    } else if (b === 'cântico' || b === 'cânticos' || b === 'cantares' || b === 'cântico dos cânticos') {
        variants.add('Cânticos');
        variants.add('Cântico');
        variants.add('Cantares');
        variants.add('Cântico dos Cânticos');
    } else if (b === 'oseias' || b === 'oséias') {
        variants.add('Oséias');
        variants.add('Oseias');
    } else if (b === 'miqueias' || b === 'miquéias') {
        variants.add('Miquéias');
        variants.add('Miqueias');
    } else if (b.includes('samuel')) {
        if (b.includes('1') || b.includes('i')) { variants.add('1 Samuel'); variants.add('1Samuel'); variants.add('I Samuel'); }
        if (b.includes('2') || b.includes('ii')) { variants.add('2 Samuel'); variants.add('2Samuel'); variants.add('II Samuel'); }
    } else if (b.includes('reis')) {
        if (b.includes('1') || b.includes('i')) { variants.add('1 Reis'); variants.add('1Reis'); variants.add('I Reis'); }
        if (b.includes('2') || b.includes('ii')) { variants.add('2 Reis'); variants.add('2Reis'); variants.add('II Reis'); }
    } else if (b.includes('crônicas') || b.includes('cronicas')) {
        if (b.includes('1') || b.includes('i')) { variants.add('1 Crônicas'); variants.add('1Crônicas'); variants.add('I Crônicas'); }
        if (b.includes('2') || b.includes('ii')) { variants.add('2 Crônicas'); variants.add('2Crônicas'); variants.add('II Crônicas'); }
    } else if (b.includes('coríntios') || b.includes('corintios')) {
        if (b.includes('1') || b.includes('i')) { variants.add('1 Coríntios'); variants.add('1Coríntios'); }
        if (b.includes('2') || b.includes('ii')) { variants.add('2 Coríntios'); variants.add('2Coríntios'); }
    } else if (b.includes('tessalonicenses')) {
        if (b.includes('1') || b.includes('i')) { variants.add('1 Tessalonicenses'); variants.add('1Tessalonicenses'); }
        if (b.includes('2') || b.includes('ii')) { variants.add('2 Tessalonicenses'); variants.add('2Tessalonicenses'); }
    } else if (b.includes('timóteo') || b.includes('timoteo')) {
        if (b.includes('1') || b.includes('i')) { variants.add('1 Timóteo'); variants.add('1Timóteo'); }
        if (b.includes('2') || b.includes('ii')) { variants.add('2 Timóteo'); variants.add('2Timóteo'); }
    } else if (b.includes('pedro')) {
        if (b.includes('1') || b.includes('i')) { variants.add('1 Pedro'); variants.add('1Pedro'); }
        if (b.includes('2') || b.includes('ii')) { variants.add('2 Pedro'); variants.add('2Pedro'); }
    } else if (b.includes('joão') || b.includes('joao')) {
        if (b.includes('1') || b.includes('i')) { variants.add('1 João'); variants.add('1João'); }
        if (b.includes('2') || b.includes('ii')) { variants.add('2 João'); variants.add('2João'); }
        if (b.includes('3') || b.includes('iii')) { variants.add('3 João'); variants.add('3João'); }
    }

    return Array.from(variants);
};

const fetchChapterSummary = async (refStr: string): Promise<string | null> => {
    if (!refStr) return null;
    const match = refStr.trim().match(/^(.+?)\s+(\d+)/);
    if (!match) return null;
    const rawBook = match[1].trim();
    const chapter = parseInt(match[2], 10);
    const bookVariants = getBookVariants(rawBook);

    if (isSupabaseConfigured()) {
        try {
            const { data, error } = await supabase
                .from('commentaries')
                .select('text')
                .eq('author', 'Resumo dos Capítulos')
                .in('book', bookVariants)
                .eq('chapter', chapter)
                .limit(1)
                .maybeSingle();

            if (!error && data && data.text) {
                return data.text;
            }
        } catch (e) {
            console.error('Erro ao buscar Resumo dos Capítulos do Supabase:', e);
        }
    }

    // Local JSON fallback
    try {
        const res = await fetch('/traducoes/comentarios_resumo_dos_capitulos_en.json');
        if (res.ok) {
            const json = await res.json();
            const found = json.find((item: any) => 
                bookVariants.includes(item.book) && item.chapter === chapter
            );
            if (found && found.text) return found.text;
        }
    } catch (e) {
        // Silently fail fallback
    }

    return null;
};


// --- Tab Content Components ---

// --- Helper Data for BÍBLIA ---
const BIBLIA_STRUCTURE = {
    "Antigo Testamento": {
        col1: [
            { name: "Gênesis", chapters: 50 , verses: [31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26] },
            { name: "Êxodo", chapters: 40 , verses: [22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38] },
            { name: "Levítico", chapters: 27 , verses: [17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34] },
            { name: "Números", chapters: 36 , verses: [54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13] },
            { name: "Deuteronômio", chapters: 34 , verses: [46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12] },
            { name: "Josué", chapters: 24 , verses: [18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33] },
            { name: "Juízes", chapters: 21 , verses: [36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25] },
            { name: "Rute", chapters: 4 , verses: [22,23,18,22] },
            { name: "1 Samuel", map: "1Samuel", chapters: 31 , verses: [28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13] },
            { name: "2 Samuel", map: "2Samuel", chapters: 24 , verses: [27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25] },
            { name: "1 Reis", map: "1Reis", chapters: 22 , verses: [53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53] },
            { name: "2 Reis", map: "2Reis", chapters: 25 , verses: [18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30] },
            { name: "1 Crônicas", map: "1Crônicas", chapters: 29 , verses: [54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30] },
            { name: "2 Crônicas", map: "2Crônicas", chapters: 36 , verses: [17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23] },
            { name: "Esdras", chapters: 10 , verses: [11,70,13,24,17,22,28,36,15,44] },
            { name: "Neemias", chapters: 13 , verses: [11,20,32,23,19,19,73,18,38,39,36,47,31] },
            { name: "Ester", chapters: 10 , verses: [22,23,15,17,14,14,10,17,32,3] },
            { name: "Jó", chapters: 42 , verses: [22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17] },
            { name: "Salmos", map: "Salmo", chapters: 150 , verses: [6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6] },
            { name: "Provérbios", chapters: 31 , verses: [33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31] }
        ],
        col2: [
            { name: "Eclesiastes", chapters: 12 , verses: [18,26,22,16,20,12,29,17,18,20,10,14] },
            { name: "Cânticos", map: "Cântico", chapters: 8 , verses: [17,17,11,16,16,13,13,14] },
            { name: "Isaías", chapters: 66 , verses: [31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24] },
            { name: "Jeremias", chapters: 52 , verses: [19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34] },
            { name: "Lamentações", chapters: 5 , verses: [22,22,66,22,22] },
            { name: "Ezequiel", chapters: 48 , verses: [28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35] },
            { name: "Daniel", chapters: 12 , verses: [21,49,30,37,31,28,28,27,27,21,45,13] },
            { name: "Oséias", map: "Oseias", chapters: 14 },
            { name: "Joel", chapters: 3 , verses: [20,32,21] },
            { name: "Amós", chapters: 9 , verses: [15,16,15,13,27,14,17,14,15] },
            { name: "Obadias", chapters: 1 , verses: [21] },
            { name: "Jonas", chapters: 4 , verses: [17,10,10,11] },
            { name: "Miquéias", map: "Miqueias", chapters: 7 },
            { name: "Naum", chapters: 3 , verses: [15,13,19] },
            { name: "Habacuque", chapters: 3 , verses: [17,20,19] },
            { name: "Sofonias", chapters: 3 , verses: [18,15,20] },
            { name: "Ageu", chapters: 2 , verses: [15,23] },
            { name: "Zacarias", chapters: 14 , verses: [21,13,10,14,11,15,14,23,17,12,17,14,9,21] },
            { name: "Malaquias", chapters: 4 , verses: [14,17,18,6] }
        ]
    },
    "Novo Testamento": {
        col1: [
            { name: "Mateus", chapters: 28 , verses: [25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20] },
            { name: "Marcos", chapters: 16 , verses: [45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20] },
            { name: "Lucas", chapters: 24 , verses: [80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53] },
            { name: "João", chapters: 21 , verses: [51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25] },
            { name: "Atos", chapters: 28 , verses: [26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31] },
            { name: "Romanos", chapters: 16 , verses: [32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27] },
            { name: "1 Coríntios", map: "1Coríntios", chapters: 16 , verses: [31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24] },
            { name: "2 Coríntios", map: "2Coríntios", chapters: 13 , verses: [24,17,18,18,21,18,16,24,15,18,33,21,14] },
            { name: "Gálatas", chapters: 6 , verses: [24,21,29,31,26,18] },
            { name: "Efésios", chapters: 6 , verses: [23,22,21,32,33,24] },
            { name: "Filipenses", chapters: 4 , verses: [30,30,21,23] },
            { name: "Colossenses", chapters: 4 , verses: [29,23,25,18] },
            { name: "1 Tessalonicenses", map: "1Tessalonicenses", chapters: 5 , verses: [10,20,13,18,28] },
            { name: "2 Tessalonicenses", map: "2Tessalonicenses", chapters: 3 , verses: [12,17,18] }
        ],
        col2: [
            { name: "1 Timóteo", map: "1Timóteo", chapters: 6 , verses: [20,15,16,16,25,21] },
            { name: "2 Timóteo", map: "2Timóteo", chapters: 4 , verses: [18,26,17,22] },
            { name: "Tito", chapters: 3 , verses: [16,15,15] },
            { name: "Filemom", chapters: 1 , verses: [25] },
            { name: "Hebreus", chapters: 13 , verses: [14,18,19,16,14,20,28,13,28,39,40,29,25] },
            { name: "Tiago", chapters: 5 , verses: [27,26,18,17,20] },
            { name: "1 Pedro", map: "1Pedro", chapters: 5 , verses: [25,25,22,19,14] },
            { name: "2 Pedro", map: "2Pedro", chapters: 3 , verses: [21,22,18] },
            { name: "1 João", map: "1João", chapters: 5 , verses: [10,29,24,21,21] },
            { name: "2 João", map: "2João", chapters: 1 , verses: [13] },
            { name: "3 João", map: "3João", chapters: 1 , verses: [14] },
            { name: "Judas", chapters: 1 , verses: [25] },
            { name: "Apocalipse", chapters: 22 , verses: [20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21] }
        ]
    }
};

const NAA_BOOKS = {
    "Antigo Testamento": [
        ...BIBLIA_STRUCTURE["Antigo Testamento"].col1,
        ...BIBLIA_STRUCTURE["Antigo Testamento"].col2
    ],
    "Novo Testamento": [
        ...BIBLIA_STRUCTURE["Novo Testamento"].col1,
        ...BIBLIA_STRUCTURE["Novo Testamento"].col2
    ]
};

const BibliaView = () => {
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedChapter, setSelectedChapter] = useState(null);
    const [fullText, setFullText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [isInterlinear, setIsInterlinear] = useState(false);
    const [bhsWords, setBhsWords] = useState<any[]>([]);
    const [selectedBhsWord, setSelectedBhsWord] = useState<any | null>(null);
    const [bhsAiAnalysis, setBhsAiAnalysis] = useState('');
    const [loadingBhsAi, setLoadingBhsAi] = useState(false);

    const handleSelectBook = (book) => {
        setSelectedBook(book);
        setSelectedChapter(null);
        setFullText('');
        setError('');
    };

    const handleSelectChapter = useCallback(async (chapterNumber) => {
        if (!selectedBook) return;
        setSelectedChapter(chapterNumber);
        setLoading(true);
        setError('');
        setFullText('');
        setBhsWords([]);
        setSelectedBhsWord(null);
        setBhsAiAnalysis('');
        
        try {
            const bookQueryName = selectedBook.map || selectedBook.name;
            const ref = `${bookQueryName} ${chapterNumber}`;
            const text = await getBibleTextFromRef(ref);
            if (text && !text.startsWith("Capítulo não encontrado") && !text.startsWith("Referência inválida")) {
                setFullText(text);
            } else {
                setError(text || 'Capítulo não encontrado.');
            }

            // Fetch BHS if Old Testament
            const bookIdx = getHebrewBookIndex(bookQueryName);
            if (bookIdx !== -1) {
                const response = await fetch(`/api/hebrew-bible?book=${bookIdx + 1}&chapter=${chapterNumber}`);
                if (response.ok) {
                    const json = await response.json();
                    setBhsWords(json.data || []);
                }
            }
        } catch (e) {
            console.error(e);
            setError('Falha ao carregar o texto bíblico.');
        } finally {
            setLoading(false);
        }
    }, [selectedBook]);

    const handlePrev = () => {
        if (selectedChapter > 1) {
            handleSelectChapter(selectedChapter - 1);
        }
    };

    const handleNext = () => {
        if (selectedBook && selectedChapter < selectedBook.chapters) {
            handleSelectChapter(selectedChapter + 1);
        }
    };

    const bhsWordsByVerse = React.useMemo(() => {
        const map: Record<number, any[]> = {};
        bhsWords.forEach(w => {
            if (!map[w.verse]) {
                map[w.verse] = [];
            }
            map[w.verse].push(w);
        });
        return map;
    }, [bhsWords]);

    const handleBhsAiAnalysis = async () => {
        if (!selectedBhsWord || !selectedBook || !selectedChapter) return;
        setLoadingBhsAi(true);
        setBhsAiAnalysis('');
        const prompt = `Analise a palavra hebraica original a seguir no contexto bíblico da passagem ${selectedBook.name} ${selectedChapter}:${selectedBhsWord.verse}:
Palavra Original (Hebraico): ${selectedBhsWord.word.replace(/<[^>]*>/g, '')}
Transliteração: ${selectedBhsWord.translit}
Morfologia: ${selectedBhsWord.morphDetail} (${selectedBhsWord.morphCode})
Glossário/Significado literal: ${selectedBhsWord.gloss}
Tradução aproximada: ${selectedBhsWord.bsb ? selectedBhsWord.bsb.replace(/〔\d+＠(.*)〕/, '$1') : 'N/A'}
Número Strong: ${selectedBhsWord.strong}

Por favor, forneça uma análise teológica detalhada em português, incluindo:
1. O significado da raiz original e sua importância cultural/teológica.
2. Como esta palavra contribui para o sentido teológico do versículo em questão.
3. Se houver alguma nuance que a tradução em português geralmente perde, explique de forma simples e enriquecedora para um pregador ou estudante da Bíblia.
Retorne um texto bem formatado em Markdown com títulos curtos.`;

        try {
            const result = await generateAIContent({ prompt });
            setBhsAiAnalysis(result);
        } catch (e: any) {
            console.error(e);
            setBhsAiAnalysis(`Erro ao gerar análise com IA: ${e.message || e}`);
        } finally {
            setLoadingBhsAi(false);
        }
    };

    return (
        <div className="tab-content" style={{ padding: '0.5rem 0' }}>
            {error && <ErrorMessage message={error} />}
            
            {!selectedBook && (
                <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
                        {Object.entries(BIBLIA_STRUCTURE).map(([testamentName, { col1, col2 }]) => (
                            <div key={testamentName} style={{ backgroundColor: '#ffffff', border: '1px solid #e1eaf5', borderRadius: '16px', padding: '1.5rem 1.75rem', boxShadow: '0 4px 14px rgba(43, 86, 154, 0.04)' }}>
                                <h3 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#2b569a', marginTop: 0, marginBottom: '1.25rem' }}>
                                    {testamentName}
                                </h3>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '1.5rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        {col1.map(book => (
                                            <button
                                                key={book.name}
                                                onClick={() => handleSelectBook(book)}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: '#2b569a',
                                                    fontSize: '0.98rem',
                                                    fontWeight: 500,
                                                    textAlign: 'left',
                                                    padding: '3px 6px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease'
                                                }}
                                                onMouseOver={e => {
                                                    e.currentTarget.style.backgroundColor = '#edf4fc';
                                                    e.currentTarget.style.color = '#1d4076';
                                                }}
                                                onMouseOut={e => {
                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                    e.currentTarget.style.color = '#2b569a';
                                                }}
                                            >
                                                {book.name}
                                            </button>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        {col2.map(book => (
                                            <button
                                                key={book.name}
                                                onClick={() => handleSelectBook(book)}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: '#2b569a',
                                                    fontSize: '0.98rem',
                                                    fontWeight: 500,
                                                    textAlign: 'left',
                                                    padding: '3px 6px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease'
                                                }}
                                                onMouseOver={e => {
                                                    e.currentTarget.style.backgroundColor = '#edf4fc';
                                                    e.currentTarget.style.color = '#1d4076';
                                                }}
                                                onMouseOut={e => {
                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                    e.currentTarget.style.color = '#2b569a';
                                                }}
                                            >
                                                {book.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {testamentName === "Novo Testamento" && (
                                    <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'center' }}>
                                        <button
                                            onClick={() => window.dispatchEvent(new CustomEvent('change-tab', { detail: 'BHS' }))}
                                            style={{
                                                backgroundColor: '#2b569a',
                                                color: '#ffffff',
                                                border: 'none',
                                                borderRadius: '8px',
                                                padding: '10px 20px',
                                                fontSize: '1rem',
                                                fontWeight: 'bold',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                boxShadow: '0 2px 8px rgba(43, 86, 154, 0.2)'
                                            }}
                                            onMouseOver={e => e.currentTarget.style.backgroundColor = '#1d4076'}
                                            onMouseOut={e => e.currentTarget.style.backgroundColor = '#2b569a'}
                                        >
                                            Bíblia Hebraica (BHS)
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {selectedBook && !selectedChapter && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0, color: '#2b569a', fontSize: '1.4rem', fontWeight: 700 }}>
                            Livro: {selectedBook.name}
                        </h3>
                        <button 
                            onClick={() => setSelectedBook(null)} 
                            style={{ backgroundColor: '#2b569a', color: '#fff', padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >
                            ← Voltar aos Livros da Bíblia
                        </button>
                    </div>
                    <p style={{ color: '#555', marginBottom: '1rem', fontWeight: 500 }}>Selecione o capítulo:</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))', gap: '10px' }}>
                        {Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map(chapterNum => (
                            <button 
                                key={chapterNum} 
                                onClick={() => handleSelectChapter(chapterNum)}
                                style={{ 
                                    padding: '12px 5px', 
                                    fontSize: '1rem', 
                                    fontWeight: 'bold', 
                                    backgroundColor: '#f0f6ff', 
                                    color: '#2b569a', 
                                    border: '1px solid #d0e2f7', 
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease' 
                                }}
                                onMouseOver={e => {
                                    e.currentTarget.style.backgroundColor = '#2b569a';
                                    e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseOut={e => {
                                    e.currentTarget.style.backgroundColor = '#f0f6ff';
                                    e.currentTarget.style.color = '#2b569a';
                                }}
                            >
                                {chapterNum}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {selectedBook && selectedChapter && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0, color: '#2b569a', fontSize: '1.4rem', fontWeight: 700 }}>
                            {selectedBook.name} {selectedChapter}
                        </h3>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => setIsInterlinear(prev => !prev)}
                                style={{
                                    backgroundColor: isInterlinear ? '#2e7d32' : '#f5f5f5',
                                    color: isInterlinear ? '#fff' : '#333',
                                    padding: '8px 18px',
                                    borderRadius: '8px',
                                    border: '1px solid #ccc',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                {isInterlinear ? '✓ Interlinear' : 'Interlinear'}
                            </button>
                            <button 
                                onClick={() => { setSelectedChapter(null); setFullText(''); }} 
                                style={{ backgroundColor: '#2b569a', color: '#fff', padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                            >
                                ← Voltar aos Capítulos
                            </button>
                        </div>
                    </div>
                    
                    {loading ? <LoadingSpinner /> : (
                        <div className="card" style={{ backgroundColor: '#ffffff', color: '#212121', padding: '24px', borderRadius: '12px', boxShadow: '0 4px 14px rgba(0, 0, 0, 0.05)', border: '1px solid #e1eaf5' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '20px' }}>
                                {fullText.split(/\r?\n/).filter(line => line.trim()).map((line, i) => {
                                    const match = line.trim().match(/^\*\*(\d+)\*\*\s*(.*)$/);
                                    const vNum = match ? parseInt(match[1], 10) : null;
                                    const verseContent = match ? match[2] : line;

                                    return (
                                        <div key={i} style={{ borderBottom: '1px dashed #e1eaf5', paddingBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <p style={{ margin: 0, fontSize: '16px', lineHeight: '1.7', textAlign: 'left' }}>
                                                {vNum !== null ? <strong>{vNum} </strong> : null}
                                                {parseBold(verseContent)}
                                            </p>
                                            {isInterlinear && vNum !== null && bhsWordsByVerse[vNum] && bhsWordsByVerse[vNum].length > 0 && (
                                                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '10px 6px', alignItems: 'center', direction: 'rtl', textAlign: 'right', backgroundColor: '#edf4fc', padding: '8px 12px', borderRadius: '8px', borderRight: '3px solid #2b569a', marginTop: '4px' }}>
                                                    {bhsWordsByVerse[vNum].map((word, idx) => (
                                                        <span
                                                            key={idx}
                                                            onClick={() => {
                                                                setSelectedBhsWord(word);
                                                                setBhsAiAnalysis('');
                                                            }}
                                                            title={word.gloss || ''}
                                                            style={{
                                                                fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif",
                                                                fontSize: '1.75rem',
                                                                cursor: 'pointer',
                                                                padding: '2px 6px',
                                                                borderRadius: '6px',
                                                                backgroundColor: selectedBhsWord?.sort === word.sort ? '#fff' : 'transparent',
                                                                color: selectedBhsWord?.sort === word.sort ? '#0d47a1' : '#212121',
                                                                transition: 'all 0.15s ease',
                                                                borderBottom: selectedBhsWord?.sort === word.sort ? '3px solid #2b569a' : '3px solid transparent',
                                                                lineHeight: '2.4rem'
                                                            }}
                                                            onMouseOver={e => {
                                                                if (selectedBhsWord?.sort !== word.sort) {
                                                                    e.currentTarget.style.backgroundColor = '#fff';
                                                                    e.currentTarget.style.color = '#2b569a';
                                                                }
                                                            }}
                                                            onMouseOut={e => {
                                                                if (selectedBhsWord?.sort !== word.sort) {
                                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                                    e.currentTarget.style.color = '#212121';
                                                                }
                                                            }}
                                                            dangerouslySetInnerHTML={{ __html: word.word }}
                                                        />
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e1eaf5', paddingTop: '15px' }}>
                                <button 
                                    onClick={handlePrev} 
                                    disabled={selectedChapter <= 1}
                                    style={{ padding: '10px 20px', borderRadius: '8px', opacity: selectedChapter <= 1 ? 0.5 : 1, backgroundColor: selectedChapter <= 1 ? '#ccc' : '#2b569a', color: '#fff', border: 'none', cursor: selectedChapter <= 1 ? 'not-allowed' : 'pointer' }}
                                >
                                    ← Anterior
                                </button>
                                <button 
                                    onClick={handleNext} 
                                    disabled={selectedChapter >= selectedBook.chapters}
                                    style={{ padding: '10px 20px', borderRadius: '8px', opacity: selectedChapter >= selectedBook.chapters ? 0.5 : 1, backgroundColor: selectedChapter >= selectedBook.chapters ? '#ccc' : '#2b569a', color: '#fff', border: 'none', cursor: selectedChapter >= selectedBook.chapters ? 'not-allowed' : 'pointer' }}
                                >
                                    Próximo →
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {selectedBhsWord && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
                    justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '20px'
                }}>
                    <div style={{
                        backgroundColor: '#ffffff', border: '2px solid #2b569a', borderRadius: '12px',
                        padding: '24px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)', position: 'relative',
                        maxWidth: '400px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center'
                    }}>
                        <button
                            onClick={() => { setSelectedBhsWord(null); setBhsAiAnalysis(''); }}
                            style={{
                                position: 'absolute', top: '12px', right: '12px', background: 'transparent',
                                border: 'none', color: '#888', fontSize: '1.25rem', cursor: 'pointer', fontWeight: 'bold', padding: '4px'
                            }}
                        >
                            ✕
                        </button>
                        <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'bold', alignSelf: 'flex-start' }}>
                            {selectedBhsWord.verse}:{selectedBhsWord.sort}
                        </span>
                        <span style={{ fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif", fontSize: '2.5rem', fontWeight: 'bold', color: '#2b569a', marginTop: '4px' }} dangerouslySetInnerHTML={{ __html: selectedBhsWord.word }} />
                        <span style={{ fontSize: '1rem', fontStyle: 'italic', color: '#555' }}>
                            {selectedBhsWord.translit} ({selectedBhsWord.phonetic})
                        </span>
                        <span style={{ fontSize: '1.05rem', fontWeight: 600, color: '#0d47a1' }}>
                            Literal: {selectedBhsWord.gloss}
                        </span>
                        {selectedBhsWord.bsb && (
                            <span style={{ fontSize: '0.95rem', color: '#f9a825', fontWeight: 600 }}>
                                BSB: {selectedBhsWord.bsb.replace(/〔\d+＠(.*)〕/, '$1')}
                            </span>
                        )}
                        <span style={{ fontSize: '0.85rem', color: '#666', backgroundColor: '#f0f6ff', padding: '4px 10px', borderRadius: '4px', border: '1px solid #d0e2f7' }} title={selectedBhsWord.morphDetail}>
                            {selectedBhsWord.morphCode}
                        </span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#002171' }}>
                            Strong: {selectedBhsWord.strong}
                        </span>
                        <div style={{ width: '100%', borderTop: '1px solid #e1eaf5', paddingTop: '15px', marginTop: '10px' }}>
                            <button
                                onClick={handleBhsAiAnalysis}
                                disabled={loadingBhsAi}
                                style={{
                                    width: '100%', backgroundColor: '#f9a825', color: '#ffffff', padding: '10px',
                                    border: 'none', borderRadius: '8px', cursor: loadingBhsAi ? 'not-allowed' : 'pointer',
                                    fontWeight: 'bold', fontSize: '0.95rem', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', gap: '8px', boxShadow: '0 2px 5px rgba(249, 168, 37, 0.2)'
                                }}
                            >
                                {loadingBhsAi ? 'Analisando com IA...' : '✨ Analisar Palavra com IA'}
                            </button>
                            {bhsAiAnalysis && (
                                <div style={{
                                    marginTop: '15px', backgroundColor: '#fcf8e3', border: '1px solid #faebcc',
                                    borderRadius: '8px', padding: '12px', fontSize: '0.9rem', color: '#8a6d3b',
                                    maxHeight: '200px', overflowY: 'auto', textAlign: 'left'
                                }}>
                                    {bhsAiAnalysis.split('\n').map((line, i) => {
                                        let trimmed = line.trim();
                                        if (trimmed.startsWith('### ')) return <h5 key={i} style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#0d47a1', margin: '12px 0 6px 0' }}>{trimmed.slice(4)}</h5>;
                                        if (trimmed.startsWith('## ')) return <h4 key={i} style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#0d47a1', margin: '16px 0 8px 0' }}>{trimmed.slice(3)}</h4>;
                                        if (trimmed.startsWith('# ')) return <h3 key={i} style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0d47a1', margin: '18px 0 10px 0' }}>{trimmed.slice(2)}</h3>;
                                        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) return <li key={i} style={{ marginLeft: '1rem', marginBottom: '4px' }}>{parseBold(trimmed.slice(2))}</li>;
                                        return <p key={i} style={{ margin: '0 0 8px 0', lineHeight: '1.5' }}>{parseBold(line)}</p>;
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const NAAView = BibliaView;

const BhsView = () => {
    const [selectedBook, setSelectedBook] = useState<any | null>(null);
    const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
    const [bhsWords, setBhsWords] = useState<any[]>([]);
    const [selectedWord, setSelectedWord] = useState<any | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [aiAnalysis, setAiAnalysis] = useState('');
    const [loadingAi, setLoadingAi] = useState(false);

    const [isInterlinear, setIsInterlinear] = useState(false);
    const [naaVersesMap, setNaaVersesMap] = useState<Record<number, string>>({});

    const handleSelectBook = (book: any) => {
        setSelectedBook(book);
        setSelectedChapter(null);
        setBhsWords([]);
        setError('');
    };

    const handleSelectChapter = useCallback(async (chapterNumber: number) => {
        if (!selectedBook) return;
        setSelectedChapter(chapterNumber);
        setLoading(true);
        setError('');
        setBhsWords([]);
        setSelectedWord(null);
        setAiAnalysis('');
        setNaaVersesMap({});
        
        try {
            const bookName = selectedBook.map || selectedBook.name;
            const bookIdx = getHebrewBookIndex(bookName);
            if (bookIdx !== -1) {
                const response = await fetch(`/api/hebrew-bible?book=${bookIdx + 1}&chapter=${chapterNumber}`);
                if (response.ok) {
                    const json = await response.json();
                    setBhsWords(json.data || []);
                } else {
                    setError('Falha ao carregar o texto hebraico (BHS).');
                }

                // Fetch NAA text
                const ref = `${bookName} ${chapterNumber}`;
                const naaText = await getBibleTextFromRef(ref);
                if (naaText && !naaText.startsWith("Capítulo não encontrado") && !naaText.startsWith("Referência inválida")) {
                    const parsed: Record<number, string> = {};
                    naaText.split(/\n+/).forEach(line => {
                        const match = line.trim().match(/^\*\*(\d+)\*\*\s*(.*)$/);
                        if (match) {
                            parsed[parseInt(match[1], 10)] = match[2];
                        }
                    });
                    setNaaVersesMap(parsed);
                }
            } else {
                setError('Livro não encontrado no mapeamento hebraico.');
            }
        } catch (e) {
            console.error(e);
            setError('Falha ao carregar o texto bíblico.');
        } finally {
            setLoading(false);
        }
    }, [selectedBook]);

    const handlePrev = () => {
        if (selectedChapter && selectedChapter > 1) {
            handleSelectChapter(selectedChapter - 1);
        }
    };

    const handleNext = () => {
        if (selectedBook && selectedChapter && selectedChapter < selectedBook.chapters) {
            handleSelectChapter(selectedChapter + 1);
        }
    };

    const bhsWordsByVerse = React.useMemo(() => {
        const map: Record<number, any[]> = {};
        bhsWords.forEach(w => {
            if (!map[w.verse]) {
                map[w.verse] = [];
            }
            map[w.verse].push(w);
        });
        return map;
    }, [bhsWords]);

    const handleBhsAiAnalysis = async () => {
        if (!selectedWord || !selectedBook || !selectedChapter) return;
        setLoadingAi(true);
        setAiAnalysis('');
        const prompt = `Analise a palavra hebraica original a seguir no contexto bíblico da passagem ${selectedBook.name} ${selectedChapter}:${selectedWord.verse}:
Palavra Original (Hebraico): ${selectedWord.word.replace(/<[^>]*>/g, '')}
Transliteração: ${selectedWord.translit}
Morfologia: ${selectedWord.morphDetail} (${selectedWord.morphCode})
Glossário/Significado literal: ${selectedWord.gloss}
Tradução aproximada: ${selectedWord.bsb ? selectedWord.bsb.replace(/〔\d+＠(.*)〕/, '$1') : 'N/A'}
Número Strong: ${selectedWord.strong}

Por favor, forneça uma análise teológica detalhada em português, incluindo:
1. O significado da raiz original e sua importância cultural/teológica.
2. Como esta palavra contribui para o sentido teológico do versículo em questão.
3. Se houver alguma nuance que a tradução em português geralmente perde, explique de forma simples e enriquecedora para um pregador ou estudante da Bíblia.
Retorne um texto bem formatado em Markdown com títulos curtos.`;

        try {
            const result = await generateAIContent({ prompt });
            setAiAnalysis(result);
        } catch (e: any) {
            console.error(e);
            setAiAnalysis(`Erro ao gerar análise com IA: ${e.message || e}`);
        } finally {
            setLoadingAi(false);
        }
    };

    return (
        <div className="tab-content" style={{ padding: '0.5rem 0' }}>
            {error && <ErrorMessage message={error} />}
            
            {!selectedBook && (
                <div>
                    <h3 style={{ fontSize: '1.4rem', color: '#2b569a', marginTop: 0, marginBottom: '1.25rem' }}>
                        Bíblia Hebraica (BHS)
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', alignItems: 'start' }}>
                        {Object.entries(BIBLIA_STRUCTURE).filter(([name]) => name === "Antigo Testamento").map(([testamentName, { col1, col2 }]) => (
                            <div key={testamentName} style={{ backgroundColor: '#ffffff', border: '1px solid #e1eaf5', borderRadius: '16px', padding: '1.5rem 1.75rem', boxShadow: '0 4px 14px rgba(43, 86, 154, 0.04)' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '1.5rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        {col1.map(book => (
                                            <button
                                                key={book.name}
                                                onClick={() => handleSelectBook(book)}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: '#2b569a',
                                                    fontSize: '0.98rem',
                                                    fontWeight: 500,
                                                    textAlign: 'left',
                                                    padding: '3px 6px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease'
                                                }}
                                                onMouseOver={e => {
                                                    e.currentTarget.style.backgroundColor = '#edf4fc';
                                                    e.currentTarget.style.color = '#1d4076';
                                                }}
                                                onMouseOut={e => {
                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                    e.currentTarget.style.color = '#2b569a';
                                                }}
                                            >
                                                {book.name}
                                            </button>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        {col2.map(book => (
                                            <button
                                                key={book.name}
                                                onClick={() => handleSelectBook(book)}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: '#2b569a',
                                                    fontSize: '0.98rem',
                                                    fontWeight: 500,
                                                    textAlign: 'left',
                                                    padding: '3px 6px',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease'
                                                }}
                                                onMouseOver={e => {
                                                    e.currentTarget.style.backgroundColor = '#edf4fc';
                                                    e.currentTarget.style.color = '#1d4076';
                                                }}
                                                onMouseOut={e => {
                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                    e.currentTarget.style.color = '#2b569a';
                                                }}
                                            >
                                                {book.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {selectedBook && !selectedChapter && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0, color: '#2b569a', fontSize: '1.4rem', fontWeight: 700 }}>
                            Livro (BHS): {selectedBook.name}
                        </h3>
                        <button 
                            onClick={() => setSelectedBook(null)} 
                            style={{ backgroundColor: '#2b569a', color: '#fff', padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >
                            ← Voltar aos Livros
                        </button>
                    </div>
                    <p style={{ color: '#555', marginBottom: '1rem', fontWeight: 500 }}>Selecione o capítulo:</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))', gap: '10px' }}>
                        {Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map(chapterNum => (
                            <button 
                                key={chapterNum} 
                                onClick={() => handleSelectChapter(chapterNum)}
                                style={{ 
                                    padding: '12px 5px', 
                                    fontSize: '1rem', 
                                    fontWeight: 'bold', 
                                    backgroundColor: '#f0f6ff', 
                                    color: '#2b569a', 
                                    border: '1px solid #d0e2f7', 
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease' 
                                }}
                                onMouseOver={e => {
                                    e.currentTarget.style.backgroundColor = '#2b569a';
                                    e.currentTarget.style.color = '#ffffff';
                                }}
                                onMouseOut={e => {
                                    e.currentTarget.style.backgroundColor = '#f0f6ff';
                                    e.currentTarget.style.color = '#2b569a';
                                }}
                            >
                                {chapterNum}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {selectedBook && selectedChapter && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '10px' }}>
                        <h3 style={{ margin: 0, color: '#2b569a', fontSize: '1.4rem', fontWeight: 700 }}>
                            {selectedBook.name} {selectedChapter} (BHS)
                        </h3>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => setIsInterlinear(prev => !prev)}
                                style={{
                                    backgroundColor: isInterlinear ? '#2e7d32' : '#f5f5f5',
                                    color: isInterlinear ? '#fff' : '#333',
                                    padding: '8px 18px',
                                    borderRadius: '8px',
                                    border: '1px solid #ccc',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                {isInterlinear ? '✓ Interlinear' : 'Interlinear'}
                            </button>
                            <button 
                                onClick={() => { setSelectedChapter(null); setBhsWords([]); }} 
                                style={{ backgroundColor: '#2b569a', color: '#fff', padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                            >
                                ← Voltar aos Capítulos
                            </button>
                        </div>
                    </div>
                    
                    {loading ? <LoadingSpinner /> : (
                        <div className="card" style={{ backgroundColor: '#ffffff', color: '#212121', padding: '24px', borderRadius: '12px', boxShadow: '0 4px 14px rgba(0, 0, 0, 0.05)', border: '1px solid #e1eaf5' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '20px' }}>
                                {(Object.entries(bhsWordsByVerse) as [string, any[]][]).map(([verseNum, verseWords]) => {
                                    const vNum = parseInt(verseNum, 10);
                                    return (
                                        <div key={verseNum} style={{ borderBottom: '1px dashed #e1eaf5', paddingBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '10px 6px', alignItems: 'center', direction: 'rtl', textAlign: 'right' }}>
                                                <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#2b569a', marginLeft: '6px', alignSelf: 'center', userSelect: 'none', direction: 'ltr' }}>
                                                    {verseNum}
                                                </span>
                                                {verseWords.map((word, idx) => (
                                                    <span
                                                        key={idx}
                                                        onClick={() => {
                                                            setSelectedWord(word);
                                                            setAiAnalysis('');
                                                        }}
                                                        title={word.gloss || ''}
                                                        style={{
                                                            fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif",
                                                            fontSize: '1.8rem',
                                                            cursor: 'pointer',
                                                            padding: '2px 6px',
                                                            borderRadius: '6px',
                                                            backgroundColor: selectedWord?.sort === word.sort ? '#edf4fc' : 'transparent',
                                                            color: selectedWord?.sort === word.sort ? '#0d47a1' : '#212121',
                                                            transition: 'all 0.15s ease',
                                                            borderBottom: selectedWord?.sort === word.sort ? '3px solid #2b569a' : '3px solid transparent',
                                                            lineHeight: '2.4rem'
                                                        }}
                                                        onMouseOver={e => {
                                                            if (selectedWord?.sort !== word.sort) {
                                                                e.currentTarget.style.backgroundColor = '#f0f6ff';
                                                                e.currentTarget.style.color = '#2b569a';
                                                            }
                                                        }}
                                                        onMouseOut={e => {
                                                            if (selectedWord?.sort !== word.sort) {
                                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                                e.currentTarget.style.color = '#212121';
                                                            }
                                                        }}
                                                        dangerouslySetInnerHTML={{ __html: word.word }}
                                                    />
                                                ))}
                                            </div>
                                            {isInterlinear && naaVersesMap[vNum] && (
                                                <div style={{ fontSize: '0.95rem', color: '#555', fontStyle: 'italic', padding: '4px 8px', borderLeft: '3px solid #4caf50', direction: 'ltr', textAlign: 'left', backgroundColor: '#fcfcfc', borderRadius: '4px', marginTop: '4px' }}>
                                                    {parseBold(naaVersesMap[vNum])}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e1eaf5', paddingTop: '15px' }}>
                                <button 
                                    onClick={handlePrev} 
                                    disabled={selectedChapter <= 1}
                                    style={{ padding: '10px 20px', borderRadius: '8px', opacity: selectedChapter <= 1 ? 0.5 : 1, backgroundColor: selectedChapter <= 1 ? '#ccc' : '#2b569a', color: '#fff', border: 'none', cursor: selectedChapter <= 1 ? 'not-allowed' : 'pointer' }}
                                >
                                    ← Anterior
                                </button>
                                <button 
                                    onClick={handleNext} 
                                    disabled={selectedChapter >= selectedBook.chapters}
                                    style={{ padding: '10px 20px', borderRadius: '8px', opacity: selectedChapter >= selectedBook.chapters ? 0.5 : 1, backgroundColor: selectedChapter >= selectedBook.chapters ? '#ccc' : '#2b569a', color: '#fff', border: 'none', cursor: selectedChapter >= selectedBook.chapters ? 'not-allowed' : 'pointer' }}
                                >
                                    Próximo →
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {selectedWord && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
                    justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '20px'
                }}>
                    <div style={{
                        backgroundColor: '#ffffff', border: '2px solid #2b569a', borderRadius: '12px',
                        padding: '24px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)', position: 'relative',
                        maxWidth: '400px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center'
                    }}>
                        <button
                            onClick={() => { setSelectedWord(null); setAiAnalysis(''); }}
                            style={{
                                position: 'absolute', top: '12px', right: '12px', background: 'transparent',
                                border: 'none', color: '#888', fontSize: '1.25rem', cursor: 'pointer', fontWeight: 'bold', padding: '4px'
                            }}
                        >
                            ✕
                        </button>
                        <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'bold', alignSelf: 'flex-start' }}>
                            {selectedWord.verse}:{selectedWord.sort}
                        </span>
                        <span style={{ fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif", fontSize: '2.5rem', fontWeight: 'bold', color: '#2b569a', marginTop: '4px' }} dangerouslySetInnerHTML={{ __html: selectedWord.word }} />
                        <span style={{ fontSize: '1rem', fontStyle: 'italic', color: '#555' }}>
                            {selectedWord.translit} ({selectedWord.phonetic})
                        </span>
                        <span style={{ fontSize: '1.05rem', fontWeight: 600, color: '#0d47a1' }}>
                            Literal: {selectedWord.gloss}
                        </span>
                        {selectedWord.bsb && (
                            <span style={{ fontSize: '0.95rem', color: '#f9a825', fontWeight: 600 }}>
                                BSB: {selectedWord.bsb.replace(/〔\d+＠(.*)〕/, '$1')}
                            </span>
                        )}
                        <span style={{ fontSize: '0.85rem', color: '#666', backgroundColor: '#f0f6ff', padding: '4px 10px', borderRadius: '4px', border: '1px solid #d0e2f7' }} title={selectedWord.morphDetail}>
                            {selectedWord.morphCode}
                        </span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#002171' }}>
                            Strong: {selectedWord.strong}
                        </span>
                        <div style={{ width: '100%', borderTop: '1px solid #e1eaf5', paddingTop: '15px', marginTop: '10px' }}>
                            <button
                                onClick={handleBhsAiAnalysis}
                                disabled={loadingAi}
                                style={{
                                    width: '100%', backgroundColor: '#f9a825', color: '#ffffff', padding: '10px',
                                    border: 'none', borderRadius: '8px', cursor: loadingAi ? 'not-allowed' : 'pointer',
                                    fontWeight: 'bold', fontSize: '0.95rem', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', gap: '8px', boxShadow: '0 2px 5px rgba(249, 168, 37, 0.2)'
                                }}
                            >
                                {loadingAi ? 'Analisando com IA...' : '✨ Analisar Palavra com IA'}
                            </button>
                            {aiAnalysis && (
                                <div style={{
                                    marginTop: '15px', backgroundColor: '#fcf8e3', border: '1px solid #faebcc',
                                    borderRadius: '8px', padding: '12px', fontSize: '0.9rem', color: '#8a6d3b',
                                    maxHeight: '200px', overflowY: 'auto', textAlign: 'left'
                                }}>
                                    {aiAnalysis.split('\n').map((line, i) => {
                                        let trimmed = line.trim();
                                        if (trimmed.startsWith('### ')) return <h5 key={i} style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#0d47a1', margin: '12px 0 6px 0' }}>{trimmed.slice(4)}</h5>;
                                        if (trimmed.startsWith('## ')) return <h4 key={i} style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#0d47a1', margin: '16px 0 8px 0' }}>{trimmed.slice(3)}</h4>;
                                        if (trimmed.startsWith('# ')) return <h3 key={i} style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0d47a1', margin: '18px 0 10px 0' }}>{trimmed.slice(2)}</h3>;
                                        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) return <li key={i} style={{ marginLeft: '1rem', marginBottom: '4px' }}>{parseBold(trimmed.slice(2))}</li>;
                                        return <p key={i} style={{ margin: '0 0 8px 0', lineHeight: '1.5' }}>{parseBold(line)}</p>;
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const getHebrewBookIndex = (bookName: string): number => {
    const HEBREW_BOOKS = [
        ...BIBLIA_STRUCTURE["Antigo Testamento"].col1,
        ...BIBLIA_STRUCTURE["Antigo Testamento"].col2
    ];
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, '');
    const cleanName = norm(bookName);
    
    return HEBREW_BOOKS.findIndex(b => {
        const bNameNorm = norm(b.name);
        const bMapNorm = b.map ? norm(b.map) : '';
        return bNameNorm === cleanName || bMapNorm === cleanName || bNameNorm.startsWith(cleanName) || cleanName.startsWith(bNameNorm);
    });
};

const renderFormattedSummary = (text: string) => {
    if (!text) return null;

    let cleanedText = text
        .replace(/^id="leftbox">\s*/gi, '')
        .replace(/id="leftbox">\s*/gi, '');

    const lines = cleanedText.split('\n');
    const elements: React.ReactNode[] = [];
    let keyIdx = 0;

    lines.forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (trimmed.startsWith('id="leftbox"') || trimmed.startsWith('id="leftbox">')) return;
        if (trimmed.match(/^#?\s*.+?\s+\d+\s+Summary$/i)) return;
        if (trimmed.match(/^Resumo do Capítulo/i)) return;

        if (trimmed.startsWith('# ')) {
            elements.push(
                <h2 key={`h1-${keyIdx++}`} style={{ fontSize: '1.4rem', color: '#0d47a1', marginBottom: '0.75rem', marginTop: '1rem', borderBottom: '2px solid #e3f2fd', paddingBottom: '0.4rem' }}>
                    {trimmed.replace(/^#\s+/, '')}
                </h2>
            );
        } else if (trimmed.startsWith('### ')) {
            elements.push(
                <h3 key={`h3-${keyIdx++}`} style={{ fontSize: '1.1rem', color: '#1565c0', marginTop: '1.2rem', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    {parseBold(trimmed.replace(/^###\s+/, ''))}
                </h3>
            );
        } else if (trimmed === '---') {
            elements.push(
                <hr key={`hr-${keyIdx++}`} style={{ border: 'none', borderTop: '1px solid #e0e0e0', margin: '1.5rem 0' }} />
            );
        } else if (trimmed.startsWith('• ') || trimmed.startsWith('- ')) {
            elements.push(
                <li key={`li-${keyIdx++}`} style={{ marginLeft: '1.5rem', marginBottom: '0.5rem', color: '#333', lineHeight: '1.6' }}>
                    {parseBold(trimmed.substring(2))}
                </li>
            );
        } else {
            elements.push(
                <p key={`p-${keyIdx++}`} style={{ marginBottom: '0.8rem', lineHeight: '1.6', color: '#333' }}>
                    {parseBold(trimmed)}
                </p>
            );
        }
    });

    return <div className="formatted-summary-content">{elements}</div>;
};

const CapituloView = ({ externalRef }) => {
    const [ref, setRef] = useState('');
    const [summary, setSummary] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [fullTextModal, setFullTextModal] = useState({ show: false, text: '', title: '' });
    const [loadingText, setLoadingText] = useState(false);

    const [bhsChapterWords, setBhsChapterWords] = useState<any[]>([]);
    const [selectedBhsWord, setSelectedBhsWord] = useState<any | null>(null);
    const [bhsAiAnalysis, setBhsAiAnalysis] = useState('');
    const [loadingBhsAi, setLoadingBhsAi] = useState(false);

    useEffect(() => { 
        if (externalRef && externalRef !== ref) setRef(externalRef); 
    }, [externalRef]);

    const loadSummary = useCallback(async (targetRef: string) => {
        if (!targetRef) return;
        setLoading(true);
        setError('');
        setSummary(null);

        try {
            const data = await fetchChapterSummary(targetRef);
            if (data) {
                setSummary(data);
            } else {
                setError(`Resumo do capítulo não encontrado no banco de dados para ${targetRef}.`);
            }
        } catch (e: any) {
            console.error(e);
            setError('Falha ao carregar o resumo do capítulo.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (ref) {
            loadSummary(ref);
        }
    }, [ref, loadSummary]);

    const bhsWordsByVerse = React.useMemo(() => {
        const map: Record<number, any[]> = {};
        bhsChapterWords.forEach(w => {
            if (!map[w.verse]) {
                map[w.verse] = [];
            }
            map[w.verse].push(w);
        });
        return map;
    }, [bhsChapterWords]);

    const handleBhsAiAnalysis = async () => {
        if (!selectedBhsWord || !ref) return;
        setLoadingBhsAi(true);
        setBhsAiAnalysis('');
        const prompt = `Analise a palavra hebraica original a seguir no contexto bíblico da passagem ${ref}, versículo ${selectedBhsWord.verse}:
Palavra Original (Hebraico): ${selectedBhsWord.word.replace(/<[^>]*>/g, '')}
Transliteração: ${selectedBhsWord.translit}
Morfologia: ${selectedBhsWord.morphDetail} (${selectedBhsWord.morphCode})
Glossário/Significado literal: ${selectedBhsWord.gloss}
Tradução aproximada: ${selectedBhsWord.bsb ? selectedBhsWord.bsb.replace(/〔\d+＠(.*)〕/, '$1') : 'N/A'}
Número Strong: ${selectedBhsWord.strong}

Por favor, forneça uma análise teológica detalhada em português, incluindo:
1. O significado da raiz original e sua importância cultural/teológica.
2. Como esta palavra contribui para o sentido teológico do versículo em questão.
3. Se houver alguma nuance que a tradução em português geralmente perde, explique de forma simples e enriquecedora para um pregador ou estudante da Bíblia.
Retorne um texto bem formatado em Markdown com títulos curtos.`;

        try {
            const result = await generateAIContent({ prompt });
            setBhsAiAnalysis(result);
        } catch (e: any) {
            console.error(e);
            setBhsAiAnalysis(`Erro ao gerar análise com IA: ${e.message || e}`);
        } finally {
            setLoadingBhsAi(false);
        }
    };

    const handleViewText = useCallback(async () => {
        if (!ref) return;
        setLoadingText(true);
        setError('');
        setBhsChapterWords([]);
        setSelectedBhsWord(null);
        setBhsAiAnalysis('');
        try {
            const text = await getBibleTextFromRef(ref);
            if (text && !text.startsWith("Capítulo não encontrado") && !text.startsWith("Referência inválida")) {
                setFullTextModal({ show: true, text: text, title: ref });
                
                const match = ref.match(/^(.+?)\s+(\d+)/);
                if (match) {
                    const bookName = match[1].trim();
                    const chapter = parseInt(match[2], 10);
                    const bookIdx = getHebrewBookIndex(bookName);
                    if (bookIdx !== -1) {
                        const response = await fetch(`/api/hebrew-bible?book=${bookIdx + 1}&chapter=${chapter}`);
                        if (response.ok) {
                            const json = await response.json();
                            setBhsChapterWords(json.data || []);
                        }
                    }
                }
            } else {
                setError(text || 'Capítulo não encontrado.');
            }
        } catch (e) {
            console.error(e);
            setError('Falha ao carregar o texto bíblico.');
        } finally {
            setLoadingText(false);
        }
    }, [ref]);

    return (
        <div className="tab-content">
            <div style={{ margin: '0 0 1rem 0', width: '100%' }}>
                <div style={{ 
                    width: '30%', 
                    backgroundColor: '#fff', 
                    border: '1px solid #ccc', 
                    borderRadius: '4px', 
                    padding: '0.5rem 0.75rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'flex-start', 
                    fontWeight: 'normal', 
                    color: 'inherit', 
                    fontSize: '0.9rem', 
                    boxSizing: 'border-box', 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis' 
                }}>
                    {ref || 'Selecione o capítulo'}
                </div>
            </div>

            {loading && <LoadingSpinner />}
            {error && <ErrorMessage message={error} />}

            {summary && (
                <div className="card" style={{ padding: '20px', backgroundColor: '#ffffff', borderRadius: '8px', border: '1px solid #e0e0e0', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    {renderFormattedSummary(summary)}
                </div>
            )}

            {fullTextModal.show && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
                    justifyContent: 'center', alignItems: 'center', zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: '#ffffff', color: '#212121', padding: '24px', borderRadius: '12px',
                        width: '90%', maxWidth: '850px', maxHeight: '85vh', overflowY: 'auto',
                        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.15)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid #e1eaf5', paddingBottom: '10px' }}>
                            <h3 style={{ margin: 0, color: '#2b569a', fontSize: '1.4rem', fontWeight: 700 }}>{fullTextModal.title}</h3>
                            <button onClick={() => { setFullTextModal({ show: false, text: '', title: '' }); setBhsChapterWords([]); }} style={{ backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>✕ Fechar</button>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            {bhsChapterWords.length > 0 && (
                                <div style={{ borderBottom: '2px solid #e1eaf5', paddingBottom: '20px' }}>
                                    <h4 style={{ color: '#2b569a', fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '15px', textAlign: 'left' }}>
                                        Texto Hebraico (BHS)
                                    </h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        {(Object.entries(bhsWordsByVerse) as [string, any[]][]).map(([verseNum, verseWords]) => (
                                            <div key={verseNum} style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '10px 6px', alignItems: 'center', padding: '8px 10px', borderBottom: '1px dashed #e1eaf5', direction: 'rtl', textAlign: 'right' }}>
                                                <span style={{ fontSize: '1rem', fontWeight: 'bold', color: '#2b569a', marginLeft: '6px', alignSelf: 'center', userSelect: 'none', direction: 'ltr' }}>
                                                    {verseNum}
                                                </span>
                                                {verseWords.map((word, idx) => (
                                                    <span
                                                        key={idx}
                                                        onClick={() => {
                                                            setSelectedBhsWord(word);
                                                            setBhsAiAnalysis('');
                                                        }}
                                                        title={word.gloss || ''}
                                                        style={{
                                                            fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif",
                                                            fontSize: '1.6rem',
                                                            cursor: 'pointer',
                                                            padding: '2px 6px',
                                                            borderRadius: '6px',
                                                            backgroundColor: selectedBhsWord?.sort === word.sort ? '#edf4fc' : 'transparent',
                                                            color: selectedBhsWord?.sort === word.sort ? '#0d47a1' : '#212121',
                                                            transition: 'all 0.15s ease',
                                                            borderBottom: selectedBhsWord?.sort === word.sort ? '3px solid #2b569a' : '3px solid transparent',
                                                            lineHeight: '2.2rem'
                                                        }}
                                                        onMouseOver={e => {
                                                            if (selectedBhsWord?.sort !== word.sort) {
                                                                e.currentTarget.style.backgroundColor = '#f0f6ff';
                                                                e.currentTarget.style.color = '#2b569a';
                                                            }
                                                        }}
                                                        onMouseOut={e => {
                                                            if (selectedBhsWord?.sort !== word.sort) {
                                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                                e.currentTarget.style.color = '#212121';
                                                            }
                                                        }}
                                                        dangerouslySetInnerHTML={{ __html: word.word }}
                                                    />
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div>
                                <h4 style={{ color: '#2b569a', fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '15px', textAlign: 'left' }}>
                                    Tradução em Português (NAA)
                                </h4>
                                <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '16px' }}>
                                    {fullTextModal.text.split(/\r?\n/).map((line, i) => <p key={i} style={{ margin: '0 0 10px 0' }}>{parseBold(line)}</p>)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {selectedBhsWord && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
                    justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '20px'
                }}>
                    <div style={{
                        backgroundColor: '#ffffff', border: '2px solid #2b569a', borderRadius: '12px',
                        padding: '24px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)', position: 'relative',
                        maxWidth: '400px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center'
                    }}>
                        <button
                            onClick={() => { setSelectedBhsWord(null); setBhsAiAnalysis(''); }}
                            style={{
                                position: 'absolute', top: '12px', right: '12px', background: 'transparent',
                                border: 'none', color: '#888', fontSize: '1.25rem', cursor: 'pointer', fontWeight: 'bold', padding: '4px'
                            }}
                        >
                            ✕
                        </button>
                        <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'bold', alignSelf: 'flex-start' }}>
                            {selectedBhsWord.verse}:{selectedBhsWord.sort}
                        </span>
                        <span style={{ fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif", fontSize: '2.5rem', fontWeight: 'bold', color: '#2b569a', marginTop: '4px' }} dangerouslySetInnerHTML={{ __html: selectedBhsWord.word }} />
                        <span style={{ fontSize: '1rem', fontStyle: 'italic', color: '#555' }}>
                            {selectedBhsWord.translit} ({selectedBhsWord.phonetic})
                        </span>
                        <span style={{ fontSize: '1.05rem', fontWeight: 600, color: '#0d47a1' }}>
                            Literal: {selectedBhsWord.gloss}
                        </span>
                        {selectedBhsWord.bsb && (
                            <span style={{ fontSize: '0.95rem', color: '#f9a825', fontWeight: 600 }}>
                                BSB: {selectedBhsWord.bsb.replace(/〔\d+＠(.*)〕/, '$1')}
                            </span>
                        )}
                        <span style={{ fontSize: '0.85rem', color: '#666', backgroundColor: '#f0f6ff', padding: '4px 10px', borderRadius: '4px', border: '1px solid #d0e2f7' }} title={selectedBhsWord.morphDetail}>
                            {selectedBhsWord.morphCode}
                        </span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#002171' }}>
                            Strong: {selectedBhsWord.strong}
                        </span>
                        <div style={{ width: '100%', borderTop: '1px solid #e1eaf5', paddingTop: '15px', marginTop: '10px' }}>
                            <button
                                onClick={handleBhsAiAnalysis}
                                disabled={loadingBhsAi}
                                style={{
                                    width: '100%', backgroundColor: '#f9a825', color: '#ffffff', padding: '10px',
                                    border: 'none', borderRadius: '8px', cursor: loadingBhsAi ? 'not-allowed' : 'pointer',
                                    fontWeight: 'bold', fontSize: '0.95rem', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', gap: '8px', boxShadow: '0 2px 5px rgba(249, 168, 37, 0.2)'
                                }}
                            >
                                {loadingBhsAi ? 'Analisando com IA...' : '✨ Analisar Palavra com IA'}
                            </button>
                            {bhsAiAnalysis && (
                                <div style={{
                                    marginTop: '15px', backgroundColor: '#fcf8e3', border: '1px solid #faebcc',
                                    borderRadius: '8px', padding: '12px', fontSize: '0.9rem', color: '#8a6d3b',
                                    maxHeight: '200px', overflowY: 'auto', textAlign: 'left'
                                }}>
                                    {bhsAiAnalysis.split('\n').map((line, i) => {
                                        let trimmed = line.trim();
                                        if (trimmed.startsWith('### ')) return <h5 key={i} style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#0d47a1', margin: '12px 0 6px 0' }}>{trimmed.slice(4)}</h5>;
                                        if (trimmed.startsWith('## ')) return <h4 key={i} style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#0d47a1', margin: '16px 0 8px 0' }}>{trimmed.slice(3)}</h4>;
                                        if (trimmed.startsWith('# ')) return <h3 key={i} style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0d47a1', margin: '18px 0 10px 0' }}>{trimmed.slice(2)}</h3>;
                                        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) return <li key={i} style={{ marginLeft: '1rem', marginBottom: '4px' }}>{parseBold(trimmed.slice(2))}</li>;
                                        return <p key={i} style={{ margin: '0 0 8px 0', lineHeight: '1.5' }}>{parseBold(line)}</p>;
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const VersiculoView = ({ externalRef }) => {
    useEffect(() => { if (externalRef && externalRef !== ref) setRef(externalRef); }, [externalRef]);
    const [ref, setRef] = useState('');
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [verseText, setVerseText] = useState('');
    const [deepAnalysisState, setDeepAnalysisState] = useState({});
    const [usedCommentaries, setUsedCommentaries] = useState<any[]>([]);
    const [selectedVerseWordIndex, setSelectedVerseWordIndex] = useState<number | null>(null);
    const [verseWordDeepAnalysis, setVerseWordDeepAnalysis] = useState<Record<number, any>>({});
    const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

    const [bhsWords, setBhsWords] = useState<any[]>([]);
    const [selectedBhsWord, setSelectedBhsWord] = useState<any | null>(null);
    const [bhsAiAnalysis, setBhsAiAnalysis] = useState('');
    const [loadingBhsAi, setLoadingBhsAi] = useState(false);

    const fetchBhsTextForRef = async (targetRef: string) => {
        const match = targetRef.match(/^(.+?)\s+(\d+):?(.*)$/);
        if (!match) return null;

        const bookName = match[1].trim();
        const chapter = parseInt(match[2], 10);
        const versesStr = match[3] || '';

        const bookIdx = getHebrewBookIndex(bookName);
        if (bookIdx === -1) return null;

        const verseNumbers = new Set<number>();
        const cleanPart = versesStr.replace(/[^\d\-]/g, '');
        if (cleanPart) {
            if (cleanPart.includes('-')) {
                const [start, end] = cleanPart.split('-').map(s => parseInt(s, 10));
                if (!isNaN(start) && !isNaN(end)) {
                    for (let i = start; i <= end; i++) verseNumbers.add(i);
                }
            } else {
                const num = parseInt(cleanPart, 10);
                if (!isNaN(num)) verseNumbers.add(num);
            }
        }

        try {
            const response = await fetch(`/api/hebrew-bible?book=${bookIdx + 1}&chapter=${chapter}`);
            if (!response.ok) return null;
            const json = await response.json();
            const allWords = json.data || [];

            if (verseNumbers.size > 0) {
                return allWords.filter((w: any) => verseNumbers.has(w.verse));
            } else {
                return allWords.filter((w: any) => w.verse === 1);
            }
        } catch (e) {
            console.error(e);
            return null;
        }
    };

    const findMatchingBhsWord = (item: any) => {
        if (!bhsWords || bhsWords.length === 0) return null;
        if (item.sort) {
            const parsedSort = parseInt(item.sort, 10);
            if (!isNaN(parsedSort)) {
                const found = bhsWords.find(w => w.sort === parsedSort);
                if (found) return found;
            }
        }
        const norm = (s: string) => s ? s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]/g, "").trim() : "";
        
        const targetTranslit = norm(item.transliteracao);
        const targetOriginal = item.palavraOriginal ? item.palavraOriginal.replace(/<[^>]*>/g, '').trim() : '';
        const targetStrong = item.strong ? item.strong.trim().replace(/^H0*/i, 'H') : '';

        if (targetStrong) {
            const found = bhsWords.find(w => {
                const wStrong = w.strong ? w.strong.trim().replace(/^H0*/i, 'H') : '';
                return wStrong === targetStrong;
            });
            if (found) return found;
        }

        if (targetTranslit) {
            const found = bhsWords.find(w => norm(w.translit) === targetTranslit);
            if (found) return found;
        }

        if (targetOriginal) {
            const found = bhsWords.find(w => {
                const wWord = w.word ? w.word.replace(/<[^>]*>/g, '').trim() : '';
                return wWord.includes(targetOriginal) || targetOriginal.includes(wWord);
            });
            if (found) return found;
        }

        const targetGloss = norm(item.palavraNoVersiculo);
        if (targetGloss) {
            const found = bhsWords.find(w => norm(w.gloss).includes(targetGloss) || targetGloss.includes(norm(w.gloss)));
            if (found) return found;
        }

        return null;
    };

    const handleBhsAiAnalysis = async () => {
        if (!selectedBhsWord || !ref) return;
        setLoadingBhsAi(true);
        setBhsAiAnalysis('');
        const prompt = `Analise a palavra hebraica original a seguir no contexto bíblico da passagem ${ref}, versículo ${selectedBhsWord.verse}:
Palavra Original (Hebraico): ${selectedBhsWord.word.replace(/<[^>]*>/g, '')}
Transliteração: ${selectedBhsWord.translit}
Morfologia: ${selectedBhsWord.morphDetail} (${selectedBhsWord.morphCode})
Glossário/Significado literal: ${selectedBhsWord.gloss}
Tradução aproximada: ${selectedBhsWord.bsb ? selectedBhsWord.bsb.replace(/〔\d+＠(.*)〕/, '$1') : 'N/A'}
Número Strong: ${selectedBhsWord.strong}

Por favor, forneça uma análise teológica detalhada em português, incluindo:
1. O significado da raiz original e sua importância cultural/teológica.
2. Como esta palavra contribui para o sentido teológico do versículo em questão.
3. Se houver alguma nuance que a tradução em português geralmente perde, explique de forma simples e enriquecedora para um pregador ou estudante da Bíblia.
Retorne um texto bem formatado em Markdown com títulos curtos.`;

        try {
            const result = await generateAIContent({ prompt });
            setBhsAiAnalysis(result);
        } catch (e: any) {
            console.error(e);
            setBhsAiAnalysis(`Erro ao gerar análise com IA: ${e.message || e}`);
        } finally {
            setLoadingBhsAi(false);
        }
    };

    const handleRewriteText = async (type: 'teologica' | 'aplicacao', index: number, text: string) => {
        const loadingKey = `${type}-rewrite-${index}`;
        setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
        try {
            const prompt = `Reescreva o seguinte texto sobre o versículo ${ref} em uma linguagem muito mais acessível, envolvente, devocional e menos técnica, seguindo o estilo do escritor cristão Max Lucado. Sinta-se livre para ampliar ou resumir as ideias originais o quanto for necessário, desde que mantenha a mensagem principal e atenda ao objetivo da reescrita. Retorne APENAS o texto reescrito, sem aspas e sem introdução:\n\n"${text}"`;
            const responseText = await generateAIContent({
                prompt,
                isJson: false,
            });
            const newText = responseText.trim();
            
            setResult(prev => {
                if (!prev) return prev;
                const next = { ...prev };
                if (type === 'teologica') {
                    const parts = [...(next.analiseTeologica || [])];
                    parts[index] = newText;
                    next.analiseTeologica = parts;
                } else if (type === 'aplicacao') {
                    const parts = [...(next.aplicacoes || [])];
                    parts[index] = newText;
                    next.aplicacoes = parts;
                }
                return next;
            });
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao reescrever texto.'));
        } finally {
            setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
        }
    };

    const handleExpandText = async (type: 'teologica' | 'aplicacao', index: number, text: string) => {
        const loadingKey = `${type}-expand-${index}`;
        setActionLoading(prev => ({ ...prev, [loadingKey]: true }));
        try {
            const prompt = `O texto original é: "${text}". Escreva mais dois parágrafos explicando e aprofundando o assunto deste parágrafo sobre o versículo ${ref}. Não repita o texto original, forneça apenas os novos parágrafos, separados por linha em branco.`;
            const responseText = await generateAIContent({
                prompt,
                isJson: false,
            });
            const newText = responseText.trim();
            
            setResult(prev => {
                if (!prev) return prev;
                const next = { ...prev };
                if (type === 'teologica') {
                    const parts = [...(next.analiseTeologica || [])];
                    parts[index] = parts[index] + '\n\n' + newText;
                    next.analiseTeologica = parts;
                } else if (type === 'aplicacao') {
                    const parts = [...(next.aplicacoes || [])];
                    parts[index] = parts[index] + '\n\n' + newText;
                    next.aplicacoes = parts;
                }
                return next;
            });
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao ampliar texto.'));
        } finally {
            setActionLoading(prev => ({ ...prev, [loadingKey]: false }));
        }
    };

    const handleVerseWordClick = (index: number) => {
        setSelectedVerseWordIndex(index === selectedVerseWordIndex ? null : index);
    };

    const handleVerseWordDeepAnalysis = async (index: number, word: string) => {
        setSelectedVerseWordIndex(null);
        const cleanWord = word.replace(/[.,;!?()]/g, '').trim();
        setVerseWordDeepAnalysis(prev => ({ ...prev, [index]: { loading: true } }));
        
        try {
            const prompt = `Faça uma análise profunda da palavra "${cleanWord}" no contexto do versículo ${ref}. 
Siga estritamente estes 6 passos de análise. Retorne um JSON contendo a palavra original (em hebraico/aramaico/grego), sua transliteração, como ela aparece na tradução em português, e um array de objetos "passos", onde cada objeto representa um passo com "titulo" e "conteudo".
Passos obrigatórios:
A) Análise Morfológica (A Estrutura) - Foque na forma, estrutura e etiquetas gramaticais.
B) Análise Sintática (A Relação) - Como a palavra se conecta na frase, sujeito, predicado, etc.
C) Análise Semântica (O Significado) - Significado no contexto cultural, histórico e literário.
D) Análise Etimológica (A Origem) - Raiz da palavra e sua formação histórica.
E) Análise de Contexto Literário e Histórico - Cultura e gênero literário que a envolve.
F) Análise Teológica - Como se encaixa no plano geral da Bíblia e conexões doutrinárias.`;

            const responseText = await generateAIContent({
                prompt,
                isJson: true,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            palavraOriginal: { type: Type.STRING },
                            transliteracao: { type: Type.STRING },
                            palavraNoVersiculo: { type: Type.STRING },
                            passos: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        titulo: { type: Type.STRING },
                                        conteudo: { type: Type.STRING }
                                    },
                                    required: ['titulo', 'conteudo']
                                }
                            }
                        },
                        required: ['palavraOriginal', 'transliteracao', 'palavraNoVersiculo', 'passos']
                    }
                }
            });
            const analysisResult = JSON.parse(responseText);
            setVerseWordDeepAnalysis(prev => ({ ...prev, [index]: { loading: false, result: analysisResult } }));
        } catch (e) {
            setVerseWordDeepAnalysis(prev => ({ ...prev, [index]: { loading: false, error: formatGeminiError(e, 'Falha ao realizar análise profunda da palavra.') } }));
        }
    };

    const handleDeepAnalysis = async (index, item) => {
        setDeepAnalysisState(prev => ({ ...prev, [index]: { loading: true } }));
        try {
            const prompt = `Faça uma análise profunda da palavra "${item.palavraOriginal}" (transliterada como ${item.transliteracao}) no contexto do versículo ${ref}. 
Siga estritamente estes 6 passos de análise. Retorne um JSON com um array de objetos, onde cada objeto representa um passo e tem "titulo" e "conteudo".
Passos obrigatórios:
A) Análise Morfológica (A Estrutura) - Foque na forma, estrutura e etiquetas gramaticais.
B) Análise Sintática (A Relação) - Como a palavra se conecta na frase, sujeito, predicado, etc.
C) Análise Semântica (O Significado) - Significado no contexto cultural, histórico e literário.
D) Análise Etimológica (A Origem) - Raiz da palavra e sua formação histórica.
E) Análise de Contexto Literário e Histórico - Cultura e gênero literário que a envolve.
F) Análise Teológica - Como se encaixa no plano geral da Bíblia e conexões doutrinárias.`;

            const responseText = await generateAIContent({
                prompt,
                isJson: true,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                titulo: { type: Type.STRING },
                                conteudo: { type: Type.STRING }
                            },
                            required: ['titulo', 'conteudo']
                        }
                    }
                }
            });
            const analysisResult = parseAIJsonArray(responseText);
            setDeepAnalysisState(prev => ({ ...prev, [index]: { loading: false, result: analysisResult } }));
        } catch (e) {
            setDeepAnalysisState(prev => ({ ...prev, [index]: { loading: false, error: formatGeminiError(e, 'Falha ao realizar análise profunda.') } }));
        }
    };

    const handleAnalyze = useCallback(async (overrideRef) => {
        const targetRef = typeof overrideRef === 'string' ? overrideRef : ref;
        if (!targetRef) return;
        setRef(targetRef);
        setLoading(true);
        setError('');
        setResult(null);
        setVerseText('');
        setDeepAnalysisState({});
        setVerseWordDeepAnalysis({});
        setSelectedVerseWordIndex(null);
        setUsedCommentaries([]);

        try {
            const vText = await getBibleTextFromRef(targetRef);
            if (vText && !vText.startsWith("Capítulo não encontrado") && !vText.startsWith("Referência inválida")) {
                setVerseText(vText);
            }

            const commentaries = await fetchCommentaries(targetRef);
            setUsedCommentaries(commentaries);

            // Fetch BHS words
            const bWords = await fetchBhsTextForRef(targetRef);
            setBhsWords(bWords || []);
            setBhsAiAnalysis('');
            setSelectedBhsWord(null);

            const currentProvider = localStorage.getItem('ai_provider') || 'ollama';
            if (currentProvider === 'supabase') {
                const apresentacao = vText && !vText.startsWith("Capítulo não encontrado")
                    ? `[Busca Direta Supabase - Sem IA]\n\nTexto do Versículo ${targetRef}:\n${vText}`
                    : `[Busca Direta Supabase - Sem IA]\n\nConsulta realizada diretamente no banco Supabase para ${targetRef}.`;

                const histCult = commentaries.length > 0
                    ? commentaries.map(c => `👤 Comentário de ${c.author}${c.verse ? ` (Versículo ${c.verse})` : ' (Capítulo)'}:\n${c.text}`).join('\n\n')
                    : 'Nenhum comentário cadastrado para este versículo no banco de dados Supabase.';

                setResult({
                    apresentacaoCapitulo: apresentacao,
                    analiseHistoricoCultural: histCult,
                    analiseTeologica: `Consulta direta realizada no banco de dados Supabase para a passagem ${targetRef}. Total de comentários encontrados: ${commentaries.length}.`,
                    aplicacoes: commentaries.length > 0
                        ? commentaries.map(c => `**Comentário (${c.author}):** ${c.text}`)
                        : ['Nenhum comentário disponível no banco para gerar aplicações.'],
                    analiseLinguistica: []
                });
                return;
            }

            let prompt = `Faça uma exegese detalhada de ${targetRef}. Siga estas instruções estritas para cada seção:

1. **Apresentação do Capítulo**: Escreva exatamente dois parágrafos apresentando o contexto geral do capítulo.
2. **Análise Histórico-Cultural**: Escreva exatamente quatro parágrafos com informações sobre o contexto da época (política, religião, sociedade, costumes, leis, práticas, cidades, etc.) relacionadas ao versículo. **Cada tema deve estar em um parágrafo separado por duas quebras de linha**.
3. **Análise Teológica**: Escreva exatamente quatro parágrafos destacando frases de peso teológico. Cada frase deve vir acompanhada de uma explicação sobre seu significado no capítulo, verdades reveladas (Deus, ser humano, pecado, salvação, missão) e como dialoga com a Bíblia de forma pastoral e simples. **Cada frase/parágrafo deve estar separado por duas quebras de linha**.
4. **Análise Linguística**: Selecione exatamente de 3 a 4 palavras principais do versículo original em Hebraico/Grego.
5. **Aplicações**: Gere 4 parágrafos. Cada um sugerindo uma aplicação prática e concreta conectada ao versículo. As aplicações devem conter: Atitudes, decisões, mudanças de mentalidade; Encorajamento, consolo, exortação, esperança; Exemplos contemporâneos que ajudem a aplicar o texto na vida real. Apresentação: a primeira frase de cada aplicação (que resume a ideia principal) deve estar em negrito (ex: **Pratique o perdão diariamente.**). Pule uma linha entre cada parágrafo e não use a palavra literal "Frase resumo".

`;

            if (bWords && bWords.length > 0) {
                prompt += `Aqui está a lista de palavras em Hebraico (BHS) presentes no versículo com suas respectivas informações. Escolha de 3 a 4 dessas palavras para realizar a análise linguística e retorne o ID 'sort' correspondente no campo "sort" do JSON:\n` +
                    bWords.map(w => `- ID: ${w.sort} | Palavra: "${w.word.replace(/<[^>]*>/g, '')}" | Transliteração: "${w.translit}" | Significado literal: "${w.gloss}" | Strong: "${w.strong}"`).join('\n') + `\n\n`;
            }

            prompt += `Responda em JSON com as chaves: apresentacaoCapitulo (string), analiseHistoricoCultural (string), analiseTeologica (string), aplicacoes (array de strings onde cada string é o texto do parágrafo de uma aplicação), analiseLinguistica (array de objetos com chaves: palavraOriginal, transliteracao, palavraNoVersiculo, sentidoEnuances, sort). A chave 'sort' deve ser o ID inteiro correspondente à palavra da lista fornecida (se aplicável). Destaque termos importantes com ** no corpo dos textos.`;

            const responseText = await generateAIContent({
                prompt,
                isJson: true,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            apresentacaoCapitulo: { type: Type.STRING },
                            analiseHistoricoCultural: { type: Type.STRING },
                            analiseTeologica: { type: Type.STRING },
                            aplicacoes: { type: Type.ARRAY, items: { type: Type.STRING } },
                            analiseLinguistica: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        palavraOriginal: { type: Type.STRING },
                                        transliteracao: { type: Type.STRING },
                                        palavraNoVersiculo: { type: Type.STRING },
                                        sentidoEnuances: { type: Type.STRING },
                                        sort: { type: Type.INTEGER }
                                    },
                                    required: ['palavraOriginal', 'transliteracao', 'palavraNoVersiculo', 'sentidoEnuances']
                                }
                            }
                        },
                        required: ['apresentacaoCapitulo', 'analiseHistoricoCultural', 'analiseTeologica', 'aplicacoes', 'analiseLinguistica']
                    }
                }
            });
            setResult(JSON.parse(responseText));
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao analisar o versículo.'));
        } finally {
            setLoading(false);
        }
    }, [ref]);

    useEffect(() => {
        const handler = (e) => {
            if (e.detail) handleAnalyze(e.detail);
        };
        window.addEventListener('analyze-verse', handler);
        return () => window.removeEventListener('analyze-verse', handler);
    }, [handleAnalyze]);

    return (
        <div className="tab-content">
            
            <div className="form-group" style={{ position: 'relative', width: '100%', margin: '0 0 1rem 0', display: 'block' }}>
                <input 
                    type="text" 
                    value={ref} 
                    onChange={e => setRef(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && handleAnalyze()} 
                    placeholder="Ex: João 3:16" 
                    style={{ width: '100%', paddingRight: '40px' }}
                />
                <span 
                    onClick={() => !loading && handleAnalyze()} 
                    title="Analisar"
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '1.2rem', opacity: loading ? 0.5 : 1, userSelect: 'none', color: '#616161' }}
                >
                    {loading ? '⏳' : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    )}
                </span>
            </div>
            {loading && <LoadingSpinner />}
            {error && <ErrorMessage message={error} />}
            {result && (
                <div>
                    {usedCommentaries.length > 0 && (
                        <div style={{ fontSize: '0.85rem', color: '#1565c0', backgroundColor: '#e3f2fd', padding: '10px 15px', borderRadius: '6px', marginBottom: '15px', borderLeft: '4px solid #2196f3' }}>
                            <strong>📖 Comentários utilizados do Supabase:</strong> {Array.from(new Set(usedCommentaries.map(c => c.author))).join(', ')}
                        </div>
                    )}
                    <div className="card">
                        <h3>Apresentação do Capítulo</h3>
                        {(result.apresentacaoCapitulo || '').split(/\n+/).filter(p => p.trim()).map((p, i, arr) => (
                            <div key={i} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: i < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                <p>{parseBold(p)}</p>
                            </div>
                        ))}
                    </div>
                    <div className="card">
                        <h3>Análise Histórico-Cultural</h3>
                        {(result.analiseHistoricoCultural || '').split(/\n+/).filter(p => p.trim()).map((p, i, arr) => (
                            <div key={i} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: i < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                <p>{parseBold(p)}</p>
                            </div>
                        ))}
                    </div>
                    <div className="card">
                        <h3>Análise Linguística</h3>
                        {(result.analiseLinguistica || []).map((item, index, arr) => {
                            const matchingWord = findMatchingBhsWord(item);
                            
                            return (
                                <div key={index} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: index < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                    {matchingWord ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                                                <span 
                                                    style={{ 
                                                        fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif", 
                                                        fontSize: '2.2rem', 
                                                        fontWeight: 'bold', 
                                                        color: '#2b569a',
                                                        lineHeight: '1.2'
                                                    }}
                                                    dangerouslySetInnerHTML={{ __html: matchingWord.word }} 
                                                />
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontSize: '1rem', fontWeight: 600, color: '#424242' }}>
                                                        Transliteração: {matchingWord.translit} ({matchingWord.phonetic})
                                                    </span>
                                                    <span style={{ fontSize: '0.95rem', color: '#1565c0', fontWeight: 500 }}>
                                                        Literal: {matchingWord.gloss} {matchingWord.bsb ? ` | Tradução: ${matchingWord.bsb.replace(/〔\d+＠(.*)〕/, '$1')}` : ''}
                                                    </span>
                                                    <span style={{ fontSize: '0.85rem', color: '#757575' }}>
                                                        Morfologia: {matchingWord.morphDetail} ({matchingWord.morphCode}) | Strong: {matchingWord.strong}
                                                    </span>
                                                </div>
                                            </div>
                                            <p style={{ marginTop: '5px', fontSize: '1rem', lineHeight: '1.6', color: '#212121' }}>
                                                {item.sentidoEnuances}
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            <p><strong>{item.palavraOriginal}</strong>; {item.transliteracao}</p>
                                            <p>{item.sentidoEnuances}</p>
                                        </>
                                    )}
                                    <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', borderTop: 'none', paddingTop: 0, gap: '15px' }}>
                                        <button onClick={() => handleDeepAnalysis(index, item)} disabled={deepAnalysisState[index]?.loading} style={{ backgroundColor: 'transparent', border: 'none', color: '#0d47a1', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}>
                                            {deepAnalysisState[index]?.loading ? 'Analisando...' : 'Análise Profunda'}
                                        </button>
                                    </div>
                                    
                                    {deepAnalysisState[index]?.error && <ErrorMessage message={deepAnalysisState[index].error} />}
                                    {deepAnalysisState[index]?.result && (
                                        <div style={{ marginTop: '15px', padding: '15px', backgroundColor: '#f0f4f8', borderRadius: '5px', borderLeft: '4px solid #2196F3' }}>
                                            <h4 style={{ margin: '0 0 10px 0', color: '#1565C0' }}>Análise Profunda</h4>
                                            {(deepAnalysisState[index].result || []).map((passo, pIndex) => (
                                                <div key={pIndex} style={{ marginBottom: '15px' }}>
                                                    <p style={{ fontWeight: 'bold', margin: '0 0 5px 0' }}>{passo.titulo}</p>
                                                    <p style={{ margin: '0 0 10px 0' }}>{passo.conteudo}</p>

                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="card">
                        <h3>Análise Teológica</h3>
                        {(result.analiseTeologica || '').split(/\n+/).filter(p => p.trim()).map((p, i, arr) => (
                            <div key={i} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: i < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                <p>{parseBold(p)}</p>
                                <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', borderTop: 'none', paddingTop: 0, gap: '15px' }}>
                                    <button onClick={() => handleExpandText('teologica', i, p)} disabled={actionLoading[`teologica-expand-${i}`]} style={{ backgroundColor: 'transparent', border: 'none', color: '#0d47a1', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}>
                                        {actionLoading[`teologica-expand-${i}`] ? 'Ampliando...' : 'Ampliar'}
                                    </button>
                                    <button onClick={() => handleRewriteText('teologica', i, p)} disabled={actionLoading[`teologica-rewrite-${i}`]} style={{ backgroundColor: 'transparent', border: 'none', color: '#0d47a1', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}>
                                        {actionLoading[`teologica-rewrite-${i}`] ? 'Reescrevendo...' : 'Reescrever'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="card">
                        <h3>Aplicações</h3>
                        {result.aplicacoes && (result.aplicacoes || []).map((p, i, arr) => {
                            let cleanP = p.replace(/^\*\*(?:Frase\s+)?[Rr]esumo:?\s*\*\*\s*|^(?:Frase\s+)?[Rr]esumo:?\s*/i, '');
                            if (!cleanP.startsWith('**') && cleanP.includes('.')) {
                                const firstDot = cleanP.indexOf('.');
                                cleanP = `**${cleanP.substring(0, firstDot + 1)}**${cleanP.substring(firstDot + 1)}`;
                            }
                            const match = cleanP.match(/^\*\*(.*?)\*\*(?:[:\-]?\s*)(.*)$/);
                            const fraseResumo = match ? match[1] : cleanP.split(':')[0] || cleanP.split('.')[0] || cleanP.substring(0, 50);
                            return (
                                <div key={i} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: i < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                    <p>{parseBold(cleanP)}</p>
                                    <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', borderTop: 'none', paddingTop: 0, gap: '15px' }}>
                                        <button onClick={() => handleExpandText('aplicacao', i, cleanP)} disabled={actionLoading[`aplicacao-expand-${i}`]} style={{ backgroundColor: 'transparent', border: 'none', color: '#0d47a1', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}>
                                            {actionLoading[`aplicacao-expand-${i}`] ? 'Ampliando...' : 'Ampliar'}
                                        </button>
                                        <button onClick={() => handleRewriteText('aplicacao', i, cleanP)} disabled={actionLoading[`aplicacao-rewrite-${i}`]} style={{ backgroundColor: 'transparent', border: 'none', color: '#0d47a1', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}>
                                            {actionLoading[`aplicacao-rewrite-${i}`] ? 'Reescrevendo...' : 'Reescrever'}
                                        </button>
                                        <button onClick={() => window.dispatchEvent(new CustomEvent('search-thoughts', { detail: fraseResumo }))} style={{ backgroundColor: 'transparent', border: 'none', color: '#0d47a1', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}>Pensamentos</button>
                                        <button onClick={() => window.dispatchEvent(new CustomEvent('search-illustrations', { detail: fraseResumo }))} style={{ backgroundColor: 'transparent', border: 'none', color: '#0d47a1', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}>Ilustrações</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            {selectedBhsWord && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
                    justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '20px'
                }}>
                    <div style={{
                        backgroundColor: '#ffffff', border: '2px solid #2b569a', borderRadius: '12px',
                        padding: '24px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)', position: 'relative',
                        maxWidth: '400px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center'
                    }}>
                        <button
                            onClick={() => { setSelectedBhsWord(null); setBhsAiAnalysis(''); }}
                            style={{
                                position: 'absolute', top: '12px', right: '12px', background: 'transparent',
                                border: 'none', color: '#888', fontSize: '1.25rem', cursor: 'pointer', fontWeight: 'bold', padding: '4px'
                            }}
                        >
                            ✕
                        </button>
                        <span style={{ fontSize: '0.8rem', color: '#888', fontWeight: 'bold', alignSelf: 'flex-start' }}>
                            {selectedBhsWord.verse}:{selectedBhsWord.sort}
                        </span>
                        <span style={{ fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif", fontSize: '2.5rem', fontWeight: 'bold', color: '#2b569a', marginTop: '4px' }} dangerouslySetInnerHTML={{ __html: selectedBhsWord.word }} />
                        <span style={{ fontSize: '1rem', fontStyle: 'italic', color: '#555' }}>
                            {selectedBhsWord.translit} ({selectedBhsWord.phonetic})
                        </span>
                        <span style={{ fontSize: '1.05rem', fontWeight: 600, color: '#0d47a1' }}>
                            Literal: {selectedBhsWord.gloss}
                        </span>
                        {selectedBhsWord.bsb && (
                            <span style={{ fontSize: '0.95rem', color: '#f9a825', fontWeight: 600 }}>
                                BSB: {selectedBhsWord.bsb.replace(/〔\d+＠(.*)〕/, '$1')}
                            </span>
                        )}
                        <span style={{ fontSize: '0.85rem', color: '#666', backgroundColor: '#f0f6ff', padding: '4px 10px', borderRadius: '4px', border: '1px solid #d0e2f7' }} title={selectedBhsWord.morphDetail}>
                            {selectedBhsWord.morphCode}
                        </span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#002171' }}>
                            Strong: {selectedBhsWord.strong}
                        </span>
                        <div style={{ width: '100%', borderTop: '1px solid #e1eaf5', paddingTop: '15px', marginTop: '10px' }}>
                            <button
                                onClick={handleBhsAiAnalysis}
                                disabled={loadingBhsAi}
                                style={{
                                    width: '100%', backgroundColor: '#f9a825', color: '#ffffff', padding: '10px',
                                    border: 'none', borderRadius: '8px', cursor: loadingBhsAi ? 'not-allowed' : 'pointer',
                                    fontWeight: 'bold', fontSize: '0.95rem', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', gap: '8px', boxShadow: '0 2px 5px rgba(249, 168, 37, 0.2)'
                                }}
                            >
                                {loadingBhsAi ? 'Analisando com IA...' : '✨ Analisar Palavra com IA'}
                            </button>
                            {bhsAiAnalysis && (
                                <div style={{
                                    marginTop: '15px', backgroundColor: '#fcf8e3', border: '1px solid #faebcc',
                                    borderRadius: '8px', padding: '12px', fontSize: '0.9rem', color: '#8a6d3b',
                                    maxHeight: '200px', overflowY: 'auto', textAlign: 'left'
                                }}>
                                    {bhsAiAnalysis.split('\n').map((line, i) => {
                                        let trimmed = line.trim();
                                        if (trimmed.startsWith('### ')) return <h5 key={i} style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#0d47a1', margin: '12px 0 6px 0' }}>{trimmed.slice(4)}</h5>;
                                        if (trimmed.startsWith('## ')) return <h4 key={i} style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#0d47a1', margin: '16px 0 8px 0' }}>{trimmed.slice(3)}</h4>;
                                        if (trimmed.startsWith('# ')) return <h3 key={i} style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#0d47a1', margin: '18px 0 10px 0' }}>{trimmed.slice(2)}</h3>;
                                        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) return <li key={i} style={{ marginLeft: '1rem', marginBottom: '4px' }}>{parseBold(trimmed.slice(2))}</li>;
                                        return <p key={i} style={{ margin: '0 0 8px 0', lineHeight: '1.5' }}>{parseBold(line)}</p>;
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const PensamentosView = ({ externalSearch }: { externalSearch?: string }) => {
    useEffect(() => { if (externalSearch && externalSearch !== topic) setTopic(externalSearch); }, [externalSearch]);
    const [topic, setTopic] = useState('');
    const [quotes, setQuotes] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [subActionState, setSubActionState] = useState({});

    const updateSubAction = (id, key, value) => {
        setSubActionState(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
    };

    const runSubAction = async (id, prompt, resultKey) => {
        updateSubAction(id, 'loading', true);
        try {
            const responseText = await generateAIContent({ prompt });
            updateSubAction(id, resultKey, responseText);
        } catch (e) {
            updateSubAction(id, resultKey, formatGeminiError(e, 'Erro ao processar a solicitação.'));
        } finally {
            updateSubAction(id, 'loading', false);
        }
    };

    const handleSearch = useCallback(async (more = false, customTopic = null) => {
        const query = customTopic || topic;
        if (!query && !more) return;
        if (customTopic) setTopic(customTopic);
        setLoading(true);
        setError('');
        if (!more) {
            setQuotes([]);
            setSubActionState({});
        }

        try {
            const existingQuotes = more ? `Evite citações semelhantes a estas: ${quotes.map(q => q.quote).join('; ')}` : '';
            const prompt = `Encontre ${more ? 5 : 10} citações diretas (verbatim) sobre "${query}". ATENÇÃO: Coloque SOMENTE citações que realmente existam. Confirme e verifique a veracidade e autenticidade de cada uma antes de apresentá-las. Não use paráfrases ou inspirações, apenas transcrições exatas. Não cite textos bíblicos. ${existingQuotes}. Responda em JSON com um array de objetos, cada um com as chaves "quote" e "source".`;
            const responseText = await generateAIContent({
                prompt,
                isJson: true,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { quote: { type: Type.STRING }, source: { type: Type.STRING } } } }
                }
            });
            const newQuotes = parseAIJsonArray(responseText).map((q: any) => ({ ...q, id: Math.random().toString(36) }));
            setQuotes(prev => more ? [...prev, ...newQuotes] : newQuotes);
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao buscar pensamentos.'));
        } finally {
            setLoading(false);
        }
    }, [topic, quotes]);

    useEffect(() => {
        const handler = (e) => {
            if (e.detail) {
                handleSearch(false, e.detail);
            }
        };
        window.addEventListener('search-thoughts', handler);
        return () => window.removeEventListener('search-thoughts', handler);
    }, [handleSearch]);

    return (
        <div className="tab-content">

            <div className="form-group" style={{ position: 'relative', width: '90%', margin: '15px auto 1rem auto', display: 'block' }}>
                <input 
                    type="text" 
                    value={topic} 
                    onChange={e => setTopic(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && handleSearch(false)} 
                    placeholder="Ex: Graça, C.S. Lewis" 
                    style={{ width: '100%', paddingRight: '40px' }}
                />
                <span 
                    onClick={() => !loading && handleSearch(false)} 
                    title="Buscar"
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '1.2rem', opacity: loading ? 0.5 : 1, userSelect: 'none', color: '#616161' }}
                >
                    {loading ? '⏳' : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    )}
                </span>
            </div>
            {loading && !quotes.length && <LoadingSpinner />}
            {error && <ErrorMessage message={error} />}
            {quotes.map(q => {
                const subAction = subActionState[q.id] || {};
                return (
                    <div className="card quote-card" key={q.id}>
                        <blockquote>{q.quote}</blockquote>
                        <footer>— {q.source}</footer>
                        <div className="quote-actions">
                            <button onClick={() => runSubAction(q.id, `Verifique a autenticidade da citação: "${q.quote}" atribuída a ${q.source}.`, 'verify')}>Verificar</button>
                            <button onClick={() => runSubAction(q.id, `Fale sobre o autor e a obra: ${q.source}.`, 'about')}>Sobre</button>
                            <button onClick={() => window.dispatchEvent(new CustomEvent('search-illustrations', { detail: q.quote }))}>🔍 Ilustrações</button>
                        </div>
                        {subAction.loading && <LoadingSpinner />}
                        {subAction.verify && <div className="sub-result"><strong>Verificação:</strong> {subAction.verify}</div>}
                        {subAction.about && <div className="sub-result"><strong>Sobre:</strong> {subAction.about}</div>}
                    </div>
                );
            })}
            {quotes.length > 0 && <div className="more-buttons"><button onClick={() => handleSearch(true)} disabled={loading}>{loading ? 'Buscando...' : 'Mais Pensamentos'}</button></div>}
        </div>
    );
};

const renderFonteLink = (fonte: string) => {
    if (!fonte) return null;
    const trimmed = fonte.trim();
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    const match = trimmed.match(urlRegex);
    if (match) {
        let url = match[0];
        if (url.toLowerCase().startsWith('www.')) {
            url = 'https://' + url;
        }
        url = url.replace(/[.,;)]$/, '');
        return (
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'underline', fontWeight: 'bold' }}>
                {trimmed}
            </a>
        );
    }
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    return (
        <a href={searchUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-color)', textDecoration: 'underline', fontWeight: 'bold' }}>
            {trimmed}
        </a>
    );
};

const IlustracoesView = ({ externalSearch }: { externalSearch?: string }) => {
    useEffect(() => { if (externalSearch && externalSearch !== theme) setTheme(externalSearch); }, [externalSearch]);
    const [theme, setTheme] = useState('');
    const [illustrations, setIllustrations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [checkState, setCheckState] = useState({});
    const [expandState, setExpandState] = useState({});

    const handleSearch = useCallback(async (category = 'notícias', customTheme = null, append = false) => {
        const query = customTheme || theme;
        if (!query) return;
        if (customTheme) setTheme(customTheme);
        setLoading(true);
        setError('');
        
        if (!append) {
            setIllustrations([]);
            setCheckState({});
            setExpandState({});
        }

        const promptMap: Record<string, string> = {
            'notícias': `Encontre 3 notícias reais que ilustram o tema "${query}". Forneça um resumo detalhado de dois parágrafos e a fonte (tente incluir uma URL direta se disponível).`,
            'estudos': `Encontre 2 estudos científicos ou acadêmicos que ilustram o tema "${query}". Forneça um resumo detalhado de dois parágrafos e a fonte (tente incluir uma URL direta se disponível).`,
            'histórias': `Encontre 2 enredos de filmes ou livros reais que ilustram o tema "${query}". Forneça um resumo detalhado de dois parágrafos e a fonte (tente incluir uma URL direta se disponível).`,
            'literatura': `Encontre 2 obras de ficção (literatura, romances, contos ou revistas em quadrinhos) que ilustram o tema "${query}". Forneça um resumo detalhado de dois parágrafos e a fonte.`,
            'arte': `Encontre 2 obras de arte (quadros, músicas, pinturas, esculturas ou outras manifestações artísticas) que ilustram o tema "${query}". Forneça um resumo detalhado de dois parágrafos e a fonte.`
        };
        try {
            const responseText = await generateAIContent({
                prompt: promptMap[category] + ' Responda em JSON com um array de objetos, cada um com "resumo" e "fonte".',
                isJson: true,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { resumo: { type: Type.STRING }, fonte: { type: Type.STRING } } } }
                }
            });
            const newItems = parseAIJsonArray(responseText).map((item: any) => ({ ...item, id: Math.random().toString(36), category }));
            setIllustrations(prev => append ? [...prev, ...newItems] : newItems);
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao buscar ilustrações.'));
        } finally {
            setLoading(false);
        }
    }, [theme]);

    const handleCheck = async (id, item) => {
        setCheckState(prev => ({ ...prev, [id]: { loading: true } }));
        try {
            const responseText = await generateAIContent({ prompt: `Verifique a confiabilidade da notícia/fonte: ${item.fonte} sobre o resumo: "${item.resumo}"` });
            setCheckState(prev => ({ ...prev, [id]: { loading: false, result: responseText } }));
        } catch (e) {
            setCheckState(prev => ({ ...prev, [id]: { loading: false, result: formatGeminiError(e, 'Erro na verificação.') } }));
        }
    };

    const handleExpand = async (id, item) => {
        setExpandState(prev => ({ ...prev, [id]: { loading: true } }));
        try {
            const prompt = `Você é um redator auxiliar. Com base na seguinte ilustração (tema "${theme || item.category}"):
Resumo: "${item.resumo}"
Fonte: "${item.fonte}"

Gere exatamente mais TRÊS parágrafos detalhados ampliando essa ilustração, contando com mais detalhes históricos, contextuais ou narrativos relevantes sobre o caso/fato descrito. Não inclua introduções nem conclusões, apenas os 3 parágrafos de ampliação.`;
            const responseText = await generateAIContent({ prompt });
            setExpandState(prev => ({ ...prev, [id]: { loading: false, result: responseText } }));
        } catch (e) {
            setExpandState(prev => ({ ...prev, [id]: { loading: false, result: formatGeminiError(e, 'Erro ao ampliar a ilustração.') } }));
        }
    };

    useEffect(() => {
        const handler = (e) => {
            if (e.detail) {
                handleSearch('notícias', e.detail, false);
            }
        };
        window.addEventListener('search-illustrations', handler);
        return () => window.removeEventListener('search-illustrations', handler);
    }, [handleSearch]);

    return (
        <div className="tab-content">

            <div className="form-group" style={{ position: 'relative', width: '90%', margin: '15px auto 1rem auto', display: 'block' }}>
                <input 
                    type="text" 
                    value={theme} 
                    onChange={e => setTheme(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && handleSearch('notícias', null, false)} 
                    placeholder="Ex: Perdão, Fé" 
                    style={{ width: '100%', paddingRight: '40px' }}
                />
                <span 
                    onClick={() => !loading && handleSearch('notícias', null, false)} 
                    title="Buscar"
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '1.2rem', opacity: loading ? 0.5 : 1, userSelect: 'none', color: '#616161' }}
                >
                    {loading ? '⏳' : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    )}
                </span>
            </div>
            {loading && !illustrations.length && <LoadingSpinner />}
            {error && <ErrorMessage message={error} />}
            {illustrations.map(item => (
                <div className="card" key={item.id}>
                    {item.resumo.split('\n').filter(p => p.trim()).map((p, i) => <p key={i}>{p}</p>)}
                    <p><strong>Fonte:</strong> {renderFonteLink(item.fonte)}</p>
                    <div className="quote-actions" style={{ justifyContent: 'flex-end', gap: '10px' }}>
                        <button onClick={() => handleCheck(item.id, item)} disabled={checkState[item.id]?.loading}>Checar</button>
                        <button onClick={() => handleExpand(item.id, item)} disabled={expandState[item.id]?.loading}>{expandState[item.id]?.loading ? 'Ampliando...' : 'Ampliar'}</button>
                    </div>
                    {checkState[item.id]?.loading && <LoadingSpinner />}
                    {checkState[item.id]?.result && <div className="sub-result">{checkState[item.id].result}</div>}
                    
                    {expandState[item.id]?.loading && <LoadingSpinner />}
                    {expandState[item.id]?.result && (
                        <div className="sub-result expanded-content" style={{ marginTop: '10px', padding: '12px', backgroundColor: '#f9fbe7', borderRadius: '6px', borderLeft: '4px solid #c0ca33' }}>
                            <strong style={{ display: 'block', marginBottom: '8px', color: '#558b2f' }}>Ilustração Ampliada:</strong>
                            {expandState[item.id].result.split('\n').filter(p => p.trim()).map((p, i) => <p key={i} style={{ marginBottom: '8px' }}>{p}</p>)}

                        </div>
                    )}
                </div>
            ))}
            {illustrations.length > 0 && (
                <div className="more-buttons">
                    <button onClick={() => handleSearch('notícias', null, true)} disabled={loading}>+ Notícias</button>
                    <button onClick={() => handleSearch('estudos', null, true)} disabled={loading}>+ Estudos</button>
                    <button onClick={() => handleSearch('histórias', null, true)} disabled={loading}>+ Histórias</button>
                    <button onClick={() => handleSearch('literatura', null, true)} disabled={loading}>+ Literatura</button>
                    <button onClick={() => handleSearch('arte', null, true)} disabled={loading}>+ Arte</button>
                </div>
            )}
        </div>
    );
};








// Helper: flat list of all books
const ALL_BOOKS = Object.values(NAA_BOOKS).flat();




// --- Main App Component ---



const LeftSidebar = ({ selectedBook, setSelectedBook, selectedChapter, setSelectedChapter, selectedVerse, setSelectedVerse }) => {
    const allBooks: any[] = Object.values(BIBLIA_STRUCTURE).flatMap((t: any) => t.col1.concat(t.col2 || []).filter(Boolean));
    const [searchTerm, setSearchTerm] = useState('');

    const parseBibleReference = useCallback((input: string) => {
        if (!input || !input.trim()) return null;
        const trimmed = input.trim();
        
        // Match format: [Book Name/Abbr] [Chapter] [Separator] [Verse]
        // Examples: "Salmo 1:1", "Salmo 1 1", "Salmo 1.1", "1 João 3:16", "1Jo 3.16", "Gen 1"
        const match = trimmed.match(/^((?:\d\s*)?[a-zA-ZÀ-ÿ\s]+?)\s*(\d+)?(?:[\s:.]+(\d+))?\s*$/);
        if (!match) return null;

        const rawBookStr = match[1]?.trim();
        const chapterStr = match[2];
        const verseStr = match[3];

        if (!rawBookStr) return null;

        const normalizeText = (str: string) => 
            str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "");

        const normBookStr = normalizeText(rawBookStr);

        // 1. Try exact or map match
        let matchedBook = allBooks.find(b => {
            const normName = normalizeText(b.name);
            const normMap = b.map ? normalizeText(b.map) : '';
            return normName === normBookStr || normMap === normBookStr;
        });

        // 2. Try prefix / singular-plural match
        if (!matchedBook) {
            matchedBook = allBooks.find(b => {
                const normName = normalizeText(b.name);
                const normMap = b.map ? normalizeText(b.map) : '';
                return normName.startsWith(normBookStr) || normBookStr.startsWith(normName) ||
                       (normMap && (normMap.startsWith(normBookStr) || normBookStr.startsWith(normMap)));
            });
        }

        if (!matchedBook) return null;

        let chapter = chapterStr ? parseInt(chapterStr, 10) : null;
        if (chapter !== null && (isNaN(chapter) || chapter < 1 || chapter > matchedBook.chapters)) {
            chapter = null;
        }

        let verse = verseStr ? parseInt(verseStr, 10) : null;
        if (chapter !== null && verse !== null) {
            const maxVerses = matchedBook.verses ? matchedBook.verses[chapter - 1] : 200;
            if (isNaN(verse) || verse < 1 || verse > maxVerses) {
                verse = null;
            }
        } else {
            verse = null;
        }

        return { book: matchedBook, chapter, verse };
    }, [allBooks]);

    const handleExecuteSearch = useCallback(() => {
        const parsed = parseBibleReference(searchTerm);
        if (parsed && parsed.book) {
            setSelectedBook(parsed.book);
            setSelectedChapter(parsed.chapter);
            setSelectedVerse(parsed.verse);
        }
    }, [searchTerm, parseBibleReference, setSelectedBook, setSelectedChapter, setSelectedVerse]);

    const bookSearchQuery = searchTerm.replace(/[\d:.\s]+$/, '').trim();
    const filteredBooks = bookSearchQuery ? allBooks.filter(b => {
        const normName = b.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const normQuery = bookSearchQuery.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return normName.includes(normQuery);
    }) : allBooks;

    const handleSelectBook = (book) => {
        setSelectedBook(book);
        setSelectedChapter(null);
        setSelectedVerse(null);
    };

    return (
        <>
            <div style={{ padding: '0.2rem' }}>
                <div style={{ position: 'relative', width: '100%', marginBottom: '0.5rem' }}>
                    <input 
                        type="text" 
                        placeholder="Busca ex: Salmo 1:1, Salmo 1.1, Gn 1" 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleExecuteSearch();
                            }
                        }}
                        style={{ width: '100%', padding: '0.5rem 36px 0.5rem 0.75rem', borderRadius: '4px', border: '1px solid #ccc', fontSize: '0.85rem' }}
                    />
                    <span
                        onClick={handleExecuteSearch}
                        title="Buscar referência"
                        style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', userSelect: 'none', color: '#616161' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                    </span>
                </div>
            </div>
            <div className="selection-box">
                <h3>LIVRO</h3>
                <div className="book-list">
                    {filteredBooks.map(book => (
                        <div 
                            key={book.name} 
                            className={`book-item ${selectedBook?.name === book.name ? 'active' : ''}`}
                            onClick={() => handleSelectBook(book)}
                        >
                            {book.name}
                        </div>
                    ))}
                </div>
            </div>
            <div className="selection-box">
                <h3>CAPÍTULO</h3>
                <div className="number-grid">
                    {selectedBook ? Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map(num => (
                        <div 
                            key={num}
                            className={`number-btn ${selectedChapter === num ? 'active' : ''}`}
                            onClick={() => { setSelectedChapter(num); setSelectedVerse(null); }}
                        >
                            {num}
                        </div>
                    )) : <div style={{ color: '#aaa', fontSize: '0.8rem', gridColumn: '1 / -1', textAlign: 'center', padding: '1rem 0' }}>Selecione um livro</div>}
                </div>
            </div>
            <div className="selection-box">
                <h3>VERSÍCULO</h3>
                <div className="number-grid" style={{ maxHeight: '210px' }}>
                    {selectedChapter && selectedBook && selectedBook.verses ? Array.from({ length: selectedBook.verses[selectedChapter - 1] }, (_, i) => i + 1).map(num => (
                        <div 
                            key={num}
                            className={`number-btn ${selectedVerse === num ? 'active' : ''}`}
                            onClick={() => setSelectedVerse(num)}
                        >
                            {num}
                        </div>
                    )) : <div style={{ color: '#aaa', fontSize: '0.8rem', gridColumn: '1 / -1', textAlign: 'center', padding: '1rem 0' }}>Selecione um capítulo</div>}
                </div>
            </div>
        </>
    );
};


const CenterContent = ({ selectedBook, selectedChapter, selectedVerse }) => {
    const [verses, setVerses] = useState([]);
    const [bhsWordsByVerse, setBhsWordsByVerse] = useState({});
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('Capítulo');
    const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
    
    // Commentaries State
    const [comentarios, setComentarios] = useState([]);
    const [loadingComentarios, setLoadingComentarios] = useState(false);
    const [selectedCommentaries, setSelectedCommentaries] = useState({ 'Todos': true });
    const [isRefsMenuOpen, setIsRefsMenuOpen] = useState(false);

    // Original Interlinear State
    const [originalVerses, setOriginalVerses] = useState([]);
    const [loadingOriginal, setLoadingOriginal] = useState(false);

    // Interlinear State for BHS
    const [selectedBhsWord, setSelectedBhsWord] = useState(null);

    // Strongs Dictionary State
    const [strongsData, setStrongsData] = useState([]);
    const [loadingStrongs, setLoadingStrongs] = useState(false);
    const [strongsSearch, setStrongsSearch] = useState('');
    const [strongsTypeFilter, setStrongsTypeFilter] = useState('ALL'); // 'ALL', 'H', 'G'
    const [strongsVisibleCount, setStrongsVisibleCount] = useState(50);

    // Fetch Strongs dictionary when Dicionário tab is activated, search query is set, or a BHS word is selected
    useEffect(() => {
        if ((activeTab === 'Dicionário' || strongsSearch || selectedBhsWord) && strongsData.length === 0 && !loadingStrongs) {
            setLoadingStrongs(true);
            fetch('/strongs.json')
                .then(res => res.json())
                .then(data => {
                    setStrongsData(data || []);
                    setLoadingStrongs(false);
                })
                .catch(e => {
                    console.error('Erro ao carregar dicionário Strong:', e);
                    setLoadingStrongs(false);
                });
        }
    }, [activeTab, strongsSearch, selectedBhsWord, strongsData.length, loadingStrongs]);

    const handleSelectStrongCode = useCallback((code: string) => {
        if (!code) return;
        const cleanCode = code.trim();
        setStrongsSearch(cleanCode);
        setStrongsVisibleCount(50);
        setActiveTab('Dicionário');
    }, []);

    const filteredStrongsList = useMemo(() => {
        if (!strongsData || strongsData.length === 0) return [];
        let items = strongsData;
        
        if (strongsTypeFilter === 'H') {
            items = items.filter((i: any) => i.number && i.number.startsWith('H'));
        } else if (strongsTypeFilter === 'G') {
            items = items.filter((i: any) => i.number && i.number.startsWith('G'));
        }

        if (!strongsSearch || !strongsSearch.trim()) {
            return items;
        }

        const query = strongsSearch.trim();
        const upperQuery = query.toUpperCase();
        const lowerQuery = query.toLowerCase();
        const normQuery = upperQuery.replace(/^([HG])0+/, '$1');

        const matches = items.filter((item: any) => {
            if (!item) return false;
            const itemCode = (item.number || '').toUpperCase();
            const normItemCode = itemCode.replace(/^([HG])0+/, '$1');

            if (normItemCode === normQuery || itemCode === upperQuery) return true;
            if (itemCode.toLowerCase().includes(lowerQuery)) return true;
            if (item.lemma && item.lemma.includes(query)) return true;
            if (item.xlit && item.xlit.toLowerCase().includes(lowerQuery)) return true;
            if (item.description && item.description.toLowerCase().includes(lowerQuery)) return true;
            if (item.pronounce && item.pronounce.toLowerCase().includes(lowerQuery)) return true;
            return false;
        });

        return matches.sort((a: any, b: any) => {
            const codeA = (a.number || '').toUpperCase();
            const codeB = (b.number || '').toUpperCase();
            const normA = codeA.replace(/^([HG])0+/, '$1');
            const normB = codeB.replace(/^([HG])0+/, '$1');

            const exactA = normA === normQuery || codeA === upperQuery;
            const exactB = normB === normQuery || codeB === upperQuery;

            if (exactA && !exactB) return -1;
            if (!exactA && exactB) return 1;

            const startsA = normA.startsWith(normQuery) || codeA.startsWith(upperQuery);
            const startsB = normB.startsWith(normQuery) || codeB.startsWith(upperQuery);

            if (startsA && !startsB) return -1;
            if (!startsA && startsB) return 1;

            return 0;
        });
    }, [strongsData, strongsSearch, strongsTypeFilter]);

    const visibleStrongsList = useMemo(() => {
        return filteredStrongsList.slice(0, strongsVisibleCount);
    }, [filteredStrongsList, strongsVisibleCount]);

    // Deep Analysis State for NAA
    const [selectedVerseWordIndex, setSelectedVerseWordIndex] = useState(null); // format: "verseNum-wordIndex"
    const [verseWordDeepAnalysis, setVerseWordDeepAnalysis] = useState({});
    const [deepAnalysisModalOpen, setDeepAnalysisModalOpen] = useState(false);
    const [currentDeepAnalysis, setCurrentDeepAnalysis] = useState(null);


    const externalRefChapter = (selectedBook && selectedChapter) ? `${selectedBook.map || selectedBook.name} ${selectedChapter}` : '';
    const externalRefVerse = (selectedBook && selectedChapter && selectedVerse) ? `${selectedBook.map || selectedBook.name} ${selectedChapter}:${selectedVerse}` : '';
    
    // Reset selections on ref change
    useEffect(() => {
        setSelectedVerseWordIndex(null);
        setVerseWordDeepAnalysis({});
        setDeepAnalysisModalOpen(false);
        setCurrentDeepAnalysis(null);
        setSelectedBhsWord(null);
    }, [externalRefChapter, externalRefVerse]);

    useEffect(() => {
        if (!externalRefChapter) {
            setVerses([]);
            setBhsWordsByVerse({});
            return;
        }
        
        const fetchContent = async () => {
            setLoading(true);
            try {
                // Fetch NAA Text
                const text = await getBibleTextFromRef(externalRefVerse || externalRefChapter);
                const versesArray = [];
                if (text && !text.startsWith("Capítulo não encontrado")) {
                    // Extract verses
                    const lines = text.split(/\r?\n/).filter(l => l.trim());
                    for (const line of lines) {
                        const match = line.trim().match(/^\*\*(\d+)\*\*\s*(.*)$/);
                        if (match) {
                            versesArray.push({ num: parseInt(match[1], 10), text: match[2] });
                        } else if (versesArray.length === 0 && line.trim()) {
                            // Single verse without number, assume 1 or selectedVerse
                            versesArray.push({ num: selectedVerse || 1, text: line.trim() });
                        }
                    }
                }
                setVerses(versesArray);

                // Fetch BHS Text for the chapter
                const match = externalRefChapter.match(/^(.+?)\s+(\d+)/);
                if (match) {
                    const bookName = match[1].trim();
                    const chapterNum = parseInt(match[2], 10);
                    const bookIdx = getHebrewBookIndex(bookName);
                    if (bookIdx !== -1) {
                        const response = await fetch(`/api/hebrew-bible?book=${bookIdx + 1}&chapter=${chapterNum}`);
                        if (response.ok) {
                            const json = await response.json();
                            const words = json.data || [];
                            const map = {};
                            words.forEach(w => {
                                if (!map[w.verse]) map[w.verse] = [];
                                map[w.verse].push(w);
                            });
                            // If user selected a specific verse, filter the map to only contain that verse
                            if (selectedVerse) {
                                setBhsWordsByVerse({ [selectedVerse]: map[selectedVerse] || [] });
                            } else {
                                setBhsWordsByVerse(map);
                            }
                        } else {
                            setBhsWordsByVerse({});
                        }
                    } else {
                         setBhsWordsByVerse({});
                    }
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetchContent();
    }, [externalRefChapter, externalRefVerse]);

    // Handle Commentaries Tab activation
    useEffect(() => {
        if (activeTab === 'Comentários' && externalRefChapter) {
            const fetchComments = async () => {
                setLoadingComentarios(true);
                try {
                    const targetRefForDb = (selectedBook && selectedChapter) ? `${selectedBook.name} ${selectedChapter}${selectedVerse ? ':'+selectedVerse : ''}` : (externalRefVerse || externalRefChapter);
                    const res = await fetchCommentaries(targetRefForDb);
                    setComentarios(res);
                    // Reset checkboxes
                    setSelectedCommentaries({ 'Todos': true });
                } catch (e) {
                    console.error('Erro ao buscar comentários', e);
                } finally {
                    setLoadingComentarios(false);
                }
            };
            fetchComments();
        }
    }, [activeTab, externalRefChapter, externalRefVerse]);

    // Handle Original Tab activation
    useEffect(() => {
        if (activeTab === 'Original' && externalRefChapter) {
            const fetchOriginal = async () => {
                setLoadingOriginal(true);
                try {
                    const bookName = selectedBook.name;
                    const match = externalRefChapter.match(/^(.+?)\s+(\d+)/);
                    if (match && match[2]) {
                        const ch = match[2];
                        const { data, error } = await supabase
                            .from('verses')
                            .select('*')
                            .eq('book', `Original_${bookName}`)
                            .eq('chapter', ch)
                            .order('verse', { ascending: true });
                        if (data) {
                            setOriginalVerses(data);
                        }
                    }
                } catch (e) {
                    console.error('Erro ao buscar versão Original', e);
                } finally {
                    setLoadingOriginal(false);
                }
            };
            fetchOriginal();
        }
    }, [activeTab, externalRefChapter, selectedBook]);

    const handleCommentaryCheck = (author) => {
        if (author === 'Todos') {
            setSelectedCommentaries({ 'Todos': true });
        } else {
            setSelectedCommentaries(prev => {
                const next = { ...prev, [author]: !prev[author] };
                if (next['Todos']) next['Todos'] = false;
                // Se tudo desmarcado, marca Todos automaticamente? (Opção de design)
                const anyChecked = Object.keys(next).some(k => k !== 'Todos' && next[k]);
                if (!anyChecked) next['Todos'] = true;
                return next;
            });
        }
    };

    const handleVerseWordDeepAnalysis = async (verseNum, wordIndex, wordText) => {
        setSelectedVerseWordIndex(null);
        const cleanWord = wordText.replace(/[.,;!?()]/g, '').trim();
        const targetRef = `${selectedBook.map || selectedBook.name} ${selectedChapter}:${verseNum}`;
        
        setDeepAnalysisModalOpen(true);
        setCurrentDeepAnalysis({ loading: true, word: cleanWord });

        try {
            const prompt = `Faça uma análise profunda da palavra "${cleanWord}" no contexto do versículo ${targetRef}. 
Siga estritamente estes 6 passos de análise. Retorne um JSON contendo a palavra original (em hebraico/aramaico/grego), sua transliteração, como ela aparece na tradução em português, e um array de objetos "passos", onde cada objeto representa um passo com "titulo" e "conteudo".
Passos obrigatórios:
A) Análise Morfológica (A Estrutura) - Foque na forma, estrutura e etiquetas gramaticais.
B) Análise Sintática (A Relação) - Como a palavra se conecta na frase, sujeito, predicado, etc.
C) Análise Semântica (O Significado) - Significado no contexto cultural, histórico e literário.
D) Análise Etimológica (A Origem) - Raiz da palavra e sua formação histórica.
E) Análise de Contexto Literário e Histórico - Cultura e gênero literário que a envolve.
F) Análise Teológica - Como se encaixa no plano geral da Bíblia e conexões doutrinárias.`;

            const responseText = await generateAIContent({
                prompt,
                isJson: true,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            palavraOriginal: { type: Type.STRING },
                            transliteracao: { type: Type.STRING },
                            palavraNoVersiculo: { type: Type.STRING },
                            passos: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        titulo: { type: Type.STRING },
                                        conteudo: { type: Type.STRING }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            const cleanJson = responseText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
            const parsed = JSON.parse(cleanJson);
            setCurrentDeepAnalysis({ loading: false, result: parsed, word: cleanWord });
        } catch (e) {
            setCurrentDeepAnalysis({ loading: false, error: formatGeminiError(e, 'Falha ao realizar análise profunda.'), word: cleanWord });
        }
    };

    const displayTitle = selectedBook ? `${selectedBook.name} ${selectedChapter || ''}${selectedVerse ? ':'+selectedVerse : ''}` : 'Selecione um texto bíblico no painel lateral';

    // Get active comments
    let activeCommentaries = comentarios.filter(c => selectedCommentaries['Todos'] || selectedCommentaries[c.author]);
    
    // Filtro por versículo (Exibe o versículo selecionado, ou todos os versos do capítulo se nenhum verso for selecionado)
    if (selectedVerse) {
        activeCommentaries = activeCommentaries.filter(c => String(c.verse) === String(selectedVerse));
    }
    
    const authors = Array.from(new Set(comentarios.map(c => c.author)));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem', position: 'relative' }}>
            
            <div className="reading-box" style={{ 
                flex: expandedBlock === 'reading' ? '1 1 100%' : '1 1 35%', 
                minHeight: '15vh', 
                overflowY: 'auto',
                position: expandedBlock === 'reading' ? 'absolute' : 'relative',
                top: expandedBlock === 'reading' ? 0 : 'auto',
                left: expandedBlock === 'reading' ? 0 : 'auto',
                right: expandedBlock === 'reading' ? 0 : 'auto',
                bottom: expandedBlock === 'reading' ? '20px' : 'auto',
                zIndex: expandedBlock === 'reading' ? 10 : 1,
                opacity: expandedBlock === 'analysis' ? 0.3 : 1 
            }}>
                <button 
                    onClick={() => setExpandedBlock(expandedBlock === 'reading' ? null : 'reading')}
                    style={{
                        position: 'absolute', top: '10px', right: '10px',
                        width: '32px', height: '32px', fontSize: '1.2rem', 
                        backgroundColor: 'transparent', color: '#616161', border: 'none', 
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 20
                    }}
                    title={expandedBlock === 'reading' ? "Restaurar" : "Expandir"}
                >
                    {expandedBlock === 'reading' ? '–' : '☐'}
                </button>
                {loading ? <LoadingSpinner /> : (
                    verses.length === 0 ? <div style={{color: '#666'}}>Texto não encontrado.</div> :
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {verses.map(v => (
                            <div key={v.num} style={{ borderBottom: '1px dashed #e1eaf5', paddingBottom: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {/* NAA Text */}
                                <p style={{ margin: 0, fontSize: '16px', lineHeight: '1.7', textAlign: 'left' }}>
                                    <strong>{v.num} </strong>
                                    {parseBold(v.text)}
                                </p>
                                
                                {/* BHS Text */}
                                {bhsWordsByVerse[v.num] && bhsWordsByVerse[v.num].length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '10px 6px', alignItems: 'center', direction: 'rtl', textAlign: 'right', backgroundColor: '#edf4fc', padding: '8px 12px', borderRadius: '8px', borderRight: '3px solid #2b569a' }}>
                                        {bhsWordsByVerse[v.num].map((word, idx) => (
                                            <span
                                                key={idx}
                                                onClick={() => setSelectedBhsWord(word)}
                                                title={word.gloss || ''}
                                                style={{
                                                    fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif",
                                                    fontSize: '1.75rem',
                                                    cursor: 'pointer',
                                                    padding: '2px 6px',
                                                    borderRadius: '6px',
                                                    backgroundColor: selectedBhsWord?.sort === word.sort ? '#fff' : 'transparent',
                                                    color: selectedBhsWord?.sort === word.sort ? '#0d47a1' : '#212121',
                                                    transition: 'all 0.15s ease',
                                                    borderBottom: selectedBhsWord?.sort === word.sort ? '3px solid #2b569a' : '3px solid transparent',
                                                    lineHeight: '2.4rem'
                                                }}
                                                onMouseOver={e => {
                                                    if (selectedBhsWord?.sort !== word.sort) {
                                                        e.currentTarget.style.backgroundColor = '#fff';
                                                        e.currentTarget.style.color = '#2b569a';
                                                    }
                                                }}
                                                onMouseOut={e => {
                                                    if (selectedBhsWord?.sort !== word.sort) {
                                                        e.currentTarget.style.backgroundColor = 'transparent';
                                                        e.currentTarget.style.color = '#212121';
                                                    }
                                                }}
                                                dangerouslySetInnerHTML={{ __html: word.word }}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
            
            <div className="analysis-box" style={{ 
                flex: expandedBlock === 'analysis' ? '1 1 100%' : '1 1 65%', 
                height: 'auto',
                position: expandedBlock === 'analysis' ? 'absolute' : 'relative',
                top: expandedBlock === 'analysis' ? 0 : 'auto',
                left: expandedBlock === 'analysis' ? 0 : 'auto',
                right: expandedBlock === 'analysis' ? 0 : 'auto',
                bottom: expandedBlock === 'analysis' ? 0 : 'auto',
                zIndex: expandedBlock === 'analysis' ? 10 : 1,
                opacity: expandedBlock === 'reading' ? 0.3 : 1
            }}>
                <div className="analysis-tabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex' }}>
                        <div className={`analysis-tab ${activeTab === 'Capítulo' ? 'active' : ''}`} onClick={() => setActiveTab('Capítulo')}>Capítulo</div>
                        <div className={`analysis-tab ${activeTab === 'Versículo' ? 'active' : ''}`} onClick={() => setActiveTab('Versículo')}>Versículo</div>
                        <div className={`analysis-tab ${activeTab === 'Comentários' ? 'active' : ''}`} onClick={() => setActiveTab('Comentários')}>Comentários</div>
                        <div className={`analysis-tab ${activeTab === 'Original' ? 'active' : ''}`} onClick={() => setActiveTab('Original')}>Original</div>
                        <div className={`analysis-tab ${activeTab === 'Dicionário' ? 'active' : ''}`} onClick={() => setActiveTab('Dicionário')}>Dicionário</div>
                    </div>
                    <div style={{ paddingRight: '10px', display: 'flex', alignItems: 'center' }}>
                        <button 
                            onClick={() => setExpandedBlock(expandedBlock === 'analysis' ? null : 'analysis')} 
                            style={{ 
                                width: '32px', height: '32px', fontSize: '1.2rem', 
                                backgroundColor: 'transparent', color: '#616161', border: 'none', 
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' 
                            }} 
                            title={expandedBlock === 'analysis' ? "Restaurar" : "Expandir"}
                        >
                            {expandedBlock === 'analysis' ? '–' : '☐'}
                        </button>
                    </div>
                </div>
                <div className="analysis-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    {activeTab === 'Capítulo' && (
                        externalRefChapter ? <div className="embedded-view"><CapituloView externalRef={externalRefChapter} /></div> : <div style={{ color: '#666', textAlign: 'center' }}>Selecione o capítulo.</div>
                    )}
                    {activeTab === 'Versículo' && (
                        selectedVerse ? (
                            <div className="embedded-view">
                                <VersiculoView externalRef={externalRefVerse} />
                            </div>
                        ) : <div style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>Selecione o versículo no painel esquerdo.</div>
                    )}
                    {activeTab === 'Comentários' && (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem' }}>
                            {loadingComentarios ? <LoadingSpinner /> : (
                                <>
                                    {comentarios.length === 0 ? (
                                        <div style={{ color: '#666', textAlign: 'center' }}>Nenhum comentário encontrado no banco de dados.</div>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', width: '100%', gap: '10px', alignItems: 'stretch' }}>
                                                {/* Box de Referência (30%) */}
                                                <div style={{ flex: '0 0 30%', backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '4px', padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', fontWeight: 'normal', color: 'inherit', fontSize: '0.9rem', boxSizing: 'border-box', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {selectedBook?.name} {selectedChapter}{selectedVerse ? `:${selectedVerse}` : ''}
                                                </div>
                                                
                                                {/* Menu Referências (70%) */}
                                                <div style={{ flex: '1', position: 'relative' }}>
                                                    <button 
                                                        onClick={() => setIsRefsMenuOpen(!isRefsMenuOpen)}
                                                        style={{ width: '100%', height: '100%', backgroundColor: '#f0f6ff', border: '1px solid #d0e2f7', borderRadius: '4px', padding: '0.5rem 0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', fontWeight: 'bold', color: '#0d47a1', fontSize: '0.9rem', boxSizing: 'border-box' }}
                                                    >
                                                        Referências <span>{isRefsMenuOpen ? '▲' : '▼'}</span>
                                                    </button>
                                                    
                                                    {isRefsMenuOpen && (
                                                        <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', backgroundColor: '#fff', border: '1px solid #d0e2f7', borderRadius: '8px', marginTop: '5px', boxShadow: '0 4px 8px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: '300px', overflowY: 'auto' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'bold', color: '#0d47a1', padding: '10px 15px', borderBottom: '1px solid #eee' }} onClick={(e) => e.stopPropagation()}>
                                                                <input type="checkbox" checked={!!selectedCommentaries['Todos']} onChange={() => handleCommentaryCheck('Todos')} />
                                                                Todos
                                                            </label>
                                                            {authors.map(author => (
                                                                <label key={author} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#333', padding: '10px 15px', borderBottom: '1px solid #eee' }} onClick={(e) => e.stopPropagation()}>
                                                                    <input type="checkbox" checked={!!selectedCommentaries[author]} onChange={() => handleCommentaryCheck(author)} />
                                                                    {author}
                                                                </label>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ overflowY: 'auto', flexGrow: 1, paddingRight: '5px' }}>
                                                {activeCommentaries.map(c => (
                                                    <div key={c.id || Math.random()} style={{ marginBottom: '1rem', padding: '15px', backgroundColor: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>
                                                            <span style={{ fontSize: '1.2rem' }}>👤</span>
                                                            <strong style={{ color: '#0d47a1', fontSize: '1.05rem' }}>{c.author}</strong>
                                                            {c.verse && <span style={{ backgroundColor: '#e3f2fd', color: '#1565c0', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>v. {c.verse}</span>}
                                                        </div>
                                                        <div style={{ color: '#424242', lineHeight: '1.6' }}>
                                                            {c.text.split(/\r?\n/).map((p, i) => (
                                                                <p key={i} style={{ marginBottom: '8px' }}>{parseBold(p)}</p>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    {activeTab === 'Original' && (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem', overflowY: 'auto', paddingRight: '5px' }}>
                            {loadingOriginal ? <LoadingSpinner /> : (
                                <>
                                    {originalVerses.length === 0 ? (
                                        <div style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>Texto Original não encontrado para este capítulo.</div>
                                    ) : (
                                        <div className="original-version-container">
                                            {(selectedVerse ? originalVerses.filter(v => String(v.verse) === String(selectedVerse)) : originalVerses).map(v => {
                                                let words = [];
                                                try { words = JSON.parse(v.text); } catch(e) {}
                                                return (
                                                    <div key={v.verse} className="original-verse-block">
                                                        <h4 className="original-verse-num">{selectedBook?.name} {selectedChapter}:{v.verse}</h4>
                                                        <div className="original-table-wrapper">
                                                            <table className="original-interlinear-table">
                                                                <thead>
                                                                    <tr>
                                                                        <th>Strong's</th>
                                                                        <th>Original</th>
                                                                        <th>Inglês</th>
                                                                        <th>Morfologia</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {words.map((w, idx) => (
                                                                        <tr key={idx}>
                                                                            <td 
                                                                                className="strongs-col" 
                                                                                style={{ cursor: 'pointer', textDecoration: 'underline', fontWeight: 'bold' }}
                                                                                onClick={() => handleSelectStrongCode(w.strongs)}
                                                                                title={`Ver ${w.strongs} no Dicionário Strong`}
                                                                            >
                                                                                {w.strongs}
                                                                            </td>
                                                                            <td className="original-col">
                                                                                <div className="orig-text">{w.original}</div>
                                                                                <div className="translit-text">{w.translit}</div>
                                                                            </td>
                                                                            <td className="english-col">{w.english}</td>
                                                                            <td className="morph-col">{w.morphology}</td>
                                                                         </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    {activeTab === 'Dicionário' && (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1rem', overflowY: 'auto', paddingRight: '5px' }}>
                            {loadingStrongs ? <LoadingSpinner /> : (
                                <div className="original-version-container">
                                    <div className="original-verse-block">
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                                            <h4 className="original-verse-num" style={{ margin: 0, borderBottom: 'none' }}>
                                                📖 Dicionário Strong ({filteredStrongsList.length} verbetes)
                                            </h4>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button 
                                                    onClick={() => { setStrongsTypeFilter('ALL'); setStrongsVisibleCount(50); }}
                                                    style={{ 
                                                        backgroundColor: strongsTypeFilter === 'ALL' ? '#0d47a1' : '#f0f4f9', 
                                                        color: strongsTypeFilter === 'ALL' ? '#fff' : '#0d47a1',
                                                        border: '1px solid #d0e2f7',
                                                        borderRadius: '4px',
                                                        padding: '4px 10px',
                                                        fontSize: '0.8rem',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Todos
                                                </button>
                                                <button 
                                                    onClick={() => { setStrongsTypeFilter('H'); setStrongsVisibleCount(50); }}
                                                    style={{ 
                                                        backgroundColor: strongsTypeFilter === 'H' ? '#d84315' : '#fbe9e7', 
                                                        color: strongsTypeFilter === 'H' ? '#fff' : '#d84315',
                                                        border: '1px solid #ffccbc',
                                                        borderRadius: '4px',
                                                        padding: '4px 10px',
                                                        fontSize: '0.8rem',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Hebraico (H)
                                                </button>
                                                <button 
                                                    onClick={() => { setStrongsTypeFilter('G'); setStrongsVisibleCount(50); }}
                                                    style={{ 
                                                        backgroundColor: strongsTypeFilter === 'G' ? '#00695c' : '#e0f2f1', 
                                                        color: strongsTypeFilter === 'G' ? '#fff' : '#00695c',
                                                        border: '1px solid #b2dfdb',
                                                        borderRadius: '4px',
                                                        padding: '4px 10px',
                                                        fontSize: '0.8rem',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    Grego (G)
                                                </button>
                                            </div>
                                        </div>

                                        <div style={{ position: 'relative', marginBottom: '15px' }}>
                                            <input 
                                                type="text" 
                                                placeholder="Digite o código Strong (ex: H1, G25) ou palavra..." 
                                                value={strongsSearch}
                                                onChange={(e) => {
                                                    setStrongsSearch(e.target.value);
                                                    setStrongsVisibleCount(50);
                                                }}
                                                style={{
                                                    width: '100%',
                                                    padding: '10px 36px 10px 12px',
                                                    borderRadius: '6px',
                                                    border: '1px solid #ccc',
                                                    fontSize: '0.95rem'
                                                }}
                                            />
                                            {strongsSearch && (
                                                <button 
                                                    onClick={() => { setStrongsSearch(''); setStrongsVisibleCount(50); }}
                                                    style={{
                                                        position: 'absolute',
                                                        right: '8px',
                                                        top: '50%',
                                                        transform: 'translateY(-50%)',
                                                        background: 'transparent',
                                                        border: 'none',
                                                        color: '#888',
                                                        cursor: 'pointer',
                                                        fontSize: '1rem',
                                                        padding: '4px'
                                                    }}
                                                    title="Limpar busca"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>

                                        {filteredStrongsList.length === 0 ? (
                                            <div style={{ color: '#666', textAlign: 'center', padding: '2rem' }}>
                                                Nenhum verbete encontrado no Dicionário Strong para "{strongsSearch}".
                                            </div>
                                        ) : (
                                            <>
                                                <div className="original-table-wrapper">
                                                    <table className="original-interlinear-table">
                                                        <thead>
                                                            <tr>
                                                                <th style={{ width: '12%' }}>Strong</th>
                                                                <th style={{ width: '22%' }}>Original</th>
                                                                <th style={{ width: '22%' }}>Transliteração / Pronúncia</th>
                                                                <th style={{ width: '44%' }}>Descrição / Tradução</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {visibleStrongsList.map((item: any, idx: number) => {
                                                                const isMatch = strongsSearch && (
                                                                    item.number.toUpperCase() === strongsSearch.trim().toUpperCase() || 
                                                                    item.number.toUpperCase().replace(/^([HG])0+/, '$1') === strongsSearch.trim().toUpperCase().replace(/^([HG])0+/, '$1')
                                                                );
                                                                return (
                                                                    <tr key={item.number || idx} style={isMatch ? { backgroundColor: '#e3f2fd' } : {}}>
                                                                        <td className="strongs-col" style={{ fontWeight: 'bold' }}>
                                                                            <span style={{
                                                                                display: 'inline-block',
                                                                                padding: '2px 6px',
                                                                                borderRadius: '4px',
                                                                                backgroundColor: item.number.startsWith('H') ? '#fbe9e7' : '#e0f2f1',
                                                                                color: item.number.startsWith('H') ? '#d84315' : '#00695c'
                                                                            }}>
                                                                                {item.number}
                                                                            </span>
                                                                        </td>
                                                                        <td className="original-col">
                                                                            <div className="orig-text">{item.lemma}</div>
                                                                        </td>
                                                                        <td>
                                                                            <div className="translit-text" style={{ fontSize: '0.95rem', fontWeight: 500, color: '#333' }}>{item.xlit}</div>
                                                                            {item.pronounce && (
                                                                                <div style={{ fontSize: '0.8rem', color: '#777', fontStyle: 'italic' }}>
                                                                                    [{item.pronounce}]
                                                                                </div>
                                                                            )}
                                                                        </td>
                                                                        <td className="english-col" style={{ lineHeight: '1.5' }}>
                                                                            {item.description}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                                {filteredStrongsList.length > strongsVisibleCount && (
                                                    <div style={{ textAlign: 'center', marginTop: '15px' }}>
                                                        <button 
                                                            onClick={() => setStrongsVisibleCount(prev => prev + 100)}
                                                            style={{
                                                                backgroundColor: '#f0f6ff',
                                                                color: '#0d47a1',
                                                                border: '1px solid #d0e2f7',
                                                                padding: '8px 20px',
                                                                borderRadius: '6px',
                                                                cursor: 'pointer',
                                                                fontWeight: 'bold'
                                                            }}
                                                        >
                                                            Carregar mais ({strongsVisibleCount} de {filteredStrongsList.length})
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Modal de Análise Profunda NAA */}
            {deepAnalysisModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', 
                    justifyContent: 'center', alignItems: 'center', zIndex: 1200, padding: '20px'
                }}>
                    <div style={{
                        backgroundColor: '#ffffff', borderRadius: '12px',
                        padding: '24px', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)', position: 'relative',
                        maxWidth: '600px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #e3f2fd', paddingBottom: '10px' }}>
                            <h3 style={{ margin: 0, color: '#1565C0', fontSize: '1.3rem' }}>Análise Profunda: "{currentDeepAnalysis?.word}"</h3>
                            <button onClick={() => setDeepAnalysisModalOpen(false)} style={{ background: 'transparent', color: '#666', border: 'none', fontSize: '1.5rem', cursor: 'pointer', padding: 0 }}>✕</button>
                        </div>
                        <div style={{ overflowY: 'auto', flexGrow: 1, paddingRight: '10px' }}>
                            {currentDeepAnalysis?.loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><LoadingSpinner /></div>}
                            {currentDeepAnalysis?.error && <ErrorMessage message={currentDeepAnalysis.error} />}
                            {currentDeepAnalysis?.result && (
                                <div>
                                    <p style={{ margin: '0 0 15px 0', fontSize: '1.1rem', color: '#424242', backgroundColor: '#f5f5f5', padding: '10px', borderRadius: '6px' }}>
                                        <strong>{currentDeepAnalysis.result.palavraOriginal}</strong> ; {currentDeepAnalysis.result.transliteracao} - <em>{currentDeepAnalysis.result.palavraNoVersiculo}</em>
                                    </p>
                                    {currentDeepAnalysis.result.passos && currentDeepAnalysis.result.passos.map((passo, pIndex) => (
                                        <div key={pIndex} style={{ marginBottom: '15px' }}>
                                            <strong style={{ display: 'block', color: '#1565C0', marginBottom: '4px' }}>{passo.titulo}</strong>
                                            <p style={{ margin: 0, color: '#424242', lineHeight: '1.6' }}>{parseBold(passo.conteudo)}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Interlinear BHS */}
            {selectedBhsWord && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
                    justifyContent: 'center', alignItems: 'center', zIndex: 1100, padding: '20px'
                }}>
                    <div style={{
                        backgroundColor: '#ffffff', border: '2px solid #2b569a', borderRadius: '12px',
                        padding: '24px', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)', position: 'relative',
                        maxWidth: '400px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center'
                    }}>
                        <button
                            onClick={() => setSelectedBhsWord(null)}
                            style={{ position: 'absolute', top: '10px', right: '15px', background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#757575', padding: '4px' }}
                        >✕</button>
                        <div style={{ fontFamily: "'SBL BibLit', 'SBL Hebrew', 'Times New Roman', serif", fontSize: '3rem', color: '#0d47a1', marginBottom: '8px', lineHeight: '1.2' }} dangerouslySetInnerHTML={{ __html: selectedBhsWord.word }} />
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', backgroundColor: '#f5f5f5', padding: '16px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd', paddingBottom: '4px' }}>
                                <span style={{ color: '#616161', fontWeight: 'bold' }}>Transliteração:</span>
                                <span style={{ color: '#212121', fontStyle: 'italic' }}>{selectedBhsWord.translit}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd', paddingBottom: '4px' }}>
                                <span style={{ color: '#616161', fontWeight: 'bold' }}>Significado:</span>
                                <span style={{ color: '#212121', fontWeight: 600 }}>{selectedBhsWord.gloss}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #ddd', paddingBottom: '4px' }}>
                                <span style={{ color: '#616161', fontWeight: 'bold' }}>Strong:</span>
                                <span style={{ color: '#212121', fontWeight: 600 }}>{selectedBhsWord.strong}</span>
                            </div>
                            {(() => {
                                if (!selectedBhsWord.strong) return null;
                                const cleanCode = selectedBhsWord.strong.trim().replace(/^H0*/i, 'H');
                                const strongEntry = strongsData.find(s => s.number === cleanCode || s.number === selectedBhsWord.strong.trim());
                                if (!strongEntry || !strongEntry.description) return null;
                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'left', pt: '4px' }}>
                                        <span style={{ color: '#616161', fontWeight: 'bold', fontSize: '0.85rem' }}>Descrição / Tradução:</span>
                                        <span style={{ color: '#333333', fontSize: '0.9rem', lineHeight: '1.4' }}>{strongEntry.description}</span>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const RightSidebar = ({ selectedBook, selectedChapter, selectedVerse }) => {
    const [activeTab, setActiveTab] = useState('Pensamentos');
    
    return (
        <div className="selection-box" style={{ height: '100%', padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="analysis-tabs">
                <div style={{ flex: 1, textAlign: 'center' }} className={`analysis-tab ${activeTab === 'Pensamentos' ? 'active' : ''}`} onClick={() => setActiveTab('Pensamentos')}>Pensamentos</div>
                <div style={{ flex: 1, textAlign: 'center' }} className={`analysis-tab ${activeTab === 'Ilustrações' ? 'active' : ''}`} onClick={() => setActiveTab('Ilustrações')}>Ilustrações</div>
            </div>
            <div style={{ padding: '0', flex: 1, minHeight: 0, overflowY: 'auto' }} className="embedded-view">
                {activeTab === 'Pensamentos' && <PensamentosView />}
                {activeTab === 'Ilustrações' && <IlustracoesView />}
            </div>
        </div>
    );
};

const App = () => {
    const [selectedBook, setSelectedBook] = useState(() => {
        const stored = localStorage.getItem('selectedBook');
        return stored ? JSON.parse(stored) : { name: "Salmos", map: "Sl", chapters: 150 };
    });
    const [selectedChapter, setSelectedChapter] = useState(() => {
        const stored = localStorage.getItem('selectedChapter');
        return stored ? JSON.parse(stored) : 23;
    });
    const [selectedVerse, setSelectedVerse] = useState(() => {
        const stored = localStorage.getItem('selectedVerse');
        return stored ? JSON.parse(stored) : 1;
    });

    useEffect(() => {
        if (selectedBook) localStorage.setItem('selectedBook', JSON.stringify(selectedBook));
        if (selectedChapter) localStorage.setItem('selectedChapter', JSON.stringify(selectedChapter));
        if (selectedVerse) localStorage.setItem('selectedVerse', JSON.stringify(selectedVerse));
    }, [selectedBook, selectedChapter, selectedVerse]);

    const [provider, setProvider] = useState(() => localStorage.getItem('ai_provider') || 'gemini');
    const [ollamaModel, setOllamaModel] = useState(() => localStorage.getItem('ollama_model') || 'qwen2.5:14b');
    const [ollamaUrl, setOllamaUrl] = useState(() => localStorage.getItem('ollama_url') || 'http://localhost:11434');
    const [showSettings, setShowSettings] = useState(false);

    const handleProviderChange = (val) => {
        if (val === 'ollama') {
            if (!window.confirm('Você selecionou Ollama. Certifique-se de que ele está rodando localmente. Deseja continuar?')) {
                return;
            }
        }
        setProvider(val);
        localStorage.setItem('ai_provider', val);
    };

    const handleModelChange = (val) => {
        setOllamaModel(val);
        localStorage.setItem('ollama_model', val);
    };

    const handleUrlChange = (val) => {
        setOllamaUrl(val);
        localStorage.setItem('ollama_url', val);
    };

    const [rightSidebarMode, setRightSidebarMode] = useState<'normal' | 'collapsed-right' | 'expanded-left'>(() => {
        const saved = localStorage.getItem('rightSidebarMode');
        if (saved === 'normal' || saved === 'collapsed-right' || saved === 'expanded-left') {
            return saved as 'normal' | 'collapsed-right' | 'expanded-left';
        }
        if (localStorage.getItem('rightSidebarCollapsed') === 'true') {
            return 'collapsed-right';
        }
        return 'normal';
    });

    useEffect(() => {
        localStorage.setItem('rightSidebarMode', rightSidebarMode);
        localStorage.setItem('rightSidebarCollapsed', String(rightSidebarMode === 'collapsed-right'));
    }, [rightSidebarMode]);

    const isRightSidebarCollapsed = rightSidebarMode === 'collapsed-right';

    return (
        <div className="app-container">
            
            <header style={{ 
                gridTemplateColumns: rightSidebarMode === 'collapsed-right' 
                    ? '260px 1fr auto' 
                    : rightSidebarMode === 'expanded-left' 
                        ? '260px 1fr auto' 
                        : '260px 1fr 532px',
                transition: 'grid-template-columns 0.3s ease'
            }}>
                <div>
                    <h1>Redator Bíblia</h1>
                </div>
                <div>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0 }}>
                        {selectedBook ? `${selectedBook.name} ${selectedChapter || ''}${selectedVerse ? ':'+selectedVerse : ''}` : ''}
                    </h2>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <a
                        href={typeof window !== 'undefined' ? `http://${window.location.hostname || 'localhost'}:3001` : 'http://localhost:3001'}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            backgroundColor: '#e3f2fd',
                            border: '1px solid #90caf9',
                            color: '#0d47a1',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            textDecoration: 'none',
                            gap: '6px',
                            transition: 'background-color 0.2s'
                        }}
                    >
                        🌐 Abrir Tradutor
                    </a>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        style={{
                            backgroundColor: '#f5f5f5',
                            border: '1px solid #e0e0e0',
                            color: '#333',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            transition: 'background-color 0.2s'
                        }}
                    >
                        ⚙️ Provedor: {provider === 'gemini' ? 'Gemini (Nuvem)' : provider === 'supabase' ? 'Supabase (Sem IA)' : `Ollama (${ollamaModel})`}
                    </button>
                </div>
            </header>


            {showSettings && (
                <div style={{ backgroundColor: '#e3f2fd', borderBottom: '1px solid #bbdefb', padding: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '160px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <label style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#0d47a1' }}>PROVEDOR DE IA:</label>
                            {provider === 'ollama' && <OllamaStartButton />}
                        </div>
                        <select value={provider} onChange={(e) => handleProviderChange(e.target.value)} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #90caf9', fontSize: '0.9rem', backgroundColor: 'white', cursor: 'pointer' }}>
                            <option value="gemini">Gemini (Nuvem)</option>
                            <option value="ollama">Ollama (Local)</option>
                            <option value="supabase">Supabase (Sem IA)</option>
                        </select>
                    </div>
                    {provider === 'ollama' && (
                        <>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flexGrow: 1, minWidth: '180px' }}>
                                <label style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#0d47a1' }}>MODELO LOCAL (OLLAMA):</label>
                                <input type="text" value={ollamaModel} onChange={(e) => handleModelChange(e.target.value)} placeholder="Ex: qwen2.5:14b" style={{ padding: '8px', borderRadius: '4px', border: '1px solid #90caf9', fontSize: '0.9rem', backgroundColor: 'white' }} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flexGrow: 1, minWidth: '180px' }}>
                                <label style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#0d47a1' }}>ENDEREÇO DO SERVER:</label>
                                <input type="text" value={ollamaUrl} onChange={(e) => handleUrlChange(e.target.value)} placeholder="Ex: http://localhost:11434" style={{ padding: '8px', borderRadius: '4px', border: '1px solid #90caf9', fontSize: '0.9rem', backgroundColor: 'white' }} />
                            </div>
                        </>
                    )}
                </div>
            )}

            <main style={{ 
                gridTemplateColumns: rightSidebarMode === 'collapsed-right' 
                    ? '260px 1fr 32px' 
                    : rightSidebarMode === 'expanded-left' 
                        ? '260px 1fr' 
                        : '260px 1fr 532px',
                transition: 'grid-template-columns 0.3s ease'
            }}>
                <div className="sidebar-left">
                    <LeftSidebar 
                        selectedBook={selectedBook} setSelectedBook={setSelectedBook}
                        selectedChapter={selectedChapter} setSelectedChapter={setSelectedChapter}
                        selectedVerse={selectedVerse} setSelectedVerse={setSelectedVerse}
                    />
                </div>
                
                {rightSidebarMode !== 'expanded-left' && (
                    <div className="center-content">
                        <CenterContent 
                            selectedBook={selectedBook}
                            selectedChapter={selectedChapter}
                            selectedVerse={selectedVerse}
                        />
                    </div>
                )}
                
                <div className="sidebar-right" style={{ 
                    position: 'relative', 
                    padding: isRightSidebarCollapsed ? '0' : '0.75rem',
                    overflow: isRightSidebarCollapsed ? 'visible' : 'hidden',
                    transition: 'all 0.3s ease'
                }}>
                    <div style={{
                        position: 'absolute',
                        left: isRightSidebarCollapsed ? '50%' : '-15px',
                        top: '50%',
                        transform: isRightSidebarCollapsed ? 'translate(-50%, -50%)' : 'translateY(-50%)',
                        zIndex: 50,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        alignItems: 'center'
                    }}>
                        {rightSidebarMode === 'normal' ? (
                            <>
                                <button
                                    onClick={() => setRightSidebarMode('collapsed-right')}
                                    style={{
                                        width: '28px',
                                        height: '42px',
                                        backgroundColor: '#ffffff',
                                        border: '1px solid #c0d1e5',
                                        borderRadius: '6px 0 0 6px',
                                        boxShadow: '-2px 0 6px rgba(0, 0, 0, 0.12)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#0d47a1',
                                        fontSize: '0.9rem',
                                        fontWeight: 'bold',
                                        padding: 0,
                                        transition: 'all 0.2s ease'
                                    }}
                                    title="Recolher painel para a direita"
                                >
                                    ▶
                                </button>

                                <button
                                    onClick={() => setRightSidebarMode('expanded-left')}
                                    style={{
                                        width: '28px',
                                        height: '42px',
                                        backgroundColor: '#ffffff',
                                        border: '1px solid #c0d1e5',
                                        borderRadius: '6px 0 0 6px',
                                        boxShadow: '-2px 0 6px rgba(0, 0, 0, 0.12)',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#0d47a1',
                                        fontSize: '0.9rem',
                                        fontWeight: 'bold',
                                        padding: 0,
                                        transition: 'all 0.2s ease'
                                    }}
                                    title="Expandir painel sobre o bloco central"
                                >
                                    ◀
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => setRightSidebarMode('normal')}
                                style={{
                                    width: '28px',
                                    height: '48px',
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #c0d1e5',
                                    borderRadius: isRightSidebarCollapsed ? '6px' : '6px 0 0 6px',
                                    boxShadow: '-2px 0 6px rgba(0, 0, 0, 0.12)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#0d47a1',
                                    fontSize: '1rem',
                                    fontWeight: 'bold',
                                    padding: 0,
                                    transition: 'all 0.2s ease'
                                }}
                                title="Retornar ao tamanho original"
                            >
                                {rightSidebarMode === 'collapsed-right' ? '◀' : '▶'}
                            </button>
                        )}
                    </div>

                    {!isRightSidebarCollapsed && (
                        <RightSidebar 
                            selectedBook={selectedBook}
                            selectedChapter={selectedChapter}
                            selectedVerse={selectedVerse}
                        />
                    )}
                </div>
            </main>
        </div>
    );
};

// --- Render App ---
const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}









