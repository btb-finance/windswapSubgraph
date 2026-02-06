import { BigInt, BigDecimal } from "@graphprotocol/graph-ts";
import { ZERO_BI, Q96 } from "./helpers";

// Uniswap V3 tick math constants
let MIN_TICK: i32 = -887272;
let MAX_TICK: i32 = 887272;

// Q128 = 2^128
let Q128 = BigInt.fromI32(2).pow(128);

// sqrt(1.0001) in Q96 format approximation constants
// These are the magic numbers from Uniswap V3's TickMath.sol

// getSqrtRatioAtTick: returns the sqrt price as a Q96 BigInt for a given tick
// Implements the Uniswap V3 TickMath.getSqrtRatioAtTick function
// using the binary decomposition method
export function getSqrtRatioAtTick(tick: i32): BigInt {
    let absTick: i32 = tick < 0 ? -tick : tick;

    // Start with ratio = 2^128 (Q128)
    // We'll work in Q128 and convert to Q96 at the end
    let ratio: BigInt;

    // Check each bit of absTick and multiply by the corresponding magic number
    if ((absTick & 0x1) != 0) {
        ratio = BigInt.fromString("340265354078544963557816517032075149313");
    } else {
        ratio = BigInt.fromString("340282366920938463463374607431768211456"); // 2^128
    }

    if ((absTick & 0x2) != 0) ratio = ratio.times(BigInt.fromString("340248342086729790484326174814286782778")).rightShift(128);
    if ((absTick & 0x4) != 0) ratio = ratio.times(BigInt.fromString("340214320654664324051920982716015181260")).rightShift(128);
    if ((absTick & 0x8) != 0) ratio = ratio.times(BigInt.fromString("340146287995602323631171512101879684304")).rightShift(128);
    if ((absTick & 0x10) != 0) ratio = ratio.times(BigInt.fromString("340010263488231146823593991679159461444")).rightShift(128);
    if ((absTick & 0x20) != 0) ratio = ratio.times(BigInt.fromString("339738377640345403697157401104375502016")).rightShift(128);
    if ((absTick & 0x40) != 0) ratio = ratio.times(BigInt.fromString("339195258003219555707034227454543997025")).rightShift(128);
    if ((absTick & 0x80) != 0) ratio = ratio.times(BigInt.fromString("338111622100601834656805679988414885971")).rightShift(128);
    if ((absTick & 0x100) != 0) ratio = ratio.times(BigInt.fromString("335954724994790223023589805789778977700")).rightShift(128);
    if ((absTick & 0x200) != 0) ratio = ratio.times(BigInt.fromString("331682121138379247127172139078559817300")).rightShift(128);
    if ((absTick & 0x400) != 0) ratio = ratio.times(BigInt.fromString("323299236684853023288211250268160618739")).rightShift(128);
    if ((absTick & 0x800) != 0) ratio = ratio.times(BigInt.fromString("307163716377032989948697243942600083929")).rightShift(128);
    if ((absTick & 0x1000) != 0) ratio = ratio.times(BigInt.fromString("277268403626896220162999269216087595045")).rightShift(128);
    if ((absTick & 0x2000) != 0) ratio = ratio.times(BigInt.fromString("225923453940442621947126027127485391333")).rightShift(128);
    if ((absTick & 0x4000) != 0) ratio = ratio.times(BigInt.fromString("149997214084966997727330242082538205943")).rightShift(128);
    if ((absTick & 0x8000) != 0) ratio = ratio.times(BigInt.fromString("66119101136024775622716233608466517926")).rightShift(128);
    if ((absTick & 0x10000) != 0) ratio = ratio.times(BigInt.fromString("12847376061809297530290974190478138313")).rightShift(128);
    if ((absTick & 0x20000) != 0) ratio = ratio.times(BigInt.fromString("485053260817066172746253684029974020")).rightShift(128);
    if ((absTick & 0x40000) != 0) ratio = ratio.times(BigInt.fromString("691415978906521570653435304214168")).rightShift(128);
    if ((absTick & 0x80000) != 0) ratio = ratio.times(BigInt.fromString("1404880482679654955896180642")).rightShift(128);

    // If tick is positive, invert the ratio
    if (tick > 0) {
        // ratio = type(uint256).max / ratio
        let maxUint256 = BigInt.fromString("115792089237316195423570985008687907853269984665640564039457584007913129639935");
        ratio = maxUint256.div(ratio);
    }

    // Convert from Q128 to Q96: right shift by 32
    let sqrtPriceX96 = ratio.rightShift(32);

    return sqrtPriceX96;
}

// Calculate amount of token0 for a given liquidity and price range
// amount0 = liquidity * (sqrtRatioB - sqrtRatioA) / (sqrtRatioA * sqrtRatioB)
// Working in Q96 fixed-point arithmetic
export function getAmount0ForLiquidity(
    sqrtRatioA: BigInt,
    sqrtRatioB: BigInt,
    liquidity: BigInt
): BigInt {
    // Ensure sqrtRatioA <= sqrtRatioB
    let lower = sqrtRatioA;
    let upper = sqrtRatioB;
    if (sqrtRatioA.gt(sqrtRatioB)) {
        lower = sqrtRatioB;
        upper = sqrtRatioA;
    }

    if (lower.le(ZERO_BI) || upper.le(ZERO_BI)) {
        return ZERO_BI;
    }

    // amount0 = liquidity * Q96 * (upper - lower) / upper / lower
    let numerator = liquidity.times(Q96).times(upper.minus(lower));
    let denominator = upper.times(lower);

    if (denominator.le(ZERO_BI)) {
        return ZERO_BI;
    }

    return numerator.div(denominator);
}

// Calculate amount of token1 for a given liquidity and price range
// amount1 = liquidity * (sqrtRatioB - sqrtRatioA) / Q96
export function getAmount1ForLiquidity(
    sqrtRatioA: BigInt,
    sqrtRatioB: BigInt,
    liquidity: BigInt
): BigInt {
    // Ensure sqrtRatioA <= sqrtRatioB
    let lower = sqrtRatioA;
    let upper = sqrtRatioB;
    if (sqrtRatioA.gt(sqrtRatioB)) {
        lower = sqrtRatioB;
        upper = sqrtRatioA;
    }

    // amount1 = liquidity * (upper - lower) / Q96
    return liquidity.times(upper.minus(lower)).div(Q96);
}

// Calculate both token amounts for a position given the current pool price
// This is the core function that determines how much of each token a position holds
export function getAmountsForLiquidity(
    sqrtPriceX96: BigInt,
    sqrtRatioA: BigInt,
    sqrtRatioB: BigInt,
    liquidity: BigInt
): BigInt[] {
    // Ensure A <= B
    let lower = sqrtRatioA;
    let upper = sqrtRatioB;
    if (sqrtRatioA.gt(sqrtRatioB)) {
        lower = sqrtRatioB;
        upper = sqrtRatioA;
    }

    let amount0 = ZERO_BI;
    let amount1 = ZERO_BI;

    if (sqrtPriceX96.le(lower)) {
        // Current price is below the range - position is entirely token0
        amount0 = getAmount0ForLiquidity(lower, upper, liquidity);
    } else if (sqrtPriceX96.lt(upper)) {
        // Current price is within the range - position has both tokens
        amount0 = getAmount0ForLiquidity(sqrtPriceX96, upper, liquidity);
        amount1 = getAmount1ForLiquidity(lower, sqrtPriceX96, liquidity);
    } else {
        // Current price is above the range - position is entirely token1
        amount1 = getAmount1ForLiquidity(lower, upper, liquidity);
    }

    return [amount0, amount1];
}
