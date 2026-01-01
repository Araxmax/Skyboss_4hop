const fs = require('fs');
const path = require('path');

/**
 * View and analyze scanner logs
 */

const logsDir = './logs';

// Find latest UltraFastScanner CSV
const files = fs.readdirSync(logsDir)
  .filter(f => f.startsWith('UltraFastScanner_') && f.endsWith('.csv'))
  .sort()
  .reverse();

if (files.length === 0) {
  console.log('❌ No scanner logs found in logs/ directory');
  console.log('Run your bot first with: npm run hft');
  process.exit(1);
}

const latestFile = path.join(logsDir, files[0]);
console.log(`\n📊 Reading: ${latestFile}\n`);

const content = fs.readFileSync(latestFile, 'utf8');
const lines = content.split('\n').filter(line => line.trim().length > 0);

if (lines.length <= 1) {
  console.log('⏳ Log file is empty. Bot hasn\'t received any price updates yet.');
  console.log('Wait for pool activity and check back in a few minutes.');
  process.exit(0);
}

// Parse CSV
const headers = lines[0].split(',');
const entries = lines.slice(1).map(line => {
  const cols = line.split(',');
  return {
    slNo: cols[0],
    timestamp: cols[1],
    price001: parseFloat(cols[2]),
    price005: parseFloat(cols[3]),
    spreadUsd: parseFloat(cols[4]),
    spreadPct: parseFloat(cols[5].replace('%', '')),
    netProfit: parseFloat(cols[6].replace('%', '')),
    tradePossible: cols[7],
    failureReason: cols.slice(8).join(',').replace(/"/g, '').trim()
  };
});

console.log('='.repeat(80));
console.log('📊 SCANNER LOG ANALYSIS');
console.log('='.repeat(80));

// Summary statistics
const totalChecks = entries.length;
const profitableCount = entries.filter(e => e.tradePossible === 'YES').length;
const avgSpread = entries.reduce((sum, e) => sum + e.spreadPct, 0) / totalChecks;
const avgProfit = entries.reduce((sum, e) => sum + e.netProfit, 0) / totalChecks;
const maxProfit = Math.max(...entries.map(e => e.netProfit));
const minProfit = Math.min(...entries.map(e => e.netProfit));

console.log(`\n📈 SUMMARY:`);
console.log(`   Total Checks: ${totalChecks}`);
console.log(`   Profitable Signals: ${profitableCount} (${(profitableCount/totalChecks*100).toFixed(2)}%)`);
console.log(`   Average Spread: ${avgSpread.toFixed(4)}%`);
console.log(`   Average Net Profit: ${avgProfit.toFixed(4)}%`);
console.log(`   Max Profit: ${maxProfit.toFixed(4)}%`);
console.log(`   Min Profit: ${minProfit.toFixed(4)}%`);

// Show latest entries
console.log(`\n📋 LATEST 10 CHECKS:`);
console.log('-'.repeat(80));
console.log(` # | Time         | 0.01% Price | 0.05% Price | Spread   | Net Profit | Result`);
console.log('-'.repeat(80));

const latest = entries.slice(-10).reverse();
latest.forEach(e => {
  const status = e.tradePossible === 'YES' ? '✅ YES' : '❌ NO ';
  const profit = e.netProfit >= 0 ? `+${e.netProfit.toFixed(4)}%` : `${e.netProfit.toFixed(4)}%`;
  const time = e.timestamp.split(' ').slice(1).join(' '); // Remove date, keep time

  console.log(`${e.slNo.padStart(3)} | ${time.padEnd(12)} | $${e.price001.toFixed(2).padStart(9)} | $${e.price005.toFixed(2).padStart(9)} | ${e.spreadPct.toFixed(4).padStart(7)}% | ${profit.padStart(10)} | ${status}`);
});

// Show profitable signals
if (profitableCount > 0) {
  console.log(`\n✅ PROFITABLE SIGNALS (${profitableCount} total):`);
  console.log('-'.repeat(80));
  console.log(` # | Timestamp           | Spread   | Net Profit | 0.01% Price | 0.05% Price`);
  console.log('-'.repeat(80));

  const profitable = entries.filter(e => e.tradePossible === 'YES');
  profitable.forEach(e => {
    const profit = `+${e.netProfit.toFixed(4)}%`;
    console.log(`${e.slNo.padStart(3)} | ${e.timestamp.padEnd(20)} | ${e.spreadPct.toFixed(4).padStart(7)}% | ${profit.padStart(10)} | $${e.price001.toFixed(2).padStart(9)} | $${e.price005.toFixed(2).padStart(9)}`);
  });
} else {
  console.log(`\n❌ NO PROFITABLE SIGNALS YET`);
  console.log(`   Max profit seen: ${maxProfit.toFixed(4)}% (need > 0.05% to execute)`);
  console.log(`   This is normal for efficient markets like Orca SOL/USDC`);
}

// Profit distribution
console.log(`\n📊 PROFIT DISTRIBUTION:`);
const ranges = [
  { min: -Infinity, max: -0.1, label: '< -0.10%' },
  { min: -0.1, max: -0.05, label: '-0.10% to -0.05%' },
  { min: -0.05, max: 0, label: '-0.05% to 0%' },
  { min: 0, max: 0.05, label: '0% to 0.05%' },
  { min: 0.05, max: 0.10, label: '0.05% to 0.10% ✅' },
  { min: 0.10, max: 0.20, label: '0.10% to 0.20% ✅✅' },
  { min: 0.20, max: Infinity, label: '> 0.20% ✅✅✅' }
];

ranges.forEach(range => {
  const count = entries.filter(e => e.netProfit >= range.min && e.netProfit < range.max).length;
  const pct = (count / totalChecks * 100).toFixed(1);
  const bar = '█'.repeat(Math.floor(count / totalChecks * 50));
  console.log(`   ${range.label.padEnd(25)} ${count.toString().padStart(4)} (${pct.padStart(5)}%) ${bar}`);
});

// Recommendations
console.log(`\n💡 RECOMMENDATIONS:`);

if (profitableCount === 0) {
  if (maxProfit < 0) {
    console.log(`   ⚠️  All checks showed negative profit - spreads are too small`);
    console.log(`   ⚠️  Consider raising MIN_SPREAD_PCT to 0.0015 (0.15%) or higher`);
    console.log(`   ⚠️  Or wait for higher market volatility`);
  } else if (maxProfit < 0.05) {
    console.log(`   ⚠️  Max profit ${maxProfit.toFixed(4)}% is below your 0.05% threshold`);
    console.log(`   💡 Lower MIN_SPREAD_PCT to see signals (but may lose money on fees)`);
    console.log(`   💡 Or keep current settings and wait for larger spreads`);
  }
} else {
  const profitableProfit = entries.filter(e => e.tradePossible === 'YES').reduce((sum, e) => sum + e.netProfit, 0) / profitableCount;
  console.log(`   ✅ You have ${profitableCount} profitable signals!`);
  console.log(`   ✅ Average profit on trades: ${profitableProfit.toFixed(4)}%`);
  console.log(`   💰 Keep current settings and let the bot run!`);
}

if (avgSpread < 0.1) {
  console.log(`   📊 Average spread: ${avgSpread.toFixed(4)}% (very efficient market)`);
  console.log(`   📊 Expect 1-5 profitable signals per hour in normal conditions`);
}

console.log('\n' + '='.repeat(80));
console.log('📁 Full log available at: ' + latestFile);
console.log('💡 Open in Excel/Google Sheets for detailed analysis');
console.log('='.repeat(80) + '\n');
