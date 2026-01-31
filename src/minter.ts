import { BigInt } from '@graphprotocol/graph-ts';
import { Mint } from '../generated/Minter/Minter';
import { Protocol } from '../generated/schema';

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
  }
  
  // Update epoch data on mint event
  protocol.activePeriod = event.params.timestamp;
  protocol.epochCount = protocol.epochCount.plus(BigInt.fromI32(1));
  
  protocol.save();
}
