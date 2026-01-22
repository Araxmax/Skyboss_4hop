#!/bin/bash

# Quick Start - Launch Bot Immediately
# Uses: gRPC for scanning + RPC for trading with QuickNode

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}"
echo "════════════════════════════════════════════════════════════"
echo "  QuickNode HFT Bot - Quick Start"
echo "════════════════════════════════════════════════════════════"
echo -e "${NC}"

# Check environment
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ Error: .env not found${NC}"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    npm install --silent > /dev/null 2>&1 || npm install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
fi

# Verify setup
echo -e "${YELLOW}Verifying QuickNode setup...${NC}"
if ! ts-node verify-quicknode-setup.ts 2>/dev/null; then
    echo -e "${YELLOW}Running verification...${NC}"
    npx ts-node verify-quicknode-setup.ts
fi

# Ask for trading mode
echo ""
echo -e "${BLUE}Select mode:${NC}"
echo "  1) Live Trading (Real money) 💰"
echo "  2) Dry Run (Simulation) 🧪"
echo "  3) Scanner Only (gRPC streaming) 📡"
echo ""
read -p "Enter choice (1-3): " mode

case $mode in
    1)
        echo -e "${GREEN}"
        echo "🚀 Launching LIVE Trading Bot..."
        echo "   gRPC: Scanning prices in real-time"
        echo "   RPC: Executing trades"
        echo -e "${NC}"
        npm run bot:optimized:live
        ;;
    2)
        echo -e "${YELLOW}"
        echo "🧪 Launching DRY RUN (No real trades)..."
        echo "   gRPC: Scanning prices in real-time"
        echo "   RPC: Simulating trades"
        echo -e "${NC}"
        DRY_RUN=true npm run bot:optimized
        ;;
    3)
        echo -e "${BLUE}"
        echo "📡 Launching Scanner Only..."
        echo "   gRPC: Streaming prices"
        echo -e "${NC}"
        npm run scanner:hft
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
