import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import { PoolCreated } from "../generated/CLFactory/CLFactory";
import { CLPool as CLPoolTemplate } from "../generated/templates";
import { Pool, Token, Protocol, PoolLookup, Bundle } from "../generated/schema";
import { CLPool } from "../generated/templates/CLPool/CLPool";
import { ERC20 } from "../generated/CLFactory/ERC20";
import {
    ZERO_BD,
    ZERO_BI,
    ONE_BI,
    getOrCreateBundle
} from "./helpers";

export function handlePoolCreated(event: PoolCreated): void {
    // Load or create protocol
    let protocol = Protocol.load("windswap");
    if (!protocol) {
        protocol = new Protocol("windswap");
        protocol.totalVolumeUSD = ZERO_BD;
        protocol.totalTVLUSD = ZERO_BD;
        protocol.totalFeesUSD = ZERO_BD;
        protocol.totalPools = ZERO_BI;
        protocol.totalSwaps = ZERO_BI;
        protocol.untrackedVolumeUSD = ZERO_BD;
        protocol.txCount = ZERO_BI;
        protocol.activePeriod = ZERO_BI;
        protocol.epochCount = ZERO_BI;
        protocol.proposalThreshold = ZERO_BI;
        protocol.votingDelay = ZERO_BI;
        protocol.votingPeriod = ZERO_BI;
        // Initialize epoch/emissions fields with defaults
        protocol.epochDuration = BigInt.fromI32(604800);
        protocol.epochEnd = ZERO_BI;
        protocol.weeklyEmissions = ZERO_BD;
        protocol.totalEmissions = ZERO_BD;
        protocol.tailEmissionRate = ZERO_BD;
        protocol.totalVotingWeight = ZERO_BI;
        protocol.lastUpdated = event.block.timestamp;
    }
    protocol.totalPools = protocol.totalPools.plus(ONE_BI);
    protocol.save();

    // Ensure Bundle exists
    getOrCreateBundle();

    // Create or load Token0
    let token0 = Token.load(event.params.token0.toHexString());
    if (!token0) {
        token0 = new Token(event.params.token0.toHexString());
        let token0Contract = ERC20.bind(event.params.token0);

        let symbolResult = token0Contract.try_symbol();
        token0.symbol = symbolResult.reverted ? "UNKNOWN" : symbolResult.value;

        let nameResult = token0Contract.try_name();
        token0.name = nameResult.reverted ? "Unknown Token" : nameResult.value;

        let decimalsResult = token0Contract.try_decimals();
        token0.decimals = decimalsResult.reverted ? 18 : decimalsResult.value;

        let totalSupplyResult = token0Contract.try_totalSupply();
        token0.totalSupply = totalSupplyResult.reverted ? ZERO_BI : totalSupplyResult.value;
        token0.tradeVolume = ZERO_BD;
        token0.tradeVolumeUSD = ZERO_BD;
        token0.untrackedVolumeUSD = ZERO_BD;
        token0.totalVolumeUSD = ZERO_BD;
        token0.txCount = ZERO_BI;
        token0.totalLiquidity = ZERO_BD;
        token0.derivedETH = ZERO_BD;
        token0.priceUSD = ZERO_BD;
        token0.save();
    }

    // Create or load Token1
    let token1 = Token.load(event.params.token1.toHexString());
    if (!token1) {
        token1 = new Token(event.params.token1.toHexString());
        let token1Contract = ERC20.bind(event.params.token1);

        let symbolResult = token1Contract.try_symbol();
        token1.symbol = symbolResult.reverted ? "UNKNOWN" : symbolResult.value;

        let nameResult = token1Contract.try_name();
        token1.name = nameResult.reverted ? "Unknown Token" : nameResult.value;

        let decimalsResult = token1Contract.try_decimals();
        token1.decimals = decimalsResult.reverted ? 18 : decimalsResult.value;

        let totalSupplyResult = token1Contract.try_totalSupply();
        token1.totalSupply = totalSupplyResult.reverted ? ZERO_BI : totalSupplyResult.value;
        token1.tradeVolume = ZERO_BD;
        token1.tradeVolumeUSD = ZERO_BD;
        token1.untrackedVolumeUSD = ZERO_BD;
        token1.totalVolumeUSD = ZERO_BD;
        token1.txCount = ZERO_BI;
        token1.totalLiquidity = ZERO_BD;
        token1.derivedETH = ZERO_BD;
        token1.priceUSD = ZERO_BD;
        token1.save();
    }

    // Create Pool entity
    let pool = new Pool(event.params.pool.toHexString());
    pool.token0 = token0.id;
    pool.token1 = token1.id;
    pool.tickSpacing = event.params.tickSpacing;
    pool.sqrtPriceX96 = ZERO_BI;
    pool.tick = 0;
    pool.liquidity = ZERO_BI;

    pool.totalValueLockedToken0 = ZERO_BD;
    pool.totalValueLockedToken1 = ZERO_BD;
    pool.totalValueLockedUSD = ZERO_BD;

    pool.volumeToken0 = ZERO_BD;
    pool.volumeToken1 = ZERO_BD;
    pool.volumeUSD = ZERO_BD;

    pool.feesUSD = ZERO_BD;
    pool.feesToken0 = ZERO_BD;
    pool.feesToken1 = ZERO_BD;
    pool.txCount = ZERO_BI;

    pool.token0Price = ZERO_BD;
    pool.token1Price = ZERO_BD;
    pool.untrackedVolumeUSD = ZERO_BD;

    pool.createdAtTimestamp = event.block.timestamp;
    pool.createdAtBlockNumber = event.block.number;

    pool.factory = event.address;
    pool.liquidityProviderCount = 0;
    pool.totalRewards = ZERO_BD;

    pool.save();

    // Create PoolLookup entries (both orderings)
    let t0Lower = event.params.token0.toHexString().toLowerCase();
    let t1Lower = event.params.token1.toHexString().toLowerCase();

    let lookupId1 = t0Lower + "-" + t1Lower + "-" + event.params.tickSpacing.toString();
    let poolLookup1 = new PoolLookup(lookupId1);
    poolLookup1.pool = pool.id;
    poolLookup1.token0 = token0.id;
    poolLookup1.token1 = token1.id;
    poolLookup1.tickSpacing = event.params.tickSpacing;
    poolLookup1.save();

    let lookupId2 = t1Lower + "-" + t0Lower + "-" + event.params.tickSpacing.toString();
    let poolLookup2 = new PoolLookup(lookupId2);
    poolLookup2.pool = pool.id;
    poolLookup2.token0 = token0.id;
    poolLookup2.token1 = token1.id;
    poolLookup2.tickSpacing = event.params.tickSpacing;
    poolLookup2.save();

    // Create template to track pool events
    CLPoolTemplate.create(event.params.pool);
}
