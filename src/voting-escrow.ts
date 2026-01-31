import { BigInt, BigDecimal, Address } from "@graphprotocol/graph-ts";
import {
    Deposit,
    Withdraw,
    Transfer,
    LockPermanent,
    VotingEscrow
} from "../generated/VotingEscrow/VotingEscrow";
import { VeNFT, User } from "../generated/schema";

let ZERO_BD = BigDecimal.fromString("0");
let ZERO_BI = BigInt.fromI32(0);
let ONE_BI = BigInt.fromI32(1);
let ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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

function convertTokenToDecimal(amount: BigInt): BigDecimal {
    // WIND has 18 decimals
    let divisor = BigDecimal.fromString("1000000000000000000");
    return amount.toBigDecimal().div(divisor);
}

export function handleDeposit(event: Deposit): void {
    let tokenId = event.params.tokenId.toString();
    let veNFT = VeNFT.load(tokenId);

    let contract = VotingEscrow.bind(event.address);

    if (!veNFT) {
        // New veNFT - initialize all fields
        veNFT = new VeNFT(tokenId);
        veNFT.tokenId = event.params.tokenId;
        veNFT.isPermanent = false;
        veNFT.createdAtTimestamp = event.block.timestamp;
        
        // Initialize new fields for rewards and voting
        veNFT.claimableRewards = ZERO_BD;
        veNFT.totalClaimed = ZERO_BD;
        veNFT.lastVoted = ZERO_BI;
        veNFT.hasVoted = false;

        // Get owner
        let ownerResult = contract.try_ownerOf(event.params.tokenId);
        if (ownerResult.reverted) return;
        let owner = ownerResult.value.toHexString();

        let user = getOrCreateUser(owner);
        user.totalVeNFTs = user.totalVeNFTs.plus(ONE_BI);
        user.save();

        veNFT.owner = user.id;
    }

    // Get locked amount from contract
    let lockedResult = contract.try_locked(event.params.tokenId);
    if (!lockedResult.reverted) {
        // value0 is i128, handle it properly
        veNFT.lockedAmount = convertTokenToDecimal(event.params.value);
        veNFT.lockEnd = lockedResult.value.value1;
        veNFT.isPermanent = lockedResult.value.value2;
    } else {
        veNFT.lockedAmount = convertTokenToDecimal(event.params.value);
        veNFT.lockEnd = event.params.locktime;
    }

    // Get voting power
    let vpResult = contract.try_balanceOfNFT(event.params.tokenId);
    if (!vpResult.reverted) {
        veNFT.votingPower = convertTokenToDecimal(vpResult.value);
    } else {
        veNFT.votingPower = veNFT.lockedAmount;
    }

    veNFT.save();
}

export function handleWithdraw(event: Withdraw): void {
    let tokenId = event.params.tokenId.toString();
    let veNFT = VeNFT.load(tokenId);

    if (!veNFT) return;

    // VeNFT is burned on withdraw
    let user = User.load(veNFT.owner);
    if (user) {
        user.totalVeNFTs = user.totalVeNFTs.minus(ONE_BI);
        user.save();
    }

    // Set to zero - could also delete
    veNFT.lockedAmount = ZERO_BD;
    veNFT.votingPower = ZERO_BD;
    veNFT.save();
}

export function handleVeTransfer(event: Transfer): void {
    let tokenId = event.params.tokenId.toString();

    // Skip mints and burns
    if (event.params.from.toHexString() == ZERO_ADDRESS) {
        // Mint - handled by Deposit
        return;
    }
    if (event.params.to.toHexString() == ZERO_ADDRESS) {
        // Burn - handled by Withdraw
        return;
    }

    let veNFT = VeNFT.load(tokenId);
    if (!veNFT) return;

    // Update old owner
    let oldOwner = User.load(veNFT.owner);
    if (oldOwner) {
        oldOwner.totalVeNFTs = oldOwner.totalVeNFTs.minus(ONE_BI);
        oldOwner.save();
    }

    // Update new owner
    let newOwnerAddr = event.params.to.toHexString();
    let newOwner = getOrCreateUser(newOwnerAddr);
    newOwner.totalVeNFTs = newOwner.totalVeNFTs.plus(ONE_BI);
    newOwner.save();

    veNFT.owner = newOwner.id;
    veNFT.save();
}

export function handleLockPermanent(event: LockPermanent): void {
    let tokenId = event.params.tokenId.toString();
    let veNFT = VeNFT.load(tokenId);

    if (!veNFT) return;

    veNFT.isPermanent = true;
    veNFT.lockEnd = ZERO_BI; // No end for permanent locks
    veNFT.save();
}
