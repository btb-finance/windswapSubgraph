# WindSwap DEX

**Next-Generation Concentrated Liquidity DEX on Sei Network**

![WindSwap](https://img.shields.io/badge/WindSwap-v3.0.4-blue)
![Network](https://img.shields.io/badge/Network-Sei-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 🎯 Our Mission

### Revolutionize DeFi Trading Through Concentrated Liquidity

```mermaid
flowchart LR
    A[Traditional DEX<br/>Capital Inefficient] --> B[WindSwap CL<br/>Capital Efficient]
    B --> C[Lower Slippage]
    B --> D[Better Yields]
    B --> E[Sustainable LP]
    C --> F[Superior Trading]
    D --> F
    E --> F
    
    style A fill:#ff6b6b
    style B fill:#4ecdc4
    style F fill:#95e1d3
```

**WindSwap is building the most capital-efficient decentralized exchange on Sei Network, combining:**
- **Concentrated Liquidity (CL)**: Provide liquidity in specific price ranges for up to 4000x capital efficiency
- **Ve(3,3) Tokenomics**: Lock WIND tokens to earn governance rights, fees, and emissions
- **Sustainable Yield**: Long-term focused incentives that align LPs, traders, and protocols

---

## 🏗️ Architecture Overview

```mermaid
flowchart TB
    subgraph Users
        U1[Traders]
        U2[Liquidity Providers]
        U3[WIND Stakers]
    end
    
    subgraph WindSwap Core
        CL[CL Pools<br/>Concentrated Liquidity]
        PM[Position Manager<br/>NFT Positions]
        VE[Voting Escrow<br/>veWIND]
    end
    
    subgraph Incentives
        GF[Gauges<br/>Reward Distribution]
        V[Voter<br/>Gauge Voting]
        RD[Rewards Distributor<br/>Rebase Claims]
    end
    
    subgraph Governance
        GOV[Protocol Governor<br/>DAO Proposals]
        MIN[Minter<br/>Emissions]
    end
    
    U1 -->|Swap| CL
    U2 -->|Add/Remove Liquidity| PM
    U3 -->|Lock WIND| VE
    
    PM -->|Staked Positions| GF
    VE -->|Vote| V
    V -->|Allocate Emissions| GF
    MIN -->|Weekly WIND| GF
    
    GF -->|Trading Fees| U3
    RD -->|Rebase Rewards| U3
    
    U3 -->|Proposals| GOV
    U3 -->|Votes| GOV
    
    style CL fill:#4ecdc4
    style VE fill:#95e1d3
    style GF fill:#f7d794
```

---

## 📊 Data Flow: From Chain to Frontend

```mermaid
sequenceDiagram
    participant C as Smart Contracts
    participant S as Subgraph Indexer
    participant G as GoldSky
    participant F as Frontend
    participant U as User
    
    U->>F: Connect Wallet
    F->>G: Query User Dashboard<br/>1 GraphQL Query
    G->>S: Fetch Indexed Data
    S->>C: Real-time Events
    
    Note over G: Replaces 300+ RPC Calls<br/>with 1 Query!
    
    G-->>F: User Portfolio +<br/>All DEX Data
    F-->>U: Complete Dashboard
```

---

## 🗂️ Subgraph Architecture

```mermaid
mindmap
  root((WindSwap<br/>Subgraph))
    Protocol
      Total Volume
      Total TVL
      Epoch Data
    Pools
      CL Pools
      Token Prices
      TVL Tracking
      Volume Data
    Users
      Positions
      veNFTs
      Voting
      Swap History
    Analytics
      Token Day Data
      Pool Day/Hour Data
      Price Charts
      APR Calculations
    Governance
      Proposals
      Votes
      Gauge Weights
```

---

## 🚀 Key Features

### 1. Concentrated Liquidity

```mermaid
graph LR
    subgraph Traditional
        A1[Capital Spread<br/>Across Full Range]
        A2[Low Fee<br/>Efficiency]
    end
    
    subgraph WindSwap CL
        B1[Capital Concentrated<br/>In Active Range]
        B2[4000x More<br/>Efficient]
    end
    
    style B1 fill:#4ecdc4
    style B2 fill:#4ecdc4
```

### 2. Ve(3,3) Tokenomics

```mermaid
flowchart LR
    WIND[WIND Token] --> Lock[Lock for 4 Years]
    Lock --> veNFT[veNFT]
    veNFT --> Vote[Vote on Gauges]
    Vote --> Rewards[Earn<br/>Fees + Emissions]
    Rewards --> Compound[Compound Returns]
    
    style veNFT fill:#95e1d3
    style Rewards fill:#f7d794
```

### 3. Sustainable Yield

```mermaid
pie
    title Emission Distribution
    "Trading Fees" : 40
    "Gauge Emissions" : 35
    "veWIND Rebases" : 15
    "Protocol Treasury" : 10
```

---

## 📈 Subgraph v3.0.4 Entities

| Category | Entities | Purpose |
|----------|----------|---------|
| **Core** | `Protocol`, `Pool`, `Token` | DEX statistics and prices |
| **Trading** | `Swap`, `Mint`, `Burn`, `Transaction` | All trading activity |
| **Liquidity** | `Position`, `LiquidityPosition`, `Collect` | LP tracking and fees |
| **Ve(3,3)** | `VeNFT`, `VeVote`, `Gauge`, `GaugeStakedPosition` | Voting and rewards |
| **Analytics** | `TokenDayData`, `PoolDayData`, `PoolHourData`, `Bundle` | Historical data |
| **Governance** | `Proposal`, `ProposalVote` | DAO governance |

---

## 🔗 Live Endpoints

### GoldSky Subgraph (Production)
```
https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.4/gn
```

### Dashboard
https://app.goldsky.com/project_cmjlh2t5mylhg01tm7t545rgk/dashboard/subgraphs/windswap/v3.0.4

---

## 💡 Query Examples

### User Dashboard (One Query = All Data)
```graphql
query UserDashboard($userId: ID!) {
  user(id: $userId) {
    positions {
      pool { token0 { symbol } token1 { symbol } }
      liquidity
      amount0
      amount1
    }
    veNFTs {
      tokenId
      lockedAmount
      votingPower
      votes { pool { id } weight }
    }
    liquidityPositions {
      pool { id }
      liquidityTokenBalance
    }
    usdSwapped
  }
}
```

### Pool Analytics
```graphql
query PoolAnalytics {
  pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
    token0 { symbol priceUSD }
    token1 { symbol priceUSD }
    token0Price
    token1Price
    volumeUSD
    totalValueLockedUSD
    feesUSD
    poolDayData(first: 7, orderBy: date, orderDirection: desc) {
      date
      volumeUSD
      feesUSD
    }
  }
}
```

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Generate TypeScript types
npm run codegen

# Build subgraph
npm run build

# Deploy to GoldSky
goldsky subgraph deploy windswap/v3.0.4 --path .
```

---

## 📋 Contracts Indexed

| Contract | Address | Events |
|----------|---------|--------|
| CL Factory | `0xA0E081764Ed601074C1B370eb117413145F5e8Cc` | PoolCreated |
| NonfungiblePositionManager | `0x0e98B82C5FAec199DfAFe2b151d51d40522e7f35` | IncreaseLiquidity, DecreaseLiquidity, Transfer, Collect |
| VotingEscrow | `0x9312A9702c3F0105246e12874c4A0EdC6aD07593` | Deposit, Withdraw, Transfer, LockPermanent |
| Voter | `0x4B7e64A935aEAc6f1837a57bdA329c797Fa2aD22` | Voted, Abstained |
| GaugeFactory | `0x5137eF6b4FB51E482aafDFE4B82E2618f6DE499a` | GaugeCreated |
| CLGaugeFactory | `0xbb24DA8eDAD6324a6f58485702588eFF08b3Cd64` | GaugeCreated |
| RewardsDistributor | `0x2ac111A4647708781f797F0a8794b0aEC43ED854` | Claimed |
| Minter | `0xD56369432BBb4F40143f8C930D96c83c10c68aEE` | Mint |
| ProtocolGovernor | `0x70123139AAe07Ce9d7734E92Cd1D658d6d9Ce3d2` | ProposalCreated, VoteCast |

---

## 📊 Performance Metrics

```mermaid
bar
    title Subgraph Efficiency Gains
    "RPC Calls Before" : 300
    "GraphQL Queries After" : 1
    "Speed Improvement" : 50
```

**Before Subgraph:** 300+ RPC calls to load user dashboard
**After Subgraph:** 1 GraphQL query for complete data

---

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines and submit PRs.

---

## 📜 License

MIT License - see LICENSE file for details

---

## 🔗 Links

- **Website**: https://windswap.org
- **Docs**: https://windswap.org/doc
- **Twitter**: https://x.com/WindSwap
- **Subgraph**: https://api.goldsky.com/api/public/project_cmjlh2t5mylhg01tm7t545rgk/subgraphs/windswap/v3.0.4/gn

---

**Built with ❤️ on Sei Network**
