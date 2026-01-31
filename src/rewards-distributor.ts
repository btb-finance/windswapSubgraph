import { BigDecimal, BigInt } from '@graphprotocol/graph-ts';
import { Claimed } from '../generated/RewardsDistributor/RewardsDistributor';
import { VeNFT, VeNFTRewards } from '../generated/schema';

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
  
  rewards.save();
  veNFT.save();
}
