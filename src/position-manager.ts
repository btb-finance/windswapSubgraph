import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import {
    IncreaseLiquidity,
    DecreaseLiquidity,
    Transfer,
    Collect as CollectEvent,
    NonfungiblePositionManager
} from "../generated/NonfungiblePositionManager/NonfungiblePositionManager";
import { Position, User, Collect, Pool, PositionSnapshot, PoolLookup, LiquidityPosition } from "../generated/schema";

// Helper to find pool by token pair and tick spacing using PoolLookup
function findPoolId(token0: string, token1: string, tickSpacing: number): string | null {
    // Normalize to lowercase
    let t0 = token0.toLowerCase();
    let t1 = token1.toLowerCase();

    // Try first ordering: token0-token1-tickSpacing
    let lookupKey1 = t0 + "-" + t1 + "-" + tickSpacing.toString();
    let poolLookup = PoolLookup.load(lookupKey1);
    if (poolLookup) {
        return poolLookup.pool;
    }

    // Try reversed ordering: token1-token0-tickSpacing
    let lookupKey2 = t1 + "-" + t0 + "-" + tickSpacing.toString();
    poolLookup = PoolLookup.load(lookupKey2);
    if (poolLookup) {
        return poolLookup.pool;
    }

    // Pool not found in subgraph - this shouldn't happen if pool was indexed
    return null;
}

let ZERO_BD = BigDecimal.fromString("0");
let ZERO_BI = BigInt.fromI32(0);
let ONE_BI = BigInt.fromI32(1);
let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

function convertTokenToDecimal(amount: BigInt, decimals: number): BigDecimal {
    if (decimals == 0) return amount.toBigDecimal();
    let divisor = BigDecimal.fromString("1");
    for (let i = 0; i < decimals; i++) {
        divisor = divisor.times(BigDecimal.fromString("10"));
    }
    return amount.toBigDecimal().div(divisor);
}

// Calculate token amounts from liquidity using pool's current price
// This is called whenever position liquidity changes
function updatePositionAmounts(position: Position): void {
    // Load pool to get current price
    let pool = Pool.load(position.pool);
    if (!pool) return;

    // For now, set amounts based on deposited amounts minus withdrawn
    // This is an approximation - precise calculation requires complex TickMath
    // which is difficult to implement correctly in AssemblyScript
    // 
    // The subgraph stores:
    // - depositedToken0/1: what was originally put in
    // - withdrawnToken0/1: what was taken out
    // - amount0/1: current estimated value (this field)
    //
    // Note: For precise real-time amounts, frontend should use:
    // 1. NFTManager.positions(tokenId) for tokensOwed (uncollected fees)
    // 2. Calculate current value from liquidity + current pool price using TickMath library

    // Simple approximation: current = deposited - withdrawn
    // This doesn't account for price movement but gives a baseline
    position.amount0 = position.depositedToken0.minus(position.withdrawnToken0);
    position.amount1 = position.depositedToken1.minus(position.withdrawnToken1);

    // Ensure non-negative
    if (position.amount0.lt(ZERO_BD)) position.amount0 = ZERO_BD;
    if (position.amount1.lt(ZERO_BD)) position.amount1 = ZERO_BD;
}

export function handleIncreaseLiquidity(event: IncreaseLiquidity): void {
    let tokenId = event.params.tokenId.toString();
    let position = Position.load(tokenId);

    if (!position) {
        // New position - need to get position data from contract
        let contract = NonfungiblePositionManager.bind(event.address);
        let positionResult = contract.try_positions(event.params.tokenId);

        if (positionResult.reverted) return;

        let posData = positionResult.value;
        let token0 = posData.value2; // token0 address
        let token1 = posData.value3; // token1 address
        let tickSpacing = posData.value4;
        let tickLower = posData.value5;
        let tickUpper = posData.value6;

        // Get owner
        let ownerResult = contract.try_ownerOf(event.params.tokenId);
        if (ownerResult.reverted) return;
        let owner = ownerResult.value.toHexString();

        // Find pool by token0, token1, tickSpacing using PoolLookup
        let poolId = findPoolId(
            token0.toHexString(),
            token1.toHexString(),
            tickSpacing
        );

        // If pool not found, skip creating position (pool should exist)
        if (poolId == null) {
            // Pool not found in subgraph - this shouldn't happen if pool was indexed first
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
        position.amount0 = ZERO_BD; // Will be updated after deposit
        position.amount1 = ZERO_BD; // Will be updated after deposit
        position.depositedToken0 = ZERO_BD;
        position.depositedToken1 = ZERO_BD;
        position.withdrawnToken0 = ZERO_BD;
        position.withdrawnToken1 = ZERO_BD;
        position.collectedToken0 = ZERO_BD;
        position.collectedToken1 = ZERO_BD;
        position.staked = false;
        position.stakedGauge = null;
        position.createdAtTimestamp = event.block.timestamp;
        position.createdAtBlockNumber = event.block.number;
    }

    // Update liquidity and deposited amounts
    position.liquidity = position.liquidity.plus(event.params.liquidity);
    position.depositedToken0 = position.depositedToken0.plus(convertTokenToDecimal(event.params.amount0, 18));
    position.depositedToken1 = position.depositedToken1.plus(convertTokenToDecimal(event.params.amount1, 18));
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

    position.liquidity = position.liquidity.minus(event.params.liquidity);
    position.withdrawnToken0 = position.withdrawnToken0.plus(convertTokenToDecimal(event.params.amount0, 18));
    position.withdrawnToken1 = position.withdrawnToken1.plus(convertTokenToDecimal(event.params.amount1, 18));
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

    let amount0 = convertTokenToDecimal(event.params.amount0, 18);
    let amount1 = convertTokenToDecimal(event.params.amount1, 18);

    position.collectedToken0 = position.collectedToken0.plus(amount0);
    position.collectedToken1 = position.collectedToken1.plus(amount1);
    position.save();

    // Create collect event
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
