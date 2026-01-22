/**
 * QuickNode gRPC + RPC Configuration Verification
 * Validates both scanning (gRPC) and trading (RPC) setup
 */

import dotenv from 'dotenv';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();

const execPromise = promisify(exec);

interface ConfigStatus {
  isValid: boolean;
  message: string;
  details?: string[];
}

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color: string, message: string) {
  console.log(`${color}${message}${colors.reset}`);
}

function checkRpcEndpoint(): ConfigStatus {
  const rpcUrl = process.env.RPC_URL;

  if (!rpcUrl) {
    return {
      isValid: false,
      message: '❌ RPC_URL not configured',
      details: ['Add RPC_URL to .env file'],
    };
  }

  if (!rpcUrl.includes('quicknode')) {
    return {
      isValid: false,
      message: '⚠️  RPC endpoint is not QuickNode',
      details: [
        'Using non-QuickNode RPC may cause rate limits',
        'Recommended: Use QuickNode HTTP endpoint',
        `Current: ${rpcUrl.substring(0, 50)}...`,
      ],
    };
  }

  if (!rpcUrl.endsWith('/')) {
    return {
      isValid: false,
      message: '⚠️  RPC endpoint format issue',
      details: ['RPC_URL should end with trailing slash', `Current: ${rpcUrl}`],
    };
  }

  return {
    isValid: true,
    message: '✅ RPC endpoint configured correctly (QuickNode)',
    details: [`Endpoint: ${rpcUrl.substring(0, 60)}...`],
  };
}

function checkGrpcEndpoint(): ConfigStatus {
  const grpcEndpoint = process.env.QUICKNODE_GRPC_ENDPOINT;
  const grpcToken = process.env.QUICKNODE_GRPC_TOKEN;
  const useGrpc = process.env.USE_QUICKNODE_GRPC;

  if (!grpcEndpoint || !grpcToken) {
    return {
      isValid: false,
      message: '❌ gRPC configuration missing',
      details: [
        'Add QUICKNODE_GRPC_ENDPOINT to .env',
        'Add QUICKNODE_GRPC_TOKEN to .env',
        'Format: host:port',
      ],
    };
  }

  if (useGrpc !== 'true') {
    return {
      isValid: false,
      message: '❌ gRPC disabled',
      details: ['Set USE_QUICKNODE_GRPC=true in .env', 'gRPC is required for fast scanning'],
    };
  }

  if (!grpcEndpoint.includes(':')) {
    return {
      isValid: false,
      message: '⚠️  gRPC endpoint format invalid',
      details: [
        'Format should be: host:port',
        `Current: ${grpcEndpoint}`,
        'Example: prettiest-omniscient-glade.solana-mainnet.quiknode.pro:10000',
      ],
    };
  }

  return {
    isValid: true,
    message: '✅ gRPC endpoint configured correctly',
    details: [
      `Endpoint: ${grpcEndpoint}`,
      `Token: ${grpcToken.substring(0, 10)}...`,
      'Status: Enabled',
    ],
  };
}

function checkTradingConfig(): ConfigStatus {
  const tradeUsd = process.env.TRADE_USD;
  const minProfit = process.env.MIN_PROFIT_USDC;
  const dryRun = process.env.DRY_RUN;

  const details: string[] = [];
  let issues = false;

  if (!tradeUsd || parseFloat(tradeUsd) <= 0) {
    details.push('⚠️  TRADE_USD not set or invalid');
    issues = true;
  } else {
    details.push(`✓ Trade size: $${tradeUsd}`);
  }

  if (!minProfit || parseFloat(minProfit) < 0) {
    details.push('⚠️  MIN_PROFIT_USDC not set');
    issues = true;
  } else {
    details.push(`✓ Min profit threshold: $${minProfit}`);
  }

  if (dryRun === 'true') {
    details.push('⚠️  DRY_RUN=true (no real trades)');
  } else {
    details.push('✓ LIVE TRADING ENABLED');
  }

  return {
    isValid: !issues,
    message: issues ? '⚠️  Trading configuration needs review' : '✅ Trading configuration valid',
    details,
  };
}

function checkWalletConfig(): ConfigStatus {
  const walletPath = process.env.WALLET_PATH;
  const walletAddress = process.env.WALLET_ADDRESS;

  const details: string[] = [];
  let issues = false;

  if (!walletPath) {
    details.push('⚠️  WALLET_PATH not set');
    issues = true;
  } else {
    details.push(`✓ Wallet path: ${walletPath}`);
  }

  if (!walletAddress) {
    details.push('⚠️  WALLET_ADDRESS not set');
    issues = true;
  } else {
    details.push(`✓ Wallet: ${walletAddress.substring(0, 20)}...`);
  }

  return {
    isValid: !issues,
    message: issues ? '⚠️  Wallet configuration incomplete' : '✅ Wallet configuration valid',
    details,
  };
}

function checkDependencies(): ConfigStatus {
  const packageJsonPath = './package.json';

  if (!fs.existsSync(packageJsonPath)) {
    return {
      isValid: false,
      message: '❌ package.json not found',
      details: ['Run: npm init -y'],
    };
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  const requiredDeps = [
    '@solana/web3.js',
    '@triton-one/yellowstone-grpc',
    '@grpc/grpc-js',
    'dotenv',
    'decimal.js',
  ];

  const installedDeps = packageJson.dependencies || {};
  const missing = requiredDeps.filter((dep) => !installedDeps[dep]);

  if (missing.length > 0) {
    return {
      isValid: false,
      message: '❌ Missing dependencies',
      details: [`Missing: ${missing.join(', ')}`, 'Run: npm install'],
    };
  }

  const details: string[] = ['✓ Node modules installed'];
  Object.keys(installedDeps).forEach((dep) => {
    if (requiredDeps.includes(dep)) {
      details.push(`  ✓ ${dep}@${installedDeps[dep]}`);
    }
  });

  return {
    isValid: true,
    message: '✅ All dependencies installed',
    details,
  };
}

function checkPerformanceSettings(): ConfigStatus {
  const priorityFee = process.env.BASE_PRIORITY_FEE_LAMPORTS;
  const maxSlippage = process.env.MAX_SLIPPAGE_PCT;
  const swapMode = process.env.SWAP_MODE;

  const details: string[] = [];

  if (priorityFee) {
    const fee = parseInt(priorityFee);
    if (fee < 50000) {
      details.push(`⚠️  Priority fee low: ${fee} (may be slow)`);
    } else if (fee > 200000) {
      details.push(`⚠️  Priority fee high: ${fee} (expensive)`);
    } else {
      details.push(`✓ Priority fee optimized: ${fee}`);
    }
  }

  if (maxSlippage) {
    const slippage = parseFloat(maxSlippage);
    if (slippage < 0.003) {
      details.push(`⚠️  Slippage tight: ${slippage} (may fail)`);
    } else if (slippage > 0.01) {
      details.push(`⚠️  Slippage loose: ${slippage} (lower profit)`);
    } else {
      details.push(`✓ Slippage configured: ${slippage}`);
    }
  }

  if (swapMode) {
    details.push(`✓ Swap mode: ${swapMode}`);
  }

  return {
    isValid: true,
    message: '✅ Performance settings configured',
    details,
  };
}

async function runChecks() {
  console.log('');
  log(colors.blue, '════════════════════════════════════════════════════════════');
  log(colors.blue, '  QuickNode gRPC + RPC Configuration Checker');
  log(colors.blue, '════════════════════════════════════════════════════════════');
  console.log('');

  const checks = [
    { name: '🌐 RPC Endpoint (Trading)', check: checkRpcEndpoint },
    { name: '⚡ gRPC Endpoint (Scanning)', check: checkGrpcEndpoint },
    { name: '📊 Trading Configuration', check: checkTradingConfig },
    { name: '💰 Wallet Configuration', check: checkWalletConfig },
    { name: '📦 Dependencies', check: checkDependencies },
    { name: '⚙️  Performance Settings', check: checkPerformanceSettings },
  ];

  let allValid = true;

  for (const check of checks) {
    const result = check.check();
    log(colors.cyan, `${check.name}:`);
    log(result.isValid ? colors.green : colors.yellow, `  ${result.message}`);

    if (result.details) {
      result.details.forEach((detail) => {
        console.log(`    ${detail}`);
      });
    }

    if (!result.isValid) {
      allValid = false;
    }

    console.log('');
  }

  log(colors.blue, '════════════════════════════════════════════════════════════');

  if (allValid) {
    log(colors.green, '✅ All checks passed! Ready to launch bot.');
    log(colors.green, '   Run: npm run bot:optimized:live');
  } else {
    log(colors.yellow, '⚠️  Fix issues above before launching.');
  }

  console.log('');
}

runChecks().catch((error) => {
  log(colors.red, `❌ Error: ${error.message}`);
  process.exit(1);
});
