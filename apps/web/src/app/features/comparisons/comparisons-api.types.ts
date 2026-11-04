import type { components, operations } from '@probedesk/api-client';

/**
 * Comparison screen types.
 *
 * Every alias is generated from the OpenAPI document (`RunComparisonDto` and
 * its nested schemas). The screens keep no second, hand-written API model.
 * `comparisons-api.ts` validates the fields it consumes at runtime and never
 * fills a missing run, step, rule, statistic, or sample with a default.
 */

/** GET /api/comparisons response. */
export type ComparisonResult = components['schemas']['RunComparisonDto'];

/** One immutable run snapshot summary. */
export type ComparisonRunSummary = components['schemas']['ComparisonRunSummaryDto'];

/** Plan version identity difference for the pair. */
export type ComparisonVersionDifference =
  components['schemas']['ComparisonVersionDifferenceDto'];

/** One logical step recorded by both runs, matched by logicalStepId. */
export type ComparisonMatchedStep = components['schemas']['ComparisonMatchedStepDto'];

/** One changed rule and both stored values. */
export type ComparisonChangedField = components['schemas']['ComparisonRuleChangeDto'];

/** Rule fields the server compares, in the fixed contract order. */
export type ComparisonRuleField = ComparisonChangedField['field'];

/** Values keep the API representation: decimal strings stay strings. */
export type ComparisonChangeValue = ComparisonChangedField['left'];

/** Side-by-side numeric comparison; null statistics means units differ. */
export type ComparisonNumericComparison =
  components['schemas']['ComparisonNumericComparisonDto'];

/** Same-unit stored summary values and their right-minus-left deltas. */
export type ComparisonStatistics = components['schemas']['ComparisonStatisticsDto'];

/** One decimal statistic pair with its API-provided delta. */
export type ComparisonDecimalValue = ComparisonStatistics['minimum'];

/** One sample-count statistic pair with its API-provided delta. */
export type ComparisonCountValue = ComparisonStatistics['sampleCount'];

/** Query accepted by GET /api/comparisons. */
export type ComparisonQuery =
  operations['ComparisonsController_compare']['parameters']['query'];
