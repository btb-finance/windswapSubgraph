import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import {
    ProposalCreated,
    ProposalCanceled,
    ProposalExecuted,
    VoteCast,
} from '../generated/ProtocolGovernor/ProtocolGovernor';
import { Proposal, ProposalVote } from '../generated/schema';

export function handleProposalCreated(event: ProposalCreated): void {
    let proposalId = event.params.proposalId;
    let id = proposalId.toHexString();

    let proposal = new Proposal(id);
    proposal.proposalId = proposalId;
    proposal.proposer = event.params.proposer;

    // Convert arrays
    let targets: Bytes[] = [];
    for (let i = 0; i < event.params.targets.length; i++) {
        targets.push(event.params.targets[i]);
    }
    proposal.targets = targets;

    let values: BigInt[] = [];
    for (let i = 0; i < event.params.values.length; i++) {
        values.push(event.params.values[i]);
    }
    proposal.values = values;

    let calldatas: Bytes[] = [];
    for (let i = 0; i < event.params.calldatas.length; i++) {
        calldatas.push(event.params.calldatas[i]);
    }
    proposal.calldatas = calldatas;

    proposal.description = event.params.description;
    proposal.voteStart = event.params.voteStart;
    proposal.voteEnd = event.params.voteEnd;

    // Initialize vote counts
    proposal.forVotes = BigInt.fromI32(0);
    proposal.againstVotes = BigInt.fromI32(0);
    proposal.abstainVotes = BigInt.fromI32(0);

    // Initial state is Pending (0)
    proposal.state = 0;
    proposal.executed = false;
    proposal.canceled = false;

    proposal.createdAtTimestamp = event.block.timestamp;
    proposal.createdAtBlockNumber = event.block.number;
    proposal.executedAtTimestamp = null;

    proposal.save();
}

export function handleProposalCanceled(event: ProposalCanceled): void {
    let id = event.params.proposalId.toHexString();
    let proposal = Proposal.load(id);

    if (proposal) {
        proposal.canceled = true;
        proposal.state = 2; // Canceled
        proposal.save();
    }
}

export function handleProposalExecuted(event: ProposalExecuted): void {
    let id = event.params.proposalId.toHexString();
    let proposal = Proposal.load(id);

    if (proposal) {
        proposal.executed = true;
        proposal.state = 7; // Executed
        proposal.executedAtTimestamp = event.block.timestamp;
        proposal.save();
    }
}

export function handleVoteCast(event: VoteCast): void {
    let proposalId = event.params.proposalId;
    let voter = event.params.voter;
    let tokenId = event.params.tokenId;

    // Create vote record (include tokenId for uniqueness - same voter can vote with different veNFTs)
    let voteId = proposalId.toHexString() + '-' + voter.toHexString() + '-' + tokenId.toString();
    let vote = new ProposalVote(voteId);

    vote.proposal = proposalId.toHexString();
    vote.voter = voter;
    vote.tokenId = tokenId;
    vote.support = event.params.support;
    vote.weight = event.params.weight;
    vote.timestamp = event.block.timestamp;
    vote.transaction = event.transaction.hash;

    vote.save();

    // Update proposal vote tallies
    let proposal = Proposal.load(proposalId.toHexString());
    if (proposal) {
        let support = event.params.support;
        let weight = event.params.weight;

        if (support == 0) {
            proposal.againstVotes = proposal.againstVotes.plus(weight);
        } else if (support == 1) {
            proposal.forVotes = proposal.forVotes.plus(weight);
        } else if (support == 2) {
            proposal.abstainVotes = proposal.abstainVotes.plus(weight);
        }

        // Update state to Active (1) once voting starts
        if (proposal.state == 0) {
            proposal.state = 1;
        }

        proposal.save();
    }
}
