import { BigDecimal, BigInt } from '@graphprotocol/graph-ts';
import { Claimed } from '../generated/RewardsDistributor/RewardsDistributor';
import { VeNFT, VeNFTRewards, VeNFTWeeklyRebase } from '../generated/schema';
import { ZERO_BD, ZERO_BI, convertTokenToDecimal } from './helpers';

export function handleVeNFTClaimed(event: Claimed): void {
    let tokenId = event.params.tokenId;
    let amount = event.params.amount;

    let veNFT = VeNFT.load(tokenId.toString());
    if (!veNFT) {
        return;
    }

    let rewardsId = tokenId.toString();
    let rewards = VeNFTRewards.load(rewardsId);
    if (!rewards) {
        rewards = new VeNFTRewards(rewardsId);
        rewards.veNFT = veNFT.id;
        rewards.claimable = ZERO_BD;
        rewards.claimed = ZERO_BD;
        rewards.rebases = ZERO_BD;
        rewards.incentives = ZERO_BD;
        rewards.lastClaimTimestamp = ZERO_BI;
    }

    // WIND has 18 decimals
    let claimedAmount = convertTokenToDecimal(amount, 18);
    rewards.claimed = rewards.claimed.plus(claimedAmount);
    rewards.claimable = rewards.claimable.minus(claimedAmount);
    rewards.lastClaimTimestamp = event.block.timestamp;

    veNFT.totalClaimed = veNFT.totalClaimed.plus(claimedAmount);

    // Create weekly rebase record
    let weekNumber = event.block.timestamp.toI32() / 604800;
    let weeklyRebaseId = veNFT.id + "-" + weekNumber.toString();

    let weeklyRebase = VeNFTWeeklyRebase.load(weeklyRebaseId);
    if (!weeklyRebase) {
        weeklyRebase = new VeNFTWeeklyRebase(weeklyRebaseId);
        weeklyRebase.veNFT = veNFT.id;
        weeklyRebase.weekNumber = weekNumber;
        weeklyRebase.amount = ZERO_BD;
    }

    weeklyRebase.amount = weeklyRebase.amount.plus(claimedAmount);
    weeklyRebase.timestamp = event.block.timestamp;
    weeklyRebase.txHash = event.transaction.hash.toHexString();
    weeklyRebase.save();

    rewards.save();
    veNFT.save();
}
