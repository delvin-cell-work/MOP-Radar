/**
 * RFC 4180 CSV parser: quoted fields, escaped quotes ("") and LF or CRLF line
 * endings. Blank lines are skipped. Throws on malformed quoting rather than
 * guessing, because a mis-split row would silently corrupt prices.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const n = text.length;
  let row: string[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = () => {
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < n) {
    if (text.charCodeAt(i) === 34) {
      let value = "";
      let cursor = i + 1;
      for (;;) {
        const quote = text.indexOf('"', cursor);
        if (quote === -1) throw new Error("Malformed CSV: unterminated quoted field");
        value += text.slice(cursor, quote);
        if (text.charCodeAt(quote + 1) === 34) {
          value += '"';
          cursor = quote + 2;
          continue;
        }
        i = quote + 1;
        break;
      }
      row.push(value);
    } else {
      let end = i;
      while (end < n) {
        const c = text.charCodeAt(end);
        if (c === 44 || c === 10 || c === 13) break;
        end++;
      }
      row.push(text.slice(i, end));
      i = end;
    }

    if (i >= n) {
      endRow();
      break;
    }
    const c = text.charCodeAt(i);
    if (c === 44) {
      i++;
      if (i === n) {
        row.push("");
        endRow();
      }
    } else if (c === 10 || c === 13) {
      i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
      endRow();
    } else {
      throw new Error(`Malformed CSV: unexpected character after quoted field at offset ${i}`);
    }
  }
  return rows;
}
