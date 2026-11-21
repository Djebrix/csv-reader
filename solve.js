// Fast Broken-CSV Reader — a faster drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly csv-reader 1.0.0's answer {columns, rows, errors}
// for an input {text, header}: BOM dropped, LF/CRLF record ends, stray CRs
// dropped with a stray_cr error, quoted fields with doubled quotes and CR/LF
// folded to LF, junk after a closing quote appended with a quote_junk error,
// an unterminated quote re-read as a literal with an unterminated_quote error,
// short rows padded (short_row) and long rows cut (long_row) to the first
// record's width, every error {code, line, row} in the order met.
//
// Speed comes from never building a field a character at a time:
//  - a record with no quote and no stray CR is split natively in one call;
//  - every other unquoted field is found by one tight charCodeAt scan to its
//    terminator and taken as a single slice, stray CRs flagged during the scan;
//  - a quoted field is found by indexOf jumps to its closing quote and taken
//    as a single slice, transformed only when it actually holds a doubled
//    quote, a CR, or a line break. Nothing is allocated per field beyond the
//    field string itself.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = (header && columns === null) ? null : rows.length;

    // Fast path: a record with no quote and no stray CR is one native split.
    // A quote anywhere up to the next LF means the record needs the slow path
    // (a quoted field may span lines); a lone CR anywhere in the segment does
    // the same, except a single trailing CR, which is the CRLF record end.
    const lf = text.indexOf('\n', pos);
    const qi = text.indexOf('"', pos);
    if (qi === -1 || (lf !== -1 && qi > lf)) {
      const lineEnd = lf === -1 ? n : lf;
      const seg = text.slice(pos, lineEnd);
      const ri = seg.indexOf('\r');
      if (ri === -1 || (lf !== -1 && ri === seg.length - 1 && seg.indexOf('\r') === ri)) {
        const fields = ri === -1 ? seg.split(',') : seg.slice(0, -1).split(',');
        pos = lf === -1 ? n : lf + 1;
        if (lf !== -1) line++;
        if (fields.length === 1 && fields[0] === '') continue;
        if (width < 0) width = fields.length;
        if (header && columns === null) { columns = fields; continue; }
        if (fields.length < width) {
          errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
          while (fields.length < width) fields.push('');
        } else if (fields.length > width) {
          errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
        }
        rows.push(fields);
        continue;
      }
    }

    const fields = [];
    let ended = 0; // 0 comma, 1 line break, 2 end of text
    let quoted = false;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        const open = pos, openLine = line;
        let q = pos + 1, close = -1;
        for (;;) {
          q = text.indexOf('"', q);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) { q += 2; continue; }
          close = q; break;
        }
        if (close === -1) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1; line = openLine;
          let p = pos, sawCR = false;
          while (p < n) {
            const c = text.charCodeAt(p);
            if (c === 44 || c === 10) break;
            if (c === 13) { if (text.charCodeAt(p + 1) === 10) break; sawCR = true; }
            p++;
          }
          let v = '"' + text.slice(pos, p);
          if (sawCR) {
            const parts = v.split('\r');
            for (let i = 1; i < parts.length; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            v = parts.join('');
          }
          fields.push(v);
          if (p >= n) { pos = n; ended = 2; }
          else if (text.charCodeAt(p) === 44) { pos = p + 1; ended = 0; }
          else { pos = p + (text.charCodeAt(p) === 13 ? 2 : 1); line++; ended = 1; }
          continue;
        }
        let value = text.slice(open + 1, close);
        if (value.indexOf('"') === -1 && value.indexOf('\r') === -1) {
          // No doubled quote, no CR: the slice stands as-is; count its LFs.
          const ni = value.indexOf('\n');
          if (ni !== -1) {
            let lb = 0;
            for (let i = ni; i < value.length; i++) if (value.charCodeAt(i) === 10) lb++;
            line += lb;
          }
        } else {
          // Doubled quotes become one quote; CRLF and lone CR become LF.
          let lb = 0;
          for (let i = 0; i < value.length; i++) {
            const c = value.charCodeAt(i);
            if (c === 10) lb++;
            else if (c === 13) { lb++; if (value.charCodeAt(i + 1) === 10) i++; }
          }
          line += lb;
          value = value.replaceAll('""', '"').replace(/\r\n?/g, '\n');
        }
        pos = close + 1;
        if (pos >= n) { fields.push(value); ended = 2; break; }
        const c = text.charCodeAt(pos);
        if (c === 44) { fields.push(value); pos++; ended = 0; continue; }
        if (c === 10) { fields.push(value); pos++; line++; ended = 1; continue; }
        if (c === 13 && text.charCodeAt(pos + 1) === 10) { fields.push(value); pos += 2; line++; ended = 1; continue; }
        // What follows the closing quote is appended as it stands, up to the
        // next comma or line break.
        let p = pos, sawCR = false;
        while (p < n) {
          const cc = text.charCodeAt(p);
          if (cc === 44 || cc === 10) break;
          if (cc === 13) { if (text.charCodeAt(p + 1) === 10) break; sawCR = true; }
          p++;
        }
        let v = value + text.slice(pos, p);
        if (sawCR) {
          const parts = v.split('\r');
          for (let i = 1; i < parts.length; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          v = parts.join('');
        }
        if (v.length > value.length) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(v);
        if (p >= n) { pos = n; ended = 2; }
        else if (text.charCodeAt(p) === 44) { pos = p + 1; ended = 0; }
        else { pos = p + (text.charCodeAt(p) === 13 ? 2 : 1); line++; ended = 1; }
      } else {
        quoted = false;
        // Unquoted field: one scan to its terminator, one slice. A CR not
        // followed by LF is a stray CR: dropped, and the field goes on.
        let p = pos, sawCR = false;
        while (p < n) {
          const c = text.charCodeAt(p);
          if (c === 44 || c === 10) break;
          if (c === 13) { if (text.charCodeAt(p + 1) === 10) break; sawCR = true; }
          p++;
        }
        let v = text.slice(pos, p);
        if (sawCR) {
          const parts = v.split('\r');
          for (let i = 1; i < parts.length; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          v = parts.join('');
        }
        fields.push(v);
        if (p >= n) { pos = n; ended = 2; }
        else if (text.charCodeAt(p) === 44) { pos = p + 1; ended = 0; }
        else { pos = p + (text.charCodeAt(p) === 13 ? 2 : 1); line++; ended = 1; }
      }
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
