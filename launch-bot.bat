@echo off
REM QuickNode HFT Bot Launcher (Windows)
REM Uses gRPC for scanning + RPC for trading

echo ════════════════════════════════════════════════════════════
echo   QuickNode HFT Arbitrage Bot - Launcher (Windows)
echo ════════════════════════════════════════════════════════════
echo.

REM Check if Node modules are installed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Check .env file
if not exist ".env" (
    echo Error: .env file not found!
    echo Please create .env file with QuickNode credentials
    pause
    exit /b 1
)

echo Configuration loaded
echo.
echo Select bot mode:
echo   1) Optimized HFT Bot (RECOMMENDED)
echo   2) Ultra-Fast Scanner (gRPC only)
echo   3) Fast Executor (RPC only)
echo   4) Multi-Pool HFT Bot
echo   5) Test Mode (Dry Run)
echo.
set /p choice="Enter choice (1-5): "

if "%choice%"=="1" (
    echo.
    echo Launching Optimized HFT Bot (Live Trading)...
    echo Mode: gRPC Scanning + RPC Trading
    echo.
    call npm run bot:optimized:live
) else if "%choice%"=="2" (
    echo.
    echo Launching Ultra-Fast Scanner (gRPC Only)...
    echo Mode: Real-time price streaming
    echo.
    call npm run scanner:hft
) else if "%choice%"=="3" (
    echo.
    echo Launching Fast Executor (RPC Only)...
    echo Mode: Execution engine
    echo.
    call npm run executor:fast
) else if "%choice%"=="4" (
    echo.
    echo Launching Multi-Pool HFT Bot (Live Trading)...
    echo Mode: gRPC Scanning + RPC Trading (Multiple Pools)
    echo.
    call npm run bot:multipool:live
) else if "%choice%"=="5" (
    echo.
    echo Dry Run Mode (No Real Transactions)...
    echo Mode: Simulation only
    echo.
    set DRY_RUN=true
    call npm run bot:optimized
) else (
    echo Invalid choice
    pause
    exit /b 1
)

pause
