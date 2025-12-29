#!/usr/bin/env node

/**
 * Setup Verification Script
 * Checks that all components are properly installed and configured
 */

const fs = require('fs');
const path = require('path');

console.log('\n' + '='.repeat(70));
console.log('ARBITRAGE BOT SETUP VERIFICATION');
console.log('='.repeat(70));

let errors = [];
let warnings = [];
let passed = 0;
let total = 0;

function check(name, condition, errorMsg, warningMsg = null) {
  total++;
  process.stdout.write(`\n[${total}] ${name}... `);

  if (condition) {
    console.log('✓ PASS');
    passed++;
  } else if (warningMsg) {
    console.log('⚠ WARNING');
    warnings.push(`[${total}] ${name}: ${warningMsg}`);
  } else {
    console.log('✗ FAIL');
    errors.push(`[${total}] ${name}: ${errorMsg}`);
  }
}

// Check 1: Node.js version
check(
  'Node.js version >= 16',
  parseInt(process.version.slice(1).split('.')[0]) >= 16,
  `Node.js ${process.version} is too old. Need v16+`
);

// Check 2: Required files exist
const requiredFiles = [
  'Sky_O2O.py',
  'ArbitrageBot.ts',
  'SwapExecutor.ts',
  'SignalManager.ts',
  'SafetyChecker.ts',
  'Executor.ts',
  'package.json',
  '.env',
  'tsconfig.json'
];

requiredFiles.forEach(file => {
  check(
    `File exists: ${file}`,
    fs.existsSync(file),
    `Missing required file: ${file}`
  );
});

// Check 3: node_modules exists
check(
  'Dependencies installed (node_modules)',
  fs.existsSync('node_modules'),
  'Run: npm install',
  'Dependencies may need updating'
);

// Check 4: Key dependencies
const requiredDeps = [
  '@solana/web3.js',
  '@orca-so/whirlpools-sdk',
  '@coral-xyz/anchor',
  'dotenv',
  'decimal.js',
  'ts-node',
  'typescript'
];

if (fs.existsSync('package.json')) {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

  requiredDeps.forEach(dep => {
    check(
      `Dependency: ${dep}`,
      dep in allDeps,
      `Missing dependency: ${dep}. Run: npm install`
    );
  });
}

// Check 5: .env configuration
if (fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const envVars = {};

  envContent.split('\n').forEach(line => {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) {
      envVars[match[1]] = match[2];
    }
  });

  // Check required env vars
  check(
    'RPC_URL configured',
    'RPC_URL' in envVars && envVars.RPC_URL.length > 0,
    'Set RPC_URL in .env file'
  );

  check(
    'WALLET_PATH configured',
    'WALLET_PATH' in envVars && envVars.WALLET_PATH.length > 0,
    'Set WALLET_PATH in .env file'
  );

  // Check wallet file exists
  if (envVars.WALLET_PATH) {
    check(
      'Wallet file exists',
      fs.existsSync(envVars.WALLET_PATH),
      `Wallet file not found: ${envVars.WALLET_PATH}`
    );
  }

  // Check DRY_RUN setting
  const dryRun = envVars.DRY_RUN;
  check(
    'DRY_RUN is set to true (SAFETY)',
    dryRun && dryRun.toLowerCase() === 'true',
    null,
    'DRY_RUN should be true for initial testing'
  );

  // Check trade amount is reasonable
  const tradeUsd = parseFloat(envVars.TRADE_USD || '0');
  check(
    'TRADE_USD is reasonable (<100 for testing)',
    tradeUsd > 0 && tradeUsd <= 100,
    null,
    `TRADE_USD=${tradeUsd} - consider starting smaller`
  );

} else {
  check('.env file exists', false, 'Create .env file from template');
}

// Check 6: TypeScript compilation
try {
  require('typescript');
  check('TypeScript available', true, null);
} catch (e) {
  check('TypeScript available', false, 'Install: npm install typescript');
}

// Check 7: Documentation files
const docs = [
  'README.md',
  'QUICKSTART.md',
  'TESTING_CHECKLIST.md',
  'IMPLEMENTATION_SUMMARY.md'
];

docs.forEach(doc => {
  check(
    `Documentation: ${doc}`,
    fs.existsSync(doc),
    `Missing documentation: ${doc}`
  );
});

// Print summary
console.log('\n' + '='.repeat(70));
console.log('VERIFICATION SUMMARY');
console.log('='.repeat(70));
console.log(`\nPassed: ${passed}/${total} checks`);

if (warnings.length > 0) {
  console.log('\n⚠ WARNINGS:');
  warnings.forEach(w => console.log(`  ${w}`));
}

if (errors.length > 0) {
  console.log('\n✗ ERRORS:');
  errors.forEach(e => console.log(`  ${e}`));
  console.log('\n❌ Setup verification FAILED');
  console.log('Fix the errors above and run this script again.');
  process.exit(1);
} else if (warnings.length > 0) {
  console.log('\n⚠ Setup verification passed with warnings');
  console.log('Review warnings above before proceeding.');
  console.log('\nNext steps:');
  console.log('1. Review QUICKSTART.md');
  console.log('2. Run: npm run check-wallet');
  console.log('3. Run: npm run scanner (in one terminal)');
  console.log('4. Run: npm run executor (in another terminal)');
} else {
  console.log('\n✅ Setup verification PASSED');
  console.log('All checks passed! You\'re ready to start.');
  console.log('\nNext steps:');
  console.log('1. Review QUICKSTART.md');
  console.log('2. Run: npm run check-wallet');
  console.log('3. Run: npm run scanner (in one terminal)');
  console.log('4. Run: npm run executor (in another terminal)');
}

console.log('='.repeat(70) + '\n');
