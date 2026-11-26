"use client";

// A CSV file as a table: the first row is the header, the rest are rows, every cell a text
// node. At most 500 rows are drawn.
import { parseCsv } from "../csv";
import { useText } from "./TextView";
import p from "./preview.module.css";

const ROWS = 500;

export function CsvView({ blob, name }: { blob: Blob; name: string }) {
  const text = useText(blob);
  if (text === null)
    return (
      <p role="status" className={p.note}>
        Opening…
      </p>
    );
  // One row more than is shown: the header.
  const { rows, truncated } = parseCsv(text, ROWS + 1);
  const [head, ...body] = rows;
  const width = Math.max(0, ...rows.map((r) => r.length));
  const pad = (r: string[]) => [
    ...r,
    ...Array<string>(width - r.length).fill(""),
  ];
  return (
    <div className={p.sheetWrap}>
      {truncated && (
        <p role="status" className={p.cut}>
          Showing the first {ROWS} rows.
        </p>
      )}
      <div className={p.tableBox} tabIndex={0} role="region" aria-label={name}>
        <table className={p.table}>
          {head && (
            <thead>
              <tr>
                {pad(head).map((cell, i) => (
                  <th key={i} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {pad(row).map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
