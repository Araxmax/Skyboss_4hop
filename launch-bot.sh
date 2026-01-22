#!/bin/bash

# QuickNode HFT Bot Launcher
# Uses gRPC for scanning + RPC for trading

echo "════════════════════════════════════════════════════════════"
echo "  QuickNode HFT Arbitrage Bot - Launcher"
echo "════════════════════════════════════════════════════════════"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Node modules are installed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install
    echo ""
fi

# Check .env file
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ Error: .env file not found!${NC}"
    echo "Please create .env file with QuickNode credentials"
    exit 1
fi

# Source .env
export $(grep -v '^#' .env | xargs)

# Validate QuickNode setup
if [ -z "$RPC_URL" ]; then
    echo -e "${RED}❌ Error: RPC_URL not set in .env${NC}"
    exit 1
fi

if [ -z "$QUICKNODE_GRPC_ENDPOINT" ]; then
    echo -e "${RED}❌ Error: QUICKNODE_GRPC_ENDPOINT not set in .env${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Configuration loaded${NC}"
echo ""
echo "Select bot mode:"
echo "  1) Optimized HFT Bot (RECOMMENDED)"
echo "  2) Ultra-Fast Scanner (gRPC only)"
echo "  3) Fast Executor (RPC only)"
echo "  4) Multi-Pool HFT Bot"
echo "  5) Test Mode (Dry Run)"
echo ""
read -p "Enter choice (1-5): " choice

case $choice in
    1)
        echo -e "${BLUE}Launching Optimized HFT Bot (Live Trading)...${NC}"
        echo "Mode: gRPC Scanning + RPC Trading"
        echo "Trade Size: \$${TRADE_USD}"
        echo "Min Profit: \$${MIN_PROFIT_USDC}"
        echo ""
        npm run bot:optimized:live
        ;;
    2)
        echo -e "${BLUE}Launching Ultra-Fast Scanner (gRPC Only)...${NC}"
        echo "Mode: Real-time price streaming"
        echo "Pools: Monitoring price updates"
        echo ""
        npm run scanner:hft
        ;;
    3)
        echo -e "${BLUE}Launching Fast Executor (RPC Only)...${NC}"
        echo "Mode: Execution engine"
        echo ""
        npm run executor:fast
        ;;
    4)
        echo -e "${BLUE}Launching Multi-Pool HFT Bot (Live Trading)...${NC}"
        echo "Mode: gRPC Scanning + RPC Trading (Multiple Pools)"
        echo ""
        npm run bot:multipool:live
        ;;
    5)
        echo -e "${YELLOW}⚠️  Dry Run Mode (No Real Transactions)${NC}"
        echo "Mode: Simulation only"
        echo ""
        DRY_RUN=true npm run bot:optimized
        ;;
    *)
        echo -e "${RED}❌ Invalid choice${NC}"
        exit 1
        ;;
esac
