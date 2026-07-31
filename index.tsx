import React, { useState, useCallback, Fragment, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";
import { supabase, isSupabaseConfigured } from './supabase';
import logoImg from './logo.jpg';

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

// --- API Wrapper ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const generateAIContent = async ({ prompt, isJson = false, config }: { prompt: string; isJson?: boolean; config?: any }): Promise<string> => {
    const provider = localStorage.getItem('ai_provider') || 'gemini';
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

const extractVersesFromRefLocal = (bibleText: string, ref: string, defaultVersesStr = '') => {
    const match = ref.match(/^(.+?)\s+(\d+):?(.*)$/);
    if (!match) return "Referência inválida.";

    let book = match[1].trim();
    book = book.replace(/^(\d)\s+/, '$1');
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

// --- Tab Content Components ---

// --- NAA Helper Data ---
const NAA_BOOKS = {
    "Antigo Testamento": [
        { name: "Gênesis", chapters: 50 }, { name: "Êxodo", chapters: 40 }, { name: "Levítico", chapters: 27 },
        { name: "Números", chapters: 36 }, { name: "Deuteronômio", chapters: 34 }, { name: "Josué", chapters: 24 },
        { name: "Juízes", chapters: 21 }, { name: "Rute", chapters: 4 }, { name: "1 Samuel", map: "1Samuel", chapters: 31 },
        { name: "2 Samuel", map: "2Samuel", chapters: 24 }, { name: "1 Reis", map: "1Reis", chapters: 22 },
        { name: "2 Reis", map: "2Reis", chapters: 25 }, { name: "1 Crônicas", map: "1Crônicas", chapters: 29 },
        { name: "2 Crônicas", map: "2Crônicas", chapters: 36 }, { name: "Esdras", chapters: 10 },
        { name: "Neemias", chapters: 13 }, { name: "Ester", chapters: 10 }, { name: "Jó", chapters: 42 },
        { name: "Salmos", map: "Salmo", chapters: 150 }, { name: "Provérbios", chapters: 31 },
        { name: "Eclesiastes", chapters: 12 }, { name: "Cântico dos Cânticos", map: "Cântico", chapters: 8 },
        { name: "Isaías", chapters: 66 }, { name: "Jeremias", chapters: 52 }, { name: "Lamentações", chapters: 5 },
        { name: "Ezequiel", chapters: 48 }, { name: "Daniel", chapters: 12 }, { name: "Oseias", chapters: 14 },
        { name: "Joel", chapters: 3 }, { name: "Amós", chapters: 9 }, { name: "Jonas", chapters: 4 },
        { name: "Miqueias", chapters: 7 }, { name: "Naum", chapters: 3 }, { name: "Habacuque", chapters: 3 },
        { name: "Sofonias", chapters: 3 }, { name: "Ageu", chapters: 2 }, { name: "Zacarias", chapters: 14 },
        { name: "Malaquias", chapters: 4 }
    ],
    "Novo Testamento": [
        { name: "Mateus", chapters: 28 }, { name: "Marcos", chapters: 16 }, { name: "Lucas", chapters: 24 },
        { name: "João", chapters: 21 }, { name: "Atos", chapters: 28 }, { name: "Romanos", chapters: 16 },
        { name: "1 Coríntios", map: "1Coríntios", chapters: 16 }, { name: "2 Coríntios", map: "2Coríntios", chapters: 13 },
        { name: "Gálatas", chapters: 6 }, { name: "Efésios", chapters: 6 }, { name: "Filipenses", chapters: 4 },
        { name: "Colossenses", chapters: 4 }, { name: "1 Tessalonicenses", map: "1Tessalonicenses", chapters: 5 },
        { name: "2 Tessalonicenses", map: "2Tessalonicenses", chapters: 3 }, { name: "1 Timóteo", map: "1Timóteo", chapters: 6 },
        { name: "2 Timóteo", map: "2Timóteo", chapters: 4 }, { name: "Tito", chapters: 3 },
        { name: "Hebreus", chapters: 13 }, { name: "Tiago", chapters: 5 }, { name: "1 Pedro", map: "1Pedro", chapters: 5 },
        { name: "2 Pedro", map: "2Pedro", chapters: 3 }, { name: "1 João", map: "1João", chapters: 5 },
        { name: "Apocalipse", chapters: 22 }
    ]
};

const NAAView = () => {
    const [selectedBook, setSelectedBook] = useState(null);
    const [selectedChapter, setSelectedChapter] = useState(null);
    const [fullText, setFullText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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
        
        try {
            const bookQueryName = selectedBook.map || selectedBook.name;
            const ref = `${bookQueryName} ${chapterNumber}`;
            const text = await getBibleTextFromRef(ref);
            if (text && !text.startsWith("Capítulo não encontrado") && !text.startsWith("Referência inválida")) {
                setFullText(text);
            } else {
                setError(text || 'Capítulo não encontrado.');
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

    return (
        <div className="tab-content">
            <h2>Navegação Bíblica (NAA)</h2>
            {error && <ErrorMessage message={error} />}
            
            {!selectedBook && (
                <div>
                    {Object.entries(NAA_BOOKS).map(([testament, books]) => (
                        <div key={testament} style={{ marginBottom: '20px' }}>
                            <h3 style={{ borderBottom: '2px solid #2196F3', paddingBottom: '5px' }}>{testament}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px', marginTop: '10px' }}>
                                {books.map(book => (
                                    <button 
                                        key={book.name} 
                                        onClick={() => handleSelectBook(book)}
                                        style={{ padding: '10px', fontSize: '14px' }}
                                    >
                                        {book.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedBook && !selectedChapter && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <h3>Livro: {selectedBook.name}</h3>
                        <button onClick={() => setSelectedBook(null)} style={{ backgroundColor: '#757575', padding: '5px 15px' }}>Voltar aos Livros</button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', gap: '10px' }}>
                        {Array.from({ length: selectedBook.chapters }, (_, i) => i + 1).map(chapterNum => (
                            <button 
                                key={chapterNum} 
                                onClick={() => handleSelectChapter(chapterNum)}
                                style={{ padding: '15px 5px', fontSize: '16px', fontWeight: 'bold' }}
                            >
                                {chapterNum}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {selectedBook && selectedChapter && (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <h3 style={{ margin: 0, color: '#002171' }}>{selectedBook.name} {selectedChapter}</h3>
                        <button onClick={() => { setSelectedChapter(null); setFullText(''); }} style={{ backgroundColor: '#757575', padding: '5px 15px' }}>Voltar aos Capítulos</button>
                    </div>
                    
                    {loading ? <LoadingSpinner /> : (
                        <div className="card" style={{ backgroundColor: '#ffffff', color: '#212121', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)' }}>
                            <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '16px', marginBottom: '20px' }}>
                                {fullText.split(/\r?\n/).map((line, i) => <p key={i} style={{ margin: '0 0 10px 0' }}>{parseBold(line)}</p>)}
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e0e0e0', paddingTop: '15px' }}>
                                <button 
                                    onClick={handlePrev} 
                                    disabled={selectedChapter <= 1}
                                    style={{ padding: '10px 20px', opacity: selectedChapter <= 1 ? 0.5 : 1 }}
                                >
                                    Anterior
                                </button>
                                <button 
                                    onClick={handleNext} 
                                    disabled={selectedChapter >= selectedBook.chapters}
                                    style={{ padding: '10px 20px', opacity: selectedChapter >= selectedBook.chapters ? 0.5 : 1 }}
                                >
                                    Próximo
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

const CapituloView = () => {
    const [ref, setRef] = useState('');
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [fullTextModal, setFullTextModal] = useState({ show: false, text: '', title: '' });
    const [loadingText, setLoadingText] = useState(false);

    const handleViewText = useCallback(async () => {
        if (!ref) return;
        setLoadingText(true);
        setError('');
        try {
            const text = await getBibleTextFromRef(ref);
            if (text && !text.startsWith("Capítulo não encontrado") && !text.startsWith("Referência inválida")) {
                setFullTextModal({ show: true, text: text, title: ref });
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

        let existingTitles = '';
        if (more && result && result.temasImportantes) {
            existingTitles = `Os seguintes temas já foram abordados e não devem ser repetidos: ${result.temasImportantes.map(t => t.titulo).join(', ')}. Gere temas IMPORTANTES e TOTALMENTE NOVOS que ainda não foram abordados, com abordagens teológicas e focos diferentes.`;
        }
        setResult(null);

        try {
            const prompt = `Faça uma análise aprofundada do capítulo ${ref}. Forneça uma síntese do capítulo e identifique os temas mais importantes com seus versículos chave. ${existingTitles}`;
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
            jsonResult.temasImportantes = await Promise.all(jsonResult.temasImportantes.map(async (tema: { titulo: string; explicacao: string; versiculos: string }) => {
                const text = await getBibleTextFromRef(ref, tema.versiculos);
                return { ...tema, versiculosTexto: text };
            }));
            setResult(jsonResult);
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao analisar o capítulo.'));
        } finally {
            setLoading(false);
        }
    }, [ref]);

    return (
        <div className="tab-content">
            <h2>Análise de Capítulo</h2>
            <div className="form-group">
                <input type="text" value={ref} onChange={e => setRef(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAnalyze()} placeholder="Ex: Gênesis 1" />
                <button onClick={handleAnalyze} disabled={loading}>{loading ? 'Analisando...' : 'Analisar'}</button>
                <button onClick={handleViewText} disabled={loadingText}>{loadingText ? 'Carregando...' : 'Ver Texto'}</button>
            </div>
            {loading && <LoadingSpinner />}
            {error && <ErrorMessage message={error} />}
            {result && (
                <div>
                    <div className="card">
                        <h3>Síntese do Capítulo</h3>
                        {(result.sinteseCapitulo || '').split(/\n+/).filter(p => p.trim()).map((p, i) => (
                            <div key={i} style={{ marginBottom: '1rem' }}>
                                <p>{p}</p>
                                <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px' }}>
                                    <button onClick={(e) => handleAddClick(e, 'add-construction-apresentacao', p)}>Adicionar na Construção</button>
                                </div>
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
                                <button onClick={(e) => handleAddClick(e, 'add-construction', `Título: ${tema.titulo}\nDescrição: ${tema.explicacao}\nVersículo(s): ${ref}:${tema.versiculos}${tema.versiculosTexto ? '\nTexto Bíblico:\n' + tema.versiculosTexto : ''}`)}>
                                    Adicionar na Construção
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
                        backgroundColor: '#ffffff', color: '#212121', padding: '20px', borderRadius: '8px',
                        width: '90%', maxWidth: '800px', maxHeight: '80vh', overflowY: 'auto',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #e0e0e0', paddingBottom: '10px' }}>
                            <h3 style={{ margin: 0, color: '#002171' }}>{fullTextModal.title}</h3>
                            <button onClick={() => setFullTextModal({ show: false, text: '', title: '' })} style={{ backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '4px', padding: '5px 10px', cursor: 'pointer', fontSize: '16px' }}>X</button>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.6', fontSize: '16px' }}>
                            {fullTextModal.text.split(/\r?\n/).map((line, i) => <p key={i} style={{ margin: '0 0 10px 0' }}>{parseBold(line)}</p>)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const VersiculoView = () => {
    const [ref, setRef] = useState('');
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [verseText, setVerseText] = useState('');
    const [deepAnalysisState, setDeepAnalysisState] = useState({});

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
            const analysisResult = JSON.parse(responseText);
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

        try {
            const vText = await getBibleTextFromRef(targetRef);
            if (vText && !vText.startsWith("Capítulo não encontrado") && !vText.startsWith("Referência inválida")) {
                setVerseText(vText);
            }
            const prompt = `Faça uma exegese detalhada de ${targetRef}. Siga estas instruções estritas para cada seção:

1. **Apresentação do Capítulo**: Escreva exatamente dois parágrafos apresentando o contexto geral do capítulo.
2. **Análise Histórico-Cultural**: Escreva exatamente quatro parágrafos com informações sobre o contexto da época (política, religião, sociedade, costumes, leis, práticas, cidades, etc.) relacionadas ao versículo. **Cada tema deve estar em um parágrafo separado por duas quebras de linha**.
3. **Análise Teológica**: Escreva exatamente quatro parágrafos destacando frases de peso teológico. Cada frase deve vir acompanhada de uma explicação sobre seu significado no capítulo, verdades reveladas (Deus, ser humano, pecado, salvação, missão) e como dialoga com a Bíblia de forma pastoral e simples. **Cada frase/parágrafo deve estar separado por duas quebras de linha**.
4. **Análise Linguística**: Identifique palavras-chave no original (Hebraico, Aramaico ou Grego).
5. **Aplicações**: Gere 4 parágrafos. Cada um sugerindo uma aplicação prática e concreta conectada ao versículo. As aplicações devem conter: Atitudes, decisões, mudanças de mentalidade; Encorajamento, consolo, exortação, esperança; Exemplos contemporâneos que ajudem a aplicar o texto na vida real. Apresentação: a primeira frase de cada aplicação (que resume a ideia principal) deve estar em negrito (ex: **Pratique o perdão diariamente.**). Pule uma linha entre cada parágrafo e não use a palavra literal "Frase resumo".

Responda em JSON com as chaves: apresentacaoCapitulo (string), analiseHistoricoCultural (string), analiseTeologica (string), aplicacoes (array de strings onde cada string é o texto do parágrafo de uma aplicação), analiseLinguistica (array de objetos com chaves: palavraOriginal, transliteracao, sentidoEnuances). Destaque termos importantes com ** no corpo dos textos.`;

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
                                        sentidoEnuances: { type: Type.STRING }
                                    },
                                    required: ['palavraOriginal', 'transliteracao', 'sentidoEnuances']
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
            <h2>Análise de Versículo</h2>
            <div className="form-group">
                <input type="text" value={ref} onChange={e => setRef(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAnalyze()} placeholder="Ex: João 3:16" />
                <button onClick={handleAnalyze} disabled={loading}>{loading ? 'Analisando...' : 'Analisar'}</button>
            </div>
            {verseText && (
                <div className="card" style={{ marginTop: '1rem', marginBottom: '1rem', backgroundColor: '#f9f9f9', borderLeft: '4px solid #4CAF50' }}>
                    <p style={{ fontStyle: 'italic' }}>{parseBold(verseText)}</p>
                </div>
            )}
            {loading && <LoadingSpinner />}
            {error && <ErrorMessage message={error} />}
            {result && (
                <div>
                    <div className="card">
                        <h3>Apresentação do Capítulo</h3>
                        {(result.apresentacaoCapitulo || '').split(/\n+/).filter(p => p.trim()).map((p, i, arr) => (
                            <div key={i} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: i < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                <p>{parseBold(p)}</p>
                                <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', borderTop: 'none', paddingTop: 0 }}>
                                    <button onClick={(e) => handleAddClick(e, 'add-construction-apresentacao', p)}>Adicionar na Construção</button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="card">
                        <h3>Análise Histórico-Cultural</h3>
                        {(result.analiseHistoricoCultural || '').split(/\n+/).filter(p => p.trim()).map((p, i, arr) => (
                            <div key={i} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: i < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                <p>{parseBold(p)}</p>
                                <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', borderTop: 'none', paddingTop: 0 }}>
                                    <button onClick={(e) => handleAddClick(e, 'add-construction-historica', p)}>Adicionar na Construção</button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="card">
                        <h3>Análise Linguística</h3>
                        {(result.analiseLinguistica || []).map((item, index, arr) => (
                            <div key={index} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: index < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                <p><strong>{item.palavraOriginal}</strong>; {item.transliteracao}</p>
                                <p>{item.sentidoEnuances}</p>
                                <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', borderTop: 'none', paddingTop: 0, gap: '10px' }}>
                                    <button onClick={(e) => handleAddClick(e, 'add-construction-palavras', `**${item.palavraOriginal}**; ${item.transliteracao} - ${item.sentidoEnuances}`)}>Adicionar na Construção</button>
                                    <button onClick={() => handleDeepAnalysis(index, item)} disabled={deepAnalysisState[index]?.loading}>
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
                                                <div className="quote-actions" style={{ justifyContent: 'flex-start', margin: 0, padding: 0, border: 'none' }}>
                                                    <button 
                                                        onClick={(e) => handleAddClick(e, 'add-construction-palavras', `**${item.palavraOriginal}** (${item.transliteracao})\n**${passo.titulo}**\n${passo.conteudo}`)}
                                                        style={{ fontSize: '12px', padding: '4px 8px' }}
                                                    >
                                                        Adicionar na Construção
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="card">
                        <h3>Análise Teológica</h3>
                        {(result.analiseTeologica || '').split(/\n+/).filter(p => p.trim()).map((p, i, arr) => (
                            <div key={i} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: i < arr.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                                <p>{parseBold(p)}</p>
                                <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', borderTop: 'none', paddingTop: 0 }}>
                                    <button onClick={(e) => handleAddClick(e, 'add-construction-teologica', p)}>Adicionar na Construção</button>
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
                                    <div className="quote-actions" style={{ justifyContent: 'flex-start', marginTop: '10px', borderTop: 'none', paddingTop: 0, gap: '10px' }}>
                                        <button onClick={(e) => handleAddClick(e, 'add-construction-aplicacao', cleanP)}>Adicionar na Construção</button>
                                        <button onClick={() => window.dispatchEvent(new CustomEvent('search-thoughts', { detail: fraseResumo }))}>Procurar Pensamentos</button>
                                        <button onClick={() => window.dispatchEvent(new CustomEvent('search-illustrations', { detail: fraseResumo }))}>Procurar Ilustrações</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

const PensamentosView = () => {
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
            const newQuotes = JSON.parse(responseText).map((q: any) => ({ ...q, id: Math.random().toString(36) }));
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
            <h2>Busca de Citações</h2>
            <div className="form-group">
                <input type="text" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch(false)} placeholder="Ex: Graça, C.S. Lewis" />
                <button onClick={() => handleSearch(false)} disabled={loading}>{loading ? 'Buscando...' : 'Buscar'}</button>
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
                            <button onClick={() => window.dispatchEvent(new CustomEvent('search-illustrations', { detail: q.quote }))}>Procurar Ilustrações</button>
                            <button onClick={(e) => handleAddClick(e, 'add-construction-pensamentos', `"${q.quote}" — ${q.source}`)}>Adicionar na Construção</button>
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

const IlustracoesView = () => {
    const [theme, setTheme] = useState('');
    const [illustrations, setIllustrations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [checkState, setCheckState] = useState({});

    const handleSearch = useCallback(async (category = 'notícias', customTheme = null) => {
        const query = customTheme || theme;
        if (!query) return;
        if (customTheme) setTheme(customTheme);
        setLoading(true);
        setError('');
        if (category === 'notícias' && illustrations.length === 0) setIllustrations([]);

        const promptMap = {
            'notícias': `Encontre 3 notícias reais que ilustram o tema "${query}". Forneça um resumo detalhado de dois parágrafos e a fonte.`,
            'estudos': `Encontre 2 estudos científicos ou acadêmicos que ilustram o tema "${query}". Forneça um resumo detalhado de dois parágrafos e a fonte.`,
            'histórias': `Encontre 2 enredos de filmes ou livros que ilustram o tema "${query}". Forneça um resumo detalhado de dois parágrafos e a fonte.`
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
            const newItems = JSON.parse(responseText).map((item: any) => ({ ...item, id: Math.random().toString(36), category }));
            setIllustrations(prev => [...prev, ...newItems]);
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao buscar ilustrações.'));
        } finally {
            setLoading(false);
        }
    }, [theme, illustrations]);

    const handleCheck = async (id, item) => {
        setCheckState(prev => ({ ...prev, [id]: { loading: true } }));
        try {
            const responseText = await generateAIContent({ prompt: `Verifique a confiabilidade da notícia/fonte: ${item.fonte} sobre o resumo: "${item.resumo}"` });
            setCheckState(prev => ({ ...prev, [id]: { loading: false, result: responseText } }));
        } catch (e) {
            setCheckState(prev => ({ ...prev, [id]: { loading: false, result: formatGeminiError(e, 'Erro na verificação.') } }));
        }
    };

    useEffect(() => {
        const handler = (e) => {
            if (e.detail) {
                handleSearch('notícias', e.detail);
            }
        };
        window.addEventListener('search-illustrations', handler);
        return () => window.removeEventListener('search-illustrations', handler);
    }, [handleSearch]);

    return (
        <div className="tab-content">
            <h2>Busca de Ilustrações</h2>
            <div className="form-group">
                <input type="text" value={theme} onChange={e => setTheme(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch('notícias')} placeholder="Ex: Perdão, Fé" />
                <button onClick={() => handleSearch('notícias')} disabled={loading}>{loading ? 'Buscando...' : 'Buscar'}</button>
            </div>
            {loading && !illustrations.length && <LoadingSpinner />}
            {error && <ErrorMessage message={error} />}
            {illustrations.map(item => (
                <div className="card" key={item.id}>
                    {item.resumo.split('\n').filter(p => p.trim()).map((p, i) => <p key={i}>{p}</p>)}
                    <p><strong>Fonte:</strong> {item.fonte}</p>
                    <div className="quote-actions" style={{ justifyContent: 'flex-end', gap: '10px' }}>
                        <button onClick={() => handleCheck(item.id, item)} disabled={checkState[item.id]?.loading}>Checar</button>
                        <button onClick={(e) => handleAddClick(e, 'add-construction-ilustracao', `${item.resumo}\n\nFonte: ${item.fonte}`)}>Adicionar na Construção</button>
                    </div>
                    {checkState[item.id]?.loading && <LoadingSpinner />}
                    {checkState[item.id]?.result && <div className="sub-result">{checkState[item.id].result}</div>}
                </div>
            ))}
            {illustrations.length > 0 && (
                <div className="more-buttons">
                    <button onClick={() => handleSearch('notícias')} disabled={loading}>+ Notícias</button>
                    <button onClick={() => handleSearch('estudos')} disabled={loading}>+ Estudos</button>
                    <button onClick={() => handleSearch('histórias')} disabled={loading}>+ Histórias</button>
                </div>
            )}
        </div>
    );
};


const ConstrucaoView = () => {
    const [form, setForm] = useState({});
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const appendField = (field, text) => {
            setForm(prev => {
                const current = prev[field] || '';
                return { ...prev, [field]: current ? current + '\n\n' + text : text };
            });
        };

        const handlerTema = (e) => { if (e.detail) setForm(prev => ({ ...prev, temaCentral: e.detail })); };
        const handlerPensamentos = (e) => { if (e.detail) appendField('pensamentos', e.detail); };
        const handlerIlustracao = (e) => { if (e.detail) appendField('ilustracao', e.detail); };
        const handlerApresentacao = (e) => { if (e.detail) appendField('apresentacaoCapitulo', e.detail); };
        const handlerHistorica = (e) => { if (e.detail) appendField('infoHistorica', e.detail); };
        const handlerPalavras = (e) => { if (e.detail) appendField('palavrasChave', e.detail); };
        const handlerTeologica = (e) => { if (e.detail) appendField('expressoesTeologicas', e.detail); };
        const handlerAplicacao = (e) => { if (e.detail) appendField('aplicacoes', e.detail); };

        window.addEventListener('add-construction', handlerTema);
        window.addEventListener('add-construction-pensamentos', handlerPensamentos);
        window.addEventListener('add-construction-ilustracao', handlerIlustracao);
        window.addEventListener('add-construction-apresentacao', handlerApresentacao);
        window.addEventListener('add-construction-historica', handlerHistorica);
        window.addEventListener('add-construction-palavras', handlerPalavras);
        window.addEventListener('add-construction-teologica', handlerTeologica);
        window.addEventListener('add-construction-aplicacao', handlerAplicacao);

        return () => {
            window.removeEventListener('add-construction', handlerTema);
            window.removeEventListener('add-construction-pensamentos', handlerPensamentos);
            window.removeEventListener('add-construction-ilustracao', handlerIlustracao);
            window.removeEventListener('add-construction-apresentacao', handlerApresentacao);
            window.removeEventListener('add-construction-historica', handlerHistorica);
            window.removeEventListener('add-construction-palavras', handlerPalavras);
            window.removeEventListener('add-construction-teologica', handlerTeologica);
            window.removeEventListener('add-construction-aplicacao', handlerAplicacao);
        };
    }, []);

    const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleBuild = useCallback(async () => {
        setLoading(true);
        setError('');
        setResult('');
        try {
            const prompt = `Persona: Você é um Educador Empático e mentor teológico. Seu tom é o de um professor que guia seus alunos com sabedoria, sendo instrutivo mas nunca autoritário. Você faz pesquisas sobre capítulos da Bíblia com rigor intelectual e fluidez narrativa.

Projeto: A partir das informações postadas será construído um texto completo no final. Formate qualquer trecho de texto citado que estiver entre aspas em negrito utilizando os asteriscos do markdown (exemplo: **"texto aspeado"**).

ESTRUTURA DO TEXTO:
A) Inicie o texto com o pensamento inserido na caixa PENSAMENTOS. A apresentação deverá ser feita através de duas frases. A primeira frase deve apresentar a autoria e a segunda o pensamento citado de forma integral entre aspas. Use como base o exemplo a seguir: o teólogo (qualificação do autor, que pode ser escritor, político, filósofo...) João (nome do autor) é autor de um interessante pensamento que declara. 
(caso não tenha sido selecionado nenhum pensamento, vá para o próximo item). 

C) escreva de dois a três parágrafos contendo a ILUSTRAÇÃO postada na caixa ILUSTRAÇÃO. Ao iniciar esta seção, use a primeira frase para conectar o assunto da ilustração com o conteúdo do parágrafo anterior (caso não tenha sido selecionada nenhuma ilustração, vá para o próximo item). 

D) escreva um breve parágrafo de transição entre os elementos da introdução com a seção do desenvolvimento.

E) Síntese do capítulo: Escreva um parágrafo de apresentação do contexto geral do capítulo do texto bíblico usando as informações descritas na caixa APRESENTAÇÃO DO CAPÍTULO (caso a caixa esteja vazia, escreva um parágrafo de apresentação baseado no TEMA CENTRAL).

F) Escreva uma breve parágrafo conectando a síntese do capítulo com o conteúdo do(s) versículo(s) que serão citados no próximo passo.

G) Escreva uma frase de apresentação do texto bíblico baseando-se no exemplo a seguir: - Veja o que diz o verso X do capítulo X do livro X. (Se o texto bíblico for composto por mais de um versículo, escreva a frase no plural: Veja o que que os versos X do capítulo X do livro X.)
- Após a frase de apresentação, terminada com dois pontos (:), coloque na íntegra na linha debaixo o TB (texto bíblico), que foi colocado na caixa do TEMA CENTRAL. 
- A apresentação do texto bíblico deverá ser entre aspas.
- Ao final do texto bíblico coloque a referência entre parênteses colocando o nome do livro, o capítulo e o(s) versículo(s). Exemplo: (2 Reis 24:1)

H) Explicação do texto: Inicie com uma frase conectando esta seção com o texto bíblico citado anteriormente. Em seguida, dedique vários parágrafos para explorar o texto bíblico desenvolvendo as informações postadas nas caixas INFORMAÇÕES HISTÓRICAS, PALAVRAS-CHAVE e EXPRESSÕES TEOLÓGICAS. Sempre use frases de conexão entre os elementos, para que todos pareçam coesos.

I) Conclusão: Escreva dois parágrafos que fechem o texto de forma coerente, conectando as informações anteriores com as sugestões presentes na seção APLICAÇÕES.
Termine o último parágrafo com um Arremate Poético: use uma máxima ou frase de efeito que sirva como "âncora" para a memória do leitor.

ESTILO DE ESCRITA OBRIGATÓRIO:
- Tom de Educador Empático: O tom é de um mentor. É instrutivo, mas não autoritário.
- Raciocínio Lógico: Use conectivos que demonstrem causa e consequência (ex: "Desta forma...", "Por isso...", "Perceba que...", "Como resultado...").
- Interpelação do Leitor: Faça perguntas retóricas frequentes para engajar quem lê (ex: "Você já ouviu falar...?", "Qual o maior presente...?", "Como isso se aplica a nós hoje?").
- Tom Didático-Persuasivo: O texto não busca apenas informar, mas transformar o comportamento através da lógica. Enfatize a responsabilidade individual, mostrando que as escolhas geram frutos inevitáveis.
- Voz Ativa e Assertiva: Use frases curtas e diretas, evitando ambiguidades e mantendo um ritmo constante de leitura.
- Elegância Formal: Mantenha a elegância sem ser excessivamente erudito. Evite jargões religiosos excessivos ou clichês sem explicação. 
- Restrição: NÃO use uma linguagem infantil ou excessivamente simplista. O texto deve ser acessível tanto para acadêmicos quanto para o leitor comum.

INFORMAÇÕES INSERIDAS:
- TEMA CENTRAL: ${form.temaCentral || 'Não informado'}
- APRESENTAÇÃO DO CAPÍTULO: ${form.apresentacaoCapitulo || 'Não informado'}
- PENSAMENTOS: ${form.pensamentos || 'Não informado'}
- ILUSTRAÇÃO: ${form.ilustracao || 'Não informado'}
- INFORMAÇÕES HISTÓRICAS: ${form.infoHistorica || 'Não informado'}
- PALAVRAS-CHAVE: ${form.palavrasChave || 'Não informado'}
- EXPRESSÕES TEOLÓGICAS: ${form.expressoesTeologicas || 'Não informado'}
- APLICAÇÕES: ${form.aplicacoes || 'Não informado'}
            `;

            const responseText = await generateAIContent({ prompt });
            setResult(responseText);
        } catch (e) {
            setError(formatGeminiError(e, 'Falha ao construir o texto.'));
        } finally {
            setLoading(false);
        }
    }, [form]);

    return (
        <div className="tab-content">
            <h2>Construção de Texto Devocional</h2>
            <div className="grid-form">
                <div className="form-section full-span">
                    <h3>TEMA CENTRAL</h3>
                    <textarea name="temaCentral" value={form.temaCentral || ''} onChange={handleChange} placeholder="Insira o tema e o texto bíblico..." />
                </div>
                <div className="form-section full-span">
                    <h3>APRESENTAÇÃO DO CAPÍTULO</h3>
                    <textarea name="apresentacaoCapitulo" value={form.apresentacaoCapitulo || ''} onChange={handleChange} placeholder="Apresentação do capítulo..." />
                </div>
                <div className="form-section full-span">
                    <h3>PENSAMENTOS</h3>
                    <textarea name="pensamentos" value={form.pensamentos || ''} onChange={handleChange} placeholder="Pensamento interessante com referência (Autor e Obra)..." />
                </div>
                <div className="form-section full-span">
                    <h3>ILUSTRAÇÃO</h3>
                    <textarea name="ilustracao" value={form.ilustracao || ''} onChange={handleChange} placeholder="Ilustração conectada ao tema..." />
                </div>
                <div className="form-section full-span">
                    <h3>INFORMAÇÕES HISTÓRICAS</h3>
                    <textarea name="infoHistorica" value={form.infoHistorica || ''} onChange={handleChange} placeholder="Contexto histórico e cultural da época..." />
                </div>
                <div className="form-section full-span">
                    <h3>PALAVRAS-CHAVE</h3>
                    <textarea name="palavrasChave" value={form.palavrasChave || ''} onChange={handleChange} placeholder="Termos originais (hebraico, aramaico ou grego) de curiosidade teológica..." />
                </div>
                <div className="form-section full-span">
                    <h3>EXPRESSÕES TEOLÓGICAS</h3>
                    <textarea name="expressoesTeologicas" value={form.expressoesTeologicas || ''} onChange={handleChange} placeholder="Expressões ou frases com peso teológico..." />
                </div>
                <div className="form-section full-span">
                    <h3>APLICAÇÕES</h3>
                    <textarea name="aplicacoes" value={form.aplicacoes || ''} onChange={handleChange} placeholder="Aplicações práticas (Atitudes, encorajamento, exemplos)..." />
                </div>
            </div>
            <button onClick={handleBuild} disabled={loading} className="full-width-button">{loading ? 'Construindo...' : 'Construir Texto'}</button>
            {loading && <LoadingSpinner />}
            {error && <ErrorMessage message={error} />}
            {result && (
                <div className="card">
                    <h3>Texto Devocional Gerado</h3>
                    {result.split(/\n+/).filter(p => p.trim() !== '').map((p, i) => <p key={i} style={{ fontFamily: 'Arial', fontSize: '16px', lineHeight: '1.5', marginBottom: '1rem' }}>{parseBold(p)}</p>)}
                    <div className="quote-actions" style={{ justifyContent: 'flex-end' }}>
                        <button onClick={() => navigator.clipboard.writeText(result)}>Copiar</button>
                    </div>
                </div>
            )}
        </div>
    );
};


// --- Main App Component ---
const App = () => {
    const TABS = ['NAA', 'Capítulo', 'Versículo', 'Pensamentos', 'Ilustrações', 'Construção'];
    const [activeTab, setActiveTab] = useState(TABS[0]);
    const [resetKey, setResetKey] = useState(0);

    const [provider, setProvider] = useState(() => localStorage.getItem('ai_provider') || 'gemini');
    const [ollamaModel, setOllamaModel] = useState(() => localStorage.getItem('ollama_model') || 'qwen2.5:14b');
    const [ollamaUrl, setOllamaUrl] = useState(() => localStorage.getItem('ollama_url') || 'http://localhost:11434');
    const [showSettings, setShowSettings] = useState(false);

    const handleProviderChange = (val: string) => {
        setProvider(val);
        localStorage.setItem('ai_provider', val);
    };

    const handleModelChange = (val: string) => {
        setOllamaModel(val);
        localStorage.setItem('ollama_model', val);
    };

    const handleUrlChange = (val: string) => {
        setOllamaUrl(val);
        localStorage.setItem('ollama_url', val);
    };

    useEffect(() => {
        const handleAnalyze = () => setActiveTab('Versículo');
        const handleThoughts = () => setActiveTab('Pensamentos');
        const handleIllustrations = () => setActiveTab('Ilustrações');
        const handleResetAll = () => setResetKey(prev => prev + 1);
        
        window.addEventListener('analyze-verse', handleAnalyze);
        window.addEventListener('search-thoughts', handleThoughts);
        window.addEventListener('search-illustrations', handleIllustrations);
        window.addEventListener('reset-all', handleResetAll);
        
        return () => {
            window.removeEventListener('analyze-verse', handleAnalyze);
            window.removeEventListener('search-thoughts', handleThoughts);
            window.removeEventListener('search-illustrations', handleIllustrations);
            window.removeEventListener('reset-all', handleResetAll);
        };
    }, []);

    return (
        <div className="app-container">
            <header style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <img src={logoImg} alt="Logo" style={{ width: '40px', height: '40px', borderRadius: '8px', border: '2px solid white', boxShadow: '0 2px 5px rgba(0,0,0,0.2)' }} />
                    <h1 style={{ margin: 0, fontSize: '1.8rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>TEXTOS REAVIVADOS</h1>
                </div>
                <button 
                    onClick={() => setShowSettings(!showSettings)} 
                    style={{
                        marginTop: '5px',
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: 'white',
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
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.3)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'}
                >
                    ⚙️ Provedor: {provider === 'gemini' ? 'Gemini (Nuvem)' : `Ollama (${ollamaModel})`}
                </button>
            </header>

            {showSettings && (
                <div style={{
                    backgroundColor: '#e3f2fd',
                    borderBottom: '1px solid #bbdefb',
                    padding: '1.25rem',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '1.25rem',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '160px' }}>
                        <label style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#0d47a1' }}>PROVEDOR DE IA:</label>
                        <select 
                            value={provider} 
                            onChange={(e) => handleProviderChange(e.target.value)}
                            style={{ padding: '8px', borderRadius: '4px', border: '1px solid #90caf9', fontSize: '0.9rem', backgroundColor: 'white', cursor: 'pointer' }}
                        >
                            <option value="gemini">Gemini (Nuvem)</option>
                            <option value="ollama">Ollama (Local)</option>
                        </select>
                    </div>

                    {provider === 'ollama' && (
                        <>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flexGrow: 1, minWidth: '180px' }}>
                                <label style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#0d47a1' }}>MODELO LOCAL (OLLAMA):</label>
                                <input 
                                    type="text" 
                                    value={ollamaModel} 
                                    onChange={(e) => handleModelChange(e.target.value)}
                                    placeholder="Ex: qwen2.5:14b ou llama3.1:8b"
                                    style={{ padding: '8px', borderRadius: '4px', border: '1px solid #90caf9', fontSize: '0.9rem', backgroundColor: 'white' }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flexGrow: 1, minWidth: '180px' }}>
                                <label style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#0d47a1' }}>ENDEREÇO DO SERVER:</label>
                                <input 
                                    type="text" 
                                    value={ollamaUrl} 
                                    onChange={(e) => handleUrlChange(e.target.value)}
                                    placeholder="Ex: http://localhost:11434"
                                    style={{ padding: '8px', borderRadius: '4px', border: '1px solid #90caf9', fontSize: '0.9rem', backgroundColor: 'white' }}
                                />
                            </div>
                        </>
                    )}
                </div>
            )}

            <nav className="tab-nav">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        className={`tab-button ${activeTab === tab ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab}
                    </button>
                ))}
            </nav>
            <main>
                <div style={{ display: activeTab === 'NAA' ? 'block' : 'none' }}><NAAView key={`naa-${resetKey}`} /></div>
                <div style={{ display: activeTab === 'Capítulo' ? 'block' : 'none' }}><CapituloView /></div>
                <div style={{ display: activeTab === 'Versículo' ? 'block' : 'none' }}><VersiculoView key={`versiculo-${resetKey}`} /></div>
                <div style={{ display: activeTab === 'Pensamentos' ? 'block' : 'none' }}><PensamentosView key={`pensamentos-${resetKey}`} /></div>
                <div style={{ display: activeTab === 'Ilustrações' ? 'block' : 'none' }}><IlustracoesView key={`ilustracoes-${resetKey}`} /></div>
                <div style={{ display: activeTab === 'Construção' ? 'block' : 'none' }}><ConstrucaoView key={`construcao-${resetKey}`} /></div>
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
