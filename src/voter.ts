import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { Voted, Abstained } from "../generated/Voter/Voter";
import { Vote, User } from "../generated/schema";

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

export function handleVoted(event: Voted): void {
    let voteId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();

    // Get or create user
    let userAddr = event.params.voter.toHexString();
    let user = getOrCreateUser(userAddr);

    // Create vote entity
    let vote = new Vote(voteId);
    vote.user = user.id;
    vote.veNFTId = event.params.tokenId;
    vote.pool = event.params.pool;
    vote.weight = event.params.weight;
    vote.timestamp = event.params.timestamp;
    vote.transaction = event.transaction.hash;
    vote.save();
}

export function handleAbstained(event: Abstained): void {
    // Abstained votes remove voting weight from pools
    // Could track these separately or as negative votes
    // For now, we just log it as a vote with the weight being removed
    let voteId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString() + "-abstain";

    let userAddr = event.params.voter.toHexString();
    let user = getOrCreateUser(userAddr);

    let vote = new Vote(voteId);
    vote.user = user.id;
    vote.veNFTId = event.params.tokenId;
    vote.pool = event.params.pool;
    vote.weight = event.params.weight; // This is the weight being removed
    vote.timestamp = event.params.timestamp;
    vote.transaction = event.transaction.hash;
    vote.save();
}
