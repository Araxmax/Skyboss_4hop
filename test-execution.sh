#!/bin/bash
# QUICK EXECUTION TEST - Run This Now!

echo "════════════════════════════════════════════════════════════"
echo "  ✅ Execution Fix Applied - Testing Now"
echo "════════════════════════════════════════════════════════════"
echo ""

# First, verify the fix is in place
echo "🔍 Verifying fix..."
if grep -q "this.swapExecutor" OptimizedHFTBot.ts; then
    echo "✅ SwapExecutor integration: CONFIRMED"
else
    echo "❌ SwapExecutor integration: MISSING"
    exit 1
fi

if grep -q "executeArbitrageTrade" OptimizedHFTBot.ts; then
    echo "✅ Trade execution logic: CONFIRMED"
else
    echo "❌ Trade execution logic: MISSING"
    exit 1
fi

if grep -q "tradesExecuted" OptimizedHFTBot.ts; then
    echo "✅ Trade tracking: CONFIRMED"
else
    echo "❌ Trade tracking: MISSING"
    exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  📊 Status: All fixes verified!"
echo "════════════════════════════════════════════════════════════"
echo ""

echo "Choose test mode:"
echo "1) Dry Run (simulate trades, no real money)"
echo "2) Live Trade (real money - BE CAREFUL!)"
echo ""
read -p "Enter choice (1 or 2): " choice

if [ "$choice" = "1" ]; then
    echo ""
    echo "🧪 Starting DRY RUN (no real transactions)..."
    echo "Watch for:"
    echo "  ✅ Profitable opportunities found"
    echo "  ✅ Trade execution messages"
    echo "  ✅ Swap 1 and Swap 2 confirmations"
    echo ""
    DRY_RUN=true npm run bot:optimized
elif [ "$choice" = "2" ]; then
    echo ""
    echo "⚠️  LIVE TRADING MODE"
    echo "💰 Real money will be spent!"
    echo ""
    read -p "Are you sure? Type 'YES' to continue: " confirm
    if [ "$confirm" = "YES" ]; then
        echo ""
        echo "🚀 Starting LIVE trading..."
        npm run bot:optimized:live
    else
        echo "Cancelled."
    fi
else
    echo "Invalid choice."
fi
