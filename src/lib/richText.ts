export type Span = { text: string; bold: boolean }

/** Splits text into paragraphs of plain and **bold** spans, without any HTML. */
export function parseRichText(text: string): Span[][] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) =>
      paragraph
        .split(/(\*\*[^*\n]+\*\*)/)
        .filter(Boolean)
        .map((part) =>
          /^\*\*[^*\n]+\*\*$/.test(part)
            ? { text: part.slice(2, -2), bold: true }
            : { text: part, bold: false },
        ),
    )
}
