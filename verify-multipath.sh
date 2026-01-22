#!/bin/bash
# Test script to verify HFT scanner with multi-path support

cd "$(dirname "$0")"

echo "========================================================================"
echo "MULTI-PATH HFT SCANNER - VERIFICATION TEST"
echo "========================================================================"
echo ""

echo "1. Verifying TypeScript compilation..."
npx tsc --version
npx tsc --noEmit HFTGrpcScanner.ts HFTExecutor.ts MultiPathGenerator.ts
if [ $? -eq 0 ]; then
  echo "✅ TypeScript compilation successful"
else
  echo "❌ TypeScript compilation failed"
  exit 1
fi
echo ""

echo "2. Running path generation test..."
npx ts-node test-multipath-scanner.ts > /tmp/path-test.log 2>&1
if grep -q "ALL TESTS PASSED" /tmp/path-test.log; then
  echo "✅ Path generation test passed"
  echo "   Found $(grep 'Total Paths:' /tmp/path-test.log | awk '{print $3}') total paths"
else
  echo "❌ Path generation test failed"
  cat /tmp/path-test.log
  exit 1
fi
echo ""

echo "3. Checking pool coverage..."
grep "Total unique pools" /tmp/path-test.log
echo ""

echo "4. Checking DEX coverage..."
grep "DEX COVERAGE:" -A 10 /tmp/path-test.log | tail -5
echo ""

echo "========================================================================"
echo "✅ ALL VERIFICATIONS PASSED!"
echo "========================================================================"
echo ""
echo "You can now run: npm run hft"
echo "Or: concurrently \"ts-node HFTGrpcScanner.ts\" \"ts-node HFTExecutor.ts\""
