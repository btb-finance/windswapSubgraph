import { BigInt, BigDecimal } from '@graphprotocol/graph-ts';
import { Mint } from '../generated/Minter/Minter';
import { Protocol } from '../generated/schema';

const EPOCH_DURATION = BigInt.fromI32(604800); // 1 week in seconds

export function handleMint(event: Mint): void {
  // Get or create Protocol entity
  let protocol = Protocol.load('windswap');
  if (!protocol) {
    protocol = new Protocol('windswap');
    protocol.totalVolumeUSD = BigInt.fromI32(0).toBigDecimal();
    protocol.totalTVLUSD = BigInt.fromI32(0).toBigDecimal();
    protocol.totalPools = BigInt.fromI32(0);
    protocol.totalSwaps = BigInt.fromI32(0);
    // Initialize with default values - will be updated by other handlers
    protocol.activePeriod = event.block.timestamp;
    protocol.epochCount = BigInt.fromI32(1);
    // Initialize new fields
    protocol.epochDuration = EPOCH_DURATION;
    protocol.epochEnd = event.params.timestamp.plus(EPOCH_DURATION);
    protocol.weeklyEmissions = BigInt.fromI32(0).toBigDecimal();
    protocol.totalEmissions = BigInt.fromI32(0).toBigDecimal();
    protocol.tailEmissionRate = BigDecimal.fromString('0');
    protocol.lastUpdated = event.block.timestamp;
  }

  // Update epoch data on mint event
  protocol.activePeriod = event.params.timestamp;
  protocol.epochCount = protocol.epochCount.plus(BigInt.fromI32(1));

  // Update new fields
  protocol.epochDuration = EPOCH_DURATION;
  protocol.epochEnd = event.params.timestamp.plus(EPOCH_DURATION);

  // Convert weekly emissions from BigInt to BigDecimal
  let weeklyEmissions = event.params.weekly.toBigDecimal();
  protocol.weeklyEmissions = weeklyEmissions;

  // Accumulate total emissions
  protocol.totalEmissions = protocol.totalEmissions.plus(weeklyEmissions);

  // Set tail emission rate (0.01 = 1% if tail is true, otherwise 0)
  if (event.params.tail) {
    protocol.tailEmissionRate = BigDecimal.fromString('0.01');
  } else {
    protocol.tailEmissionRate = BigDecimal.fromString('0');
  }

  // Update lastUpdated timestamp
  protocol.lastUpdated = event.block.timestamp;

  protocol.save();
}
