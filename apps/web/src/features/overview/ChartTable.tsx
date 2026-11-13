import type { ReactNode } from "react";
import { Table, TableScroll, Td, Th, Tr } from "../../components/ui/table";

export interface ChartTableColumn<T> {
  key: string;
  label: ReactNode;
  cell: (row: T) => ReactNode;
}

/** The table twin of a chart: the same numbers, readable without colour or hover. */
export function ChartTable<T extends { key: string }>({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: ChartTableColumn<T>[];
  rows: T[];
}) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm font-semibold text-green-2 hover:underline">
        Table
      </summary>
      <TableScroll className="relative mt-2">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <Tr>
              {columns.map((c, i) => (
                <Th key={c.key} numeric={i > 0}>
                  {c.label}
                </Th>
              ))}
            </Tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.key}>
                {columns.map((c, i) => (
                  <Td key={c.key} numeric={i > 0}>
                    {c.cell(row)}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </Table>
      </TableScroll>
    </details>
  );
}
