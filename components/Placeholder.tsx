export default function Placeholder({ title, phase, summary }: { title: string; phase: string; summary: string }) {
  return (
    <main className="app-main">
      <div className="placeholder">
        <h2>{title}</h2>
        <p style={{ marginBottom: 16, color: 'var(--gold-light)', letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 11 }}>
          {phase} — Coming next
        </p>
        <p>{summary}</p>
      </div>
    </main>
  );
}
