import { BigInt, BigDecimal, Address, ethereum } from "@graphprotocol/graph-ts";
import {
    Swap as SwapEvent,
    Mint as MintEvent,
    Burn as BurnEvent,
    CLPool
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
    User,
    PoolLookup,
    ProtocolDayData
} from "../generated/schema";
import {
    ZERO_BD,
    ZERO_BI,
    ONE_BI,
    ONE_BD,
    Q96,
    WSEI_ADDRESS,
    USDC_ADDRESS,
    STABLECOINS,
    convertTokenToDecimal,
    exponentToBigDecimal,
    abs,
    isStablecoin,
    getOrCreateUser,
    getOrCreateBundle,
    getOrCreateTransaction,
    getFeeTierFromTickSpacing,
    FEE_DENOMINATOR
} from "./helpers";

// Calculate price from sqrtPriceX96
function calculatePriceFromSqrtPriceX96(sqrtPriceX96: BigInt, token0Decimals: i32, token1Decimals: i32): BigDecimal {
    let sqrtPrice = sqrtPriceX96.toBigDecimal().div(Q96.toBigDecimal());
    let price = sqrtPrice.times(sqrtPrice);

    let decimalDiff = token0Decimals - token1Decimals;
    if (decimalDiff > 0) {
        price = price.times(exponentToBigDecimal(decimalDiff));
    } else if (decimalDiff < 0) {
        price = price.div(exponentToBigDecimal(-decimalDiff));
    }

    return price;
}

// Get WSEI price in USD by looking at WSEI/USDC pools
function getEthPriceInUSD(): BigDecimal {
    // Search for WSEI/USDC pools across common tick spacings
    let tickSpacings: i32[] = [1, 10, 50, 60, 100, 200];

    let bestPrice = ZERO_BD;
    let bestLiquidity = ZERO_BI;

    for (let i = 0; i < tickSpacings.length; i++) {
        // Try WSEI as token0
        let lookupId = WSEI_ADDRESS + "-" + USDC_ADDRESS + "-" + tickSpacings[i].toString();
        let poolLookup = PoolLookup.load(lookupId);

        if (!poolLookup) {
            // Try reversed
            lookupId = USDC_ADDRESS + "-" + WSEI_ADDRESS + "-" + tickSpacings[i].toString();
            poolLookup = PoolLookup.load(lookupId);
        }

        if (poolLookup) {
            let pool = Pool.load(poolLookup.pool);
            if (pool && pool.liquidity.gt(bestLiquidity)) {
                let token0 = Token.load(pool.token0);
                let token1 = Token.load(pool.token1);
                if (token0 && token1) {
                    // Determine which token is WSEI and which is USDC
                    let token0IsWsei = token0.id.toLowerCase() == WSEI_ADDRESS;

                    if (pool.token0Price.gt(ZERO_BD)) {
                        if (token0IsWsei) {
                            // token0Price = price of token0 (WSEI) in token1 (USDC) terms
                            bestPrice = pool.token0Price;
                        } else {
                            // token0Price = price of token0 (USDC) in token1 (WSEI) terms
                            // So WSEI price = 1 / token0Price
                            if (pool.token0Price.gt(ZERO_BD)) {
                                bestPrice = ONE_BD.div(pool.token0Price);
                            }
                        }
                        bestLiquidity = pool.liquidity;
                    }
                }
            }
        }
    }

    return bestPrice;
}

// Find token price in USD using pool relationship
function findTokenPriceUSD(token: Token, pool: Pool, bundle: Bundle): BigDecimal {
    let tokenAddress = token.id.toLowerCase();

    // Stablecoin: price = $1
    if (isStablecoin(tokenAddress)) {
        return ONE_BD;
    }

    // WSEI: price = bundle.ethPrice
    if (tokenAddress == WSEI_ADDRESS) {
        return bundle.ethPrice;
    }

    // Derive from the other token in the pool
    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return ZERO_BD;

    let isToken0 = token.id == token0.id;
    let otherToken = isToken0 ? token1 : token0;
    let otherTokenPrice = otherToken.priceUSD;

    // If the other token has a known price, derive this token's price from pool ratio
    if (otherTokenPrice.gt(ZERO_BD)) {
        if (isToken0 && pool.token0Price.gt(ZERO_BD)) {
            // token0Price = price of token0 in token1 terms
            return pool.token0Price.times(otherTokenPrice);
        } else if (!isToken0 && pool.token1Price.gt(ZERO_BD)) {
            return pool.token1Price.times(otherTokenPrice);
        }
    }

    return ZERO_BD;
}

// Update token prices from pool data
function updateTokenPrices(pool: Pool, bundle: Bundle): void {
    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    // Calculate token prices
    let token0PriceUSD = findTokenPriceUSD(token0, pool, bundle);
    let token1PriceUSD = findTokenPriceUSD(token1, pool, bundle);

    // Update derivedETH
    if (bundle.ethPrice.gt(ZERO_BD)) {
        if (token0PriceUSD.gt(ZERO_BD)) {
            token0.derivedETH = token0PriceUSD.div(bundle.ethPrice);
        }
        if (token1PriceUSD.gt(ZERO_BD)) {
            token1.derivedETH = token1PriceUSD.div(bundle.ethPrice);
        }
    }

    token0.priceUSD = token0PriceUSD;
    token1.priceUSD = token1PriceUSD;

    token0.save();
    token1.save();
}

// Get or create TokenDayData
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

// Get or create LiquidityPosition
function getOrCreateLiquidityPosition(user: Address, pool: Pool, timestamp: BigInt): LiquidityPosition {
    let id = user.toHexString() + "-" + pool.id;
    let position = LiquidityPosition.load(id);
    let isNew = false;
    if (!position) {
        position = new LiquidityPosition(id);
        position.user = user.toHexString();
        position.pool = pool.id;
        position.liquidityTokenBalance = ZERO_BD;
        position.createdAtTimestamp = timestamp;
        isNew = true;
    }
    return position;
}

// Get or create PoolDayData
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

// Get or create PoolHourData
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

// Get or create ProtocolDayData
function getOrCreateProtocolDayData(timestamp: BigInt): ProtocolDayData {
    let dayTimestamp = timestamp.toI32() / 86400;
    let id = dayTimestamp.toString();

    let dayData = ProtocolDayData.load(id);
    if (!dayData) {
        dayData = new ProtocolDayData(id);
        dayData.date = dayTimestamp * 86400;
        dayData.totalVolumeUSD = ZERO_BD;
        dayData.totalTVLUSD = ZERO_BD;
        dayData.txCount = ZERO_BI;
    }
    return dayData;
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

    // Read feeGrowthGlobal from pool contract (enables client-side uncollected fee calculation)
    let poolContract = CLPool.bind(event.address);
    let feeGrowth0Result = poolContract.try_feeGrowthGlobal0X128();
    let feeGrowth1Result = poolContract.try_feeGrowthGlobal1X128();
    if (!feeGrowth0Result.reverted) {
        pool.feeGrowthGlobal0X128 = feeGrowth0Result.value;
    }
    if (!feeGrowth1Result.reverted) {
        pool.feeGrowthGlobal1X128 = feeGrowth1Result.value;
    }

    // Calculate prices
    let token0Price = calculatePriceFromSqrtPriceX96(
        event.params.sqrtPriceX96,
        token0.decimals,
        token1.decimals
    );

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

    // Update WSEI price (Bundle.ethPrice) from WSEI/USDC pools
    let bundle = getOrCreateBundle();
    let ethPrice = getEthPriceInUSD();
    if (ethPrice.gt(ZERO_BD)) {
        bundle.ethPrice = ethPrice;
        bundle.lastUpdated = event.block.timestamp;
        bundle.save();
    }

    // Update token prices using the oracle
    updateTokenPrices(pool, bundle);

    // Reload tokens after price update
    token0 = Token.load(pool.token0)!;
    token1 = Token.load(pool.token1)!;

    // Calculate USD volume from token prices
    let volumeUSD = ZERO_BD;
    if (token0.priceUSD.gt(ZERO_BD) && token1.priceUSD.gt(ZERO_BD)) {
        // Both prices available: use average for best accuracy
        volumeUSD = amount0Decimal.times(token0.priceUSD)
            .plus(amount1Decimal.times(token1.priceUSD))
            .div(BigDecimal.fromString("2"));
    } else if (token0.priceUSD.gt(ZERO_BD)) {
        volumeUSD = amount0Decimal.times(token0.priceUSD);
    } else if (token1.priceUSD.gt(ZERO_BD)) {
        volumeUSD = amount1Decimal.times(token1.priceUSD);
    }
    // If no price available, volumeUSD stays ZERO_BD (honest zero)

    // Calculate fees from swap volume using tick spacing
    let feeTier = getFeeTierFromTickSpacing(pool.tickSpacing);
    let feeAmount0 = amount0Decimal.times(feeTier).div(FEE_DENOMINATOR);
    let feeAmount1 = amount1Decimal.times(feeTier).div(FEE_DENOMINATOR);
    let feesUSD = volumeUSD.times(feeTier).div(FEE_DENOMINATOR);

    // Update pool fee accumulators
    pool.feesToken0 = pool.feesToken0.plus(feeAmount0);
    pool.feesToken1 = pool.feesToken1.plus(feeAmount1);
    pool.feesUSD = pool.feesUSD.plus(feesUSD);

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

    // Update TokenDayData
    let token0DayData = getOrCreateTokenDayData(token0, event.block.timestamp);
    token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0Decimal);
    token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD.plus(volumeUSD);
    token0DayData.dailyTxns = token0DayData.dailyTxns.plus(ONE_BI);
    token0DayData.priceUSD = token0.priceUSD;
    token0DayData.save();

    let token1DayData = getOrCreateTokenDayData(token1, event.block.timestamp);
    token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1Decimal);
    token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD.plus(volumeUSD);
    token1DayData.dailyTxns = token1DayData.dailyTxns.plus(ONE_BI);
    token1DayData.priceUSD = token1.priceUSD;
    token1DayData.save();

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

    // Update PoolDayData
    let dayData = getOrCreatePoolDayData(pool, event.block.timestamp);
    dayData.volumeToken0 = dayData.volumeToken0.plus(amount0Decimal);
    dayData.volumeToken1 = dayData.volumeToken1.plus(amount1Decimal);
    dayData.volumeUSD = dayData.volumeUSD.plus(volumeUSD);
    dayData.feesUSD = dayData.feesUSD.plus(feesUSD);
    dayData.feesToken0 = dayData.feesToken0.plus(feeAmount0);
    dayData.feesToken1 = dayData.feesToken1.plus(feeAmount1);
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

    // Update PoolHourData
    let hourData = getOrCreatePoolHourData(pool, event.block.timestamp);
    hourData.volumeToken0 = hourData.volumeToken0.plus(amount0Decimal);
    hourData.volumeToken1 = hourData.volumeToken1.plus(amount1Decimal);
    hourData.volumeUSD = hourData.volumeUSD.plus(volumeUSD);
    hourData.feesUSD = hourData.feesUSD.plus(feesUSD);
    hourData.txCount = hourData.txCount.plus(ONE_BI);
    hourData.tvlUSD = pool.totalValueLockedUSD;
    hourData.save();

    // Update protocol stats
    let protocol = Protocol.load("windswap");
    if (protocol) {
        protocol.totalVolumeUSD = protocol.totalVolumeUSD.plus(volumeUSD);
        protocol.totalFeesUSD = protocol.totalFeesUSD.plus(feesUSD);
        protocol.totalSwaps = protocol.totalSwaps.plus(ONE_BI);
        protocol.txCount = protocol.txCount.plus(ONE_BI);
        protocol.save();
    }

    // Update ProtocolDayData
    let protocolDayData = getOrCreateProtocolDayData(event.block.timestamp);
    protocolDayData.totalVolumeUSD = protocolDayData.totalVolumeUSD.plus(volumeUSD);
    if (protocol) {
        protocolDayData.totalTVLUSD = protocol.totalTVLUSD;
    }
    protocolDayData.txCount = protocolDayData.txCount.plus(ONE_BI);
    protocolDayData.save();

    // Track user swap volume
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

    let transaction = getOrCreateTransaction(event);

    let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    // Calculate USD - only use priced tokens, no garbage fallback
    let bundle = getOrCreateBundle();
    let amountUSD = ZERO_BD;
    if (token0.priceUSD.gt(ZERO_BD) && token1.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount0.times(token0.priceUSD)
            .plus(amount1.times(token1.priceUSD));
    } else if (token0.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount0.times(token0.priceUSD).times(BigDecimal.fromString("2"));
    } else if (token1.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount1.times(token1.priceUSD).times(BigDecimal.fromString("2"));
    }

    // Update TVL
    pool.totalValueLockedToken0 = pool.totalValueLockedToken0.plus(amount0);
    pool.totalValueLockedToken1 = pool.totalValueLockedToken1.plus(amount1);

    // Recalculate USD from current token amounts x current prices
    let tvl0USD = pool.totalValueLockedToken0.times(token0.priceUSD);
    let tvl1USD = pool.totalValueLockedToken1.times(token1.priceUSD);
    pool.totalValueLockedUSD = tvl0USD.plus(tvl1USD);
    pool.txCount = pool.txCount.plus(ONE_BI);

    // Track liquidity provider count
    let lpId = event.params.owner.toHexString() + "-" + pool.id;
    let existingPosition = LiquidityPosition.load(lpId);
    let isNewLP = existingPosition == null;

    if (isNewLP) {
        pool.liquidityProviderCount = pool.liquidityProviderCount + 1;
    }

    pool.save();

    // Update token liquidity
    token0.totalLiquidity = token0.totalLiquidity.plus(amount0);
    token1.totalLiquidity = token1.totalLiquidity.plus(amount1);
    token0.save();
    token1.save();

    // Update LiquidityPosition
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
        // Recalculate total TVL (more accurate than adding amountUSD)
        protocol.txCount = protocol.txCount.plus(ONE_BI);
        protocol.save();
    }

    // Update PoolDayData
    let dayData = getOrCreatePoolDayData(pool, event.block.timestamp);
    dayData.tvlUSD = pool.totalValueLockedUSD;
    dayData.save();

    // Update ProtocolDayData
    let protocolDayData = getOrCreateProtocolDayData(event.block.timestamp);
    if (protocol) {
        protocolDayData.totalTVLUSD = protocol.totalTVLUSD;
    }
    protocolDayData.txCount = protocolDayData.txCount.plus(ONE_BI);
    protocolDayData.save();
}

export function handleBurn(event: BurnEvent): void {
    let pool = Pool.load(event.address.toHexString());
    if (!pool) return;

    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    let transaction = getOrCreateTransaction(event);

    let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    // Calculate USD - no garbage fallback
    let bundle = getOrCreateBundle();
    let amountUSD = ZERO_BD;
    if (token0.priceUSD.gt(ZERO_BD) && token1.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount0.times(token0.priceUSD)
            .plus(amount1.times(token1.priceUSD));
    } else if (token0.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount0.times(token0.priceUSD).times(BigDecimal.fromString("2"));
    } else if (token1.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount1.times(token1.priceUSD).times(BigDecimal.fromString("2"));
    }

    // Update TVL (subtract)
    pool.totalValueLockedToken0 = pool.totalValueLockedToken0.minus(amount0);
    pool.totalValueLockedToken1 = pool.totalValueLockedToken1.minus(amount1);

    // Ensure non-negative
    if (pool.totalValueLockedToken0.lt(ZERO_BD)) pool.totalValueLockedToken0 = ZERO_BD;
    if (pool.totalValueLockedToken1.lt(ZERO_BD)) pool.totalValueLockedToken1 = ZERO_BD;

    // Recalculate USD from current amounts x prices
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

    // Update LiquidityPosition
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
        protocol.txCount = protocol.txCount.plus(ONE_BI);
        protocol.save();
    }

    // Update PoolDayData
    let dayData = getOrCreatePoolDayData(pool, event.block.timestamp);
    dayData.tvlUSD = pool.totalValueLockedUSD;
    dayData.save();

    // Update ProtocolDayData
    let protocolDayData = getOrCreateProtocolDayData(event.block.timestamp);
    if (protocol) {
        protocolDayData.totalTVLUSD = protocol.totalTVLUSD;
    }
    protocolDayData.txCount = protocolDayData.txCount.plus(ONE_BI);
    protocolDayData.save();
}
