const fileSelect = document.getElementById('fileSelect');
const modelSelect = document.getElementById('modelSelect');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const currentRef = document.getElementById('currentRef');
const enText = document.getElementById('enText');
const ptText = document.getElementById('ptText');

let isRunning = false;
let currentData = [];
let currentFileName = '';

// Load files on startup
async function loadFiles() {
    try {
        const res = await fetch('/api/files');
        const files = await res.json();
        fileSelect.innerHTML = '<option value="">Selecione um arquivo...</option>';
        files.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            fileSelect.appendChild(opt);
        });
    } catch (e) {
        statusText.textContent = "Erro ao carregar lista de arquivos.";
    }
}

fileSelect.addEventListener('change', async (e) => {
    if (!e.target.value) return;
    currentFileName = e.target.value;
    statusText.textContent = `Carregando ${currentFileName}...`;
    try {
        const res = await fetch(`/api/file/${encodeURIComponent(currentFileName)}`);
        currentData = await res.json();
        const translatedCount = currentData.filter(d => d.translated).length;
        statusText.textContent = `Arquivo carregado! ${translatedCount} de ${currentData.length} já traduzidos.`;
        updateProgress();
    } catch (err) {
        statusText.textContent = "Erro ao ler o arquivo JSON.";
    }
});

function updateProgress() {
    if (!currentData.length) return;
    const translatedCount = currentData.filter(d => d.translated).length;
    const pct = Math.floor((translatedCount / currentData.length) * 100);
    progressBar.style.width = `${pct}%`;
    progressBar.textContent = `${pct}% (${translatedCount}/${currentData.length})`;
}

async function translateText(text) {
    const prompt = `Você é um tradutor especialista bíblico. Traduza o seguinte texto do inglês para o português do Brasil (PT-BR) de forma natural, mantendo o sentido original, regras gramaticais e contexto teológico. Responda SOMENTE com o texto traduzido, sem aspas, sem explicações extras, sem formatação markdown. TEXTO PARA TRADUZIR:\n\n${text}`;
    
    const res = await fetch('/api/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modelSelect.value,
            prompt: prompt,
            stream: false
        })
    });
    
    if (!res.ok) {
        let errMsg = "Erro na comunicação com Ollama.";
        try {
            const errData = await res.json();
            if (errData.error) errMsg = `Erro do Ollama: ${errData.error}`;
        } catch(e) {}
        throw new Error(errMsg);
    }
    const data = await res.json();
    return data.response.trim();
}

async function saveTranslation(index, item) {
    await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fileName: currentFileName,
            index: index,
            item: item
        })
    });
}

startBtn.addEventListener('click', async () => {
    if (!currentFileName || !currentData.length) {
        alert("Selecione um arquivo primeiro.");
        return;
    }
    
    isRunning = true;
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    fileSelect.disabled = true;
    modelSelect.disabled = true;
    
    for (let i = 0; i < currentData.length; i++) {
        if (!isRunning) break;
        
        let item = currentData[i];
        if (item.translated) continue; // Pula os já traduzidos
        
        currentRef.textContent = `Original (${item.book} ${item.chapter}:${item.verse})`;
        enText.value = item.text;
        ptText.value = "Traduzindo...";
        statusText.textContent = `Traduzindo ID ${item.id}... (${i + 1}/${currentData.length})`;
        
        try {
            const translatedStr = await translateText(item.text);
            ptText.value = translatedStr;
            
            // Atualiza item e salva no backend
            item.text = translatedStr;
            item.translated = true;
            await saveTranslation(i, item);
            
            updateProgress();
        } catch (e) {
            statusText.textContent = `Erro ao traduzir ID ${item.id}: ${e.message}`;
            isRunning = false;
            break;
        }
    }
    
    if (isRunning) {
        statusText.textContent = "Tradução concluída!";
        isRunning = false;
    }
    
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    fileSelect.disabled = false;
    modelSelect.disabled = false;
});

pauseBtn.addEventListener('click', () => {
    isRunning = false;
    statusText.textContent = "Tradução pausada. (Aguarde o versículo atual terminar...)";
});

// Init
loadFiles();
