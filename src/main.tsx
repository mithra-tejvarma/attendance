import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./glass.css";
import "./student.css";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="fatal">
        <h1>Something didn’t load correctly.</h1>
        <p>Please reload to reconnect your workspace.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload app
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
