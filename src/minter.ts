import { BigInt, BigDecimal } from '@graphprotocol/graph-ts';
import { Mint } from '../generated/Minter/Minter';
import { Protocol } from '../generated/schema';
import { ZERO_BD, ZERO_BI } from './helpers';

const EPOCH_DURATION = BigInt.fromI32(604800); // 1 week in seconds

export function handleMint(event: Mint): void {
    let protocol = Protocol.load('windswap');
    if (!protocol) {
        protocol = new Protocol('windswap');
        protocol.totalVolumeUSD = ZERO_BD;
        protocol.totalTVLUSD = ZERO_BD;
        protocol.totalFeesUSD = ZERO_BD;
        protocol.totalPools = ZERO_BI;
        protocol.totalSwaps = ZERO_BI;
        protocol.untrackedVolumeUSD = ZERO_BD;
        protocol.txCount = ZERO_BI;
        protocol.activePeriod = event.block.timestamp;
        protocol.epochCount = BigInt.fromI32(1);
        protocol.epochDuration = EPOCH_DURATION;
        protocol.epochEnd = event.block.timestamp.plus(EPOCH_DURATION);
        protocol.weeklyEmissions = ZERO_BD;
        protocol.totalEmissions = ZERO_BD;
        protocol.tailEmissionRate = ZERO_BD;
        protocol.totalVotingWeight = ZERO_BI;
        protocol.proposalThreshold = ZERO_BI;
        protocol.votingDelay = ZERO_BI;
        protocol.votingPeriod = ZERO_BI;
        protocol.lastUpdated = event.block.timestamp;
    }

    protocol.activePeriod = event.block.timestamp;
    protocol.epochCount = protocol.epochCount.plus(BigInt.fromI32(1));
    protocol.epochDuration = EPOCH_DURATION;
    protocol.epochEnd = event.block.timestamp.plus(EPOCH_DURATION);

    let weeklyEmissions = event.params._weekly.toBigDecimal();
    protocol.weeklyEmissions = weeklyEmissions;
    protocol.totalEmissions = protocol.totalEmissions.plus(weeklyEmissions);

    if (event.params._tail) {
        protocol.tailEmissionRate = BigDecimal.fromString('0.01');
    } else {
        protocol.tailEmissionRate = ZERO_BD;
    }

    protocol.lastUpdated = event.block.timestamp;
    protocol.save();
}
