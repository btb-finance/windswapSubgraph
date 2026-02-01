import { BigDecimal, BigInt } from '@graphprotocol/graph-ts';
import { Claimed } from '../generated/RewardsDistributor/RewardsDistributor';
import { VeNFT, VeNFTRewards, VeNFTWeeklyRebase } from '../generated/schema';

export function handleVeNFTClaimed(event: Claimed): void {
  let tokenId = event.params.tokenId;
  let amount = event.params.amount;
  
  // Get or create veNFT
  let veNFT = VeNFT.load(tokenId.toString());
  if (!veNFT) {
    return; // Skip if veNFT doesn't exist yet
  }
  
  // Get or create VeNFTRewards
  let rewardsId = tokenId.toString();
  let rewards = VeNFTRewards.load(rewardsId);
  if (!rewards) {
    rewards = new VeNFTRewards(rewardsId);
    rewards.veNFT = veNFT.id;
    rewards.claimable = BigDecimal.fromString('0');
    rewards.claimed = BigDecimal.fromString('0');
    rewards.rebases = BigDecimal.fromString('0');
    rewards.incentives = BigDecimal.fromString('0');
    rewards.lastClaimTimestamp = BigInt.fromI32(0);
  }
  
  // Update claimed amount (WIND has 18 decimals)
  let claimedAmount = amount.toBigDecimal().div(BigDecimal.fromString('1000000000000000000'));
  rewards.claimed = rewards.claimed.plus(claimedAmount);
  rewards.claimable = rewards.claimable.minus(claimedAmount);
  rewards.lastClaimTimestamp = event.block.timestamp;
  
  // Update veNFT total claimed
  veNFT.totalClaimed = veNFT.totalClaimed.plus(claimedAmount);
  
  // Create weekly rebase record
  // Week number = timestamp / 604800 (seconds in a week)
  let weekNumber = event.block.timestamp.toI32() / 604800;
  let weeklyRebaseId = veNFT.id + "-" + weekNumber.toString();
  
  let weeklyRebase = VeNFTWeeklyRebase.load(weeklyRebaseId);
  if (!weeklyRebase) {
    // First rebase this week
    weeklyRebase = new VeNFTWeeklyRebase(weeklyRebaseId);
    weeklyRebase.veNFT = veNFT.id;
    weeklyRebase.weekNumber = weekNumber;
    weeklyRebase.amount = BigDecimal.fromString('0');
  }
  
  // Add this claim to the weekly total
  weeklyRebase.amount = weeklyRebase.amount.plus(claimedAmount);
  weeklyRebase.timestamp = event.block.timestamp;
  weeklyRebase.txHash = event.transaction.hash.toHexString();
  weeklyRebase.save();
  
  rewards.save();
  veNFT.save();
}
