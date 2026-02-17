@echo off
title VIGILANTE - EverTech Cloud (Mantenha Minimizado)
chcp 65001 >nul

REM ========================================
REM IMPORTANTE: Configure as variáveis no ficheiro .env
REM Copie .env.example para .env e preencha os valores
REM ========================================

:loop
cls
echo ==========================================
echo    VIGILANTE ATIVO - EVERTECH CLOUD
echo ==========================================
echo.

REM Verifica porta 8000 (Corrida)
netstat -ano | find ":8000" | find "LISTENING" >nul
if %errorlevel% neq 0 (
    echo [!] Porta 8000 livre. Reiniciando Corrida...
    start "InfinityRace" /d "C:\Users\João\Documents\EverTechs.com\InfinityRace" cmd /k node server.js
    timeout /t 8 >nul
) else (
    echo [OK] Corrida rodando (porta 8000)
)

echo.

REM Verifica porta 3000 (BetaTwo HTTP) ou 3443 (BetaTwo HTTPS)
netstat -ano | find ":3000" | find "LISTENING" >nul
if %errorlevel% neq 0 (
    netstat -ano | find ":3443" | find "LISTENING" >nul
    if %errorlevel% neq 0 (
        echo [!] Porta 3000/3443 livre. Reiniciando BetaTwo...
        echo [i] A carregar variáveis de ambiente do .env...
        start "BetaTwo" /d "C:\Users\João\Documents\EverTechs.com\BetaTwo" cmd /k "npm start"
        timeout /t 8 >nul
    ) else (
        echo [OK] BetaTwo rodando (HTTPS porta 3443)
    )
) else (
    echo [OK] BetaTwo rodando (HTTP porta 3000)
)

echo.

REM Verifica porta 3001 (EverTechs Hub)
netstat -ano | find ":3001" | find "LISTENING" >nul
if %errorlevel% neq 0 (
    echo [!] Porta 3001 livre. Reiniciando EverTechs Hub...
    start "EverTechs Hub" /d "C:\Users\João\Documents\EverTechs.com\EverTechs-Hub" cmd /k node server.js
    timeout /t 8 >nul
) else (
    echo [OK] EverTechs Hub rodando (porta 3001)
)

echo.
echo ==========================================
echo Proxima verificacao em 5 segundos...
echo Pressione Ctrl+C para parar
echo ==========================================

REM Aguarda 5 segundos antes de verificar novamente
timeout /t 5 >nul
goto loop
