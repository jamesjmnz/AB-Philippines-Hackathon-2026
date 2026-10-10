# Experiment: one model call per statement, or two smaller ones

Question: when a new statement arrives, should one generation both copy phrases and compare them with
what is known, or should those be separate calls?

## Arms

| Arm | Runner variant | Calls per statement | What the model does |
| --- | --- | --- | --- |
| Staged (current default) | `staged` | 1, plus 1 only when needed | Call 1 copies phrases. Code compares floor and building itself. Call 2 runs only if a free-text detail is stated and already known, or if nothing was stated and the message might be unrelated. |
| Single | `single` | 1 | One call returns the six phrases, a relation for each of three free-text details, and the topic. |

Same scenarios, same phone, same session, cache bypassed, same validation of the output, same scorer. In
both arms the delta class is computed in code from the relation and from who said what; the model never
names a class.

## What is compared

Delta class accuracy and confusion matrix, conflict precision and recall, field correctness, unsupported-
fact rate, calls per statement, total latency per statement, and failures by state (a longer single answer
is more exposed to the token limit and the context window).

## Expectation, stated before running

Staged should make fewer generations than two per statement on average, because most statements either
state only a floor or building or state a detail nothing is yet known about. Single makes exactly one but
with a longer schema and answer. Which is more accurate is not known.

## Decision rule

Choose on validation, not held-out: the arm with higher delta accuracy in both languages; if they are
within two cases of each other, the one with fewer failed calls; if still level, the lower p90 latency
per statement.

## Result

**Not run yet. Unverified.** Staged is the default only provisionally.
