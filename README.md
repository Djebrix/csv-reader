# Fast Broken-CSV Reader

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Djebrix/csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Djebrix/csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's csv-reader 1.0.0, entered in [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121).

## What it does

`solve.js` exports `run(input)`, returning exactly csv-reader 1.0.0's answer
`{columns, rows, errors}` for every input `{text, header}`: BOM dropped, LF/CRLF
record ends, stray CRs dropped with a `stray_cr` error, quoted fields with doubled
quotes and CR/LF folded to LF, junk after a closing quote appended with a
`quote_junk` error, an unterminated quote re-read as a literal with an
`unterminated_quote` error, short rows padded (`short_row`) and long rows cut
(`long_row`) to the first record's width — every error `{code, line, row}` in
the order met.

## Why it is faster

The reference builds every field one character at a time. This reader never does:

- A record with no quote and no stray CR is split natively in one `split(',')` call.
- Every other unquoted field is found by one tight `charCodeAt` scan to its
  terminator and taken as a single `slice`, with stray CRs flagged during the scan.
- A quoted field is found by `indexOf` jumps to its closing quote and taken as a
  single slice, transformed only when it actually holds a doubled quote, a CR,
  or a line break.

Nothing is allocated per field beyond the field string itself. On the practice
set it answers all 6 cases identically to csv-reader 1.0.0 at roughly 4.8× the
speed of the house baseline (median ~88 ms vs ~442 ms for the parse alone,
same machine, interleaved runs).

## Layout

- `solve.js` — the reader (dependency-free ES module).
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each case
  with `run`, writes `/output/answers.json`.
