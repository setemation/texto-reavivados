@echo off
echo Verificando se o Ollama está ativo...
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] Ollama já está rodando!
) else (
    echo [AVISO] Ollama não está rodando. Iniciando Ollama...
    set OLLAMA_ORIGINS=*
    start "" ollama serve
    echo [OK] Ollama foi iniciado em segundo plano.
)
timeout /t 3
