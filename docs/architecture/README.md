# Architecture Decision Records

An ADR records a decision that was **hard to make and expensive to reverse**, together
with the reasoning at the time. Its value is not the decision — that is visible in the
code — but the context: what we knew, what we rejected, and what we expected to go wrong.

Six months from now, when the obvious question is "why on earth is it done this way?",
the ADR answers it without anyone having to reconstruct the argument from memory.

## What deserves an ADR

Write one when a decision is structural, contested, or surprising. Choosing a database,
an auth model, or where a domain boundary sits all qualify. Picking a date formatting
helper does not.

## Format

Each record uses the same five headings:

- **Status** — Proposed, Accepted, or Superseded by ADR-NNNN
- **Context** — the situation and constraints that forced a choice
- **Decision** — what we are doing, stated plainly
- **Consequences** — what this makes easy, and what it makes hard
- **Alternatives considered** — what was rejected and why

Records are immutable once accepted. When a decision changes, write a new ADR that
supersedes the old one and update the old one's Status line. Editing history to hide a
reversal destroys the only thing this directory is for.

## Index

| ADR                                                 | Title                                      | Status   |
| --------------------------------------------------- | ------------------------------------------ | -------- |
| [0001](0001-technology-stack.md)                    | Technology stack for the MVP               | Accepted |
| [0002](0002-monorepo-with-shared-source-package.md) | Monorepo with a shared source package      | Accepted |
| [0003](0003-cube-state-representation.md)           | Represent the cube as stickers, not pieces | Accepted |
