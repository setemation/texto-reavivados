import React, { useState, useCallback, Fragment, useEffect } from 'react';
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
            .eq('chapter', chapter);
            
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

// --- Tab Content Components ---

// --- Helper Data for BÍBLIA ---
const BIBLIA_STRUCTURE = {
    "Antigo Testamento": {
        col1: [
            { name: "Gênesis", chapters: 50 },
            { name: "Êxodo", chapters: 40 },
            { name: "Levítico", chapters: 27 },
            { name: "Números", chapters: 36 },
            { name: "Deuteronômio", chapters: 34 },
            { name: "Josué", chapters: 24 },
            { name: "Juízes", chapters: 21 },
            { name: "Rute", chapters: 4 },
            { name: "1 Samuel", map: "1Samuel", chapters: 31 },
            { name: "2 Samuel", map: "2Samuel", chapters: 24 },
            { name: "1 Reis", map: "1Reis", chapters: 22 },
            { name: "2 Reis", map: "2Reis", chapters: 25 },
            { name: "1 Crônicas", map: "1Crônicas", chapters: 29 },
            { name: "2 Crônicas", map: "2Crônicas", chapters: 36 },
            { name: "Esdras", chapters: 10 },
            { name: "Neemias", chapters: 13 },
            { name: "Ester", chapters: 10 },
            { name: "Jó", chapters: 42 },
            { name: "Salmos", map: "Salmo", chapters: 150 },
            { name: "Provérbios", chapters: 31 }
        ],
        col2: [
            { name: "Eclesiastes", chapters: 12 },
            { name: "Cânticos", map: "Cântico", chapters: 8 },
            { name: "Isaías", chapters: 66 },
            { name: "Jeremias", chapters: 52 },
            { name: "Lamentações", chapters: 5 },
            { name: "Ezequiel", chapters: 48 },
            { name: "Daniel", chapters: 12 },
            { name: "Oséias", map: "Oseias", chapters: 14 },
            { name: "Joel", chapters: 3 },
            { name: "Amós", chapters: 9 },
            { name: "Obadias", chapters: 1 },
            { name: "Jonas", chapters: 4 },
            { name: "Miquéias", map: "Miqueias", chapters: 7 },
            { name: "Naum", chapters: 3 },
            { name: "Habacuque", chapters: 3 },
            { name: "Sofonias", chapters: 3 },
            { name: "Ageu", chapters: 2 },
            { name: "Zacarias", chapters: 14 },
            { name: "Malaquias", chapters: 4 }
        ]
    },
    "Novo Testamento": {
        col1: [
            { name: "Mateus", chapters: 28 },
            { name: "Marcos", chapters: 16 },
            { name: "Lucas", chapters: 24 },
            { name: "João", chapters: 21 },
            { name: "Atos", chapters: 28 },
            { name: "Romanos", chapters: 16 },
            { name: "1 Coríntios", map: "1Coríntios", chapters: 16 },
            { name: "2 Coríntios", map: "2Coríntios", chapters: 13 },
            { name: "Gálatas", chapters: 6 },
            { name: "Efésios", chapters: 6 },
            { name: "Filipenses", chapters: 4 },
            { name: "Colossenses", chapters: 4 },
            { name: "1 Tessalonicenses", map: "1Tessalonicenses", chapters: 5 },
            { name: "2 Tessalonicenses", map: "2Tessalonicenses", chapters: 3 }
        ],
        col2: [
            { name: "1 Timóteo", map: "1Timóteo", chapters: 6 },
            { name: "2 Timóteo", map: "2Timóteo", chapters: 4 },
            { name: "Tito", chapters: 3 },
            { name: "Filemom", chapters: 1 },
            { name: "Hebreus", chapters: 13 },
            { name: "Tiago", chapters: 5 },
            { name: "1 Pedro", map: "1Pedro", chapters: 5 },
            { name: "2 Pedro", map: "2Pedro", chapters: 3 },
            { name: "1 João", map: "1João", chapters: 5 },
            { name: "2 João", map: "2João", chapters: 1 },
            { name: "3 João", map: "3João", chapters: 1 },
            { name: "Judas", chapters: 1 },
            { name: "Apocalipse", chapters: 22 }
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

const CapituloView = ({ externalRef }) => {
    useEffect(() => { if (externalRef && externalRef !== ref) setRef(externalRef); }, [externalRef]);
    const [ref, setRef] = useState('');
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [fullTextModal, setFullTextModal] = useState({ show: false, text: '', title: '' });
    const [loadingText, setLoadingText] = useState(false);
    const [usedCommentaries, setUsedCommentaries] = useState<any[]>([]);

    const [bhsChapterWords, setBhsChapterWords] = useState<any[]>([]);
    const [selectedBhsWord, setSelectedBhsWord] = useState<any | null>(null);
    const [bhsAiAnalysis, setBhsAiAnalysis] = useState('');
    const [loadingBhsAi, setLoadingBhsAi] = useState(false);

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
                
                // Fetch BHS text as well
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

    const handleAnalyze = useCallback(async (more = false) => {
        if (!ref) return;
        if (!more) {
            window.dispatchEvent(new CustomEvent('reset-all'));
        }
        setLoading(true);
        setError('');
        setUsedCommentaries([]);

        // Preserve existing data when loading more themes
        const previousResult = more ? result : null;

        let existingTitles = '';
        if (more && result && result.temasImportantes) {
            existingTitles = `Os seguintes temas já foram abordados e NÃO devem ser repetidos: ${result.temasImportantes.map(t => t.titulo).join(', ')}. Gere 3 temas IMPORTANTES e TOTALMENTE NOVOS que ainda não foram abordados, com abordagens teológicas e focos completamente diferentes dos anteriores.`;
        }
        if (!more) setResult(null);

        try {
            const commentaries = await fetchCommentaries(ref);
            setUsedCommentaries(commentaries);

            const currentProvider = localStorage.getItem('ai_provider') || 'ollama';

            if (currentProvider === 'supabase') {
                const chapterText = await getBibleTextFromRef(ref);
                const temas = commentaries.length > 0
                    ? commentaries.map(c => ({
                        titulo: `Comentário de ${c.author}${c.verse ? ` (Versículo ${c.verse})` : ' (Capítulo)'}`,
                        explicacao: c.text,
                        versiculos: c.verse ? `${c.verse}` : 'Capítulo inteiro',
                        versiculosTexto: null
                    }))
                    : [{
                        titulo: `Capítulo ${ref} (Sem comentários cadastrados)`,
                        explicacao: 'Nenhum comentário cadastrado no Supabase para este capítulo. Use a aba Obras para anexar ou escanear comentários.',
                        versiculos: '—',
                        versiculosTexto: null
                    }];

                setResult({
                    sinteseCapitulo: chapterText && !chapterText.startsWith('Capítulo não encontrado')
                        ? `[Busca Direta Supabase - Sem IA]\n\nTexto Bíblico de ${ref}:\n${chapterText}`
                        : `[Busca Direta Supabase - Sem IA]\n\nForam encontrados ${commentaries.length} comentário(s) no banco de dados para ${ref}.`,
                    temasImportantes: previousResult ? [...previousResult.temasImportantes, ...temas] : temas
                });
                return;
            }

            let prompt = `IMPORTANTE: Responda SEMPRE em português brasileiro correto, com acentuação completa e grafia correta.\n\nFaça uma análise aprofundada do capítulo ${ref}. Forneça uma síntese do capítulo e identifique os 3 temas mais importantes com seus versículos chave. ${existingTitles}`;
            
            if (commentaries.length > 0) {
                prompt += `\n\nConsidere e incorpore ativamente em sua análise teológica as informações dos seguintes comentários históricos de apoio:\n`;
                commentaries.forEach(c => {
                    const verseInfo = c.verse ? ` (Versículo ${c.verse})` : '';
                    prompt += `- Comentário de ${c.author}${verseInfo}: "${c.text}"\n`;
                });
            }

            const responseText = await generateAIContent({
                prompt,
                isJson: true,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            sinteseCapitulo: { type: Type.STRING },
                            temasImportantes: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        titulo: { type: Type.STRING },
                                        explicacao: { type: Type.STRING },
                                        versiculos: { type: Type.STRING }
                                    },
                                    required: ['titulo', 'explicacao', 'versiculos']
                                }
                            }
                        },
                        required: ['sinteseCapitulo', 'temasImportantes']
                    }
                }
            });
            const jsonResult = JSON.parse(responseText);
            const newTemas = await Promise.all(jsonResult.temasImportantes.map(async (tema: { titulo: string; explicacao: string; versiculos: string }) => {
                const text = await getBibleTextFromRef(ref, tema.versiculos);
                return { ...tema, versiculosTexto: text };
            }));
            // If "more", append new themes to existing ones and keep existing sinteseCapitulo
            if (more && previousResult) {
                setResult({
                    sinteseCapitulo: previousResult.sinteseCapitulo,
                    temasImportantes: [...previousResult.temasImportantes, ...newTemas]
                });
            } else {
                setResult({ ...jsonResult, temasImportantes: newTemas });
            }
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao analisar o capítulo.'));
        } finally {
            setLoading(false);
        }
    }, [ref, result]);

    return (
        <div className="tab-content">
            
            <div className="form-group" style={{ position: 'relative', width: '100%', margin: '0 0 1rem 0', display: 'block' }}>
                <input 
                    type="text" 
                    value={ref} 
                    onChange={e => setRef(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && handleAnalyze()} 
                    placeholder="Ex: Gênesis 1" 
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
                        <h3>Síntese do Capítulo</h3>
                        {(result.sinteseCapitulo || '').split(/\n+/).filter(p => p.trim()).map((p, i) => (
                            <div key={i} style={{ marginBottom: '1rem' }}>
                                <p>{p}</p>
                            </div>
                        ))}
                    </div>
                    <h3>Temas Importantes</h3>
                    {(result.temasImportantes || []).map((tema, i) => (
                        <div className="card" key={i}>
                            <h4>{tema.titulo}</h4>
                            <p>{tema.explicacao}</p>
                            <p><strong>Versículos:</strong> {tema.versiculos}</p>
                            {tema.versiculosTexto && (
                                <blockquote style={{ fontStyle: 'italic', borderLeft: '4px solid #2196F3', paddingLeft: '1rem', margin: '0.5rem 0' }}>
                                    {parseBold(tema.versiculosTexto)}
                                </blockquote>
                            )}
                            <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', gap: '10px' }}>
                                <button onClick={() => window.dispatchEvent(new CustomEvent('analyze-verse', { detail: `${ref}:${tema.versiculos}` }))}>
                                    Análise do versículo
                                </button>
                            </div>
                        </div>
                    ))}
                    <div className="more-buttons" style={{ marginTop: '20px' }}>
                        <button onClick={() => handleAnalyze(true)} disabled={loading} className="full-width-button">
                            {loading ? 'Gerando Novos Temas...' : 'Novos Temas'}
                        </button>
                    </div>
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

const PensamentosView = ({ externalSearch }) => {
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

const IlustracoesView = ({ externalSearch }) => {
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
    const allBooks = Object.values(BIBLIA_STRUCTURE).flatMap(t => t.col1.concat(t.col2 || []).filter(Boolean));
    const [searchTerm, setSearchTerm] = useState('');
    const filteredBooks = searchTerm ? allBooks.filter(b => b.name.toLowerCase().includes(searchTerm.toLowerCase())) : allBooks;

    const handleSelectBook = (book) => {
        setSelectedBook(book);
        setSelectedChapter(null);
        setSelectedVerse(null);
    };

    return (
        <>
            <div style={{ padding: '0.2rem' }}>
                <input 
                    type="text" 
                    placeholder="Busca ex: Gen 1" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ marginBottom: '0.5rem', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', width: '100%' }}
                />
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
                <div className="number-grid">
                    {selectedChapter && selectedBook ? Array.from({ length: 50 }, (_, i) => i + 1).map(num => (
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

    // Deep Analysis State for NAA
    const [selectedVerseWordIndex, setSelectedVerseWordIndex] = useState(null); // format: "verseNum-wordIndex"
    const [verseWordDeepAnalysis, setVerseWordDeepAnalysis] = useState({});
    const [deepAnalysisModalOpen, setDeepAnalysisModalOpen] = useState(false);
    const [currentDeepAnalysis, setCurrentDeepAnalysis] = useState(null);

    // Interlinear State for BHS
    const [selectedBhsWord, setSelectedBhsWord] = useState(null);

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
    const activeCommentaries = comentarios.filter(c => selectedCommentaries['Todos'] || selectedCommentaries[c.author]);
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
                                    {v.text.split(/(\s+)/).map((part, index) => {
                                        if (!part.trim()) return <span key={index}>{part}</span>;
                                        const keyId = `${v.num}-${index}`;
                                        return (
                                            <span key={index} style={{ position: 'relative', display: 'inline-block' }}>
                                                <span
                                                    onClick={() => setSelectedVerseWordIndex(selectedVerseWordIndex === keyId ? null : keyId)}
                                                    style={{ 
                                                        cursor: 'pointer', 
                                                        padding: '2px', 
                                                        borderRadius: '3px',
                                                        backgroundColor: selectedVerseWordIndex === keyId ? '#e0f7fa' : 'transparent',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = selectedVerseWordIndex === keyId ? '#e0f7fa' : '#f5f5f5'}
                                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = selectedVerseWordIndex === keyId ? '#e0f7fa' : 'transparent'}
                                                >
                                                    {parseBold(part)}
                                                </span>
                                                {selectedVerseWordIndex === keyId && (
                                                    <div style={{
                                                        position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                                                        backgroundColor: 'white', border: '1px solid #ccc', boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                                                        borderRadius: '4px', padding: '8px', zIndex: 10, marginTop: '4px', whiteSpace: 'nowrap'
                                                    }}>
                                                        <button 
                                                            onClick={() => handleVerseWordDeepAnalysis(v.num, index, part)}
                                                            style={{ padding: '6px 12px', fontSize: '0.85rem', margin: 0, backgroundColor: '#1565C0', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            Análise Profunda
                                                        </button>
                                                    </div>
                                                )}
                                            </span>
                                        );
                                    })}
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
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', backgroundColor: '#f0f6ff', padding: '10px', borderRadius: '8px', border: '1px solid #d0e2f7' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 'bold', color: '#0d47a1' }}>
                                                    <input type="checkbox" checked={!!selectedCommentaries['Todos']} onChange={() => handleCommentaryCheck('Todos')} />
                                                    Todos
                                                </label>
                                                {authors.map(author => (
                                                    <label key={author} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', color: '#333' }}>
                                                        <input type="checkbox" checked={!!selectedCommentaries[author]} onChange={() => handleCommentaryCheck(author)} />
                                                        {author}
                                                    </label>
                                                ))}
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
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#616161', fontWeight: 'bold' }}>Strong:</span>
                                <a href={`https://biblehub.com/hebrew/${selectedBhsWord.strong.replace(/[^0-9]/g, '')}.htm`} target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2', textDecoration: 'underline' }}>{selectedBhsWord.strong}</a>
                            </div>
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
        <div className="selection-box" style={{ height: '100%', padding: 0, overflow: 'hidden' }}>
            <div className="analysis-tabs">
                <div style={{ flex: 1, textAlign: 'center' }} className={`analysis-tab ${activeTab === 'Pensamentos' ? 'active' : ''}`} onClick={() => setActiveTab('Pensamentos')}>Pensamentos</div>
                <div style={{ flex: 1, textAlign: 'center' }} className={`analysis-tab ${activeTab === 'Ilustrações' ? 'active' : ''}`} onClick={() => setActiveTab('Ilustrações')}>Ilustrações</div>
            </div>
            <div style={{ padding: '0', height: '100%', overflowY: 'auto' }} className="embedded-view">
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

    useEffect(() => { localStorage.setItem('ai_provider', provider); }, [provider]);
    useEffect(() => { localStorage.setItem('ollama_model', ollamaModel); }, [ollamaModel]);
    useEffect(() => { localStorage.setItem('ollama_url', ollamaUrl); }, [ollamaUrl]);

    return (
        <div className="app-container">
            
            <header>
                <div>
                    <h1>Redator Bíblia</h1>
                </div>
                <div>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0 }}>
                        {selectedBook ? `${selectedBook.name} ${selectedChapter || ''}${selectedVerse ? ':'+selectedVerse : ''}` : ''}
                    </h2>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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

            <main>
                <div className="sidebar-left">
                    <LeftSidebar 
                        selectedBook={selectedBook} setSelectedBook={setSelectedBook}
                        selectedChapter={selectedChapter} setSelectedChapter={setSelectedChapter}
                        selectedVerse={selectedVerse} setSelectedVerse={setSelectedVerse}
                    />
                </div>
                
                <div className="center-content">
                    <CenterContent 
                        selectedBook={selectedBook}
                        selectedChapter={selectedChapter}
                        selectedVerse={selectedVerse}
                    />
                </div>
                
                <div className="sidebar-right">
                    <RightSidebar 
                        selectedBook={selectedBook}
                        selectedChapter={selectedChapter}
                        selectedVerse={selectedVerse}
                    />
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









