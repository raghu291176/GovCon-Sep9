export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, Arial, sans-serif' }}>
      <h1>doc-router-next</h1>
      <p>Use the API endpoint: <code>/api/route-document</code></p>
      <p>Health: <code>/api/healthz</code> | <code>/api/readyz</code></p>
    </main>
  );
}
