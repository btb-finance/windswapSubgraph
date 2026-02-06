import { BigInt, BigDecimal, Address } from "@graphprotocol/graph-ts";
import {
    Deposit,
    Withdraw,
    Transfer,
    LockPermanent,
    VotingEscrow
} from "../generated/VotingEscrow/VotingEscrow";
import { VeNFT, User } from "../generated/schema";
import {
    ZERO_BD,
    ZERO_BI,
    ONE_BI,
    ZERO_ADDRESS,
    convertTokenToDecimal,
    getOrCreateUser
} from "./helpers";

export function handleDeposit(event: Deposit): void {
    let tokenId = event.params.tokenId.toString();
    let veNFT = VeNFT.load(tokenId);

    let contract = VotingEscrow.bind(event.address);

    if (!veNFT) {
        veNFT = new VeNFT(tokenId);
        veNFT.tokenId = event.params.tokenId;
        veNFT.isPermanent = false;
        veNFT.createdAtTimestamp = event.block.timestamp;
        veNFT.claimableRewards = ZERO_BD;
        veNFT.totalClaimed = ZERO_BD;
        veNFT.lastVoted = ZERO_BI;
        veNFT.hasVoted = false;

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
        veNFT.lockedAmount = convertTokenToDecimal(lockedResult.value.value0, 18);
        veNFT.lockEnd = lockedResult.value.value1;
        veNFT.isPermanent = lockedResult.value.value2;
    } else {
        veNFT.lockedAmount = convertTokenToDecimal(event.params.value, 18);
        veNFT.lockEnd = event.params.locktime;
    }

    // Get voting power
    let vpResult = contract.try_balanceOfNFT(event.params.tokenId);
    if (!vpResult.reverted) {
        veNFT.votingPower = convertTokenToDecimal(vpResult.value, 18);
    } else {
        veNFT.votingPower = veNFT.lockedAmount;
    }

    veNFT.save();
}

export function handleWithdraw(event: Withdraw): void {
    let tokenId = event.params.tokenId.toString();
    let veNFT = VeNFT.load(tokenId);

    if (!veNFT) return;

    let user = User.load(veNFT.owner);
    if (user) {
        user.totalVeNFTs = user.totalVeNFTs.minus(ONE_BI);
        user.save();
    }

    veNFT.lockedAmount = ZERO_BD;
    veNFT.votingPower = ZERO_BD;
    veNFT.save();
}

export function handleVeTransfer(event: Transfer): void {
    let tokenId = event.params.tokenId.toString();

    if (event.params.from.toHexString() == ZERO_ADDRESS) {
        return;
    }
    if (event.params.to.toHexString() == ZERO_ADDRESS) {
        return;
    }

    let veNFT = VeNFT.load(tokenId);
    if (!veNFT) return;

    let oldOwner = User.load(veNFT.owner);
    if (oldOwner) {
        oldOwner.totalVeNFTs = oldOwner.totalVeNFTs.minus(ONE_BI);
        oldOwner.save();
    }

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
    veNFT.lockEnd = ZERO_BI;
    veNFT.save();
}
