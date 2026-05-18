# WindSwap Subgraph

**Concentrated Liquidity DEX Subgraph on Base Network**

![WindSwap](https://img.shields.io/badge/WindSwap-v1.0.0-blue)
![Network](https://img.shields.io/badge/Network-Base-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Overview

WindSwap is a concentrated liquidity DEX with Ve(3,3) tokenomics on Base. This subgraph indexes all protocol activity including LP positions, swaps, gauges, voting, and governance.

---

## Live Endpoint

### The Graph Studio (Production)
```
https://api.studio.thegraph.com/query/1744944/windswap-base/v0.0.1779114222
```

### Studio Dashboard
```
https://thegraph.com/studio/subgraph/windswap-base
```

---

## Contracts Indexed

| Contract | Address | Events |
|----------|---------|--------|
| CL Factory | `0x8888A3D87EF6aBC5F50572661E4729A45b255cF6` | PoolCreated |
| NonfungiblePositionManager | `0x8888bB79b80e6B48014493819656Ffc1444d7687` | IncreaseLiquidity, DecreaseLiquidity, Transfer, Collect |
| VotingEscrow | `0x88889C4Be508cA88eba6ad802340C0563891D426` | Deposit, Withdraw, Transfer, LockPermanent |
| Voter | `0x88881EB4b5dD3461fC0CFBc44606E3b401197E38` | Voted, Abstained, GaugeCreated, DistributeReward |
| GaugeFactory | `0x88886e546d9024C53Cfb0FbD87DE83FA9BF9e857` | GaugeCreated |
| CLGaugeFactory | `0x8888B7b5731EBB4E7962cC20b186C92C94bCAFbd` | GaugeCreated |
| RewardsDistributor | `0x8888f1e8908F7B268439289091b3Fd1dE2B4c124` | Claimed |
| Minter | `0x8888a8585d2Ab886800409fF97Ce84564CbFeF47` | Mint |
| ProtocolGovernor | `0x0000000000000000000000000000000000000000` | ProposalCreated, VoteCast |

**Start Block:** 43735495

---

## Entities

| Category | Entities | Purpose |
|----------|----------|---------|
| **Core** | `Protocol`, `Pool`, `Token` | DEX statistics and prices |
| **Trading** | `Swap`, `Mint`, `Burn`, `Transaction` | All trading activity |
| **Liquidity** | `Position`, `LiquidityPosition`, `PoolLiquidityProvider` | LP tracking and fees |
| **Ve(3,3)** | `VeNFT`, `VeVote`, `Gauge`, `GaugeStakedPosition` | Voting and rewards |
| **Analytics** | `TokenDayData`, `PoolDayData`, `PoolHourData`, `Bundle` | Historical data |
| **Governance** | `Proposal`, `ProposalVote` | DAO governance |

---

## Query Examples

### User Positions
```graphql
query UserPositions($userId: ID!) {
  positions(where: { owner: $userId }) {
    tokenId
    liquidity
    pool {
      token0 { symbol priceUSD }
      token1 { symbol priceUSD }
      sqrtPriceX96
      tick
    }
    tickLower
    tickUpper
    depositedToken0
    depositedToken1
    depositedUSD
  }
}
```

### Pool Analytics
```graphql
query PoolAnalytics {
  pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
    id
    token0 { symbol priceUSD }
    token1 { symbol priceUSD }
    totalValueLockedUSD
    volumeUSD
    feesUSD
    liquidityProviderCount
    tick
    sqrtPriceX96
  }
}
```

### Sync Status
```graphql
{
  _meta {
    block { number }
    hasIndexingErrors
  }
}
```

---

## Development

```bash
# Install dependencies
npm install

# Generate TypeScript types
graph codegen

# Build subgraph
graph build

# Authenticate
graph auth <deploy-key>

# Deploy to The Graph Studio
graph deploy windswap-base
```

---

## License

MIT License

---

**Built on Base Network**
