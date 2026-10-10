# Model card: SAGIP on-device incident intelligence

Status on 2026-10-10: the pipeline is implemented and unit-tested; real-model accuracy is **unverified**
until device result files are committed under `benchmarks/device-results/` (see `RESULTS.md`).

## What this is

Not a trained model. SAGIP uses the language model Apple ships on the iPhone (Apple Foundation Models),
unchanged, through `@react-native-ai/apple` 0.12.0 and the Vercel AI SDK 6 (`generateText` with
`Output.object`). No weights are trained, fine-tuned, downloaded or bundled by SAGIP, and no request
leaves the phone. This card describes the system built around that model.

| Part | What it does | Where |
| --- | --- | --- |
| Wording rules | Read floor and building in English and Tagalog, detect a first-person move, classify how a statement relates to earlier ones, flag disagreements between people | `src/domain/rules/` |
| Phrase extraction | The model copies exact phrases for six fields; code locates each phrase in the original text and derives the value | `src/ai/callstack/`, `src/ai/evidence.ts`, `src/ai/grounding.ts` |
| Statement assessment | The model says whether a free-text detail is the same as, adds to, or differs from what is known; code turns that into a class using who said what | `src/ai/callstack/`, `src/services/deltaPipeline.ts` |
| Guarded lane | One generation at a time, bounded queue, dedup, cache, typed failure states | `src/ai/runtime/` |

## Intended use

Helping a person who raised an SOS, and the trusted people nearby who received it, see what a short
typed report says, what a later message changes, and where two people disagree. Every model output is a
proposal shown as a proposal. A person confirms, corrects or resolves; the model never does.

## Out of scope, by design

- Diagnosis, severity, triage or any medical instruction. The model writes no text that people read: every
  displayed value is a phrase copied from the person's own statement, and questions and suggested tasks
  use fixed wording. A fixed list of severity and diagnosis words ("critical", "severe", "fracture",
  "broken", "malubha" and a few more) additionally removes a phrase from its field; the statement itself is
  still sent as written. The list is short and literal. It is not a medical classifier: "heart attack" in a
  person's own words passes, and "the elevator is broken" is removed from its field.
- Dispatching or assigning anyone, resolving an incident, or closing a disagreement.
- Any claim that emergency services were contacted.
- Deciding who is right when two people say different things.

## Devices

| Device | Language model | What runs |
| --- | --- | --- |
| iPhone 17 Pro Max | Apple Foundation Models, observed working on 2026-10-10 | Rules, phrase extraction, statement assessment |
| iPhone 14 Pro Max, iPhone 13 | Not available on these models | Rules only: floor, building, movement, delta classes, conflicts. Untested on the physical phones. |

Manual SOS does not depend on any of this on any device. It is stored and queued before any model,
microphone, permission or radio work, and that is covered by tests with the model lane full, hanging and
throwing.

## Inputs and outputs

Input: one typed statement of at most 4000 characters (the model sees the first 1200), English, Filipino
or mixed. For assessment, also the current value of up to three free-text details. The model is never
given names, the incident history, or who wrote what.

Output: for each of six fields either an exact phrase from the statement or nothing; for assessment, one
of `not_mentioned / same / different / adds_detail` per free-text detail and whether the message is about
the request at all.

## Safeguards applied to every output

1. Guided generation constrains the model to the schema; an unexpected key fails the call.
2. Each phrase must be found in the original text. The stored evidence is the original's exact substring.
3. The value must follow from the phrase. A floor must be something the rules read as a floor. A building
   or floor the text negates ("hindi ako sa Building A") is dropped.
4. A phrase containing a word from the fixed severity and diagnosis list is dropped from its field.
   Every content word of a value must come from the phrase it rests on.
5. The report is fenced and declared to be data. This is a weak defence by itself; items 2 to 4 are what
   stop an injected instruction from becoming a value.
6. Rules override the model for floor and building.
7. Before anything is recorded, the incident is replayed again and any field a human has since changed is
   dropped from the result.
8. A disagreement only the model can see becomes a question to the person, in fixed wording, at most three
   per incident and never on a detail the person already skipped. It is never flagged as settled.
9. A different person's differing reading is never stored as the field's proposal, so it cannot replace
   what the first person said on screen. A proposed value is attributed to whoever wrote the words.
10. Only the incident owner's device may record an assessment, and an assessment can add to what the rules
    found for a statement but never remove or soften it.

## Evaluation

48 synthetic scenarios (24 English, 24 Taglish) across extraction, incident deltas, contradictions with
hard negatives, and adversarial reports; 18 development, 12 validation, 18 held-out. Reference answers
were written from the text before any rule or model was scored and are frozen by hash. Method, metrics
and commands are in `README.md`; numbers are in `RESULTS.md` and nowhere else.

## Known limitations

- **Small synthetic test set written by the team.** It measures whether the pipeline does what it was
  designed to do on text like this. It says nothing about real incidents or real distress.
- **Only the first 1200 characters reach the model.** Later text is still stored and sent as written.
- **Rules read only floor and building.** On phones without the model, other details stay unknown and
  most later messages are "not compared".
- **The rules can still read a floor from a sentence that is not about where the person is** when it has
  no clear subject. Sentences with another subject, questions, leaving and instructions are excluded.
- **"What is already known" ignores the order of statements.** A statement is compared with everything
  else on record, so if analysis of an older statement is delayed it can be compared with a newer one.
- **Movement is recognised only in first-person phrasing.** "Alex moved to the second floor", written by
  someone else, yields no floor.
- **A reporter's move can be contradicted only by a later statement.** An older statement from someone
  else that agrees with where the person came from is treated as explained by the move.
- **"Unrelated" exists only where the model runs**, and only for messages that state nothing.
- **A different feeling or description from a second person is treated as additional information,** never
  as a contradiction. Only place details can be in dispute.
- **Speech, other languages, and long conversations are untested.**
- **The provider cannot cancel a generation in progress.** After a timeout the model stays busy until the
  native call ends; the lane accounts for that with a ceiling, and the ceiling's value is a guess.
- **Error wording from the phone is matched by pattern** and depends on the phone's language. Refusal,
  unsupported-language and context-overflow wording have not been observed.
- **Latency, battery and thermal behaviour under sustained use are unmeasured.**
