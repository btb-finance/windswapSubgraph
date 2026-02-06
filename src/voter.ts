import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import { Voted, Abstained, GaugeCreated, DistributeReward } from "../generated/Voter/Voter";
import { VeVote, User, VeNFT, Gauge, Protocol, GaugeEpochData, VoteSnapshot, PoolVote, Pool, VotingRewardSource } from "../generated/schema";
import { VotingReward as VotingRewardTemplate } from "../generated/templates";
import {
    ZERO_BI,
    ZERO_BD,
    getOrCreateUser,
    convertTokenToDecimal
} from "./helpers";

// Get current epoch from Protocol entity
function getCurrentEpoch(): BigInt {
    let protocol = Protocol.load("windswap");
    if (!protocol) {
        return ZERO_BI;
    }
    return protocol.epochCount;
}

function getOrCreateVeNFT(tokenId: BigInt): VeNFT {
    let id = tokenId.toString();
    let veNFT = VeNFT.load(id);
    if (!veNFT) {
        veNFT = new VeNFT(id);
        veNFT.tokenId = tokenId;
        veNFT.owner = "";
        veNFT.lockedAmount = ZERO_BD;
        veNFT.lockEnd = ZERO_BI;
        veNFT.votingPower = ZERO_BD;
        veNFT.isPermanent = false;
        veNFT.createdAtTimestamp = ZERO_BI;
        veNFT.claimableRewards = ZERO_BD;
        veNFT.totalClaimed = ZERO_BD;
        veNFT.lastVoted = ZERO_BI;
        veNFT.hasVoted = false;
        veNFT.save();
    }
    return veNFT;
}

export function handleVoted(event: Voted): void {
    let userAddr = event.params.voter.toHexString();
    let user = getOrCreateUser(userAddr);

    let veNFT = getOrCreateVeNFT(event.params.tokenId);
    let veNFTId = event.params.tokenId.toString();
    let poolId = event.params.pool.toHexString();
    let currentEpoch = getCurrentEpoch();

    veNFT.hasVoted = true;
    veNFT.lastVoted = event.block.timestamp;

    let voteId = veNFTId + "-" + poolId;
    let vote = VeVote.load(voteId);

    let previousWeight = ZERO_BI;
    let isNewVote = !vote;

    if (isNewVote) {
        vote = new VeVote(voteId);
        vote.user = user.id;
        vote.veNFT = veNFT.id;
        vote.pool = poolId;
        vote.feesEarnedToken0 = ZERO_BD;
        vote.feesEarnedToken1 = ZERO_BD;
        vote.bribesEarned = ZERO_BD;
    } else {
        previousWeight = vote!.weight;
    }

    let voteEntity = vote!;
    voteEntity.epoch = currentEpoch;
    voteEntity.weight = event.params.weight;
    voteEntity.timestamp = event.params.timestamp;
    voteEntity.isActive = true;
    voteEntity.save();

    // Create/update VoteSnapshot
    let snapshotId = veNFTId + "-" + currentEpoch.toString();
    let snapshot = VoteSnapshot.load(snapshotId);

    if (!snapshot) {
        snapshot = new VoteSnapshot(snapshotId);
        snapshot.veNFT = veNFT.id;
        snapshot.epoch = currentEpoch;
        snapshot.totalWeight = ZERO_BD;
        snapshot.timestamp = event.block.timestamp;
    }

    let weightBD = convertTokenToDecimal(event.params.weight, 18);
    let previousWeightBD = convertTokenToDecimal(previousWeight, 18);

    if (isNewVote) {
        snapshot.totalWeight = snapshot.totalWeight.plus(weightBD);
    } else {
        snapshot.totalWeight = snapshot.totalWeight.minus(previousWeightBD).plus(weightBD);
    }
    snapshot.timestamp = event.block.timestamp;
    snapshot.save();

    // Create/update PoolVote
    let poolVoteId = veNFTId + "-" + poolId + "-" + currentEpoch.toString();
    let poolVote = PoolVote.load(poolVoteId);

    if (!poolVote) {
        poolVote = new PoolVote(poolVoteId);
        poolVote.snapshot = snapshotId;
        poolVote.pool = poolId;
    }

    poolVote.weight = weightBD;

    if (snapshot.totalWeight.gt(ZERO_BD)) {
        poolVote.weightPercentage = weightBD.div(snapshot.totalWeight).times(BigDecimal.fromString("100"));
    } else {
        poolVote.weightPercentage = ZERO_BD;
    }
    poolVote.save();

    // Update Protocol.totalVotingWeight
    let protocol = Protocol.load("windswap");
    if (protocol) {
        if (isNewVote) {
            protocol.totalVotingWeight = protocol.totalVotingWeight.plus(event.params.weight);
        } else {
            protocol.totalVotingWeight = protocol.totalVotingWeight.minus(previousWeight).plus(event.params.weight);
        }
        protocol.save();
    }

    // Create or update GaugeEpochData - look up gauge via Pool.gaugeAddress
    let pool = Pool.load(poolId);
    if (pool && pool.gaugeAddress) {
        let gauge = Gauge.load(pool.gaugeAddress!);
        if (gauge) {
            let gaugeEpochDataId = gauge.id + "-" + currentEpoch.toString();
            let gaugeEpochData = GaugeEpochData.load(gaugeEpochDataId);

            if (!gaugeEpochData) {
                gaugeEpochData = new GaugeEpochData(gaugeEpochDataId);
                gaugeEpochData.gauge = gauge.id;
                gaugeEpochData.epoch = currentEpoch;
                gaugeEpochData.votingWeight = event.params.weight;
                gaugeEpochData.feeRewardToken0 = ZERO_BD;
                gaugeEpochData.feeRewardToken1 = ZERO_BD;
                gaugeEpochData.totalBribes = ZERO_BD;
                gaugeEpochData.emissions = ZERO_BD;
                gaugeEpochData.timestamp = event.block.timestamp;
            } else {
                if (isNewVote) {
                    gaugeEpochData.votingWeight = gaugeEpochData.votingWeight.plus(event.params.weight);
                } else {
                    gaugeEpochData.votingWeight = gaugeEpochData.votingWeight.minus(previousWeight).plus(event.params.weight);
                }
            }
            gaugeEpochData.save();
        }
    }

    veNFT.save();
}

export function handleAbstained(event: Abstained): void {
    let voteId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString() + "-abstain";

    let userAddr = event.params.voter.toHexString();
    let user = getOrCreateUser(userAddr);

    let veNFT = getOrCreateVeNFT(event.params.tokenId);
    let veNFTId = event.params.tokenId.toString();
    let poolId = event.params.pool.toHexString();
    let currentEpoch = getCurrentEpoch();

    veNFT.hasVoted = false;

    let existingVoteId = veNFTId + "-" + poolId;
    let existingVote = VeVote.load(existingVoteId);

    if (existingVote) {
        existingVote.isActive = false;
        existingVote.save();
    }

    // Update VoteSnapshot
    let snapshotId = veNFTId + "-" + currentEpoch.toString();
    let snapshot = VoteSnapshot.load(snapshotId);

    if (snapshot) {
        let weightBD = convertTokenToDecimal(event.params.weight, 18);
        snapshot.totalWeight = snapshot.totalWeight.minus(weightBD);
        snapshot.timestamp = event.block.timestamp;
        snapshot.save();
    }

    // Remove the PoolVote
    let poolVoteId = veNFTId + "-" + poolId + "-" + currentEpoch.toString();
    let poolVote = PoolVote.load(poolVoteId);
    if (poolVote) {
        poolVote.weight = ZERO_BD;
        poolVote.weightPercentage = ZERO_BD;
        poolVote.save();
    }

    // Subtract from Protocol.totalVotingWeight
    let protocol = Protocol.load("windswap");
    if (protocol) {
        protocol.totalVotingWeight = protocol.totalVotingWeight.minus(event.params.weight);
        protocol.save();
    }

    // Update GaugeEpochData - look up gauge via Pool.gaugeAddress
    let absPool = Pool.load(poolId);
    if (absPool && absPool.gaugeAddress) {
        let gauge = Gauge.load(absPool.gaugeAddress!);
        if (gauge) {
            let gaugeEpochDataId = gauge.id + "-" + currentEpoch.toString();
            let gaugeEpochData = GaugeEpochData.load(gaugeEpochDataId);

            if (gaugeEpochData) {
                gaugeEpochData.votingWeight = gaugeEpochData.votingWeight.minus(event.params.weight);
                gaugeEpochData.save();
            }
        }
    }

    // Create abstain vote record
    let vote = new VeVote(voteId);
    vote.user = user.id;
    vote.veNFT = veNFT.id;
    vote.pool = poolId;
    vote.weight = event.params.weight;
    vote.epoch = currentEpoch;
    vote.timestamp = event.params.timestamp;
    vote.isActive = false;
    vote.feesEarnedToken0 = ZERO_BD;
    vote.feesEarnedToken1 = ZERO_BD;
    vote.bribesEarned = ZERO_BD;
    vote.save();

    veNFT.save();
}

// ============================================
// GAUGE CREATED HANDLER (from Voter contract)
// ============================================

export function handleGaugeCreated(event: GaugeCreated): void {
    let gaugeAddress = event.params.gauge.toHexString();

    let gauge = Gauge.load(gaugeAddress);

    if (!gauge) {
        gauge = new Gauge(gaugeAddress);
        gauge.pool = "";
        gauge.gaugeType = "";
        gauge.poolAddress = Bytes.empty();
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
    }

    gauge.bribeVotingReward = event.params.bribeVotingReward;
    gauge.feeVotingReward = event.params.feeVotingReward;

    // Set pool from GaugeCreated event if not already set
    let poolAddress = event.params.pool.toHexString();
    if (gauge.pool == "") {
        gauge.pool = poolAddress;
        gauge.poolAddress = event.params.pool;
    }

    gauge.save();

    // Also set gaugeAddress on Pool for reverse lookup
    let pool = Pool.load(poolAddress);
    if (pool && !pool.gaugeAddress) {
        pool.gaugeAddress = gaugeAddress;
        pool.save();
    }

    // Create VotingReward templates for fee and bribe voting reward contracts
    let feeRewardAddr = event.params.feeVotingReward;
    let bribeRewardAddr = event.params.bribeVotingReward;

    // Fee voting reward
    let feeSource = new VotingRewardSource(feeRewardAddr.toHexString());
    feeSource.gauge = gaugeAddress;
    feeSource.pool = poolAddress;
    feeSource.rewardType = "fee";
    feeSource.save();
    VotingRewardTemplate.create(feeRewardAddr);

    // Bribe voting reward
    let bribeSource = new VotingRewardSource(bribeRewardAddr.toHexString());
    bribeSource.gauge = gaugeAddress;
    bribeSource.pool = poolAddress;
    bribeSource.rewardType = "bribe";
    bribeSource.save();
    VotingRewardTemplate.create(bribeRewardAddr);
}

// ============================================
// DISTRIBUTE REWARD HANDLER (from Voter contract)
// ============================================

export function handleDistributeReward(event: DistributeReward): void {
    let gaugeAddress = event.params.gauge.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;

    let amount = convertTokenToDecimal(event.params.amount, 18);
    let currentEpoch = getCurrentEpoch();

    // Update GaugeEpochData emissions
    let epochDataId = gaugeAddress + "-" + currentEpoch.toString();
    let epochData = GaugeEpochData.load(epochDataId);
    if (!epochData) {
        epochData = new GaugeEpochData(epochDataId);
        epochData.gauge = gaugeAddress;
        epochData.epoch = currentEpoch;
        epochData.votingWeight = ZERO_BI;
        epochData.feeRewardToken0 = ZERO_BD;
        epochData.feeRewardToken1 = ZERO_BD;
        epochData.totalBribes = ZERO_BD;
        epochData.emissions = ZERO_BD;
        epochData.timestamp = event.block.timestamp;
    }

    epochData.emissions = epochData.emissions.plus(amount);
    epochData.save();

    // Also update gauge total rewards
    gauge.totalRewardsDistributed = gauge.totalRewardsDistributed.plus(amount);
    gauge.save();
}
