/**
 * Plain-language explanations of the statistics.
 *
 * Kept out of the component so the wording can be reviewed as prose. These are the terms
 * a newcomer meets on their first visit, and "ao5" means nothing at all until someone
 * explains it — which is a poor reason for a tool to feel like it is not for you.
 */
export const STAT_DEFINITIONS = {
  bestSingle: 'Your fastest single solve ever, penalties included.',

  ao5:
    'Average of 5. Takes your last five solves, throws away the fastest and the slowest, ' +
    'and averages the middle three — so one lucky solve or one disaster cannot define it. ' +
    'This is the number competitions use.',

  ao12: 'Average of 12. The same idea over your last twelve solves: best and worst dropped.',

  ao50: 'Average of 50. The fastest and slowest 5% are dropped before averaging.',

  ao100: 'Average of 100. The fastest and slowest 5% are dropped before averaging.',

  bestAverage:
    'The best you have ever managed over that many solves in a row. It has to be ' +
    'consecutive, so it measures a good run rather than your luckiest solves collected up.',

  mean: 'The plain average of every solve, with nothing dropped. Solves you did not finish are left out.',

  spread:
    'The gap between your fastest and slowest solve. A wide spread means your times are ' +
    'inconsistent rather than limited by speed — usually a sign to focus on avoiding ' +
    'mistakes rather than going faster.',

  deviation:
    'How much a typical solve differs from your average. Lower means steadier. Two cubers ' +
    'with the same average but different deviations need completely different practice.',

  crossDifficulty:
    'How many moves the cross needs at minimum, worked out exactly for each scramble. ' +
    'Comparing your times on easy and hard crosses shows whether you are planning the ' +
    'cross during inspection or improvising once the solve starts.',
} as const;
