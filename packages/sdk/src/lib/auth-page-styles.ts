// Self-contained: sign-in pages render before either site or Studio CSS is loaded.
export const authPageStyles = `
  .camox-auth-page {
    align-items: center;
    background: #09090b;
    box-sizing: border-box;
    color: #fafafa;
    color-scheme: dark;
    display: flex;
    flex-direction: column;
    font: 16px/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
    gap: 16px;
    inset: 0;
    justify-content: center;
    margin: 0;
    overflow: auto;
    padding: 24px;
    position: fixed;
    text-align: center;
  }
  .camox-auth-page .camox-auth-spinner {
    animation: camox-auth-spin 800ms linear infinite;
    border: 2px solid #3f3f46;
    border-radius: 999px;
    border-top-color: #fafafa;
    box-sizing: content-box;
    flex-shrink: 0;
    height: 24px;
    width: 24px;
  }
  .camox-auth-page p { color: #a1a1aa; margin: 0; max-width: 32rem; }
  @keyframes camox-auth-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .camox-auth-page .camox-auth-spinner { animation: none; }
  }
`;
