import { authPageStyles } from "../../lib/auth-page-styles";

export function PreviewSignInPage({ error }: { error?: string }) {
  return (
    <main
      className="camox-auth-page"
      role={error ? "alert" : "status"}
      data-camox-preview={error ? "error" : "pending"}
    >
      <style>{authPageStyles}</style>
      {!error && <div className="camox-auth-spinner" aria-hidden="true" />}
      <p>{error ?? "Signing in to draft preview…"}</p>
    </main>
  );
}
