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
    Gauge as GaugeContract,
} from "../generated/GaugeFactory/Gauge";
import {
    Deposit as CLDeposit,
    Withdraw as CLWithdraw,
    ClaimRewards as CLClaimRewards,
    NotifyReward as CLNotifyReward,
    CLGauge as CLGaugeContract,
} from "../generated/CLGaugeFactory/CLGauge";
import { Gauge, GaugeStakedPosition, GaugeEpochData, GaugeInvestor, Pool, Position, Token, Protocol, Bundle, UserProfile, User } from "../generated/schema";
import { Gauge as GaugeTemplate } from "../generated/templates";
import { CLGauge as CLGaugeTemplate } from "../generated/templates";
import {
    ZERO_BD,
    ZERO_BI,
    ONE_BI,
    convertTokenToDecimal,
    getOrCreateBundle,
    WIND_ADDRESS
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
        position.totalClaimed = ZERO_BD;
        position.rewardPerTokenPaid = ZERO_BD;
        position.tokenId = ZERO_BI;
        position.isActive = true;
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
// APR = (yearlyRewardsUSD / stakedTVL) * 100
function calculateUSDBasedAPR(gauge: Gauge, rateBD: BigDecimal): BigDecimal {
    let pool = Pool.load(gauge.pool);
    if (!pool) return ZERO_BD;
    if (pool.totalValueLockedUSD.le(ZERO_BD)) return ZERO_BD;

    // Get WIND token price (reward token)
    let windToken = Token.load(WIND_ADDRESS);
    if (!windToken || windToken.priceUSD.le(ZERO_BD)) return ZERO_BD;

    // Yearly rewards in USD
    let yearlyRewardsUSD = rateBD.times(SECONDS_PER_YEAR).times(windToken.priceUSD);

    // Calculate staked TVL from staked/total liquidity ratio
    let stakedValueUSD = ZERO_BD;
    let totalLiq = pool.liquidity;

    if (gauge.totalStakedLiquidity.gt(ZERO_BI) && totalLiq.gt(ZERO_BI)) {
        // stakedTVL = (stakedLiquidity / totalLiquidity) * poolTVL
        let stakedBD = gauge.totalStakedLiquidity.toBigDecimal();
        let totalBD = totalLiq.toBigDecimal();
        stakedValueUSD = stakedBD.div(totalBD).times(pool.totalValueLockedUSD);
    } else {
        // No one staked — use total pool TVL as fallback (conservative APR)
        stakedValueUSD = pool.totalValueLockedUSD;
    }

    if (stakedValueUSD.le(ZERO_BD)) return ZERO_BD;

    return yearlyRewardsUSD.div(stakedValueUSD).times(BigDecimal.fromString("100"));
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
    position.isActive = true;
    position.lastUpdateTimestamp = event.block.timestamp;

    // Read pending rewards from contract (snapshot after _updateRewards)
    let gaugeContract = GaugeContract.bind(event.address);
    let earnedResult = gaugeContract.try_earned(user);
    if (!earnedResult.reverted) {
        position.earned = convertTokenToDecimal(earnedResult.value, 18);
    }

    position.save();

    gauge.totalSupply = gauge.totalSupply.plus(amount);
    gauge.totalStaked = gauge.totalSupply;
    gauge.totalStakedLiquidity = gauge.totalStakedLiquidity.plus(event.params.amount);
    if (isNew) {
        gauge.investorCount = gauge.investorCount + 1;
    }
    gauge.save();

    // Track GaugeInvestor
    let investorId = user.toHexString() + "-" + gaugeAddress;
    let investor = GaugeInvestor.load(investorId);
    if (!investor) {
        investor = new GaugeInvestor(investorId);
        investor.user = user;
        investor.gauge = gaugeAddress;
        investor.investedAmount = ZERO_BD;
        investor.totalInvested = ZERO_BD;
        investor.totalWithdrawn = ZERO_BD;
        investor.firstInvestTimestamp = event.block.timestamp;
    }
    investor.investedAmount = investor.investedAmount.plus(amount);
    investor.totalInvested = investor.totalInvested.plus(amount);
    investor.lastInvestTimestamp = event.block.timestamp;
    investor.save();
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

        // Read pending rewards from contract (V2 withdraw does NOT auto-claim)
        let gaugeContract = GaugeContract.bind(event.address);
        let earnedResult = gaugeContract.try_earned(user);
        if (!earnedResult.reverted) {
            position.earned = convertTokenToDecimal(earnedResult.value, 18);
        }

        // Mark inactive when fully withdrawn
        if (position.amount.le(ZERO_BD)) {
            position.isActive = false;
            position.amount = ZERO_BD; // guard against negative from rounding
        }
        position.save();
    }

    gauge.totalSupply = gauge.totalSupply.minus(amount);
    gauge.totalStaked = gauge.totalSupply;
    let newStakedV2 = gauge.totalStakedLiquidity.minus(event.params.amount);
    gauge.totalStakedLiquidity = newStakedV2.gt(ZERO_BI) ? newStakedV2 : ZERO_BI;
    gauge.save();

    // Track GaugeInvestor withdrawal
    let investorId = user.toHexString() + "-" + gaugeAddress;
    let investor = GaugeInvestor.load(investorId);
    if (investor) {
        investor.investedAmount = investor.investedAmount.minus(amount);
        investor.totalWithdrawn = investor.totalWithdrawn.plus(amount);
        investor.lastInvestTimestamp = event.block.timestamp;
        investor.save();
    }
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
        // earned = pending rewards → 0 after claim (all pending was just claimed)
        position.earned = ZERO_BD;
        // totalClaimed = cumulative lifetime claimed
        position.totalClaimed = position.totalClaimed.plus(claimedAmount);
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
        position.totalClaimed = ZERO_BD;
        position.rewardPerTokenPaid = ZERO_BD;
        position.tokenId = tokenId;
        position.isActive = true;
        position.createdAtTimestamp = event.block.timestamp;
    }

    position.amount = position.amount.plus(amount);
    position.isActive = true;
    position.lastUpdateTimestamp = event.block.timestamp;

    // Read pending rewards from CL gauge contract
    // After deposit(), the token is staked so earned() should work
    let clGaugeContract = CLGaugeContract.bind(event.address);
    let earnedResult = clGaugeContract.try_earned(user, tokenId);
    if (!earnedResult.reverted) {
        position.earned = convertTokenToDecimal(earnedResult.value, 18);
    } else {
        // New deposit - no pending rewards yet
        position.earned = ZERO_BD;
    }

    position.save();

    gauge.totalSupply = gauge.totalSupply.plus(amount);
    gauge.totalStaked = gauge.totalSupply;
    gauge.totalStakedLiquidity = gauge.totalStakedLiquidity.plus(event.params.liquidityToStake);
    if (isNew) {
        gauge.investorCount = gauge.investorCount + 1;
    }
    gauge.save();

    // Track GaugeInvestor
    let investorId = user.toHexString() + "-" + gaugeAddress;
    let investor = GaugeInvestor.load(investorId);
    if (!investor) {
        investor = new GaugeInvestor(investorId);
        investor.user = user;
        investor.gauge = gaugeAddress;
        investor.investedAmount = ZERO_BD;
        investor.totalInvested = ZERO_BD;
        investor.totalWithdrawn = ZERO_BD;
        investor.firstInvestTimestamp = event.block.timestamp;
    }
    investor.investedAmount = investor.investedAmount.plus(amount);
    investor.totalInvested = investor.totalInvested.plus(amount);
    investor.lastInvestTimestamp = event.block.timestamp;
    investor.save();

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
        // CL withdraw() auto-claims via _getReward() before emitting Withdraw
        // so earned is 0 at this point (ClaimRewards event already handled above)
        position.earned = ZERO_BD;
        // Mark inactive when fully withdrawn
        if (position.amount.le(ZERO_BD)) {
            position.isActive = false;
            position.amount = ZERO_BD; // guard against negative from rounding
        }
        position.save();
    }

    gauge.totalSupply = gauge.totalSupply.minus(amount);
    gauge.totalStaked = gauge.totalSupply;
    let newStaked = gauge.totalStakedLiquidity.minus(event.params.liquidityToStake);
    gauge.totalStakedLiquidity = newStaked.gt(ZERO_BI) ? newStaked : ZERO_BI;
    gauge.save();

    // Track GaugeInvestor withdrawal
    let investorId = user.toHexString() + "-" + gaugeAddress;
    let investor = GaugeInvestor.load(investorId);
    if (investor) {
        investor.investedAmount = investor.investedAmount.minus(amount);
        investor.totalWithdrawn = investor.totalWithdrawn.plus(amount);
        investor.lastInvestTimestamp = event.block.timestamp;
        investor.save();
    }

    // Mark Position entity as unstaked
    let clPosition = Position.load(tokenId.toString());
    if (clPosition) {
        let fullyWithdrawn = !position || position.amount.le(ZERO_BD);
        if (fullyWithdrawn) {
            clPosition.staked = false;
            clPosition.stakedGauge = null;
            clPosition.save();
        }
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
            // earned = pending rewards → 0 after claim
            position.earned = ZERO_BD;
            // totalClaimed = cumulative lifetime claimed
            position.totalClaimed = position.totalClaimed.plus(claimedAmount);
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
