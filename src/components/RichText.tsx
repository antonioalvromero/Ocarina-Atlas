import { parseRichText } from '../lib/richText'

export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {parseRichText(text).map((spans, p) => (
        <p key={p}>
          {spans.map((span, s) =>
            span.bold ? (
              <strong key={s} className="font-semibold text-parchment-50">
                {span.text}
              </strong>
            ) : (
              <span key={s}>{span.text}</span>
            ),
          )}
        </p>
      ))}
    </div>
  )
}
