import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import { Voted, Abstained, GaugeCreated } from "../generated/Voter/Voter";
import { VeVote, User, VeNFT, Gauge, Protocol, GaugeEpochData, VoteSnapshot, PoolVote, Pool } from "../generated/schema";
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

    gauge.save();
}
