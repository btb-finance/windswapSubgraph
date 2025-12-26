# WindSwap CL Subgraph

A comprehensive subgraph for WindSwap's Concentrated Liquidity (CL) pools on Sei Network.

## Features

- **Pool Tracking**: All CL pool creation events
- **Swap Tracking**: Individual swaps with volume calculations
- **Liquidity Events**: Mint and Burn events for TVL tracking
- **User Positions**: Track LP positions per user
- **VeNFT Tracking**: Locked WIND and voting power
- **Vote Tracking**: User votes on pools
- **Aggregations**: Daily and hourly data for charts
- **Protocol Stats**: Total volume, TVL, pools, and swaps

## Deployed Endpoint (v2.0.0)

**GraphQL API**: 
```
https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap-cl/2.0.0/gn
```

## Entities

| Entity | Description |
|--------|-------------|
| `Protocol` | Global stats (totalVolume, totalTVL, totalPools) |
| `Token` | ERC20 token info (symbol, name, decimals) |
| `Pool` | CL pool with TVL and volume tracking |
| `Swap` | Individual swap events |
| `Mint` | Add liquidity events |
| `Burn` | Remove liquidity events |
| `User` | User with positions, veNFTs, and votes |
| `Position` | CL LP position with liquidity and fees |
| `VeNFT` | Voting escrow NFT (locked WIND) |
| `Vote` | User vote on a pool |
| `Collect` | Fee collection from position |
| `PoolDayData` | Daily pool aggregations |
| `PoolHourData` | Hourly pool aggregations |

## Sample Queries

### Get Pools
```graphql
{
  pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
    id
    token0 { symbol }
    token1 { symbol }
    tickSpacing
    volumeUSD
    totalValueLockedUSD
    txCount
  }
}
```

### Get User Positions
```graphql
{
  user(id: "0x...") {
    positions {
      id
      pool { token0 { symbol } token1 { symbol } }
      liquidity
      depositedToken0
      depositedToken1
    }
    veNFTs {
      id
      lockedAmount
      votingPower
    }
  }
}
```

## Contracts Indexed

| Contract | Address | Events |
|----------|---------|--------|
| CL Factory | `0xA0E081764Ed601074C1B370eb117413145F5e8Cc` | PoolCreated |
| NonfungiblePositionManager | `0x0e98B82C5FAec199DfAFe2b151d51d40522e7f35` | IncreaseLiquidity, DecreaseLiquidity, Transfer, Collect |
| VotingEscrow | `0x9312A9702c3F0105246e12874c4A0EdC6aD07593` | Deposit, Withdraw, Transfer, LockPermanent |
| Voter | `0x4B7e64A935aEAc6f1837a57bdA329c797Fa2aD22` | Voted, Abstained |

## Development

```bash
npm install
npm run codegen
npm run build
goldsky subgraph deploy windswap-cl/2.0.0 --path .
```

## License

MIT
