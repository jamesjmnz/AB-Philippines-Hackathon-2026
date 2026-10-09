# Device runs

One entry per file in this directory, added when the file is saved here. A run that is not listed here
is not reported in `RESULTS.md`.

| file | date | device, OS | build | JS commit | network | phone language | operator notes |
| --- | --- | --- | --- | --- | --- | --- | --- |

No device run has been saved yet.

## Observations made on the phone outside the evaluation runner

These are single observations reported by the owner from the diagnostics screen. They are not scored
results and are listed so they are not mistaken for one.

| date | what was run | what the phone showed |
| --- | --- | --- |
| 2026-10-10 | Output-shape probe, one built-in sentence, Wi-Fi on | All six shapes returned: plain text 901 ms; JSON asked in prompt 893 ms (fenced in a code block); schema with 2 strings 396 ms; 12 flat strings 1403 ms; 6 nested objects 1401 ms; array of objects 908 ms |
| 2026-10-10 | Typed-text extraction, earlier nested prompt, 500-token limit | `invalid_output` after 4362 ms: "Failed to deserialize a Generable type from model output" |
| 2026-10-10 | Typed-text extraction, earlier nested prompt, 1500-token limit | Proposal in 1476 ms; a paraphrased value and a misassigned field were shown |
| 2026-10-10 | Typed-text extraction, earlier nested prompt, Airplane Mode on | Proposal in 1383 ms for "Fall in our house"; one field with no support in the text was dropped by the evidence check |
