/**
 * `mulberry32-v1`: the seeded PRNG used by the simulator.
 *
 * The exact state update is part of the simulator contract. The state is
 * normalised to an unsigned 32-bit integer after every call so the sequence is
 * identical across engines and does not lose precision after many samples.
 *
 * Version history:
 * - v1: initial state = seed; increment by 0x6d2b79f5 with `>>> 0`; the body
 *   below is the canonical mulberry32 mixer. Changing any operation here
 *   requires a new `simulatorVersion`.
 */
const MULBERRY32_INCREMENT = 0x6d2b79f5;

/** 2^32, the number of values returned by the uint32 generator. */
export const UINT32_SPACE = 2n ** 32n;

/** Boundary between the lower and upper half of the uint32 range. */
export const UINT32_HALF = 0x8000_0000;

/**
 * Creates a deterministic uint32 generator. The caller must validate the seed
 * as an integer in [0, 4294967295]; the mask is defensive only.
 */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return (mixed ^ (mixed >>> 14)) >>> 0;
  };
}
