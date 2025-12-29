import os
import json
import requests
from decimal import Decimal, getcontext
from dotenv import load_dotenv

from solana.rpc.api import Client
from solders.pubkey import Pubkey

# ==============================
# LOAD ENV
# ==============================
load_dotenv()
getcontext().prec = 18

RPC_URL = os.getenv("RPC_URL")
HELIUS_API_KEY = os.getenv("HELIUS_API_KEY")
USE_HELIUS_GRPC = os.getenv("USE_HELIUS_GRPC", "false").lower() == "true"

POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "0"))
DRY_RUN = os.getenv("DRY_RUN", "true").lower() == "true"

if not RPC_URL:
    raise RuntimeError("RPC_URL missing in .env")

# ==============================
# RPC CLIENT (PAID HELIUS)
# ==============================
client = Client(RPC_URL)

print("[OK] RPC connected")
print(f"[OK] DRY_RUN = {DRY_RUN}")
print(f"[OK] USE_HELIUS_GRPC = {USE_HELIUS_GRPC}")
print(f"[OK] POLL_INTERVAL = {POLL_INTERVAL}")

# ==============================

# CONSTANTS
# ==============================
SOL_MINT = "So11111111111111111111111111111111111111112"
USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

# MANUALLY VERIFIED POOLS - These are the ONLY pools the bot will use
# Data verified by user with actual SOL/USDC liquidity
PREDEFINED_POOLS = [
    {
        "name": "SOL/USDC 0.05% [VERIFIED]",
        "address": "7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm",
        "fee_rate": 0.0005,
        "config": "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
        "vault_a": "9RfZwn2Prux6QesG1Noo4HzMEBv3rPndJ2bN2Wwd6a7p",
        "vault_b": "BVNo8ftg2LkkssnWT4ZWdtoFaevnfD6ExYeramwM27pe",
    },
    {
        "name": "SOL/USDC 0.01% [VERIFIED]",
        "address": "83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d",
        "fee_rate": 0.0001,
        "config": "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ",
        "vault_a": "D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4",
        "vault_b": "dwxR9YF7WwnJJu7bPC4UNcWFpcSsooH6fxbpoa3fTbJ",
    },
]

# Arbitrage thresholds
MIN_PROFIT_THRESHOLD = Decimal("0.00001")  # 0.001% minimum profit
OPTIMAL_PROFIT_THRESHOLD = Decimal("0.0001")  # 0.01% optimal profit

# ==============================
# WHIRLPOOL DECODER
# ==============================
def get_vault_balance(vault_address: str, is_usdc: bool = False) -> dict:
    """
    Get the balance of a vault account.
    For SOL vaults: Returns lamports balance (native SOL)
    For USDC vaults: Returns token account balance (SPL tokens)
    """
    try:
        resp = client.get_account_info(Pubkey.from_string(vault_address))
        if not resp.value:
            return {"raw": 0, "display": 0.0, "token": "USDC" if is_usdc else "SOL"}
        
        if is_usdc:
            data = resp.value.data
            if len(data) >= 72:
                amount = int.from_bytes(bytes(data[64:72]), "little")
                display = amount / 1_000_000
                return {"raw": amount, "display": display, "token": "USDC"}
            return {"raw": 0, "display": 0.0, "token": "USDC"}
        else:
            lamports = resp.value.lamports
            display = lamports / 1_000_000_000
            return {"raw": lamports, "display": display, "token": "SOL"}
    except Exception:
        return {"raw": 0, "display": 0.0, "token": "USDC" if is_usdc else "SOL"}

def sqrt_price_to_price(sqrt_price_x64: int) -> Decimal:
    """Convert sqrt price X64 to regular price"""
    sqrt_price = Decimal(sqrt_price_x64) / Decimal(2 ** 64)
    price = sqrt_price ** 2
    return price * Decimal(10**9) / Decimal(10**6)

def decode_whirlpool(pool_pubkey: str):
    """Decode whirlpool account data (fallback method)"""
    resp = client.get_account_info(Pubkey.from_string(pool_pubkey))
    if not resp.value:
        raise RuntimeError("Failed to fetch Whirlpool account")

    data = resp.value.data
    if len(data) != 653:
        raise RuntimeError("Not a Whirlpool account")

    sqrt_price_x64 = int.from_bytes(data[65:81], "little")
    
    # Liquidity is stored as u128 (16 bytes)
    liquidity_raw = int.from_bytes(data[85:101], "little")
    
    # Convert to human-readable (approximate L = sqrt(X * Y) in token units)
    # For display purposes, divide by 2^64 to get more reasonable numbers
    liquidity_display = liquidity_raw / (2 ** 64) if liquidity_raw > 0 else 0
    
    tick_current_index = int.from_bytes(data[81:85], "little", signed=True)
    tick_spacing = int.from_bytes(data[101:103], "little")

    vault_a = Pubkey.from_bytes(bytes(data[104:136]))
    vault_b = Pubkey.from_bytes(bytes(data[136:168]))

    tick_array_0 = Pubkey.from_bytes(bytes(data[168:200]))
    tick_array_1 = Pubkey.from_bytes(bytes(data[200:232]))
    tick_array_2 = Pubkey.from_bytes(bytes(data[232:264]))

    return {
        "price": sqrt_price_to_price(sqrt_price_x64),
        "sqrt_price_x64": sqrt_price_x64,
        "liquidity_raw": liquidity_raw,  # Raw liquidity value (u128)
        "liquidity": liquidity_display,  # Human-readable
        "vault_a": str(vault_a),
        "vault_b": str(vault_b),
        "tick_current_index": tick_current_index,
        "tick_spacing": tick_spacing,
        "tick_array_0": str(tick_array_0),
        "tick_array_1": str(tick_array_1),
        "tick_array_2": str(tick_array_2),
    }

# ==============================
# ARBITRAGE CALCULATION
# ==============================
def calculate_arbitrage_simple(pool1_data: dict, pool2_data: dict) -> dict:
    """Calculate arbitrage profit using simple price comparison"""
    pool1_price = pool1_data["price"]
    pool2_price = pool2_data["price"]
    pool1_fee = pool1_data["fee_rate"]
    pool2_fee = pool2_data["fee_rate"]
    
    if pool1_price == 0 or pool2_price == 0:
        return {"profitable": False, "profit_pct": Decimal("0"), "uses_sdk": False}

    if pool1_price < pool2_price:
        buy_price = pool1_price
        sell_price = pool2_price
        buy_fee = pool1_fee
        sell_fee = pool2_fee
        direction = f"{pool1_data['name']} -> {pool2_data['name']}"
    else:
        buy_price = pool2_price
        sell_price = pool1_price
        buy_fee = pool2_fee
        sell_fee = pool1_fee
        direction = f"{pool2_data['name']} -> {pool1_data['name']}"

    cost = buy_price * (Decimal("1") + buy_fee)
    revenue = sell_price * (Decimal("1") - sell_fee)
    profit_pct = (revenue - cost) / cost

    return {
        "profitable": profit_pct >= MIN_PROFIT_THRESHOLD,
        "optimal": profit_pct >= OPTIMAL_PROFIT_THRESHOLD,
        "profit_pct": profit_pct,
        "direction": direction,
        "buy_price": buy_price,
        "sell_price": sell_price,
        "total_fees": buy_fee + sell_fee,
        "uses_sdk": False,
    }

def find_arbitrage_opportunities(pools_data: list) -> list:
    """Find arbitrage opportunities between pools"""
    opportunities = []

    for i in range(len(pools_data)):
        for j in range(i + 1, len(pools_data)):
            pool1 = pools_data[i]
            pool2 = pools_data[j]

            # Use simple calculation
            arb = calculate_arbitrage_simple(pool1, pool2)

            if arb["profitable"]:
                opportunities.append({
                    "pool1": pool1,
                    "pool2": pool2,
                    "arbitrage": arb
                })

    return opportunities

# ==============================
# MAIN
# ==============================
def main():
    global opportunities
    from datetime import datetime
    print("\n" + "=" * 70)
    print("ORCA TO ORCA ARBITRAGE SCANNER")
    print(f"Scan Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    pools_data = []

    print("\n[OK] Loading PREDEFINED pools ONLY (Auto-discovery DISABLED)")
    print(f"[OK] Using {len(PREDEFINED_POOLS)} manually verified pool(s)\n")

    for predefined in PREDEFINED_POOLS:
        try:
            print(f"[LOADING] {predefined['name']}")
            print(f"  Pool Address: {predefined['address']}")
            print(f"  Vault A (SOL): {predefined['vault_a']}")
            print(f"  Vault B (USDC): {predefined['vault_b']}")
            
            vault_a_info = get_vault_balance(predefined["vault_a"], is_usdc=False)
            vault_b_info = get_vault_balance(predefined["vault_b"], is_usdc=True)
            
            print(f"  Vault A Balance: {vault_a_info['display']:,.4f} {vault_a_info['token']}")
            print(f"  Vault B Balance: {vault_b_info['display']:,.4f} {vault_b_info['token']}")
            
            info = decode_whirlpool(predefined["address"])
            
            pools_data.append({
                "address": predefined["address"],
                "name": predefined["name"],
                "price": info["price"],
                "sqrt_price_x64": info["sqrt_price_x64"],
                "fee_rate": Decimal(str(predefined["fee_rate"])),
                "liquidity": info["liquidity"],
                "vault_a": predefined["vault_a"],
                "vault_b": predefined["vault_b"],
                "vault_a_balance": vault_a_info['display'],
                "vault_a_token": vault_a_info['token'],
                "vault_b_balance": vault_b_info['display'],
                "vault_b_token": vault_b_info['token'],
                "tick_current_index": info["tick_current_index"],
                "tick_spacing": info["tick_spacing"],
                "tick_array_0": info["tick_array_0"],
                "tick_array_1": info["tick_array_1"],
                "tick_array_2": info["tick_array_2"],
            })
            print(f"  -> [LOADED] {predefined['name']}")
            print()
        except Exception as e:
            print(f"  -> [ERROR] Failed to load {predefined['name']}: {e}")
            print()

    # Display price comparison
    if len(pools_data) == 2:
        print(f"\n{'=' * 70}")
        print("REAL-TIME PRICE COMPARISON")
        print("=" * 70)

        pool1 = pools_data[0]
        pool2 = pools_data[1]

        price_diff = abs(pool1["price"] - pool2["price"])
        price_spread_pct = (price_diff / min(pool1["price"], pool2["price"])) * 100

        print(f"\n  Pool 1 ({pool1['name']})")
        print(f"    Spot Price: ${pool1['price']:.6f}")
        print(f"    - Vault A: {pool1.get('vault_a', 'N/A')}")
        print(f"      Balance: {pool1.get('vault_a_balance', 0):,.4f} {pool1.get('vault_a_token', 'SOL')}")
        print(f"    - Vault B: {pool1.get('vault_b', 'N/A')}")
        print(f"       Balance: {pool1.get('vault_b_balance', 0):,.4f} {pool1.get('vault_b_token', 'USDC')}")
        
        print(f"\n  Pool 2 ({pool2['name']})")
        print(f"    Spot Price: ${pool2['price']:.6f}")
        print(f"    - Vault A: {pool2.get('vault_a', 'N/A')}")
        print(f"      Balance: {pool2.get('vault_a_balance', 0):,.4f} {pool2.get('vault_a_token', 'SOL')}")
        print(f"    - Vault B: {pool2.get('vault_b', 'N/A')}")
        print(f"       Balance: {pool2.get('vault_b_balance', 0):,.4f} {pool2.get('vault_b_token', 'USDC')}")
        
        print(f"\n  Spot Price Difference: ${price_diff:.6f}")
        print(f"  Spot Price Spread: {price_spread_pct:.4f}%")
        print(f"  Total Fees: {(pool1['fee_rate'] + pool2['fee_rate'])*100:.3f}%")

    # Display loaded pools
    print(f"\n{'=' * 70}")
    print(f"LOADED POOLS ({len(pools_data)} total - PREDEFINED VERIFIED ONLY)")
    print("=" * 70)

    for idx, pool in enumerate(pools_data, 1):
        print(f"\n[Pool {idx}] {pool['name']}")
        print(f"  Address: {pool['address']}")
        print(f"  Spot Price: ${pool['price']:.6f}")
        print(f"  Fee: {pool['fee_rate']*100:.3f}%")
        print(f"  Liquidity: {pool['liquidity']:,.2f} (L = sqrt(X*Y))")
        print(f"  Current Tick: {pool.get('tick_current_index', 'N/A')}")
        print(f"  Tick Spacing: {pool.get('tick_spacing', 'N/A')}")
        print(f"  - Vault A (SOL): {pool.get('vault_a', 'N/A')}")
        if 'vault_a_balance' in pool:
            print(f"    Balance: {pool['vault_a_balance']:,.4f} {pool.get('vault_a_token', 'SOL')}")
        print(f"  - Vault B (USDC): {pool.get('vault_b', 'N/A')}")
        if 'vault_b_balance' in pool:
            print(f"     Balance: {pool['vault_b_balance']:,.4f} {pool.get('vault_b_token', 'USDC')}")
        print(f"  Tick Array 0: {pool.get('tick_array_0', 'N/A')}")
        print(f"  Tick Array 1: {pool.get('tick_array_1', 'N/A')}")
        print(f"  Tick Array 2: {pool.get('tick_array_2', 'N/A')}")

    # Find arbitrage opportunities
    print(f"\n{'=' * 70}")
    print("SCANNING FOR ARBITRAGE OPPORTUNITIES")
    print("Using simple price comparison")
    print("=" * 70)

    opportunities = find_arbitrage_opportunities(pools_data)

    if not opportunities:
        print("\n[!] No profitable arbitrage opportunities found")
        print(f"  (Minimum threshold: {MIN_PROFIT_THRESHOLD*100:.4f}% - ANY profit after fees)")

        if len(pools_data) >= 2:
            print("\n[DEBUG] Price spread analysis:")
            arb = calculate_arbitrage_simple(pools_data[0], pools_data[1])
            
            print(f"\n  Spot Price Spread: {abs(pools_data[0]['price'] - pools_data[1]['price']) / min(pools_data[0]['price'], pools_data[1]['price']) * 100:.4f}%")
            print(f"  Total Fees: {(pools_data[0]['fee_rate'] + pools_data[1]['fee_rate'])*100:.4f}%")
            print(f"  Net Profit (Simple): {arb['profit_pct']*100:.4f}%")
            print(f"  Status: {'[PROFITABLE]' if arb['profitable'] else '[NOT PROFITABLE]'}")
    else:
        print(f"\n[OK] Found {len(opportunities)} arbitrage opportunity(ies)!\n")

        for idx, opp in enumerate(opportunities, 1):
            arb = opp["arbitrage"]
            pool1 = opp["pool1"]
            pool2 = opp["pool2"]

            print("=" * 70)
            print(f"OPPORTUNITY #{idx}")
            print("=" * 70)

            print(f"\n[EXECUTION PATH] {arb['direction']}")

            print(f"\n[CALCULATION RESULTS]")
            print(f"   Buy Price: ${arb.get('buy_price', 0):.4f}")
            print(f"   Sell Price: ${arb.get('sell_price', 0):.4f}")
            print(f"   Total Fees: {arb.get('total_fees', 0)*100:.3f}%")
            print(f"   Net Profit: {arb['profit_pct']*100:.4f}%")

            if arb["optimal"]:
                print(f"\n   [***OPTIMAL***] (>{OPTIMAL_PROFIT_THRESHOLD*100:.3f}%)")
            else:
                print(f"\n   [PROFITABLE] (>{MIN_PROFIT_THRESHOLD*100:.4f}%)")

            print()

    print("\n" + "=" * 70)
    print("[OK] Scan complete")
    print("=" * 70)

    if opportunities:
        best = opportunities[0]["arbitrage"]

        signal = {
            "base": "USDC",
            "direction": best["direction"],
            "profit_pct": float(best["profit_pct"] * 100),
            "trade_usdc": 50
        }

        with open("signal.json", "w") as f:
            json.dump(signal, f, indent=2)

        print("[OK] signal.json written")
    else:
        # IMPORTANT: delete old signal if no opportunity
        if os.path.exists("signal.json"):
            os.remove("signal.json")
            print("[OK] signal.json removed (no opportunity)")

if __name__ == "__main__":
    import time

    if POLL_INTERVAL > 0:
        print("\n[OK] Continuous monitoring enabled")
        print(f"[OK] Scanning every {POLL_INTERVAL} seconds")
        print("[OK] Press Ctrl+C to stop\n")

        try:
            iteration = 1
            while True:
                print(f"\n{'#' * 70}")
                print(f"# SCAN ITERATION #{iteration}")
                print(f"{'#' * 70}\n")
                main()
                iteration += 1
                time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            print("\n\n[OK] Monitoring stopped by user")
    else:
        main()