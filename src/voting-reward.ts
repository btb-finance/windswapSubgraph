import { BigInt, BigDecimal, Address } from "@graphprotocol/graph-ts";
import {
    ClaimRewards,
    NotifyReward
} from "../generated/templates/VotingReward/VotingReward";
import {
    VotingRewardClaim,
    VotingRewardSource,
    GaugeEpochData,
    GaugeEpochBribe,
    BribeDeposit,
    Gauge,
    Pool,
    Token,
    User,
    Protocol
} from "../generated/schema";
import {
    ZERO_BD,
    ZERO_BI,
    convertTokenToDecimal,
    getOrCreateUser
} from "./helpers";

// Get current epoch from Protocol
function getCurrentEpoch(): BigInt {
    let protocol = Protocol.load("windswap");
    if (!protocol) return ZERO_BI;
    return protocol.epochCount;
}

export function handleClaimRewards(event: ClaimRewards): void {
    let rewardContractAddress = event.address.toHexString();

    // Look up which gauge/pool this reward contract belongs to
    let source = VotingRewardSource.load(rewardContractAddress);
    if (!source) return;

    let gauge = Gauge.load(source.gauge);
    if (!gauge) return;

    let pool = Pool.load(source.pool);
    if (!pool) return;

    let rewardTokenAddress = event.params.token.toHexString();
    let token = Token.load(rewardTokenAddress);
    if (!token) return;

    let amount = convertTokenToDecimal(event.params.amount, token.decimals);
    if (amount.equals(ZERO_BD)) return;

    // Calculate USD value
    let amountUSD = ZERO_BD;
    if (token.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount.times(token.priceUSD);
    }

    // Create user
    let userAddress = event.params.recipient.toHexString();
    let user = getOrCreateUser(userAddress);
    user.save();

    // Create VotingRewardClaim entity
    let claimId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    let claim = new VotingRewardClaim(claimId);
    claim.user = user.id;
    claim.gauge = gauge.id;
    claim.pool = source.pool;
    claim.rewardType = source.rewardType;
    claim.rewardToken = token.id;
    claim.amount = amount;
    claim.amountUSD = amountUSD;
    claim.epoch = getCurrentEpoch();
    claim.timestamp = event.block.timestamp;
    claim.save();

    // Update GaugeEpochData fee tracking (for fee rewards)
    if (source.rewardType == "fee") {
        let currentEpoch = getCurrentEpoch();
        let epochDataId = gauge.id + "-" + currentEpoch.toString();
        let epochData = GaugeEpochData.load(epochDataId);
        if (epochData) {
            if (token.id == pool.token0) {
                epochData.feeRewardToken0 = epochData.feeRewardToken0.plus(amount);
            } else if (token.id == pool.token1) {
                epochData.feeRewardToken1 = epochData.feeRewardToken1.plus(amount);
            }
            epochData.save();
        }
    }

    // Update GaugeEpochData bribe tracking
    if (source.rewardType == "bribe") {
        let currentEpoch = getCurrentEpoch();
        let epochDataId = gauge.id + "-" + currentEpoch.toString();
        let epochData = GaugeEpochData.load(epochDataId);
        if (epochData) {
            epochData.totalBribes = epochData.totalBribes.plus(amountUSD);
            epochData.save();
        }
    }
}

export function handleNotifyReward(event: NotifyReward): void {
    let rewardContractAddress = event.address.toHexString();

    // Look up which gauge/pool this reward contract belongs to
    let source = VotingRewardSource.load(rewardContractAddress);
    if (!source) return;

    let gauge = Gauge.load(source.gauge);
    if (!gauge) return;

    let rewardTokenAddress = event.params.token.toHexString();
    let token = Token.load(rewardTokenAddress);
    if (!token) return;

    let amount = convertTokenToDecimal(event.params.amount, token.decimals);
    let amountUSD = ZERO_BD;
    if (token.priceUSD.gt(ZERO_BD)) {
        amountUSD = amount.times(token.priceUSD);
    }

    let epoch = event.params.epoch;

    // Update GaugeEpochData
    let epochDataId = gauge.id + "-" + epoch.toString();
    let epochData = GaugeEpochData.load(epochDataId);
    if (!epochData) {
        epochData = new GaugeEpochData(epochDataId);
        epochData.gauge = gauge.id;
        epochData.epoch = epoch;
        epochData.votingWeight = ZERO_BI;
        epochData.feeRewardToken0 = ZERO_BD;
        epochData.feeRewardToken1 = ZERO_BD;
        epochData.totalBribes = ZERO_BD;
        epochData.emissions = ZERO_BD;
        epochData.timestamp = event.block.timestamp;
    }

    let pool = Pool.load(source.pool);

    if (source.rewardType == "fee" && pool) {
        if (token.id == pool.token0) {
            epochData.feeRewardToken0 = epochData.feeRewardToken0.plus(amount);
        } else if (token.id == pool.token1) {
            epochData.feeRewardToken1 = epochData.feeRewardToken1.plus(amount);
        }
    } else if (source.rewardType == "bribe") {
        epochData.totalBribes = epochData.totalBribes.plus(amountUSD);

        // Create individual BribeDeposit record
        let depositId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
        let deposit = new BribeDeposit(depositId);
        deposit.gauge = gauge.id;
        deposit.pool = source.pool;
        deposit.depositor = event.params.sender;
        deposit.token = token.id;
        deposit.amount = amount;
        deposit.amountUSD = amountUSD;
        deposit.epoch = epoch;
        deposit.timestamp = event.block.timestamp;
        deposit.save();

        // Update per-token aggregate (GaugeEpochBribe)
        let bribeAggId = gauge.id + "-" + epoch.toString() + "-" + token.id;
        let bribeAgg = GaugeEpochBribe.load(bribeAggId);
        if (!bribeAgg) {
            bribeAgg = new GaugeEpochBribe(bribeAggId);
            bribeAgg.gauge = gauge.id;
            bribeAgg.epoch = epoch;
            bribeAgg.token = token.id;
            bribeAgg.totalAmount = ZERO_BD;
            bribeAgg.totalAmountUSD = ZERO_BD;
            bribeAgg.depositorCount = 0;
        }
        bribeAgg.totalAmount = bribeAgg.totalAmount.plus(amount);
        bribeAgg.totalAmountUSD = bribeAgg.totalAmountUSD.plus(amountUSD);
        bribeAgg.depositorCount = bribeAgg.depositorCount + 1;
        bribeAgg.save();
    }

    epochData.save();
}
