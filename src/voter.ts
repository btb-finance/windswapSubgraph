import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import { Voted, Abstained, GaugeCreated } from "../generated/Voter/Voter";
import { VeVote, User, VeNFT, Gauge, Protocol, GaugeEpochData, VoteSnapshot, PoolVote } from "../generated/schema";

let ZERO_BI = BigInt.fromI32(0);
let ZERO_BD = BigDecimal.fromString("0");
let BI_18 = BigInt.fromI32(18);

// Convert BigInt to BigDecimal with decimals
function convertBigIntToDecimal(value: BigInt, decimals: i32): BigDecimal {
    if (decimals == 0) return value.toBigDecimal();
    let divisor = BigDecimal.fromString("1");
    for (let i = 0; i < decimals; i++) {
        divisor = divisor.times(BigDecimal.fromString("10"));
    }
    return value.toBigDecimal().div(divisor);
}

// Get current epoch from Protocol entity
function getCurrentEpoch(): BigInt {
    let protocol = Protocol.load("windswap");
    if (!protocol) {
        return ZERO_BI;
    }
    return protocol.epochCount;
}

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

function getOrCreateVeNFT(tokenId: BigInt): VeNFT {
    let id = tokenId.toString();
    let veNFT = VeNFT.load(id);
    if (!veNFT) {
        veNFT = new VeNFT(id);
        veNFT.tokenId = tokenId;
        veNFT.owner = ""; // Will be set properly when Deposit event is handled
        veNFT.lockedAmount = BigDecimal.fromString("0");
        veNFT.lockEnd = ZERO_BI;
        veNFT.votingPower = BigDecimal.fromString("0");
        veNFT.isPermanent = false;
        veNFT.createdAtTimestamp = ZERO_BI;
        veNFT.claimableRewards = BigDecimal.fromString("0");
        veNFT.totalClaimed = BigDecimal.fromString("0");
        veNFT.lastVoted = ZERO_BI;
        veNFT.hasVoted = false;
        veNFT.save();
    }
    return veNFT;
}

export function handleVoted(event: Voted): void {
    // Get or create user
    let userAddr = event.params.voter.toHexString();
    let user = getOrCreateUser(userAddr);

    // Get or create VeNFT
    let veNFT = getOrCreateVeNFT(event.params.tokenId);
    let veNFTId = event.params.tokenId.toString();
    let poolId = event.params.pool.toHexString();
    let currentEpoch = getCurrentEpoch();

    // Mark veNFT as having voted this epoch
    veNFT.hasVoted = true;
    veNFT.lastVoted = event.block.timestamp;

    // Use veNFT+pool as vote ID - this ensures ONE vote per pool per veNFT
    // When user votes again for same pool, it UPDATES the existing vote
    let voteId = veNFTId + "-" + poolId;
    let vote = VeVote.load(voteId);

    let previousWeight = ZERO_BI;
    let isNewVote = !vote;

    if (isNewVote) {
        // First time voting for this pool
        vote = new VeVote(voteId);
        vote.user = user.id;
        vote.veNFT = veNFT.id;
        vote.pool = poolId;
        vote.feesEarnedToken0 = ZERO_BD;
        vote.feesEarnedToken1 = ZERO_BD;
        vote.bribesEarned = ZERO_BD;
    } else {
        // Existing vote - track previous weight
        previousWeight = vote!.weight;
    }

    // At this point vote is guaranteed to exist
    let voteEntity = vote!;

    // Set epoch
    voteEntity.epoch = currentEpoch;

    // Update vote details
    voteEntity.weight = event.params.weight;
    voteEntity.timestamp = event.params.timestamp;
    voteEntity.isActive = true;
    voteEntity.save();

    // ============================================
    // CREATE/UPDATE VOTE SNAPSHOT (for RPC elimination)
    // ============================================
    let snapshotId = veNFTId + "-" + currentEpoch.toString();
    let snapshot = VoteSnapshot.load(snapshotId);

    if (!snapshot) {
        snapshot = new VoteSnapshot(snapshotId);
        snapshot.veNFT = veNFT.id;
        snapshot.epoch = currentEpoch;
        snapshot.totalWeight = ZERO_BD;
        snapshot.timestamp = event.block.timestamp;
    }

    // Convert weight to BigDecimal for the snapshot
    let weightBD = convertBigIntToDecimal(event.params.weight, 18);
    let previousWeightBD = convertBigIntToDecimal(previousWeight, 18);

    // Update total weight
    if (isNewVote) {
        snapshot.totalWeight = snapshot.totalWeight.plus(weightBD);
    } else {
        snapshot.totalWeight = snapshot.totalWeight.minus(previousWeightBD).plus(weightBD);
    }
    snapshot.timestamp = event.block.timestamp;
    snapshot.save();

    // Create/update PoolVote entry
    let poolVoteId = veNFTId + "-" + poolId + "-" + currentEpoch.toString();
    let poolVote = PoolVote.load(poolVoteId);

    if (!poolVote) {
        poolVote = new PoolVote(poolVoteId);
        poolVote.snapshot = snapshotId;
        poolVote.pool = poolId;
    }

    poolVote.weight = weightBD;

    // Calculate weight percentage (will be recalculated after all votes are in)
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

    // Create or update GaugeEpochData for this gauge/epoch
    // Find the gauge for this pool
    let gauge = Gauge.load(poolId);
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

    veNFT.save();
}

export function handleAbstained(event: Abstained): void {
    // Abstained votes remove voting weight from pools
    let voteId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString() + "-abstain";

    let userAddr = event.params.voter.toHexString();
    let user = getOrCreateUser(userAddr);

    // Get or create VeNFT
    let veNFT = getOrCreateVeNFT(event.params.tokenId);
    let veNFTId = event.params.tokenId.toString();
    let poolId = event.params.pool.toHexString();
    let currentEpoch = getCurrentEpoch();

    // Mark veNFT as not having active votes (reset)
    veNFT.hasVoted = false;

    // Load and deactivate existing vote for this veNFT+pool
    let existingVoteId = veNFTId + "-" + poolId;
    let existingVote = VeVote.load(existingVoteId);

    if (existingVote) {
        existingVote.isActive = false;
        existingVote.save();
    }

    // ============================================
    // UPDATE VOTE SNAPSHOT (for RPC elimination)
    // ============================================
    let snapshotId = veNFTId + "-" + currentEpoch.toString();
    let snapshot = VoteSnapshot.load(snapshotId);

    if (snapshot) {
        let weightBD = convertBigIntToDecimal(event.params.weight, 18);
        snapshot.totalWeight = snapshot.totalWeight.minus(weightBD);
        snapshot.timestamp = event.block.timestamp;
        snapshot.save();
    }

    // Remove the PoolVote entry (set weight to 0)
    let poolVoteId = veNFTId + "-" + poolId + "-" + currentEpoch.toString();
    let poolVote = PoolVote.load(poolVoteId);
    if (poolVote) {
        poolVote.weight = ZERO_BD;
        poolVote.weightPercentage = ZERO_BD;
        poolVote.save();
    }

    // Subtract weight from Protocol.totalVotingWeight
    let protocol = Protocol.load("windswap");
    if (protocol) {
        protocol.totalVotingWeight = protocol.totalVotingWeight.minus(event.params.weight);
        protocol.save();
    }

    // Update GaugeEpochData to subtract the voting weight
    let gauge = Gauge.load(poolId);
    if (gauge) {
        let gaugeEpochDataId = gauge.id + "-" + currentEpoch.toString();
        let gaugeEpochData = GaugeEpochData.load(gaugeEpochDataId);

        if (gaugeEpochData) {
            gaugeEpochData.votingWeight = gaugeEpochData.votingWeight.minus(event.params.weight);
            gaugeEpochData.save();
        }
    }

    // Create abstain vote record
    let vote = new VeVote(voteId);
    vote.user = user.id;
    vote.veNFT = veNFT.id;
    vote.pool = poolId;
    vote.weight = event.params.weight; // This is the weight being removed
    vote.epoch = currentEpoch;
    vote.timestamp = event.params.timestamp;
    vote.isActive = false; // Abstain deactivates votes
    vote.feesEarnedToken0 = ZERO_BD;
    vote.feesEarnedToken1 = ZERO_BD;
    vote.bribesEarned = ZERO_BD;
    vote.save();

    veNFT.save();
}

// ============================================
// GAUGE CREATED HANDLER
// ============================================

export function handleGaugeCreated(event: GaugeCreated): void {
    let gaugeAddress = event.params.gauge.toHexString();

    // Load existing gauge or create new one
    let gauge = Gauge.load(gaugeAddress);

    if (!gauge) {
        // Gauge doesn't exist yet, create it
        // Note: The pool association will be handled by the GaugeFactory handler
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

        // APR calculation fields
        gauge.currentRewardRate = ZERO_BD;
        gauge.periodFinish = ZERO_BI;
        gauge.lastUpdateTime = ZERO_BI;
        gauge.rewardPerTokenStored = ZERO_BD;
        gauge.estimatedAPR = ZERO_BD;

        gauge.createdAtTimestamp = event.block.timestamp;
        gauge.createdAtBlockNumber = event.block.number;
    }

    // Update the voting reward addresses from the event
    gauge.bribeVotingReward = event.params.bribeVotingReward;
    gauge.feeVotingReward = event.params.feeVotingReward;

    gauge.save();
}
