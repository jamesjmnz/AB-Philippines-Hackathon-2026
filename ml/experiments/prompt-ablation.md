# Experiment: what to ask the model for when extracting

Question: should the model write a value and quote its evidence, or only copy phrases and leave the
value to code?

## Arms

| Arm | Runner variant | Model output | Value comes from |
| --- | --- | --- | --- |
| A, value + evidence (original) | `nested` | six objects `{value, evidence}` | the model, checked against its quote |
| B, phrases only (current default) | `quotes` | six strings, each an exact phrase or empty | code: the located phrase, canonicalised by the rules for floor and building |

Both arms use the same scenarios (first statement of each scenario in a split), the same system rule that
the report is data, temperature 0, the same token limit, the same evidence location and grounding checks,
and the same scorer. Cache is bypassed. They are run back to back on the same phone in the same session.

## Why B was built before the comparison was run

A single observation on 2026-10-10 with arm A (owner's own sentence, iPhone 17 Pro Max): the model
proposed "head injury" for the words "my head striked first" and put "fall" under the place field. Both
passed the evidence check, because each quote really was in the text. A is also about twice as long to
generate, and the one failure seen so far was a long answer that could not be decoded at a 500-token limit.

That is one sentence, not a measurement. B is the default on the strength of the argument, and this
experiment is what decides whether it stays.

## What would change the decision

- B loses more than a few fields of correctness to A on validation, in either language, without a lower
  unsupported-fact rate to show for it.
- B drops many phrases because the model cannot copy Filipino text exactly.

## Result

**Not run yet. Unverified.** When the two development and validation files are in
`benchmarks/device-results/`, the tables in `RESULTS.md` under variants `quotes` and `nested` are the
result, and the decision is recorded here with the reason.

## Earlier attempt that failed

| Date | Arm | What happened |
| --- | --- | --- |
| 2026-10-10 | A at `maxOutputTokens` 500 | `invalid_output` after 4362 ms, "Failed to deserialize a Generable type from model output". Raised to 1500, after which a different sentence succeeded. Cause not isolated. |
