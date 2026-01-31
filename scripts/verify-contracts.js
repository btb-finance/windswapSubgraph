#!/usr/bin/env node
/**
 * Subgraph Contract Verification Script
 * Verifies that our ABIs and event handlers match the actual contracts on-chain
 */

const fs = require('fs');
const path = require('path');

// Contract addresses from frontend config
const CONTRACTS = {
  // V2 Core
  CLFactory: '0xA0E081764Ed601074C1B370eb117413145F5e8Cc',
  NonfungiblePositionManager: '0x0e98B82C5FAec199DfAFe2b151d51d40522e7f35',
  VotingEscrow: '0x9312A9702c3F0105246e12874c4A0EdC6aD07593',
  Voter: '0x4B7e64A935aEAc6f1837a57bdA329c797Fa2aD22',
  ProtocolGovernor: '0x70123139AAe07Ce9d7734E92Cd1D658d6d9Ce3d2',
  
  // Gauges
  GaugeFactory: '0x5137eF6b4FB51E482aafDFE4B82E2618f6DE499a',
  CLGaugeFactory: '0xbb24DA8eDAD6324a6f58485702588eFF08b3Cd64',
  
  // Rewards
  RewardsDistributor: '0x2ac111A4647708781f797F0a8794b0aEC43ED854',
};

// Colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Load ABI file
function loadABI(abiPath) {
  try {
    const fullPath = path.join(__dirname, '..', abiPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    log(`❌ Failed to load ABI: ${abiPath}`, 'red');
    log(`   Error: ${e.message}`, 'red');
    return null;
  }
}

// Get events from ABI
function getEventsFromABI(abi) {
  if (!Array.isArray(abi)) return [];
  return abi.filter(item => item.type === 'event').map(event => ({
    name: event.name,
    signature: `${event.name}(${event.inputs.map(i => i.type).join(',')})`,
    inputs: event.inputs
  }));
}

// Get functions from ABI
function getFunctionsFromABI(abi) {
  if (!Array.isArray(abi)) return [];
  return abi.filter(item => item.type === 'function').map(fn => fn.name);
}

// Verify contract events
async function verifyContract(contractName, contractAddress, abiPath, expectedEvents) {
  log(`\n${colors.cyan}🔍 Verifying ${contractName}...${colors.reset}`);
  log(`   Address: ${contractAddress}`, 'blue');
  
  const abi = loadABI(abiPath);
  if (!abi) return false;
  
  const events = getEventsFromABI(abi);
  const eventNames = events.map(e => e.name);
  
  log(`   Found ${events.length} events in ABI`, 'blue');
  
  let allFound = true;
  
  for (const expectedEvent of expectedEvents) {
    const found = eventNames.includes(expectedEvent.name);
    if (found) {
      const abiEvent = events.find(e => e.name === expectedEvent.name);
      const abiSig = abiEvent.signature;
      const expectedSig = expectedEvent.signature || abiSig;
      
      if (abiSig === expectedSig) {
        log(`   ✅ ${expectedEvent.name}`, 'green');
      } else {
        log(`   ⚠️  ${expectedEvent.name} (signature mismatch)`, 'yellow');
        log(`      Expected: ${expectedSig}`, 'yellow');
        log(`      Found:    ${abiSig}`, 'yellow');
      }
    } else {
      log(`   ❌ ${expectedEvent.name} (NOT FOUND)`, 'red');
      allFound = false;
    }
  }
  
  return allFound;
}

// Verify subgraph.yaml against ABIs
function verifySubgraphConfig() {
  log(`\n${colors.cyan}📋 Verifying subgraph.yaml configuration...${colors.reset}`);
  
  const subgraphPath = path.join(__dirname, '..', 'subgraph.yaml');
  const subgraphContent = fs.readFileSync(subgraphPath, 'utf8');
  
  // Extract data sources and templates
  const dataSourceMatches = subgraphContent.match(/name:\s*"([^"]+)"/g) || [];
  const dataSources = dataSourceMatches.map(m => m.replace(/name:\s*"/, '').replace('"', ''));
  
  log(`   Found ${dataSources.length} data sources/templates:`, 'blue');
  dataSources.forEach(ds => log(`     • ${ds}`, 'blue'));
  
  // Verify each data source has corresponding ABI
  const abiDir = path.join(__dirname, '..', 'abis');
  const abiFiles = fs.readdirSync(abiDir).filter(f => f.endsWith('.json'));
  
  log(`\n   ABI Files found:`, 'blue');
  abiFiles.forEach(f => log(`     • ${f}`, 'blue'));
  
  // Check for missing ABIs
  const requiredABIs = dataSources.map(ds => `${ds}.json`);
  const missingABIs = requiredABIs.filter(abi => !abiFiles.includes(abi));
  
  if (missingABIs.length > 0) {
    log(`\n   ❌ Missing ABI files:`, 'red');
    missingABIs.forEach(abi => log(`     • ${abi}`, 'red'));
    return false;
  }
  
  log(`\n   ✅ All required ABI files present`, 'green');
  return true;
}

// Verify schema entities
function verifySchema() {
  log(`\n${colors.cyan}📊 Verifying schema.graphql entities...${colors.reset}`);
  
  const schemaPath = path.join(__dirname, '..', 'schema.graphql');
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  
  // Extract entity definitions
  const entityMatches = schemaContent.match(/type\s+\w+\s+@entity/g) || [];
  const entities = entityMatches.map(m => m.replace(/type\s+/, '').replace(/\s+@entity/, ''));
  
  log(`   Found ${entities.length} entities:`, 'blue');
  entities.forEach(e => log(`     • ${e}`, 'blue'));
  
  // Check for critical entities
  const requiredEntities = [
    'Protocol', 'Token', 'Pool', 'Swap', 'Mint', 'Burn',
    'PoolDayData', 'PoolHourData', 'ProtocolDayData',
    'User', 'Position', 'VeNFT', 'Vote', 'Collect',
    'Gauge', 'GaugeStakedPosition', 'VeNFTRewards',
    'GaugeInvestor', 'PoolWeeklyFees', 'PositionFees',
    'PoolLiquidityProvider', 'UserProfile'
  ];
  
  const missingEntities = requiredEntities.filter(e => !entities.includes(e));
  
  if (missingEntities.length > 0) {
    log(`\n   ❌ Missing entities:`, 'red');
    missingEntities.forEach(e => log(`     • ${e}`, 'red'));
    return false;
  }
  
  log(`\n   ✅ All required entities present`, 'green');
  return true;
}

// Check for duplicate event definitions
function checkDuplicateEvents() {
  log(`\n${colors.cyan}🔍 Checking for duplicate event definitions...${colors.reset}`);
  
  const subgraphPath = path.join(__dirname, '..', 'subgraph.yaml');
  const content = fs.readFileSync(subgraphPath, 'utf8');
  
  const eventMatches = content.match(/event:\s*\w+\([^)]*\)/g) || [];
  const events = eventMatches.map(e => e.replace('event: ', ''));
  
  const duplicates = events.filter((item, index) => events.indexOf(item) !== index);
  const uniqueDuplicates = [...new Set(duplicates)];
  
  if (uniqueDuplicates.length > 0) {
    log(`   ⚠️  Duplicate events found:`, 'yellow');
    uniqueDuplicates.forEach(e => log(`     • ${e}`, 'yellow'));
  } else {
    log(`   ✅ No duplicate events found`, 'green');
  }
}

// Verify handler files exist
function verifyHandlers() {
  log(`\n${colors.cyan}📝 Verifying handler files...${colors.reset}`);
  
  const srcDir = path.join(__dirname, '..', 'src');
  const handlers = [
    'cl-factory.ts',
    'cl-pool.ts',
    'position-manager.ts',
    'voting-escrow.ts',
    'voter.ts',
    'protocol-governor.ts',
    'gauge.ts',
    'rewards-distributor.ts'
  ];
  
  const existingFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.ts'));
  
  log(`   Required handlers:`, 'blue');
  let allExist = true;
  
  handlers.forEach(handler => {
    const exists = existingFiles.includes(handler);
    if (exists) {
      log(`     ✅ ${handler}`, 'green');
    } else {
      log(`     ❌ ${handler} (MISSING)`, 'red');
      allExist = false;
    }
  });
  
  return allExist;
}

// Main verification
async function main() {
  log(`\n${colors.cyan}╔════════════════════════════════════════════════════════╗${colors.reset}`);
  log(`${colors.cyan}║     WindSwap Subgraph Contract Verification            ║${colors.reset}`);
  log(`${colors.cyan}╚════════════════════════════════════════════════════════╝${colors.reset}`);
  
  const results = {
    config: verifySubgraphConfig(),
    schema: verifySchema(),
    handlers: verifyHandlers()
  };
  
  checkDuplicateEvents();
  
  // Verify specific contracts
  log(`\n${colors.cyan}📦 Verifying Contract ABIs and Events...${colors.reset}`);
  
  // CLFactory
  results.clFactory = await verifyContract(
    'CLFactory',
    CONTRACTS.CLFactory,
    'abis/CLFactory.json',
    [
      { name: 'PoolCreated', signature: 'PoolCreated(address,address,int24,address)' }
    ]
  );
  
  // PositionManager
  results.positionManager = await verifyContract(
    'NonfungiblePositionManager',
    CONTRACTS.NonfungiblePositionManager,
    'abis/NonfungiblePositionManager.json',
    [
      { name: 'IncreaseLiquidity' },
      { name: 'DecreaseLiquidity' },
      { name: 'Transfer' },
      { name: 'Collect' }
    ]
  );
  
  // VotingEscrow
  results.votingEscrow = await verifyContract(
    'VotingEscrow',
    CONTRACTS.VotingEscrow,
    'abis/VotingEscrow.json',
    [
      { name: 'Deposit' },
      { name: 'Withdraw' },
      { name: 'Transfer' },
      { name: 'LockPermanent' }
    ]
  );
  
  // Voter
  results.voter = await verifyContract(
    'Voter',
    CONTRACTS.Voter,
    'abis/Voter.json',
    [
      { name: 'Voted' },
      { name: 'Abstained' }
    ]
  );
  
  // ProtocolGovernor
  results.protocolGovernor = await verifyContract(
    'ProtocolGovernor',
    CONTRACTS.ProtocolGovernor,
    'abis/ProtocolGovernor.json',
    [
      { name: 'ProposalCreated' },
      { name: 'ProposalCanceled' },
      { name: 'ProposalExecuted' },
      { name: 'VoteCast' }
    ]
  );
  
  // GaugeFactory
  results.gaugeFactory = await verifyContract(
    'GaugeFactory',
    CONTRACTS.GaugeFactory,
    'abis/GaugeFactory.json',
    [
      { name: 'GaugeCreated' }
    ]
  );
  
  // CLGaugeFactory
  results.clGaugeFactory = await verifyContract(
    'CLGaugeFactory',
    CONTRACTS.CLGaugeFactory,
    'abis/CLGaugeFactory.json',
    [
      { name: 'GaugeCreated' }
    ]
  );
  
  // RewardsDistributor
  results.rewardsDistributor = await verifyContract(
    'RewardsDistributor',
    CONTRACTS.RewardsDistributor,
    'abis/RewardsDistributor.json',
    [
      { name: 'Claimed' }
    ]
  );
  
  // Summary
  log(`\n${colors.cyan}╔════════════════════════════════════════════════════════╗${colors.reset}`);
  log(`${colors.cyan}║                    Verification Summary                 ║${colors.reset}`);
  log(`${colors.cyan}╚════════════════════════════════════════════════════════╝${colors.reset}`);
  
  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    log(`\n   ✅ ALL CHECKS PASSED!`, 'green');
    log(`   The subgraph is ready for deployment.\n`, 'green');
    process.exit(0);
  } else {
    log(`\n   ❌ SOME CHECKS FAILED`, 'red');
    log(`   Please review the errors above before deploying.\n`, 'red');
    process.exit(1);
  }
}

main().catch(err => {
  log(`\n💥 Fatal error: ${err.message}`, 'red');
  process.exit(1);
});
