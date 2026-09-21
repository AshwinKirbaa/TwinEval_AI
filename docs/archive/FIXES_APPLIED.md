# TwinEval AI - Evaluation Fixes Applied

## Question-paper parsing
- Supports compound question markers such as `19.a)` and `19.b)`.
- Detects `Answer any N questions` when the instruction is on the same line as the section header.
- Detects section marks written as `10 marks each` / `10 marks per question`.
- Removes trailing Course Outcome / Bloom / Staff I/C / PAC / HOD / IQAC mapping tables from the final question.
- Removes footer content before extracting the question's marks value.

## Total-mark calculation
- Preserves `group_id` and `group_required` when saving questions.
- Choice groups count only the required number of best attempted answers.
- `(OR)` alternatives are treated as a 1-of-2 choice group.
- The database migration is in `docs/legacy/mysql/migration_add_group_columns.sql`.

## Answer evaluation
- Objective-question detection is aligned at 1 mark between answer-key generation and evaluation.
- Objective matching no longer uses unsafe substring matching.
- Clearly off-topic answers receive zero instead of arbitrary token marks.
- Teacher override display recalculates percentage and grade from the final overridden score.

## Student answer splitting
- Supports `19.a)` / `19.b)` alternatives as separate answer slots.
- Prevents the repeated printed question number from merging two OR answers into one answer.

## UI
- Removed hard-coded teacher dashboard students, scores, counts, and charts.
- Teacher dashboard/class analytics now load the authenticated teacher's real papers and submissions.
- Removed fabricated processing-page timings, OCR confidence, and concept counts; the page now displays real job progress when a job id is supplied.

## Validation performed
- Python compilation checks passed for the modified AI modules.
- Node syntax checks passed for the modified JavaScript/backend files.
- Parser test passed for section choice groups, OR alternatives, footer stripping, and answer splitting.
