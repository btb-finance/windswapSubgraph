# WindSwap CL Subgraph

A comprehensive subgraph for WindSwap's Concentrated Liquidity (CL) pools on Sei Network.

## Features

- **Pool Tracking**: All CL pool creation events
- **Swap Tracking**: Individual swaps with volume calculations
- **Liquidity Events**: Mint and Burn events for TVL tracking
- **Aggregations**: Daily and hourly data for charts
- **Protocol Stats**: Total volume, TVL, pools, and swaps

## Deployed Endpoint

**GraphQL API**: 
```
https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap-cl/1.0.0/gn
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
| `PoolDayData` | Daily pool aggregations |
| `PoolHourData` | Hourly pool aggregations |

## Sample Query

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
  protocol(id: "windswap") {
    totalPools
    totalSwaps
    totalVolumeUSD
    totalTVLUSD
  }
}
```

## Development

### Install Dependencies
```bash
npm install
```

### Generate Types
```bash
npm run codegen
```

### Build
```bash
npm run build
```

### Deploy to Goldsky
```bash
goldsky subgraph deploy windswap-cl/1.0.0 --path .
```

## Contracts Indexed

| Contract | Address | Network |
|----------|---------|---------|
| CL Factory | `0xA0E081764Ed601074C1B370eb117413145F5e8Cc` | Sei Mainnet |

## License

MIT
