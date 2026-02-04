import { BigInt, BigDecimal, Address, ethereum } from "@graphprotocol/graph-ts";
import {
    Swap as SwapEvent,
    Mint as MintEvent,
    Burn as BurnEvent
} from "../generated/templates/CLPool/CLPool";
import {
    Pool,
    Token,
    Swap,
    Mint,
    Burn,
    Transaction,
    PoolDayData,
    PoolHourData,
    TokenDayData,
    Bundle,
    Protocol,
    LiquidityPosition,
    LiquidityPositionSnapshot,
    User
} from "../generated/schema";

let ZERO_BD = BigDecimal.fromString("0");
let ZERO_BI = BigInt.fromI32(0);
let ONE_BI = BigInt.fromI32(1);
let ONE_BD = BigDecimal.fromString("1");
let Q96 = BigInt.fromI32(2).pow(96);
let BI_18 = BigInt.fromI32(18);

// Helper: Convert exponent to BigDecimal
function exponentToBigDecimal(decimals: i32): BigDecimal {
    let bd = BigDecimal.fromString("1");
    for (let i = 0; i < decimals; i++) {
        bd = bd.times(BigDecimal.fromString("10"));
    }
    return bd;
}

// Helper: Convert token amount to decimal
function convertTokenToDecimal(amount: BigInt, decimals: i32): BigDecimal {
    if (decimals == 0) {
        return amount.toBigDecimal();
    }
    return amount.toBigDecimal().div(exponentToBigDecimal(decimals));
}

// Helper: Get absolute value
function abs(value: BigInt): BigInt {
    if (value.lt(ZERO_BI)) {
        return value.neg();
    }
    return value;
}

// ⭐ CALCULATE PRICE FROM sqrtPriceX96
function calculatePriceFromSqrtPriceX96(sqrtPriceX96: BigInt, token0Decimals: i32, token1Decimals: i32): BigDecimal {
    // price = (sqrtPriceX96 / 2^96)^2 * 10^(token0Decimals - token1Decimals)
    let sqrtPrice = sqrtPriceX96.toBigDecimal().div(Q96.toBigDecimal());
    let price = sqrtPrice.times(sqrtPrice);

    // Adjust for decimals difference
    let decimalDiff = token0Decimals - token1Decimals;
    if (decimalDiff > 0) {
        price = price.times(exponentToBigDecimal(decimalDiff));
    } else if (decimalDiff < 0) {
        price = price.div(exponentToBigDecimal(-decimalDiff));
    }

    return price;
}

// ⭐ GET OR CREATE USER (for tracking swap volume)
function getOrCreateUser(address: string): User {
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

// ⭐ ENSURE TOKEN HAS ALL REQUIRED FIELDS (for backward compatibility)
function ensureTokenFields(token: Token): void {
    if (!token.totalSupply) token.totalSupply = ZERO_BI;
    if (!token.tradeVolume) token.tradeVolume = ZERO_BD;
    if (!token.tradeVolumeUSD) token.tradeVolumeUSD = ZERO_BD;
    if (!token.untrackedVolumeUSD) token.untrackedVolumeUSD = ZERO_BD;
    if (!token.totalVolumeUSD) token.totalVolumeUSD = ZERO_BD;
    if (!token.txCount) token.txCount = ZERO_BI;
    if (!token.totalLiquidity) token.totalLiquidity = ZERO_BD;
    if (!token.derivedETH) token.derivedETH = ZERO_BD;
    if (!token.priceUSD) token.priceUSD = ZERO_BD;
}

// ⭐ GET OR CREATE BUNDLE (base price oracle)
function getOrCreateBundle(): Bundle {
    let bundle = Bundle.load("windswap");
    if (!bundle) {
        bundle = new Bundle("windswap");
        bundle.ethPrice = ZERO_BD; // Will be updated when we have WIND/USDC pool
        bundle.lastUpdated = ZERO_BI;
        bundle.save();
    }
    return bundle;
}

// ⭐ GET OR CREATE TRANSACTION
function getOrCreateTransaction(event: ethereum.Event): Transaction {
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

// ⭐ GET OR CREATE TOKEN DAY DATA
function getOrCreateTokenDayData(token: Token, timestamp: BigInt): TokenDayData {
    let dayTimestamp = timestamp.toI32() / 86400;
    let dayId = token.id + "-" + dayTimestamp.toString();

    let tokenDayData = TokenDayData.load(dayId);
    if (!tokenDayData) {
        tokenDayData = new TokenDayData(dayId);
        tokenDayData.date = dayTimestamp * 86400;
        tokenDayData.token = token.id;
        tokenDayData.dailyVolumeToken = ZERO_BD;
        tokenDayData.dailyVolumeETH = ZERO_BD;
        tokenDayData.dailyVolumeUSD = ZERO_BD;
        tokenDayData.dailyTxns = ZERO_BI;
        tokenDayData.totalLiquidityToken = ZERO_BD;
        tokenDayData.totalLiquidityETH = ZERO_BD;
        tokenDayData.totalLiquidityUSD = ZERO_BD;
        tokenDayData.priceUSD = ZERO_BD;
        tokenDayData.totalVolumeToken = ZERO_BD;
        tokenDayData.totalVolumeETH = ZERO_BD;
        tokenDayData.totalVolumeUSD = ZERO_BD;
    }
    return tokenDayData;
}

// ⭐ GET OR CREATE LIQUIDITY POSITION
function getOrCreateLiquidityPosition(user: Address, pool: Pool, timestamp: BigInt): LiquidityPosition {
    let id = user.toHexString() + "-" + pool.id;
    let position = LiquidityPosition.load(id);
    if (!position) {
        position = new LiquidityPosition(id);
        position.user = user.toHexString();
        position.pool = pool.id;
        position.liquidityTokenBalance = ZERO_BD;
        position.createdAtTimestamp = timestamp;
    }
    return position;
}

// Get or create day data for pool
function getOrCreatePoolDayData(pool: Pool, timestamp: BigInt): PoolDayData {
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
        dayData.feesToken0 = ZERO_BD;
        dayData.feesToken1 = ZERO_BD;
        dayData.txCount = ZERO_BI;
        dayData.open = ZERO_BD;
        dayData.high = ZERO_BD;
        dayData.low = ZERO_BD;
        dayData.close = ZERO_BD;
    }
    return dayData;
}

// Get or create hour data for pool
function getOrCreatePoolHourData(pool: Pool, timestamp: BigInt): PoolHourData {
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

// ⭐ UPDATE TOKEN PRICES
function updateTokenPrices(pool: Pool, bundle: Bundle): void {
    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    // Calculate prices from pool
    let token0Price = pool.token0Price;
    let token1Price = pool.token1Price;

    // Update token derivedETH (price in WIND/ETH)
    // For now, we use a simplified approach - tokens derive from each other
    // In production, you'd want to trace back to a stablecoin or WIND

    // If one token has a known price, derive the other
    if (token0.derivedETH.gt(ZERO_BD) && token0Price.gt(ZERO_BD)) {
        token1.derivedETH = token0.derivedETH.div(token0Price);
    }
    if (token1.derivedETH.gt(ZERO_BD) && token1Price.gt(ZERO_BD)) {
        token0.derivedETH = token1.derivedETH.times(token0Price);
    }

    // Calculate USD prices if we have bundle price
    if (bundle.ethPrice.gt(ZERO_BD)) {
        token0.priceUSD = token0.derivedETH.times(bundle.ethPrice);
        token1.priceUSD = token1.derivedETH.times(bundle.ethPrice);
    }

    token0.save();
    token1.save();
}

export function handleSwap(event: SwapEvent): void {
    let pool = Pool.load(event.address.toHexString());
    if (!pool) return;

    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    // Get or create transaction
    let transaction = getOrCreateTransaction(event);

    // Update pool state
    pool.sqrtPriceX96 = event.params.sqrtPriceX96;
    pool.tick = event.params.tick;
    pool.liquidity = event.params.liquidity;

    // ⭐ CALCULATE PRICES
    let token0Price = calculatePriceFromSqrtPriceX96(
        event.params.sqrtPriceX96,
        token0.decimals,
        token1.decimals
    );

    // Safety check: avoid division by zero
    let token1Price: BigDecimal;
    if (token0Price.gt(ZERO_BD)) {
        token1Price = ONE_BD.div(token0Price);
    } else {
        token0Price = ZERO_BD;
        token1Price = ZERO_BD;
    }

    pool.token0Price = token0Price;
    pool.token1Price = token1Price;

    // Calculate volumes (use absolute values)
    let amount0 = abs(event.params.amount0);
    let amount1 = abs(event.params.amount1);

    let amount0Decimal = convertTokenToDecimal(amount0, token0.decimals);
    let amount1Decimal = convertTokenToDecimal(amount1, token1.decimals);

    // ⭐ CALCULATE USD VALUE
    let bundle = getOrCreateBundle();
    let volumeUSD = ZERO_BD;

    // Try to calculate USD using token prices
    if (token0.priceUSD.gt(ZERO_BD)) {
        volumeUSD = amount0Decimal.times(token0.priceUSD);
    } else if (token1.priceUSD.gt(ZERO_BD)) {
        volumeUSD = amount1Decimal.times(token1.priceUSD);
    } else {
        // Fallback: use average of both tokens
        volumeUSD = amount0Decimal.plus(amount1Decimal).div(BigDecimal.fromString("2"));
    }

    // Update pool stats
    pool.volumeToken0 = pool.volumeToken0.plus(amount0Decimal);
    pool.volumeToken1 = pool.volumeToken1.plus(amount1Decimal);
    pool.volumeUSD = pool.volumeUSD.plus(volumeUSD);
    pool.txCount = pool.txCount.plus(ONE_BI);
    pool.save();

    // Update token stats
    token0.tradeVolume = token0.tradeVolume.plus(amount0Decimal);
    token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(volumeUSD);
    token0.txCount = token0.txCount.plus(ONE_BI);
    token0.save();

    token1.tradeVolume = token1.tradeVolume.plus(amount1Decimal);
    token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(volumeUSD);
    token1.txCount = token1.txCount.plus(ONE_BI);
    token1.save();

    // ⭐ UPDATE TOKEN DAY DATA
    let token0DayData = getOrCreateTokenDayData(token0, event.block.timestamp);
    token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0Decimal);
    token0DayData.dailyTxns = token0DayData.dailyTxns.plus(ONE_BI);
    token0DayData.priceUSD = token0.priceUSD;
    token0DayData.save();

    let token1DayData = getOrCreateTokenDayData(token1, event.block.timestamp);
    token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1Decimal);
    token1DayData.dailyTxns = token1DayData.dailyTxns.plus(ONE_BI);
    token1DayData.priceUSD = token1.priceUSD;
    token1DayData.save();

    // ⭐ UPDATE TOKEN PRICES
    updateTokenPrices(pool, bundle);

    // Create swap entity
    let swapId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    let swap = new Swap(swapId);
    swap.transaction = transaction.id;
    swap.pool = pool.id;
    swap.sender = event.params.sender;
    swap.recipient = event.params.recipient;
    swap.origin = event.transaction.from;
    swap.amount0 = amount0Decimal;
    swap.amount1 = amount1Decimal;
    swap.amountUSD = volumeUSD;
    swap.sqrtPriceX96 = event.params.sqrtPriceX96;
    swap.tick = event.params.tick;
    swap.logIndex = event.logIndex;
    swap.timestamp = event.block.timestamp;
    swap.blockNumber = event.block.number;
    swap.save();

    // Update day data
    let dayData = getOrCreatePoolDayData(pool, event.block.timestamp);
    dayData.volumeToken0 = dayData.volumeToken0.plus(amount0Decimal);
    dayData.volumeToken1 = dayData.volumeToken1.plus(amount1Decimal);
    dayData.volumeUSD = dayData.volumeUSD.plus(volumeUSD);
    dayData.txCount = dayData.txCount.plus(ONE_BI);
    dayData.tvlUSD = pool.totalValueLockedUSD;

    // Update OHLC
    let currentPrice = token0Price;
    if (dayData.open.equals(ZERO_BD)) {
        dayData.open = currentPrice;
        dayData.high = currentPrice;
        dayData.low = currentPrice;
    } else {
        if (currentPrice.gt(dayData.high)) dayData.high = currentPrice;
        if (currentPrice.lt(dayData.low)) dayData.low = currentPrice;
    }
    dayData.close = currentPrice;
    dayData.save();

    // Update hour data
    let hourData = getOrCreatePoolHourData(pool, event.block.timestamp);
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
        protocol.txCount = protocol.txCount.plus(ONE_BI);
        protocol.save();
    }

    // ⭐ TRACK USER SWAP VOLUME (for RPC elimination)
    let userAddress = event.transaction.from.toHexString();
    let user = getOrCreateUser(userAddress);
    user.usdSwapped = user.usdSwapped.plus(volumeUSD);
    user.save();
}

export function handleMint(event: MintEvent): void {
    let pool = Pool.load(event.address.toHexString());
    if (!pool) return;

    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    // Get or create transaction
    let transaction = getOrCreateTransaction(event);

    let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    // Calculate USD
    let bundle = getOrCreateBundle();
    let amountUSD = ZERO_BD;
    if (token0.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount0.times(token0.priceUSD);
    } else if (token1.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount1.times(token1.priceUSD);
    } else {
        amountUSD = amount0.plus(amount1).div(BigDecimal.fromString("2"));
    }

    // Update TVL - add token amounts
    pool.totalValueLockedToken0 = pool.totalValueLockedToken0.plus(amount0);
    pool.totalValueLockedToken1 = pool.totalValueLockedToken1.plus(amount1);

    // ⭐ RECALCULATE USD from current token amounts × current prices
    // This is more accurate than accumulating mint amounts with potentially stale prices
    let tvl0USD = pool.totalValueLockedToken0.times(token0.priceUSD);
    let tvl1USD = pool.totalValueLockedToken1.times(token1.priceUSD);
    pool.totalValueLockedUSD = tvl0USD.plus(tvl1USD);
    pool.txCount = pool.txCount.plus(ONE_BI);
    pool.save();

    // Update token liquidity
    token0.totalLiquidity = token0.totalLiquidity.plus(amount0);
    token1.totalLiquidity = token1.totalLiquidity.plus(amount1);
    token0.save();
    token1.save();

    // ⭐ UPDATE LIQUIDITY POSITION
    let position = getOrCreateLiquidityPosition(event.params.owner, pool, event.block.timestamp);
    position.liquidityTokenBalance = position.liquidityTokenBalance.plus(
        convertTokenToDecimal(event.params.amount, 18)
    );
    position.save();

    // Create mint entity
    let mintId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    let mint = new Mint(mintId);
    mint.transaction = transaction.id;
    mint.pool = pool.id;
    mint.owner = event.params.owner;
    mint.sender = event.params.sender;
    mint.tickLower = event.params.tickLower;
    mint.tickUpper = event.params.tickUpper;
    mint.amount = event.params.amount;
    mint.amount0 = amount0;
    mint.amount1 = amount1;
    mint.amountUSD = amountUSD;
    mint.logIndex = event.logIndex;
    mint.timestamp = event.block.timestamp;
    mint.blockNumber = event.block.number;
    mint.save();

    // Update protocol TVL
    let protocol = Protocol.load("windswap");
    if (protocol) {
        protocol.totalTVLUSD = protocol.totalTVLUSD.plus(amountUSD);
        protocol.txCount = protocol.txCount.plus(ONE_BI);
        protocol.save();
    }

    // Update day data
    let dayData = getOrCreatePoolDayData(pool, event.block.timestamp);
    dayData.tvlUSD = pool.totalValueLockedUSD;
    dayData.save();
}

export function handleBurn(event: BurnEvent): void {
    let pool = Pool.load(event.address.toHexString());
    if (!pool) return;

    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    // Get or create transaction
    let transaction = getOrCreateTransaction(event);

    let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    // Calculate USD
    let bundle = getOrCreateBundle();
    let amountUSD = ZERO_BD;
    if (token0.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount0.times(token0.priceUSD);
    } else if (token1.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount1.times(token1.priceUSD);
    } else {
        amountUSD = amount0.plus(amount1).div(BigDecimal.fromString("2"));
    }

    // Update TVL (subtract token amounts)
    pool.totalValueLockedToken0 = pool.totalValueLockedToken0.minus(amount0);
    pool.totalValueLockedToken1 = pool.totalValueLockedToken1.minus(amount1);

    // Ensure non-negative
    if (pool.totalValueLockedToken0.lt(ZERO_BD)) pool.totalValueLockedToken0 = ZERO_BD;
    if (pool.totalValueLockedToken1.lt(ZERO_BD)) pool.totalValueLockedToken1 = ZERO_BD;

    // ⭐ RECALCULATE USD from current token amounts × current prices
    let tvl0USD = pool.totalValueLockedToken0.times(token0.priceUSD);
    let tvl1USD = pool.totalValueLockedToken1.times(token1.priceUSD);
    pool.totalValueLockedUSD = tvl0USD.plus(tvl1USD);
    pool.txCount = pool.txCount.plus(ONE_BI);
    pool.save();

    // Update token liquidity
    token0.totalLiquidity = token0.totalLiquidity.minus(amount0);
    token1.totalLiquidity = token1.totalLiquidity.minus(amount1);
    token0.save();
    token1.save();

    // ⭐ UPDATE LIQUIDITY POSITION
    let position = getOrCreateLiquidityPosition(event.params.owner, pool, event.block.timestamp);
    position.liquidityTokenBalance = position.liquidityTokenBalance.minus(
        convertTokenToDecimal(event.params.amount, 18)
    );
    position.save();

    // Create burn entity
    let burnId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    let burn = new Burn(burnId);
    burn.transaction = transaction.id;
    burn.pool = pool.id;
    burn.owner = event.params.owner;
    burn.tickLower = event.params.tickLower;
    burn.tickUpper = event.params.tickUpper;
    burn.amount = event.params.amount;
    burn.amount0 = amount0;
    burn.amount1 = amount1;
    burn.amountUSD = amountUSD;
    burn.logIndex = event.logIndex;
    burn.timestamp = event.block.timestamp;
    burn.blockNumber = event.block.number;
    burn.save();

    // Update protocol TVL
    let protocol = Protocol.load("windswap");
    if (protocol) {
        protocol.totalTVLUSD = protocol.totalTVLUSD.minus(amountUSD);
        protocol.txCount = protocol.txCount.plus(ONE_BI);
        protocol.save();
    }

    // Update day data
    let dayData = getOrCreatePoolDayData(pool, event.block.timestamp);
    dayData.tvlUSD = pool.totalValueLockedUSD;
    dayData.save();
}
