import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import {
    IncreaseLiquidity,
    DecreaseLiquidity,
    Transfer,
    Collect as CollectEvent,
    NonfungiblePositionManager
} from "../generated/NonfungiblePositionManager/NonfungiblePositionManager";
import { Position, User, Collect, Pool, Token, PositionSnapshot, PoolLookup, LiquidityPosition, PositionFees, Bundle } from "../generated/schema";
import {
    ZERO_BD,
    ZERO_BI,
    ONE_BI,
    ZERO_ADDRESS,
    convertTokenToDecimal,
    getOrCreateUser,
    getOrCreateBundle
} from "./helpers";
import {
    getSqrtRatioAtTick,
    getAmountsForLiquidity
} from "./tick-math";

// Helper to find pool by token pair and tick spacing using PoolLookup
function findPoolId(token0: string, token1: string, tickSpacing: number): string | null {
    let t0 = token0.toLowerCase();
    let t1 = token1.toLowerCase();

    let lookupKey1 = t0 + "-" + t1 + "-" + tickSpacing.toString();
    let poolLookup = PoolLookup.load(lookupKey1);
    if (poolLookup) {
        return poolLookup.pool;
    }

    let lookupKey2 = t1 + "-" + t0 + "-" + tickSpacing.toString();
    poolLookup = PoolLookup.load(lookupKey2);
    if (poolLookup) {
        return poolLookup.pool;
    }

    return null;
}

// Calculate token amounts from liquidity using proper tick math + USD value
function updatePositionAmounts(position: Position): void {
    let pool = Pool.load(position.pool);
    if (!pool) return;

    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    // Use proper CL math: calculate amounts from liquidity, current price, and tick range
    if (position.liquidity.gt(ZERO_BI) && pool.sqrtPriceX96.gt(ZERO_BI)) {
        let sqrtPriceX96 = pool.sqrtPriceX96;
        let sqrtPriceA = getSqrtRatioAtTick(position.tickLower);
        let sqrtPriceB = getSqrtRatioAtTick(position.tickUpper);

        let amounts = getAmountsForLiquidity(sqrtPriceX96, sqrtPriceA, sqrtPriceB, position.liquidity);

        position.amount0 = convertTokenToDecimal(amounts[0], token0.decimals);
        position.amount1 = convertTokenToDecimal(amounts[1], token1.decimals);
    } else {
        position.amount0 = ZERO_BD;
        position.amount1 = ZERO_BD;
    }

    // Calculate USD value from token prices
    let amountUSD = ZERO_BD;
    if (token0.priceUSD.gt(ZERO_BD)) {
        amountUSD = amountUSD.plus(position.amount0.times(token0.priceUSD));
    }
    if (token1.priceUSD.gt(ZERO_BD)) {
        amountUSD = amountUSD.plus(position.amount1.times(token1.priceUSD));
    }
    position.amountUSD = amountUSD;
}

// Read feeGrowthInside and tokensOwed from NonfungiblePositionManager.positions()
function updatePositionFeeData(position: Position, contractAddress: Address): void {
    let contract = NonfungiblePositionManager.bind(contractAddress);
    let positionResult = contract.try_positions(position.tokenId);
    if (positionResult.reverted) return;

    let posData = positionResult.value;
    // value8 = feeGrowthInside0LastX128, value9 = feeGrowthInside1LastX128
    position.feeGrowthInside0LastX128 = posData.value8;
    position.feeGrowthInside1LastX128 = posData.value9;

    // value10 = tokensOwed0, value11 = tokensOwed1
    let pool = Pool.load(position.pool);
    if (pool) {
        let token0 = Token.load(pool.token0);
        let token1 = Token.load(pool.token1);
        if (token0 && token1) {
            position.tokensOwed0 = convertTokenToDecimal(posData.value10, token0.decimals);
            position.tokensOwed1 = convertTokenToDecimal(posData.value11, token1.decimals);
        }
    }
}

export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
    let tokenId = event.params.tokenId.toString();
    let position = Position.load(tokenId);

    if (!position) {
        // New position - get position data from contract
        let contract = NonfungiblePositionManager.bind(event.address);
        let positionResult = contract.try_positions(event.params.tokenId);

        if (positionResult.reverted) return;

        let posData = positionResult.value;
        let token0 = posData.value2;
        let token1 = posData.value3;
        let tickSpacing = posData.value4;
        let tickLower = posData.value5;
        let tickUpper = posData.value6;

        let ownerResult = contract.try_ownerOf(event.params.tokenId);
        if (ownerResult.reverted) return;
        let owner = ownerResult.value.toHexString();

        let poolId = findPoolId(
            token0.toHexString(),
            token1.toHexString(),
            tickSpacing
        );

        if (poolId == null) {
            return;
        }

        let user = getOrCreateUser(owner);
        user.totalPositions = user.totalPositions.plus(ONE_BI);
        user.save();

        position = new Position(tokenId);
        position.tokenId = event.params.tokenId;
        position.owner = user.id;
        position.pool = poolId!;
        position.tickLower = tickLower;
        position.tickUpper = tickUpper;
        position.liquidity = ZERO_BI;
        position.amount0 = ZERO_BD;
        position.amount1 = ZERO_BD;
        position.amountUSD = ZERO_BD;
        position.depositedToken0 = ZERO_BD;
        position.depositedToken1 = ZERO_BD;
        position.withdrawnToken0 = ZERO_BD;
        position.withdrawnToken1 = ZERO_BD;
        position.collectedToken0 = ZERO_BD;
        position.collectedToken1 = ZERO_BD;
        position.tokensOwed0 = ZERO_BD;
        position.tokensOwed1 = ZERO_BD;
        position.feeGrowthInside0LastX128 = ZERO_BI;
        position.feeGrowthInside1LastX128 = ZERO_BI;
        position.staked = false;
        position.stakedGauge = null;
        position.createdAtTimestamp = event.block.timestamp;
        position.createdAtBlockNumber = event.block.number;
    }

    // Load pool and tokens for correct decimals
    let pool = Pool.load(position.pool);
    if (!pool) return;
    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    // Update liquidity and deposited amounts using actual token decimals
    position.liquidity = position.liquidity.plus(event.params.liquidity);
    position.depositedToken0 = position.depositedToken0.plus(
        convertTokenToDecimal(event.params.amount0, token0.decimals)
    );
    position.depositedToken1 = position.depositedToken1.plus(
        convertTokenToDecimal(event.params.amount1, token1.decimals)
    );

    // Calculate current amounts from tick math
    updatePositionAmounts(position);

    // Read feeGrowthInside and tokensOwed from contract
    updatePositionFeeData(position, event.address);

    position.save();

    // Create snapshot
    let snapshotId = tokenId + "-" + event.block.timestamp.toString();
    let snapshot = new PositionSnapshot(snapshotId);
    snapshot.position = position.id;
    snapshot.liquidity = position.liquidity;
    snapshot.depositedToken0 = position.depositedToken0;
    snapshot.depositedToken1 = position.depositedToken1;
    snapshot.timestamp = event.block.timestamp;
    snapshot.blockNumber = event.block.number;
    snapshot.save();
}

export function handleDecreaseLiquidity(event: DecreaseLiquidity): void {
    let tokenId = event.params.tokenId.toString();
    let position = Position.load(tokenId);

    if (!position) return;

    // Load pool and tokens for correct decimals
    let pool = Pool.load(position.pool);
    if (!pool) return;
    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    position.liquidity = position.liquidity.minus(event.params.liquidity);
    position.withdrawnToken0 = position.withdrawnToken0.plus(
        convertTokenToDecimal(event.params.amount0, token0.decimals)
    );
    position.withdrawnToken1 = position.withdrawnToken1.plus(
        convertTokenToDecimal(event.params.amount1, token1.decimals)
    );

    // Recalculate current amounts from tick math
    updatePositionAmounts(position);

    // Re-read feeGrowthInside and tokensOwed (updated after decrease)
    updatePositionFeeData(position, event.address);

    position.save();
}

export function handleTransfer(event: Transfer): void {
    let tokenId = event.params.tokenId.toString();

    // Skip mints and burns
    if (event.params.from.toHexString() == ZERO_ADDRESS || event.params.to.toHexString() == ZERO_ADDRESS) {
        return;
    }

    let position = Position.load(tokenId);
    if (!position) return;

    // Update old owner
    let oldOwner = User.load(position.owner);
    if (oldOwner) {
        oldOwner.totalPositions = oldOwner.totalPositions.minus(ONE_BI);
        oldOwner.save();
    }

    // Update new owner
    let newOwnerAddr = event.params.to.toHexString();
    let newOwner = getOrCreateUser(newOwnerAddr);
    newOwner.totalPositions = newOwner.totalPositions.plus(ONE_BI);
    newOwner.save();

    position.owner = newOwner.id;
    position.save();
}

export function handleCollect(event: CollectEvent): void {
    let tokenId = event.params.tokenId.toString();
    let position = Position.load(tokenId);

    if (!position) return;

    // Load pool and tokens for correct decimals
    let pool = Pool.load(position.pool);
    if (!pool) return;
    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) return;

    let amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    let amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);

    position.collectedToken0 = position.collectedToken0.plus(amount0);
    position.collectedToken1 = position.collectedToken1.plus(amount1);

    // Re-read feeGrowthInside and tokensOwed (reset after collect)
    updatePositionFeeData(position, event.address);

    position.save();

    // Calculate fees USD
    let feesUSD = ZERO_BD;
    if (token0.priceUSD.gt(ZERO_BD)) {
        feesUSD = feesUSD.plus(amount0.times(token0.priceUSD));
    }
    if (token1.priceUSD.gt(ZERO_BD)) {
        feesUSD = feesUSD.plus(amount1.times(token1.priceUSD));
    }

    // Create/update PositionFees entity
    let feesId = position.id;
    let positionFees = PositionFees.load(feesId);
    if (!positionFees) {
        positionFees = new PositionFees(feesId);
        positionFees.position = position.id;
        positionFees.feesToken0 = ZERO_BD;
        positionFees.feesToken1 = ZERO_BD;
        positionFees.feesUSD = ZERO_BD;
        positionFees.lastCollectTimestamp = ZERO_BI;
        positionFees.collectCount = 0;
    }

    positionFees.feesToken0 = positionFees.feesToken0.plus(amount0);
    positionFees.feesToken1 = positionFees.feesToken1.plus(amount1);
    positionFees.feesUSD = positionFees.feesUSD.plus(feesUSD);
    positionFees.lastCollectTimestamp = event.block.timestamp;
    positionFees.collectCount = positionFees.collectCount + 1;
    positionFees.save();

    // Create collect event entity
    let collectId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    let collect = new Collect(collectId);
    collect.position = position.id;
    collect.recipient = event.params.recipient;
    collect.amount0 = amount0;
    collect.amount1 = amount1;
    collect.timestamp = event.block.timestamp;
    collect.transaction = event.transaction.hash;
    collect.save();
}
