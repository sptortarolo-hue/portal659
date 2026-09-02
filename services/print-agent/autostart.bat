:: Portal Print Agent — arranque al abrir sesión en Windows (versión .bat manual).
:: Probable confirmás NOPROGRAM SHIFT y tiene mejor; esto arranca el agente y lo mantiene ejecutando.
:: Cómo arrancar al prender la PC: copiar este .bat a StartUp (Win+R → shell:startup).
@echo off
cd /d "%~dp0"
:loopClose
node agent.mjs
timeout /t 5 /nobreak >nul
goto loopClose
