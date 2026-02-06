import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import {
    GaugeCreated as V2GaugeCreatedEvent,
} from "../generated/GaugeFactory/GaugeFactory";
import {
    GaugeCreated as CLGaugeCreatedEvent,
} from "../generated/CLGaugeFactory/CLGaugeFactory";
import {
    Deposit,
    Withdraw,
    ClaimRewards,
    NotifyReward,
} from "../generated/GaugeFactory/Gauge";
import {
    Deposit as CLDeposit,
    Withdraw as CLWithdraw,
    ClaimRewards as CLClaimRewards,
    NotifyReward as CLNotifyReward,
} from "../generated/CLGaugeFactory/CLGauge";
import { Gauge, GaugeStakedPosition, GaugeEpochData, Pool, Position, Token, Protocol, Bundle, UserProfile, User } from "../generated/schema";
import { Gauge as GaugeTemplate } from "../generated/templates";
import { CLGauge as CLGaugeTemplate } from "../generated/templates";
import {
    ZERO_BD,
    ZERO_BI,
    ONE_BI,
    convertTokenToDecimal,
    getOrCreateBundle
} from "./helpers";

let SECONDS_PER_WEEK = BigDecimal.fromString("604800");
let SECONDS_PER_YEAR = BigDecimal.fromString("31536000");

function getOrCreateGaugeStakedPosition(
    user: Address,
    gauge: Gauge,
    timestamp: BigInt
): GaugeStakedPosition {
    let id = user.toHexString() + "-" + gauge.id;
    let position = GaugeStakedPosition.load(id);

    if (!position) {
        position = new GaugeStakedPosition(id);
        position.user = user;
        position.userId = user.toHexString().toLowerCase();
        position.gauge = gauge.id;
        position.amount = ZERO_BD;
        position.earned = ZERO_BD;
        position.rewardPerTokenPaid = ZERO_BD;
        position.tokenId = ZERO_BI;
        position.lastUpdateTimestamp = timestamp;
        position.createdAtTimestamp = timestamp;
        position.save();
    }

    return position;
}

// Get current epoch from Protocol entity
function getCurrentEpoch(): BigInt {
    let protocol = Protocol.load("windswap");
    if (!protocol) {
        return ZERO_BI;
    }
    return protocol.epochCount;
}

// Get or create GaugeEpochData for the current epoch
function getOrCreateGaugeEpochData(gaugeId: string, epoch: BigInt, timestamp: BigInt): GaugeEpochData {
    let id = gaugeId + "-" + epoch.toString();
    let data = GaugeEpochData.load(id);
    if (!data) {
        data = new GaugeEpochData(id);
        data.gauge = gaugeId;
        data.epoch = epoch;
        data.votingWeight = ZERO_BI;
        data.feeRewardToken0 = ZERO_BD;
        data.feeRewardToken1 = ZERO_BD;
        data.totalBribes = ZERO_BD;
        data.emissions = ZERO_BD;
        data.timestamp = timestamp;
    }
    return data;
}

// Calculate USD-based APR for a gauge
function calculateUSDBasedAPR(gauge: Gauge, rateBD: BigDecimal): BigDecimal {
    let bundle = getOrCreateBundle();

    // Load the pool to get token info for staked value calculation
    let pool = Pool.load(gauge.pool);
    if (!pool) {
        // Fallback to token/token ratio
        if (gauge.totalStaked.gt(ZERO_BD)) {
            return rateBD.times(SECONDS_PER_YEAR).div(gauge.totalStaked).times(BigDecimal.fromString("100"));
        }
        return ZERO_BD;
    }

    let token0 = Token.load(pool.token0);
    let token1 = Token.load(pool.token1);
    if (!token0 || !token1) {
        if (gauge.totalStaked.gt(ZERO_BD)) {
            return rateBD.times(SECONDS_PER_YEAR).div(gauge.totalStaked).times(BigDecimal.fromString("100"));
        }
        return ZERO_BD;
    }

    // Yearly rewards in token terms
    let yearlyRewards = rateBD.times(SECONDS_PER_YEAR);

    // Try to get reward token (WIND) price from bundle
    // WIND price ~ bundle.ethPrice since WIND is the base token on this DEX
    let rewardTokenPriceUSD = bundle.ethPrice;

    if (rewardTokenPriceUSD.le(ZERO_BD)) {
        // No USD price available, use token/token ratio
        if (gauge.totalStaked.gt(ZERO_BD)) {
            return yearlyRewards.div(gauge.totalStaked).times(BigDecimal.fromString("100"));
        }
        return ZERO_BD;
    }

    let yearlyRewardsUSD = yearlyRewards.times(rewardTokenPriceUSD);

    // For V2 gauges: staked value = totalStaked * lpTokenPrice (approximated from pool TVL)
    // For CL gauges: use pool TVL as approximation for total staked value
    let stakedValueUSD = ZERO_BD;

    if (gauge.gaugeType == "V2") {
        // V2: totalStaked is LP token amount, approximate USD from pool TVL
        // LP token value ~ pool TVL / total LP supply
        if (pool.totalValueLockedUSD.gt(ZERO_BD) && gauge.totalStaked.gt(ZERO_BD)) {
            stakedValueUSD = pool.totalValueLockedUSD;
        }
    } else {
        // CL: totalStaked is liquidity units
        // Use pool TVL as approximation
        if (pool.totalValueLockedUSD.gt(ZERO_BD)) {
            stakedValueUSD = pool.totalValueLockedUSD;
        }
    }

    if (stakedValueUSD.gt(ZERO_BD)) {
        return yearlyRewardsUSD.div(stakedValueUSD).times(BigDecimal.fromString("100"));
    }

    // Fallback to token/token ratio
    if (gauge.totalStaked.gt(ZERO_BD)) {
        return yearlyRewards.div(gauge.totalStaked).times(BigDecimal.fromString("100"));
    }

    return ZERO_BD;
}

// ============================================
// V2 GAUGE FACTORY HANDLER
// ============================================

export function handleV2GaugeCreated(event: V2GaugeCreatedEvent): void {
    let gaugeAddress = event.params.gauge.toHexString();
    let poolAddress = event.params.pool;
    let poolId = poolAddress.toHexString();

    let gauge = new Gauge(gaugeAddress);
    gauge.pool = poolId;
    gauge.gaugeType = "V2";
    gauge.poolAddress = poolAddress;
    gauge.rewardRate = ZERO_BI;
    gauge.totalStakedLiquidity = ZERO_BI;
    gauge.totalSupply = ZERO_BD;
    gauge.totalStaked = ZERO_BD;
    gauge.weight = ZERO_BI;
    gauge.isActive = true;
    gauge.investorCount = 0;
    gauge.totalRewardsDistributed = ZERO_BD;

    gauge.currentRewardRate = ZERO_BD;
    gauge.periodFinish = ZERO_BI;
    gauge.lastUpdateTime = ZERO_BI;
    gauge.rewardPerTokenStored = ZERO_BD;
    gauge.estimatedAPR = ZERO_BD;

    gauge.createdAtTimestamp = event.block.timestamp;
    gauge.createdAtBlockNumber = event.block.number;
    gauge.save();

    // Set gaugeAddress on Pool for reverse lookup
    let pool = Pool.load(poolId);
    if (pool) {
        pool.gaugeAddress = gaugeAddress;
        pool.save();
    }

    GaugeTemplate.create(event.params.gauge);
}

// ============================================
// CL GAUGE FACTORY HANDLER
// ============================================

export function handleCLGaugeCreated(event: CLGaugeCreatedEvent): void {
    let gaugeAddress = event.params.gauge.toHexString();
    let poolAddress = event.params.pool;
    let poolId = poolAddress.toHexString();

    let gauge = new Gauge(gaugeAddress);
    gauge.pool = poolId;
    gauge.gaugeType = "CL";
    gauge.poolAddress = poolAddress;
    gauge.rewardRate = ZERO_BI;
    gauge.totalStakedLiquidity = ZERO_BI;
    gauge.totalSupply = ZERO_BD;
    gauge.totalStaked = ZERO_BD;
    gauge.weight = ZERO_BI;
    gauge.isActive = true;
    gauge.investorCount = 0;
    gauge.totalRewardsDistributed = ZERO_BD;

    gauge.currentRewardRate = ZERO_BD;
    gauge.periodFinish = ZERO_BI;
    gauge.lastUpdateTime = ZERO_BI;
    gauge.rewardPerTokenStored = ZERO_BD;
    gauge.estimatedAPR = ZERO_BD;

    gauge.createdAtTimestamp = event.block.timestamp;
    gauge.createdAtBlockNumber = event.block.number;
    gauge.save();

    // Set gaugeAddress on Pool for reverse lookup
    let pool = Pool.load(poolId);
    if (pool) {
        pool.gaugeAddress = gaugeAddress;
        pool.save();
    }

    CLGaugeTemplate.create(event.params.gauge);
}

// ============================================
// V2 GAUGE EVENT HANDLERS
// ============================================

export function handleStaked(event: Deposit): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let user = event.params.to;
    let amount = convertTokenToDecimal(event.params.amount, 18);

    let positionId = user.toHexString() + "-" + gauge.id;
    let isNew = !GaugeStakedPosition.load(positionId);

    let position = getOrCreateGaugeStakedPosition(user, gauge, event.block.timestamp);
    position.amount = position.amount.plus(amount);
    position.lastUpdateTimestamp = event.block.timestamp;
    position.save();

    gauge.totalSupply = gauge.totalSupply.plus(amount);
    gauge.totalStaked = gauge.totalSupply;
    if (isNew) {
        gauge.investorCount = gauge.investorCount + 1;
    }
    gauge.save();
}

export function handleWithdrawn(event: Withdraw): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let user = event.params.from;
    let amount = convertTokenToDecimal(event.params.amount, 18);

    let positionId = user.toHexString() + "-" + gaugeAddress;
    let position = GaugeStakedPosition.load(positionId);
    if (position) {
        position.amount = position.amount.minus(amount);
        position.lastUpdateTimestamp = event.block.timestamp;
        position.save();
    }

    gauge.totalSupply = gauge.totalSupply.minus(amount);
    gauge.totalStaked = gauge.totalSupply;
    gauge.save();
}

export function handleClaimed(event: ClaimRewards): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let user = event.params.from;
    let claimedAmount = convertTokenToDecimal(event.params.amount, 18);

    let positionId = user.toHexString() + "-" + gaugeAddress;
    let position = GaugeStakedPosition.load(positionId);
    if (position) {
        // Track cumulative claimed rewards (don't reset to zero)
        position.earned = position.earned.plus(claimedAmount);
        position.lastUpdateTimestamp = event.block.timestamp;
        position.save();
    }

    // Update UserProfile rewards
    let bundle = getOrCreateBundle();
    if (bundle.ethPrice.gt(ZERO_BD)) {
        let rewardsUSD = claimedAmount.times(bundle.ethPrice);
        let userAddr = user.toHexString();
        let profile = UserProfile.load(userAddr);
        if (!profile) {
            profile = new UserProfile(userAddr);
            profile.user = userAddr;
            profile.totalPositionsValueUSD = ZERO_BD;
            profile.totalStakedValueUSD = ZERO_BD;
            profile.totalVeNFTValueUSD = ZERO_BD;
            profile.totalRewardsClaimedUSD = ZERO_BD;
            profile.totalFeesEarnedUSD = ZERO_BD;
            profile.totalSwaps = 0;
            profile.totalProvides = 0;
            profile.totalWithdraws = 0;
            profile.firstActivityTimestamp = event.block.timestamp;
            profile.lastActivityTimestamp = event.block.timestamp;
        }
        profile.totalRewardsClaimedUSD = profile.totalRewardsClaimedUSD.plus(rewardsUSD);
        profile.lastActivityTimestamp = event.block.timestamp;
        profile.save();
    }
}

export function handleRewardAdded(event: NotifyReward): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let reward = convertTokenToDecimal(event.params.amount, 18);

    if (SECONDS_PER_WEEK.gt(ZERO_BD)) {
        let rateBD = reward.div(SECONDS_PER_WEEK);

        gauge.currentRewardRate = rateBD;

        let rateBI = BigInt.fromString(rateBD.times(BigDecimal.fromString("1000000000000000000")).truncate(0).toString());
        gauge.rewardRate = rateBI;

        gauge.lastUpdateTime = event.block.timestamp;
        gauge.periodFinish = event.block.timestamp.plus(BigInt.fromI32(604800));

        // Calculate USD-based APR
        gauge.estimatedAPR = calculateUSDBasedAPR(gauge, rateBD);

        gauge.totalRewardsDistributed = gauge.totalRewardsDistributed.plus(reward);
    }

    // Update GaugeEpochData emissions
    let currentEpoch = getCurrentEpoch();
    let gaugeEpochData = getOrCreateGaugeEpochData(gauge.id, currentEpoch, event.block.timestamp);
    gaugeEpochData.emissions = gaugeEpochData.emissions.plus(reward);
    gaugeEpochData.save();

    gauge.save();
}

// ============================================
// CL GAUGE EVENT HANDLERS
// ============================================

export function handleCLStaked(event: CLDeposit): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let tokenId = event.params.tokenId;
    let amount = convertTokenToDecimal(event.params.liquidityToStake, 18);
    let user = event.params.user;

    let positionId = user.toHexString() + "-" + gaugeAddress + "-" + tokenId.toString();
    let position = GaugeStakedPosition.load(positionId);
    let isNew = !position;

    if (!position) {
        position = new GaugeStakedPosition(positionId);
        position.user = user;
        position.userId = user.toHexString().toLowerCase();
        position.gauge = gaugeAddress;
        position.amount = ZERO_BD;
        position.earned = ZERO_BD;
        position.rewardPerTokenPaid = ZERO_BD;
        position.tokenId = tokenId;
        position.createdAtTimestamp = event.block.timestamp;
    }

    position.amount = position.amount.plus(amount);
    position.lastUpdateTimestamp = event.block.timestamp;
    position.save();

    gauge.totalSupply = gauge.totalSupply.plus(amount);
    gauge.totalStaked = gauge.totalSupply;
    if (isNew) {
        gauge.investorCount = gauge.investorCount + 1;
    }
    gauge.save();

    // Link to Position entity and mark as staked
    let positionEntityId = tokenId.toString();
    let clPosition = Position.load(positionEntityId);
    if (clPosition) {
        clPosition.staked = true;
        clPosition.stakedGauge = event.address;
        clPosition.save();

        position.position = positionEntityId;
        position.tickLower = clPosition.tickLower;
        position.tickUpper = clPosition.tickUpper;
        position.save();
    }
}

export function handleCLWithdrawn(event: CLWithdraw): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let tokenId = event.params.tokenId;
    let amount = convertTokenToDecimal(event.params.liquidityToStake, 18);
    let user = event.params.user;

    let positionId = user.toHexString() + "-" + gaugeAddress + "-" + tokenId.toString();
    let position = GaugeStakedPosition.load(positionId);
    if (position) {
        position.amount = position.amount.minus(amount);
        position.lastUpdateTimestamp = event.block.timestamp;
        position.save();
    }

    gauge.totalSupply = gauge.totalSupply.minus(amount);
    gauge.totalStaked = gauge.totalSupply;
    gauge.save();

    let clPosition = Position.load(tokenId.toString());
    if (clPosition && position && position.amount.le(ZERO_BD)) {
        clPosition.staked = false;
        clPosition.stakedGauge = null;
        clPosition.save();
    }
}

export function handleCLClaimed(event: CLClaimRewards): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let user = event.params.from;
    let claimedAmount = convertTokenToDecimal(event.params.amount, 18);

    // CL ClaimRewards event doesn't include tokenId, but we can decode it
    // from the transaction input (getReward(uint256 tokenId) selector)
    let input = event.transaction.input;
    if (input.length >= 36) {
        // Bytes 4..36 contain the tokenId argument (uint256, big-endian)
        let tokenIdBytes = new Bytes(32);
        for (let i = 0; i < 32; i++) {
            tokenIdBytes[i] = input[4 + i];
        }
        let tokenId = BigInt.fromUnsignedBytes(changetype<Bytes>(tokenIdBytes.reverse()));

        let positionId = user.toHexString() + "-" + gaugeAddress + "-" + tokenId.toString();
        let position = GaugeStakedPosition.load(positionId);
        if (position) {
            position.earned = position.earned.plus(claimedAmount);
            position.lastUpdateTimestamp = event.block.timestamp;
            position.save();
        }
    }

    // Update UserProfile rewards
    let bundle = getOrCreateBundle();
    if (bundle.ethPrice.gt(ZERO_BD)) {
        let rewardsUSD = claimedAmount.times(bundle.ethPrice);
        let userAddr = user.toHexString();
        let profile = UserProfile.load(userAddr);
        if (!profile) {
            profile = new UserProfile(userAddr);
            profile.user = userAddr;
            profile.totalPositionsValueUSD = ZERO_BD;
            profile.totalStakedValueUSD = ZERO_BD;
            profile.totalVeNFTValueUSD = ZERO_BD;
            profile.totalRewardsClaimedUSD = ZERO_BD;
            profile.totalFeesEarnedUSD = ZERO_BD;
            profile.totalSwaps = 0;
            profile.totalProvides = 0;
            profile.totalWithdraws = 0;
            profile.firstActivityTimestamp = event.block.timestamp;
            profile.lastActivityTimestamp = event.block.timestamp;
        }
        profile.totalRewardsClaimedUSD = profile.totalRewardsClaimedUSD.plus(rewardsUSD);
        profile.lastActivityTimestamp = event.block.timestamp;
        profile.save();
    }
}

export function handleCLRewardAdded(event: CLNotifyReward): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let reward = convertTokenToDecimal(event.params.amount, 18);

    if (SECONDS_PER_WEEK.gt(ZERO_BD)) {
        let rateBD = reward.div(SECONDS_PER_WEEK);

        gauge.currentRewardRate = rateBD;

        let rateBI = BigInt.fromString(rateBD.times(BigDecimal.fromString("1000000000000000000")).truncate(0).toString());
        gauge.rewardRate = rateBI;

        gauge.lastUpdateTime = event.block.timestamp;
        gauge.periodFinish = event.block.timestamp.plus(BigInt.fromI32(604800));

        // Calculate USD-based APR
        gauge.estimatedAPR = calculateUSDBasedAPR(gauge, rateBD);

        gauge.totalRewardsDistributed = gauge.totalRewardsDistributed.plus(reward);
    }

    // Update GaugeEpochData emissions
    let currentEpoch = getCurrentEpoch();
    let gaugeEpochData = getOrCreateGaugeEpochData(gauge.id, currentEpoch, event.block.timestamp);
    gaugeEpochData.emissions = gaugeEpochData.emissions.plus(reward);
    gaugeEpochData.save();

    gauge.save();
}
