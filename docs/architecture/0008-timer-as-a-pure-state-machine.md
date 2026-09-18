# ADR-0008: The timer is a pure state machine in the shared package

## Status

Accepted — 2026-09-18

## Context

A speedcubing timer looks trivial and is not. It has six states, strict rules about which
transitions are legal, and a long tail of browser behaviour that has nothing to do with
timing: the spacebar scrolling the page, keys auto-repeating while held, focus lost
mid-hold, the release of the key that stopped the timer immediately starting another
solve.

Written the obvious way — a few `useState` calls and some event handlers — those rules
end up scattered across callbacks. That is how timers acquire their classic bugs: able to
start while already running, or recording a solve that never began.

It is also the feature users judge the product on. A timer that misses a start is worse
than no timer.

## Decision

The timer is a reducer in `packages/shared`: a pure function of `(state, event, config)`.
It has no React, no DOM, and no clock.

Every event carries the current time — `{ type: 'pressDown', at: 14_302 }` — rather than
the reducer calling `performance.now()` itself.

`apps/web` holds a thin hook that translates browser events into machine events and
renders the result. The hook takes its clock as an option, defaulting to
`performance.now`.

Two different mechanisms drive time, deliberately:

- **`setTimeout`** promotes a long-enough hold to `ready`.
- **`requestAnimationFrame`** updates the displayed number and nothing else.

## Consequences

**Made easier.** The rules are in one readable place, and a transition that is not
written down cannot happen. Thirty-odd tests drive entire solves — including inspection
overruns and penalties — in microseconds, with no fake timers and no flakiness, because
there is no clock to fake.

The hook's tests can then focus on what is genuinely browser-specific: auto-repeat,
`preventDefault`, blur, focused buttons.

Reusing the machine on another platform would need only a new adapter.

**Made harder.** Two files instead of one, and events must be constructed with a
timestamp at every call site. That is the cost of the clock being an input rather than a
hidden dependency.

## Notes on the implementation

**`performance.now`, not `Date.now`.** `Date.now` follows the system clock, which can
jump backwards when NTP corrects it or when the user changes timezone. A solve timed
across such a jump would record a negative or wildly wrong duration. `performance.now` is
monotonic.

**Arming is a timeout, not an animation frame.** This was originally driven by the
animation loop, which was wrong: `requestAnimationFrame` is for painting and browsers
throttle it hard — background tabs, battery saver, an unfocused window. Testing in a
throttled tab showed two frames in a second, and the timer could not arm at all. Becoming
ready is a state change that must happen after a fixed duration whether or not anything
is being repainted, so it has its own timer. The display can freeze without consequence;
the measured time comes from timestamps at start and stop, not from frames.

**The release of the stopping key is ignored.** Otherwise stopping a solve immediately
starts the next one, and the timer appears to restart itself.

**A press after a finished solve starts the next one.** Originally the machine sat in
`stopped` until a button was clicked, which meant reaching for the mouse between every
solve while holding a cube in both hands. Unit tests did not catch this, because they
encoded the same wrong assumption; using the app for thirty seconds did.

## Alternatives considered

**State in the component with `useState` and handlers.** Fewer files, and the normal way
this gets written. Rejected because the transition rules end up implicit, and the tests
would have to render a component and simulate real time to check any of them.

**A state machine library such as XState.** Genuinely good at this, with visualisation
and formal guarantees. Rejected as a dependency that would have to be learned before the
thing it models — a switch statement over six states is about forty lines and needs no
introduction. Worth revisiting if the machine grows substantially.

**Keeping the timer in `apps/web`.** Simpler, and wrong in the same way as duplicating
the averaging rules: solve analysis will eventually need to reason about the same states,
and the deterministic core belongs where both sides can use it.
