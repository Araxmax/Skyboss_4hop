import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import fs from 'fs';
import * as dotenv from 'dotenv';
import { USDC_MINT } from './constants';

dotenv.config();

async function checkWalletBalance() {
  try {
    // Load wallet
    const walletPath = process.env.WALLET_PATH || '';
    const secret = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const wallet = Keypair.fromSecretKey(new Uint8Array(secret));

    // Connect to RPC
    const connection = new Connection(process.env.RPC_URL || '', 'confirmed');

    console.log('\n' + '='.repeat(70));
    console.log('WALLET BALANCE CHECK');
    console.log('='.repeat(70));
    console.log(`Wallet Address: ${wallet.publicKey.toBase58()}`);
    console.log('='.repeat(70));

    // Check SOL balance
    const solBalance = await connection.getBalance(wallet.publicKey);
    const solBalanceFormatted = (solBalance / LAMPORTS_PER_SOL).toFixed(9);
    console.log(`\nSOL Balance: ${solBalanceFormatted} SOL ($${(parseFloat(solBalanceFormatted) * 124).toFixed(2)} USD)`);

    if (solBalance < 0.01 * LAMPORTS_PER_SOL) {
      console.log(`❌ CRITICAL: Need at least 0.01 SOL for gas fees!`);
      console.log(`   Missing: ${(0.01 - parseFloat(solBalanceFormatted)).toFixed(9)} SOL`);
    } else {
      console.log(`✅ SOL balance sufficient for gas fees`);
    }

    // Check USDC balance
    try {
      const usdcMint = new PublicKey(USDC_MINT);
      const usdcTokenAccount = await getAssociatedTokenAddress(
        usdcMint,
        wallet.publicKey
      );

      console.log(`\nUSDC Token Account: ${usdcTokenAccount.toBase58()}`);

      const accountInfo = await getAccount(connection, usdcTokenAccount);
      const usdcBalance = Number(accountInfo.amount) / 1_000_000; // USDC has 6 decimals

      console.log(`USDC Balance: ${usdcBalance.toFixed(6)} USDC`);

      if (usdcBalance < 30) {
        console.log(`❌ CRITICAL: Need at least $30 USDC for trading!`);
        console.log(`   Missing: $${(30 - usdcBalance).toFixed(2)} USDC`);
      } else {
        console.log(`✅ USDC balance sufficient for $30 trades`);
      }
    } catch (error: any) {
      console.log(`\n❌ USDC Token Account: NOT FOUND OR NOT INITIALIZED`);
      console.log(`   Error: ${error.message}`);
      console.log(`\n   You need to:`);
      console.log(`   1. Create a USDC token account`);
      console.log(`   2. Deposit USDC to your wallet`);
    }

    console.log('\n' + '='.repeat(70));
    console.log('REQUIRED FOR TRADING:');
    console.log('='.repeat(70));
    console.log(`1. SOL: At least 0.01 SOL (~$1.24) for gas fees`);
    console.log(`2. USDC: At least $30 USDC for trading`);
    console.log(`3. USDC Token Account: Must be initialized`);
    console.log('='.repeat(70) + '\n');

  } catch (error: any) {
    console.error(`\n❌ ERROR: ${error.message}\n`);
    process.exit(1);
  }
}

checkWalletBalance();
