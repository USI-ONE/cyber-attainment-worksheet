'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Client-side markdown renderer. Sits inside a server page that has
 * already fetched the body text. GFM enabled so tables, task lists,
 * and strikethrough work — every SOP and policy doc relies on tables.
 *
 * Styling is local CSS-in-JS on a wrapping div so we don't bleed
 * into the rest of the app; the SOPs are typography-heavy and need
 * comfortable reading width + line height.
 */
export default function MarkdownView({ source }: { source: string }) {
  return (
    <div className="md-view">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>

      <style jsx>{`
        .md-view {
          font-family: 'Inter', system-ui, sans-serif;
          font-size: 14.5px;
          line-height: 1.65;
          color: var(--text);
          max-width: 880px;
        }
        .md-view :global(h1) {
          font-size: 26px;
          font-weight: 700;
          margin: 0 0 8px 0;
          line-height: 1.25;
        }
        .md-view :global(h2) {
          font-size: 19px;
          font-weight: 700;
          margin: 26px 0 8px 0;
          padding-top: 14px;
          border-top: 1px solid var(--bg-border);
        }
        .md-view :global(h3) {
          font-size: 15px;
          font-weight: 700;
          margin: 18px 0 6px 0;
          color: var(--text);
        }
        .md-view :global(p) { margin: 0 0 12px 0; }
        .md-view :global(ul),
        .md-view :global(ol) { margin: 0 0 12px 0; padding-left: 22px; }
        .md-view :global(li) { margin-bottom: 4px; }
        .md-view :global(li > ul),
        .md-view :global(li > ol) { margin-top: 4px; margin-bottom: 4px; }
        .md-view :global(strong) { font-weight: 600; color: var(--text); }
        .md-view :global(em) { font-style: italic; color: var(--text-mid); }
        .md-view :global(code) {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          font-size: 12.5px;
          background: var(--bg-card);
          border: 1px solid var(--bg-border);
          padding: 1px 5px;
          border-radius: 3px;
        }
        .md-view :global(pre) {
          background: var(--bg-card);
          border: 1px solid var(--bg-border);
          border-radius: 4px;
          padding: 10px 12px;
          overflow-x: auto;
          margin: 12px 0;
        }
        .md-view :global(pre code) {
          background: none;
          border: none;
          padding: 0;
        }
        .md-view :global(blockquote) {
          border-left: 3px solid var(--bg-border);
          padding-left: 12px;
          color: var(--text-mid);
          margin: 12px 0;
        }
        .md-view :global(table) {
          border-collapse: collapse;
          margin: 14px 0;
          font-size: 12.5px;
          width: 100%;
        }
        .md-view :global(th),
        .md-view :global(td) {
          border: 1px solid var(--bg-border);
          padding: 6px 10px;
          text-align: left;
          vertical-align: top;
        }
        .md-view :global(th) {
          background: var(--bg-card);
          font-weight: 600;
          font-size: 11.5px;
          letter-spacing: .02em;
          color: var(--text-mid);
          text-transform: uppercase;
        }
        .md-view :global(hr) {
          border: 0;
          border-top: 1px solid var(--bg-border);
          margin: 22px 0;
        }
        .md-view :global(a) {
          color: var(--accent, #2563EB);
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
