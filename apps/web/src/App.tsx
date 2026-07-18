import { ChatPanel } from "./components/ChatPanel.js";

export function App() {
  return (
    <main className="page">
      <header className="page-header">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true"></span>
          Matheus&apos;s Portfolio Assistant
        </span>
        <p className="tagline">
          Ask about experience, skills, and projects — answers are grounded in a
          real knowledge base, not guesses.
        </p>
      </header>
      <ChatPanel />
    </main>
  );
}

export default App;
