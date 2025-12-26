import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import { Swap as SwapEvent, Mint as MintEvent, Burn as BurnEvent } from "../generated/templates/CLPool/CLPool";
import { Pool, Swap, Mint, Burn, PoolDayData, PoolHourData, Protocol } from "../generated/schema";

let ZERO_BD = BigDecimal.fromString("0");
let ZERO_BI = BigInt.fromI32(0);
let ONE_BI = BigInt.fromI32(1);
let BI_18 = BigInt.fromI32(18);

function exponentToBigDecimal(decimals: i32): BigDecimal {
    let bd = BigDecimal.fromString("1");
    for (let i = 0; i < decimals; i++) {
        bd = bd.times(BigDecimal.fromString("10"));
    }
    return bd;
}

function convertTokenToDecimal(amount: BigInt, decimals: i32): BigDecimal {
    if (decimals == 0) {
        return amount.toBigDecimal();
    }
    return amount.toBigDecimal().div(exponentToBigDecimal(decimals));
}

function abs(value: BigInt): BigInt {
    if (value.lt(ZERO_BI)) {
        return value.neg();
    }
    return value;
}

// Get or create day data for pool
function updatePoolDayData(pool: Pool, timestamp: BigInt): PoolDayData {
    let dayTimestamp = timestamp.toI32() / 86400;
    let dayId = pool.id + "-" + dayTimestamp.toString();

    let dayData = PoolDayData.load(dayId);
    if (!dayData) {
        dayData = new PoolDayData(dayId);
        dayData.pool = pool.id;
        dayData.date = dayTimestamp * 86400;
        dayData.volumeToken0 = ZERO_BD;
        dayData.volumeToken1 = ZERO_BD;
        dayData.volumeUSD = ZERO_BD;
        dayData.tvlUSD = ZERO_BD;
        dayData.feesUSD = ZERO_BD;
        dayData.txCount = ZERO_BI;
        dayData.open = ZERO_BD;
        dayData.high = ZERO_BD;
        dayData.low = ZERO_BD;
        dayData.close = ZERO_BD;
    }
    return dayData;
}

// Get or create hour data for pool
function updatePoolHourData(pool: Pool, timestamp: BigInt): PoolHourData {
    let hourTimestamp = timestamp.toI32() / 3600;
    let hourId = pool.id + "-" + hourTimestamp.toString();

    let hourData = PoolHourData.load(hourId);
    if (!hourData) {
        hourData = new PoolHourData(hourId);
        hourData.pool = pool.id;
        hourData.periodStartTimestamp = hourTimestamp * 3600;
        hourData.volumeToken0 = ZERO_BD;
        hourData.volumeToken1 = ZERO_BD;
        hourData.volumeUSD = ZERO_BD;
        hourData.tvlUSD = ZERO_BD;
        hourData.feesUSD = ZERO_BD;
        hourData.txCount = ZERO_BI;
    }
    return hourData;
}

export function handleSwap(event: SwapEvent): void {
    let pool = Pool.load(event.address.toHexString());
    if (!pool) return;

    // Update pool state
    pool.sqrtPriceX96 = event.params.sqrtPriceX96;
    pool.tick = event.params.tick;
    pool.liquidity = event.params.liquidity;

    // Calculate volumes (use absolute values)
    let amount0 = abs(event.params.amount0);
    let amount1 = abs(event.params.amount1);

    let amount0Decimal = convertTokenToDecimal(amount0, 18); // TODO: get from token
    let amount1Decimal = convertTokenToDecimal(amount1, 18);

    // Simple USD estimate (assume stablecoin value for now)
    let volumeUSD = amount0Decimal.plus(amount1Decimal).div(BigDecimal.fromString("2"));

    pool.volumeToken0 = pool.volumeToken0.plus(amount0Decimal);
    pool.volumeToken1 = pool.volumeToken1.plus(amount1Decimal);
    pool.volumeUSD = pool.volumeUSD.plus(volumeUSD);
    pool.txCount = pool.txCount.plus(ONE_BI);
    pool.save();

    // Create swap entity
    let swapId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    let swap = new Swap(swapId);
    swap.pool = pool.id;
    swap.sender = event.params.sender;
    swap.recipient = event.params.recipient;
    swap.amount0 = amount0Decimal;
    swap.amount1 = amount1Decimal;
    swap.amountUSD = volumeUSD;
    swap.sqrtPriceX96 = event.params.sqrtPriceX96;
    swap.tick = event.params.tick;
    swap.timestamp = event.block.timestamp;
    swap.blockNumber = event.block.number;
    swap.transaction = event.transaction.hash;
    swap.save();

    // Update day data
    let dayData = updatePoolDayData(pool, event.block.timestamp);
    dayData.volumeToken0 = dayData.volumeToken0.plus(amount0Decimal);
    dayData.volumeToken1 = dayData.volumeToken1.plus(amount1Decimal);
    dayData.volumeUSD = dayData.volumeUSD.plus(volumeUSD);
    dayData.txCount = dayData.txCount.plus(ONE_BI);
    dayData.tvlUSD = pool.totalValueLockedUSD;
    dayData.save();

    // Update hour data
    let hourData = updatePoolHourData(pool, event.block.timestamp);
    hourData.volumeToken0 = hourData.volumeToken0.plus(amount0Decimal);
    hourData.volumeToken1 = hourData.volumeToken1.plus(amount1Decimal);
    hourData.volumeUSD = hourData.volumeUSD.plus(volumeUSD);
    hourData.txCount = hourData.txCount.plus(ONE_BI);
    hourData.tvlUSD = pool.totalValueLockedUSD;
    hourData.save();

    // Update protocol stats
    let protocol = Protocol.load("windswap");
    if (protocol) {
        protocol.totalVolumeUSD = protocol.totalVolumeUSD.plus(volumeUSD);
        protocol.totalSwaps = protocol.totalSwaps.plus(ONE_BI);
        protocol.save();
    }
}

export function handleMint(event: MintEvent): void {
    let pool = Pool.load(event.address.toHexString());
    if (!pool) return;

    let amount0 = convertTokenToDecimal(event.params.amount0, 18);
    let amount1 = convertTokenToDecimal(event.params.amount1, 18);
    let amountUSD = amount0.plus(amount1).div(BigDecimal.fromString("2"));

    // Update TVL
    pool.totalValueLockedToken0 = pool.totalValueLockedToken0.plus(amount0);
    pool.totalValueLockedToken1 = pool.totalValueLockedToken1.plus(amount1);
    pool.totalValueLockedUSD = pool.totalValueLockedUSD.plus(amountUSD);
    pool.save();

    // Create mint entity
    let mintId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    let mint = new Mint(mintId);
    mint.pool = pool.id;
    mint.owner = event.params.owner;
    mint.sender = event.params.sender;
    mint.tickLower = event.params.tickLower;
    mint.tickUpper = event.params.tickUpper;
    mint.amount = event.params.amount;
    mint.amount0 = amount0;
    mint.amount1 = amount1;
    mint.amountUSD = amountUSD;
    mint.timestamp = event.block.timestamp;
    mint.transaction = event.transaction.hash;
    mint.save();

    // Update protocol TVL
    let protocol = Protocol.load("windswap");
    if (protocol) {
        protocol.totalTVLUSD = protocol.totalTVLUSD.plus(amountUSD);
        protocol.save();
    }
}

export function handleBurn(event: BurnEvent): void {
    let pool = Pool.load(event.address.toHexString());
    if (!pool) return;

    let amount0 = convertTokenToDecimal(event.params.amount0, 18);
    let amount1 = convertTokenToDecimal(event.params.amount1, 18);
    let amountUSD = amount0.plus(amount1).div(BigDecimal.fromString("2"));

    // Update TVL (subtract)
    pool.totalValueLockedToken0 = pool.totalValueLockedToken0.minus(amount0);
    pool.totalValueLockedToken1 = pool.totalValueLockedToken1.minus(amount1);
    pool.totalValueLockedUSD = pool.totalValueLockedUSD.minus(amountUSD);
    pool.save();

    // Create burn entity
    let burnId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    let burn = new Burn(burnId);
    burn.pool = pool.id;
    burn.owner = event.params.owner;
    burn.tickLower = event.params.tickLower;
    burn.tickUpper = event.params.tickUpper;
    burn.amount = event.params.amount;
    burn.amount0 = amount0;
    burn.amount1 = amount1;
    burn.amountUSD = amountUSD;
    burn.timestamp = event.block.timestamp;
    burn.transaction = event.transaction.hash;
    burn.save();

    // Update protocol TVL
    let protocol = Protocol.load("windswap");
    if (protocol) {
        protocol.totalTVLUSD = protocol.totalTVLUSD.minus(amountUSD);
        protocol.save();
    }
}
