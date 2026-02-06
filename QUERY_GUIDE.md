# WindSwap Subgraph Query Guide

**Endpoint:** `https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.2/gn`

---

## 1. Check Subgraph Status

Verify the subgraph is syncing and get current block:

```bash
curl -s -X POST https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.2/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query Meta { _meta { block { number } deployment hasIndexingErrors } }"
  }' | jq .
```

**Expected Response:**
```json
{
  "data": {
    "_meta": {
      "block": {
        "number": 185333014
      },
      "deployment": "QmRJmTuguSFztcqKs38ZstqAi4nZTqJX2XWpgHh7NPxuh1",
      "hasIndexingErrors": false
    }
  }
}
```

---

## 2. Query Pools

Get all pools with their tokens and prices:

```bash
curl -s -X POST https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.2/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query Pools { pools(first: 5) { id token0 { symbol } token1 { symbol } sqrtPriceX96 token0Price token1Price liquidity } }"
  }' | jq .
```

**Expected Response:**
```json
{
  "data": {
    "pools": [
      {
        "id": "0x0aeb4016e61987c48f63e9e03df79f0f0b54eb5c",
        "token0": { "symbol": "USDC.n" },
        "token1": { "symbol": "USDC" },
        "sqrtPriceX96": "0",
        "token0Price": "0",
        "token1Price": "0",
        "liquidity": "1000000"
      },
      {
        "id": "0x16722405bb17412b84c1ad9280d41bced322fcab",
        "token0": { "symbol": "WETH" },
        "token1": { "symbol": "WIND" },
        "sqrtPriceX96": "60924799830563037615549183285305",
        "token0Price": "591328.8315002143983422117125349923",
        "token1Price": "0.000001691106448273421333390517491231692",
        "liquidity": "26152908686540345122"
      }
    ]
  }
}
```

**Note:** Pools with `sqrtPriceX96: "0"` haven't had any swaps yet. Prices update when swaps occur.

---

## 3. Query User Data

Get a user's complete profile (positions, veNFTs, voting data):

```bash
curl -s -X POST https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.2/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query UserData { user(id: \"0x3af1789536d88d3dcf2e200ab0ff1b48f8012e41\") { id positions { id tokenId liquidity pool { id token0 { symbol } token1 { symbol } } amount0 amount1 amountUSD staked } veNFTs { id tokenId lockedAmount votingPower } } }"
  }' | jq .
```

**Expected Response:**
```json
{
  "data": {
    "user": {
      "id": "0x3af1789536d88d3dcf2e200ab0ff1b48f8012e41",
      "positions": [
        {
          "id": "18",
          "tokenId": "18",
          "liquidity": "576281977128176",
          "pool": {
            "id": "0x587b82b8ed109d8587a58f9476a8d4268ae945b1",
            "token0": { "symbol": "USDC" },
            "token1": { "symbol": "WSEI" }
          },
          "amount0": "9.999999",
          "amount1": "78.857284003562005357",
          "amountUSD": "19.24578442166408141076390138251116",
          "staked": false
        },
        {
          "id": "21",
          "tokenId": "21",
          "liquidity": "72573622814",
          "pool": {
            "id": "0x3c2567b15fd9133cf9101e043c58e2b444af900b",
            "token0": { "symbol": "USD₮0" },
            "token1": { "symbol": "USDC" }
          },
          "amount0": "191.999999",
          "amount1": "170.398417",
          "amountUSD": "362.3412755885836334261915066411214",
          "staked": false
        }
      ],
      "veNFTs": [
        {
          "id": "2",
          "tokenId": "2",
          "lockedAmount": "1000",
          "votingPower": "0"
        }
      ]
    }
  }
}
```

---

## 4. Query User's Voting Activity

Check which pools a user has voted on:

```bash
curl -s -X POST https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.2/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query UserVotes { veVotes(where: { veNFT_: { owner: \"0x3af1789536d88d3dcf2e200ab0ff1b48f8012e41\" } }) { id pool { id token0 { symbol } token1 { symbol } } weight timestamp veNFT { tokenId } } }"
  }' | jq .
```

**Expected Response:**
```json
{
  "data": {
    "veVotes": [
      {
        "id": "2-0xc7035a2ef7c685fc853475744623a0f164541b69",
        "pool": {
          "id": "0xc7035a2ef7c685fc853475744623a0f164541b69",
          "token0": { "symbol": "WIND" },
          "token1": { "symbol": "WSEI" }
        },
        "weight": "1000000000000000000000",
        "timestamp": "1766463475",
        "veNFT": { "tokenId": "2" }
      }
    ]
  }
}
```

---

## 5. Query Staked Positions

Check if user has staked positions in gauges:

```bash
curl -s -X POST https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.2/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query StakedPositions { gaugeStakedPositions(where: { userId: \"0x3af1789536d88d3dcf2e200ab0ff1b48f8012e41\" }) { id gauge { id pool { id token0 { symbol } token1 { symbol } } } tokenId amount earned } }"
  }' | jq .
```

**Expected Response (no staked positions):**
```json
{
  "data": {
    "gaugeStakedPositions": []
  }
}
```

---

## 6. Query Top Pools by Volume

Get the top 10 pools by trading volume:

```bash
curl -s -X POST https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.2/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query TopPools { pools(first: 10, orderBy: volumeUSD, orderDirection: desc) { id token0 { symbol } token1 { symbol } volumeUSD totalValueLockedUSD feesUSD } }"
  }' | jq .
```

---

## 7. Query Token Prices

Get current prices for all tokens:

```bash
curl -s -X POST https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.2/gn \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query TokenPrices { tokens(first: 10) { id symbol priceUSD } }"
  }' | jq .
```

---

## Understanding the Data

### Position Amounts
- **liquidity**: Raw CL liquidity parameter (L) - not actual token amounts
- **amount0/amount1**: Actual token amounts calculated from liquidity + current price + tick range
- **amountUSD**: USD value of position
- **staked**: Whether position is staked in a gauge

### When Amounts Show 0
Positions show `amount0: "0"`, `amount1: "0"` when:
1. The pool hasn't had any swaps yet (`sqrtPriceX96: "0"`)
2. The position's liquidity is entirely in one token (out of range)

Prices update automatically when swaps occur in the pool.

### veNFT Voting Power
- **lockedAmount**: Amount of WIND tokens locked
- **votingPower**: Calculated voting power (decreases over time as lock approaches expiry)

### Rebase Rewards (Important!)

**Subgraph only tracks CLAIMED rewards, not pending rewards.**

Why? The RewardsDistributor contract calculates pending rewards on-the-fly using internal checkpoint math. There's no event emitted for "pending" rewards - only when a user calls `claim()` does the `Claimed` event fire.

**To check pending rebase rewards:**
```bash
# Check claimable rewards for veNFT #2
curl -s -X POST https://evm-rpc.sei-apis.com \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_call",
    "params": [{
      "to": "0x2ac111A4647708781f797F0a8794b0aEC43ED854",
      "data": "0x4e1273f30000000000000000000000000000000000000000000000000000000000000002"
    }, "latest"],
    "id": 1
  }'
```

**Current subgraph data (claimed only):**
- `veNFT.totalClaimed`: Total WIND claimed historically
- `veNFT.claimableRewards`: 0 (placeholder, not tracked via events)

---

## Sync Status

**Current Block:** Check with meta query (see section 1)

Subgraph syncs from `startBlock: 185240982`. It can take hours to fully sync depending on:
- Number of pools and events to process
- Network activity
- Goldsky indexer performance

---

## Dashboard

View subgraph health and metrics:
https://app.goldsky.com/project_cmjlh2t5mylhg01tm7t545rgk/dashboard/subgraphs/windswap/v3.0.2
