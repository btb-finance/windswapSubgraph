import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import { Voted, Abstained, GaugeCreated } from "../generated/Voter/Voter";
import { VeVote, User, VeNFT, Gauge, Protocol, GaugeEpochData } from "../generated/schema";

let ZERO_BI = BigInt.fromI32(0);
let ZERO_BD = BigDecimal.fromString("0");

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
    voteEntity.epoch = getCurrentEpoch();
    
    // Update vote details
    voteEntity.weight = event.params.weight;
    voteEntity.timestamp = event.params.timestamp;
    voteEntity.isActive = true;
    voteEntity.save();

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
        let currentEpoch = getCurrentEpoch();
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

    // Mark veNFT as not having active votes (reset)
    veNFT.hasVoted = false;

    let vote = new VeVote(voteId);
    vote.user = user.id;
    vote.veNFT = veNFT.id;
    vote.pool = event.params.pool.toHexString();
    vote.weight = event.params.weight; // This is the weight being removed
    vote.timestamp = event.params.timestamp;
    vote.isActive = false; // Abstain deactivates votes
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
        gauge.rewardRate = BigInt.fromI32(0);
        gauge.totalStakedLiquidity = BigInt.fromI32(0);
        gauge.totalSupply = BigDecimal.fromString("0");
        gauge.totalStaked = BigDecimal.fromString("0");
        gauge.weight = BigInt.fromI32(0);
        gauge.isActive = true;
        gauge.investorCount = 0;
        gauge.totalRewardsDistributed = BigDecimal.fromString("0");
        gauge.createdAtTimestamp = event.block.timestamp;
        gauge.createdAtBlockNumber = event.block.number;
    }
    
    // Update the voting reward addresses from the event
    gauge.bribeVotingReward = event.params.bribeVotingReward;
    gauge.feeVotingReward = event.params.feeVotingReward;
    
    gauge.save();
}
