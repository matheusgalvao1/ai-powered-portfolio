import { useEffect } from "react";
import { ChatPanel } from "./components/ChatPanel.js";
import { AdminDashboard } from "./components/AdminDashboard.js";

export function App() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const updateHeight = () => {
      const height = viewport
        ? viewport.height + viewport.offsetTop
        : window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${height}px`);
    };

    updateHeight();
    viewport?.addEventListener("resize", updateHeight);
    viewport?.addEventListener("scroll", updateHeight);
    window.addEventListener("resize", updateHeight);

    return () => {
      viewport?.removeEventListener("resize", updateHeight);
      viewport?.removeEventListener("scroll", updateHeight);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  if (window.location.pathname.replace(/\/$/, "") === "/admin") {
    return <AdminDashboard />;
  }

  return (
    <main className="app">
      <ChatPanel />
    </main>
  );
}

export default App;
