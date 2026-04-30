/**
 * AuthGateway.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Entry gateway component.
 *
 * Responsibilities:
 *  - Render a simple display-name entry form (no database required).
 *  - Invoke onAuthSuccess with the entered name to unlock the app shell.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useCallback, FormEvent } from 'react';
import { WildfireBackground } from './WildfireBackground';
import './AuthGateway.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthGatewayProps {
  /** Callback invoked with the user's display name on entry */
  onAuthSuccess: (name: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const AuthGateway: React.FC<AuthGatewayProps> = ({ onAuthSuccess }) => {
  // ── Form submission handler ───────────────────────────────────────────

  /**
   * handleSubmit
   * Calls onAuthSuccess to unlock the app.
   * No network request is made – there is no database in this build.
   */
  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>): void => {
      e.preventDefault();
      onAuthSuccess('User');
    },
    [onAuthSuccess]
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="auth-gateway">
      <WildfireBackground />

      <div className="auth-gateway__card card card--accent" role="main">

        {/* Brand */}
        <div className="auth-gateway__brand">
          <span className="auth-gateway__logo">🔥</span>
          <h1 className="auth-gateway__title">Blazen Sim</h1>
          <p className="auth-gateway__tagline text-muted">
            DEVS-FIRE Wildland Fire Simulation Interface
          </p>
        </div>

        <hr className="divider" />

        {/* Form */}
        <form className="auth-gateway__form" onSubmit={handleSubmit} noValidate>
          <button type="submit" className="btn-primary auth-gateway__submit">
            Enter Blazen Sim
          </button>
        </form>

      </div>
    </div>
  );
};
