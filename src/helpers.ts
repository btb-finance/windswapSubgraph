import { BigInt, BigDecimal, Address, ethereum } from "@graphprotocol/graph-ts";
import { Bundle, Transaction, User } from "../generated/schema";

// Shared constants
export let ZERO_BD = BigDecimal.fromString("0");
export let ZERO_BI = BigInt.fromI32(0);
export let ONE_BI = BigInt.fromI32(1);
export let ONE_BD = BigDecimal.fromString("1");
export let Q96 = BigInt.fromI32(2).pow(96);
export let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Base addresses
export let WSEI_ADDRESS = "0x4200000000000000000000000000000000000006"; // WETH on Base
export let USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export let USDT_ADDRESS = "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2";
export let DAI_ADDRESS = "0x50c5725949a6f0c72e6c4a641f24049a917db0cb";
export let STABLECOINS: string[] = [USDC_ADDRESS, USDT_ADDRESS, DAI_ADDRESS];
export let WIND_ADDRESS = "0x888859feaab4922dfbb9add836172ec6f38cabb2";

// Helper: Convert exponent to BigDecimal (10^decimals)
export function exponentToBigDecimal(decimals: i32): BigDecimal {
    let bd = BigDecimal.fromString("1");
    for (let i = 0; i < decimals; i++) {
        bd = bd.times(BigDecimal.fromString("10"));
    }
    return bd;
}

// Helper: Convert token amount to decimal using actual token decimals
export function convertTokenToDecimal(amount: BigInt, decimals: i32): BigDecimal {
    if (decimals == 0) {
        return amount.toBigDecimal();
    }
    return amount.toBigDecimal().div(exponentToBigDecimal(decimals));
}

// Helper: Get absolute value of BigInt
export function abs(value: BigInt): BigInt {
    if (value.lt(ZERO_BI)) {
        return value.neg();
    }
    return value;
}

// Helper: Check if address is a stablecoin
export function isStablecoin(address: string): boolean {
    let lower = address.toLowerCase();
    for (let i = 0; i < STABLECOINS.length; i++) {
        if (lower == STABLECOINS[i]) {
            return true;
        }
    }
    return false;
}

// Get or create User entity
export function getOrCreateUser(address: string): User {
    let user = User.load(address);
    if (!user) {
        user = new User(address);
        user.totalPositions = ZERO_BI;
        user.totalVeNFTs = ZERO_BI;
        user.usdSwapped = ZERO_BD;
        user.save();
    }
    return user;
}

// Get or create Bundle (base price oracle)
export function getOrCreateBundle(): Bundle {
    let bundle = Bundle.load("windswap");
    if (!bundle) {
        bundle = new Bundle("windswap");
        bundle.ethPrice = ZERO_BD;
        bundle.lastUpdated = ZERO_BI;
        bundle.save();
    }
    return bundle;
}

// Get or create Transaction entity
export function getOrCreateTransaction(event: ethereum.Event): Transaction {
    let txHash = event.transaction.hash.toHexString();
    let transaction = Transaction.load(txHash);
    if (!transaction) {
        transaction = new Transaction(txHash);
        transaction.blockNumber = event.block.number;
        transaction.timestamp = event.block.timestamp;
        transaction.save();
    }
    return transaction;
}

// Fee tier mapping: tickSpacing -> fee in parts per million
export function getFeeTierFromTickSpacing(tickSpacing: i32): BigDecimal {
    if (tickSpacing == 1) return BigDecimal.fromString("100");       // 0.01%
    if (tickSpacing == 2) return BigDecimal.fromString("10000");     // 1.00%
    if (tickSpacing == 10) return BigDecimal.fromString("500");      // 0.05%
    if (tickSpacing == 50) return BigDecimal.fromString("2500");     // 0.25%
    if (tickSpacing == 60) return BigDecimal.fromString("3000");     // 0.30%
    if (tickSpacing == 100) return BigDecimal.fromString("5000");    // 0.50%
    if (tickSpacing == 200) return BigDecimal.fromString("10000");   // 1.00%
    // Default: 0.30% for unknown tick spacings
    return BigDecimal.fromString("3000");
}

export let FEE_DENOMINATOR = BigDecimal.fromString("1000000");
