import { BigInt, BigDecimal, Address, Bytes } from "@graphprotocol/graph-ts";
import {
    GaugeCreated as V2GaugeCreatedEvent,
} from "../generated/GaugeFactory/GaugeFactory";
import {
    GaugeCreated as CLGaugeCreatedEvent,
} from "../generated/CLGaugeFactory/CLGaugeFactory";
import {
    Staked,
    Withdrawn,
    Claimed,
    RewardAdded,
} from "../generated/GaugeFactory/Gauge";
import {
    Staked as CLStaked,
    Withdrawn as CLWithdrawn,
    Claimed as CLClaimed,
    RewardAdded as CLRewardAdded,
} from "../generated/CLGaugeFactory/CLGauge";
import { Gauge, GaugeStakedPosition, Pool, Position } from "../generated/schema";
import { Gauge as GaugeTemplate } from "../generated/templates";
import { CLGauge as CLGaugeTemplate } from "../generated/templates";

let ZERO_BD = BigDecimal.fromString("0");
let ZERO_BI = BigInt.fromI32(0);
let ONE_BI = BigInt.fromI32(1);

function getOrCreateGaugeStakedPosition(
    user: Address,
    gauge: Gauge,
    timestamp: BigInt
): GaugeStakedPosition {
    let id = user.toHexString() + "-" + gauge.id;
    let position = GaugeStakedPosition.load(id);
    
    if (!position) {
        position = new GaugeStakedPosition(id);
        position.user = user;
        position.gauge = gauge.id;
        position.amount = ZERO_BD;
        position.earned = ZERO_BD;
        position.rewardPerTokenPaid = ZERO_BD;
        position.tokenId = null;
        position.lastUpdateTimestamp = timestamp;
        position.createdAtTimestamp = timestamp;
        position.save();
    }
    
    return position;
}

function convertTokenToDecimal(amount: BigInt, decimals: number): BigDecimal {
    if (decimals == 0) return amount.toBigDecimal();
    let divisor = BigDecimal.fromString("1");
    for (let i = 0; i < decimals; i++) {
        divisor = divisor.times(BigDecimal.fromString("10"));
    }
    return amount.toBigDecimal().div(divisor);
}

// ============================================
// V2 GAUGE FACTORY HANDLER
// ============================================

export function handleV2GaugeCreated(event: V2GaugeCreatedEvent): void {
    let gaugeAddress = event.params.gauge.toHexString();
    let poolAddress = event.params.pool;
    let poolId = poolAddress.toHexString();
    
    // Create gauge entity
    let gauge = new Gauge(gaugeAddress);
    gauge.pool = poolId;
    gauge.gaugeType = "V2";
    gauge.poolAddress = poolAddress;
    gauge.rewardRate = ZERO_BI;
    gauge.totalSupply = ZERO_BD;
    gauge.totalStaked = ZERO_BD;
    gauge.isActive = true;
    gauge.createdAtTimestamp = event.block.timestamp;
    gauge.createdAtBlockNumber = event.block.number;
    gauge.save();
    
    // Create template to track gauge events
    GaugeTemplate.create(event.params.gauge);
}

// ============================================
// CL GAUGE FACTORY HANDLER
// ============================================

export function handleCLGaugeCreated(event: CLGaugeCreatedEvent): void {
    let gaugeAddress = event.params.gauge.toHexString();
    let poolAddress = event.params.pool;
    let poolId = poolAddress.toHexString();
    
    // Create gauge entity
    let gauge = new Gauge(gaugeAddress);
    gauge.pool = poolId;
    gauge.gaugeType = "CL";
    gauge.poolAddress = poolAddress;
    gauge.rewardRate = ZERO_BI;
    gauge.totalSupply = ZERO_BD;
    gauge.totalStaked = ZERO_BD;
    gauge.isActive = true;
    gauge.createdAtTimestamp = event.block.timestamp;
    gauge.createdAtBlockNumber = event.block.number;
    gauge.save();
    
    // Create template to track CL gauge events
    CLGaugeTemplate.create(event.params.gauge);
}

// ============================================
// V2 GAUGE EVENT HANDLERS
// ============================================

export function handleStaked(event: Staked): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;
    
    let user = event.params.user;
    let amount = convertTokenToDecimal(event.params.amount, 18);
    
    // Update or create staked position
    let position = getOrCreateGaugeStakedPosition(user, gauge, event.block.timestamp);
    position.amount = position.amount.plus(amount);
    position.lastUpdateTimestamp = event.block.timestamp;
    position.save();
    
    // Update gauge totals
    gauge.totalSupply = gauge.totalSupply.plus(amount);
    gauge.totalStaked = gauge.totalSupply;
    gauge.save();
}

export function handleWithdrawn(event: Withdrawn): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;
    
    let user = event.params.user;
    let amount = convertTokenToDecimal(event.params.amount, 18);
    
    // Update staked position
    let positionId = user.toHexString() + "-" + gaugeAddress;
    let position = GaugeStakedPosition.load(positionId);
    if (position) {
        position.amount = position.amount.minus(amount);
        position.lastUpdateTimestamp = event.block.timestamp;
        position.save();
    }
    
    // Update gauge totals
    gauge.totalSupply = gauge.totalSupply.minus(amount);
    gauge.totalStaked = gauge.totalSupply;
    gauge.save();
}

export function handleClaimed(event: Claimed): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;
    
    let user = event.params.user;
    
    // Update staked position - reset earned amount when claimed
    let positionId = user.toHexString() + "-" + gaugeAddress;
    let position = GaugeStakedPosition.load(positionId);
    if (position) {
        position.earned = ZERO_BD;
        position.lastUpdateTimestamp = event.block.timestamp;
        position.save();
    }
}

export function handleRewardAdded(event: RewardAdded): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;
    
    // Update reward rate based on the reward added
    // This is a simplified calculation - rewardRate is typically reward / duration
    let reward = convertTokenToDecimal(event.params.reward, 18);
    // Assume 7 day duration (604800 seconds) for reward rate calculation
    let duration = BigDecimal.fromString("604800");
    // Convert BigDecimal reward back to BigInt for storage
    // rewardRate = reward / duration (in wei units)
    if (duration.gt(ZERO_BD)) {
        let rateBD = reward.div(duration);
        // Convert to BigInt (wei) - multiply by 10^18 for precision
        let rateBI = BigInt.fromString(rateBD.times(BigDecimal.fromString("1000000000000000000")).truncate(0).toString());
        gauge.rewardRate = rateBI;
    }
    gauge.save();
}

// ============================================
// CL GAUGE EVENT HANDLERS
// ============================================

export function handleCLStaked(event: CLStaked): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;
    
    let tokenId = event.params.tokenId;
    let amount = convertTokenToDecimal(event.params.amount, 18);
    let user = event.params.owner;
    
    // Create position ID using tokenId for CL gauges
    let positionId = user.toHexString() + "-" + gaugeAddress + "-" + tokenId.toString();
    let position = GaugeStakedPosition.load(positionId);
    
    if (!position) {
        position = new GaugeStakedPosition(positionId);
        position.user = user;
        position.gauge = gaugeAddress;
        position.amount = ZERO_BD;
        position.earned = ZERO_BD;
        position.rewardPerTokenPaid = ZERO_BD;
        position.tokenId = tokenId;
        position.createdAtTimestamp = event.block.timestamp;
    }
    
    position.amount = position.amount.plus(amount);
    position.lastUpdateTimestamp = event.block.timestamp;
    position.save();
    
    // Update gauge totals
    gauge.totalSupply = gauge.totalSupply.plus(amount);
    gauge.totalStaked = gauge.totalSupply;
    gauge.save();
    
    // Link to Position entity and mark as staked
    let positionEntityId = tokenId.toString();
    let clPosition = Position.load(positionEntityId);
    if (clPosition) {
        clPosition.staked = true;
        clPosition.stakedGauge = event.address;
        clPosition.save();
        
        // Link GaugeStakedPosition to Position entity
        position.position = positionEntityId;
        position.save();
    }
}

export function handleCLWithdrawn(event: CLWithdrawn): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;
    
    let tokenId = event.params.tokenId;
    let amount = convertTokenToDecimal(event.params.amount, 18);
    let user = event.params.owner;
    
    // Update staked position
    let positionId = user.toHexString() + "-" + gaugeAddress + "-" + tokenId.toString();
    let position = GaugeStakedPosition.load(positionId);
    if (position) {
        position.amount = position.amount.minus(amount);
        position.lastUpdateTimestamp = event.block.timestamp;
        position.save();
    }
    
    // Update gauge totals
    gauge.totalSupply = gauge.totalSupply.minus(amount);
    gauge.totalStaked = gauge.totalSupply;
    gauge.save();
    
    // Update Position entity to mark as unstaked if fully withdrawn
    let clPosition = Position.load(tokenId.toString());
    if (clPosition && position && position.amount.le(ZERO_BD)) {
        clPosition.staked = false;
        clPosition.stakedGauge = null;
        clPosition.save();
    }
}

export function handleCLClaimed(event: CLClaimed): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;
    
    let tokenId = event.params.tokenId;
    let user = event.params.owner;
    
    // Update staked position - reset earned amount when claimed
    let positionId = user.toHexString() + "-" + gaugeAddress + "-" + tokenId.toString();
    let position = GaugeStakedPosition.load(positionId);
    if (position) {
        position.earned = ZERO_BD;
        position.lastUpdateTimestamp = event.block.timestamp;
        position.save();
    }
}

export function handleCLRewardAdded(event: CLRewardAdded): void {
    let gaugeAddress = event.address.toHexString();
    let gauge = Gauge.load(gaugeAddress);
    if (!gauge) return;
    
    // Update reward rate based on the reward added
    let reward = convertTokenToDecimal(event.params.reward, 18);
    // Assume 7 day duration (604800 seconds) for reward rate calculation
    let duration = BigDecimal.fromString("604800");
    // Convert BigDecimal reward back to BigInt for storage
    // rewardRate = reward / duration (in wei units)
    if (duration.gt(ZERO_BD)) {
        let rateBD = reward.div(duration);
        // Convert to BigInt (wei) - multiply by 10^18 for precision
        let rateBI = BigInt.fromString(rateBD.times(BigDecimal.fromString("1000000000000000000")).truncate(0).toString());
        gauge.rewardRate = rateBI;
    }
    gauge.save();
}
