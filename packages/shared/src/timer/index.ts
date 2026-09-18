export { formatDuration, formatSolve } from './format.js';
export {
  createInitialState,
  displayDurationMs,
  effectiveDurationMs,
  inspectionPenaltyFor,
  inspectionRemainingMs,
  solveDurationMs,
  timerReducer,
} from './timer-machine.js';
export {
  DEFAULT_TIMER_CONFIG,
  INSPECTION_DURATION_MS,
  INSPECTION_PLUS_TWO_LIMIT_MS,
  PLUS_TWO_PENALTY_MS,
  type Penalty,
  type TimerConfig,
  type TimerEvent,
  type TimerPhase,
  type TimerState,
} from './types.js';
