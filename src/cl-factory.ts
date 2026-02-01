import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import { PoolCreated } from "../generated/CLFactory/CLFactory";
import { CLPool as CLPoolTemplate } from "../generated/templates";
import { Pool, Token, Protocol, PoolLookup } from "../generated/schema";
import { CLPool } from "../generated/templates/CLPool/CLPool";
import { ERC20 } from "../generated/CLFactory/ERC20";

let ZERO_BD = BigDecimal.fromString("0");
let ZERO_BI = BigInt.fromI32(0);
let ONE_BI = BigInt.fromI32(1);
let ONE_BD = BigDecimal.fromString("1");

export function handlePoolCreated(event: PoolCreated): void {
    // Load or create protocol
    let protocol = Protocol.load("windswap");
    if (!protocol) {
        protocol = new Protocol("windswap");
        protocol.totalVolumeUSD = ZERO_BD;
        protocol.totalTVLUSD = ZERO_BD;
        protocol.totalPools = ZERO_BI;
        protocol.totalSwaps = ZERO_BI;
        // Initialize governance/epoch fields
        protocol.activePeriod = ZERO_BI;
        protocol.epochCount = ZERO_BI;
        protocol.proposalThreshold = ZERO_BI;
        protocol.votingDelay = ZERO_BI;
        protocol.votingPeriod = ZERO_BI;
    }
    protocol.totalPools = protocol.totalPools.plus(ONE_BI);
    protocol.save();

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

        // Initialize all null-style fields
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

        // Initialize all null-style fields
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

    // ⭐ Initialize price fields
    pool.token0Price = ZERO_BD;
    pool.token1Price = ZERO_BD;
    pool.untrackedVolumeUSD = ZERO_BD;

    pool.createdAtTimestamp = event.block.timestamp;
    pool.createdAtBlockNumber = event.block.number;
    
    // Initialize new required fields
    pool.factory = event.address; // CL Factory address
    pool.liquidityProviderCount = 0;
    pool.totalRewards = ZERO_BD;
    
    pool.save();

    // Create PoolLookup entry for position lookups
    let token0Addr = event.params.token0.toHexString();
    let token1Addr = event.params.token1.toHexString();
    let lookupId = token0Addr + "-" + token1Addr + "-" + event.params.tickSpacing.toString();
    
    let poolLookup = new PoolLookup(lookupId);
    poolLookup.pool = pool.id;
    poolLookup.token0 = token0.id;
    poolLookup.token1 = token1.id;
    poolLookup.tickSpacing = event.params.tickSpacing;
    poolLookup.save();

    // Create template to track pool events
    CLPoolTemplate.create(event.params.pool);
}
