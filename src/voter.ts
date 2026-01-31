import { BigInt, BigDecimal, Address } from "@graphprotocol/graph-ts";
import { Voted, Abstained } from "../generated/Voter/Voter";
import { VeVote, User, VeNFT } from "../generated/schema";

let ZERO_BI = BigInt.fromI32(0);

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
    let voteId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();

    // Get or create user
    let userAddr = event.params.voter.toHexString();
    let user = getOrCreateUser(userAddr);

    // Get or create VeNFT
    let veNFT = getOrCreateVeNFT(event.params.tokenId);

    // Create vote entity
    let vote = new VeVote(voteId);
    vote.veNFT = veNFT.id;
    vote.pool = event.params.pool.toHexString();
    vote.weight = event.params.weight;
    vote.timestamp = event.params.timestamp;
    vote.save();
}

export function handleAbstained(event: Abstained): void {
    // Abstained votes remove voting weight from pools
    let voteId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString() + "-abstain";

    let userAddr = event.params.voter.toHexString();
    let user = getOrCreateUser(userAddr);

    // Get or create VeNFT
    let veNFT = getOrCreateVeNFT(event.params.tokenId);

    let vote = new VeVote(voteId);
    vote.veNFT = veNFT.id;
    vote.pool = event.params.pool.toHexString();
    vote.weight = event.params.weight; // This is the weight being removed
    vote.timestamp = event.params.timestamp;
    vote.save();
}
