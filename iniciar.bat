@echo off
cd /d "c:\IA\Textos-Reavivados"

echo Verificando se o Ollama está ativo...
tasklist /FI "IMAGENAME eq ollama.exe" 2>NUL | find /I /N "ollama.exe" >NUL
if "%ERRORLEVEL%"=="0" (
    echo [OK] Ollama já está rodando.
) else (
    echo [AVISO] Ollama não está rodando. Iniciando Ollama...
    start "" ollama serve
    :: Aguarda 3 segundos para inicializar o serviço
    timeout /t 3 /nobreak >nul
)

echo Iniciando o projeto REDATOR REAVIVADOS 2.0...
npm run dev
pause
