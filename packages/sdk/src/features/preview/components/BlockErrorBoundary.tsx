import * as React from "react";

import { useIsAuthenticated } from "@/lib/auth";

/* -------------------------------------------------------------------------------------------------
 * BlockErrorBoundary
 *
 * Wraps each block on a page so that a rendering error in one block doesn't
 * crash the entire page. Authenticated users see an actionable error card;
 * site visitors see nothing (the broken block is silently hidden).
 * ------------------------------------------------------------------------------------------------*/

/* -------------------------------------------------------------------------------------------------
 * Class component (error boundaries require getDerivedStateFromError)
 * ------------------------------------------------------------------------------------------------*/

interface InnerProps {
  blockId: string;
  blockType: string;
  isAuthenticated: boolean;
  children: React.ReactNode;
}

interface InnerState {
  error: Error | null;
}

class BlockErrorBoundaryInner extends React.Component<InnerProps, InnerState> {
  state: InnerState = { error: null };

  static getDerivedStateFromError(error: Error): InnerState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[camox] Block "${this.props.blockType}" (id=${this.props.blockId}) crashed:`,
      error,
      info.componentStack,
    );
  }

  override render() {
    if (this.state.error) {
      if (!this.props.isAuthenticated) {
        // Site visitors: silently skip the broken block
        return null;
      }

      return (
        <div className="camox-block-error" data-camox-block-id={this.props.blockId}>
          <p className="camox-block-error-title">
            Block &ldquo;{this.props.blockType}&rdquo; failed to render
          </p>
          <pre className="camox-block-error-message">{this.state.error.message}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

/* -------------------------------------------------------------------------------------------------
 * Public wrapper (reads auth from hooks, passes to class component)
 * ------------------------------------------------------------------------------------------------*/

export const BlockErrorBoundary = ({
  blockId,
  blockType,
  children,
}: {
  blockId: string;
  blockType: string;
  children: React.ReactNode;
}) => {
  const isAuthenticated = useIsAuthenticated();
  return (
    <BlockErrorBoundaryInner
      blockId={blockId}
      blockType={blockType}
      isAuthenticated={isAuthenticated}
    >
      {children}
    </BlockErrorBoundaryInner>
  );
};
