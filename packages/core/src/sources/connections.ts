/** Parsing for a partner's own connections CSV export. No remote data is read. */

export interface ParsedContact {
  name: string;
  company: string | null;
  position: string | null;
  profileUrl: string | null;
  connectedOn: string | null;
}

const MAX_CONTACTS = 30_000;
const EXPECTED_COLUMNS = "First Name, Last Name, URL, Company, Position, and Connected On";
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cell(row: string[], index: number | undefined): string | null {
  if (index === undefined) return null;
  const value = row[index]?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function dateIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > 31 ||
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseConnectedDate(value: string | null): string | null {
  if (!value) return null;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) return dateIso(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (match) return dateIso(Number(match[3]), Number(match[1]), Number(match[2]));

  match = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(value);
  if (match) return dateIso(Number(match[3]), MONTHS[match[2]?.toLowerCase() ?? ""] ?? 0, Number(match[1]));

  match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(value);
  if (match) return dateIso(Number(match[3]), MONTHS[match[1]?.toLowerCase() ?? ""] ?? 0, Number(match[2]));
  return null;
}

export function parseConnectionsCsv(text: string): { contacts: ParsedContact[]; skipped: number } {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map((header) => header.trim().toLowerCase());
    return headers.includes("first name") && headers.includes("last name");
  });
  if (headerIndex < 0) {
    throw new Error(`This does not look like an exported connections file. Expected columns include ${EXPECTED_COLUMNS}.`);
  }

  const headers = (rows[headerIndex] ?? []).map((header) => header.trim().toLowerCase());
  const column = (name: string): number | undefined => {
    const index = headers.indexOf(name.toLowerCase());
    return index >= 0 ? index : undefined;
  };
  const firstNameColumn = column("First Name");
  const lastNameColumn = column("Last Name");
  const urlColumn = column("URL");
  const companyColumn = column("Company");
  const positionColumn = column("Position");
  const connectedOnColumn = column("Connected On");
  const contacts: ParsedContact[] = [];
  let skipped = 0;

  for (const row of rows.slice(headerIndex + 1)) {
    if (row.every((value) => value.trim() === "")) continue;
    if (contacts.length >= MAX_CONTACTS) {
      skipped++;
      continue;
    }
    const first = cell(row, firstNameColumn) ?? "";
    const last = cell(row, lastNameColumn) ?? "";
    const name = `${first} ${last}`.trim();
    if (!name) {
      skipped++;
      continue;
    }
    const connectedText = cell(row, connectedOnColumn);
    contacts.push({
      name,
      company: cell(row, companyColumn),
      position: cell(row, positionColumn),
      profileUrl: cell(row, urlColumn),
      connectedOn: parseConnectedDate(connectedText),
    });
  }
  return { contacts, skipped };
}

/**
 * Titles for working for a founder, which is not being one: "Founder's Office", "Founder
 * Associate", "Chief of Staff to the Founder". They are taken out of a title before it is read,
 * so "Co-founder, formerly Chief of Staff to the Founder" still counts and the rest do not.
 */
const FOR_A_FOUNDER = new RegExp(
  [
    String.raw`\b(?:co[\s-]?)?founders?(?:['\u2019]s?)?\s+(?:office|associate|assistant)\b`,
    String.raw`\boffice\s+of\s+the\s+(?:co[\s-]?)?founders?\b`,
    String.raw`\b(?:to|for)\s+the\s+(?:co[\s-]?)?founders?\b`,
  ].join("|"),
  "gi",
);

export function looksLikeFounder(position: string | null | undefined): boolean {
  if (!position) return false;
  // A contact wrongly read as a founder becomes a lead about a person from a partner's own
  // list who started nothing, so the cheap mistakes are ruled out here.
  const own = position.replace(FOR_A_FOUNDER, " ");
  return /\b(?:co[\s-]?founder|founder|founding|stealth)\b/i.test(own) ||
    /\bbuilding\s+something\s+new\b/i.test(own) ||
    /\bworking\s+on\s+something\s+new\b/i.test(own);
}
