/**
 * ChatInterface.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Blazen Sim – Conversational chat interface component.
 *
 * Responsibilities:
 *  - Render a scrollable message thread of user prompts and agent responses.
 *  - Provide a textarea + submit control for composing new simulation prompts.
 *  - POST prompts to the backend /api/v1/simulation/run endpoint.
 *  - Display intermediate states: sending, extracting params, running simulation.
 *  - Expose the final SimulationRunResult to the parent via onSimulationResult.
 *
 * Design Pattern: Controlled component with local message state;
 * async side effects handled via useCallback + useState.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  KeyboardEvent,
} from 'react';
import type { ThermalCell } from '../engine/ThermalRenderer';
import './ChatInterface.css';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Exported so App.tsx can forward it to VisualizationPanel */
export interface SimulationRunResult {
  extractedParams: Record<string, unknown>;
  simulationResult: {
    sessionId: string;
    status: string;
    thermalGrid?: ThermalCell[];
    firePerimeter?: Record<string, unknown>;
    summary?: string;
    errorDetail?: string;
    /** Grid columns from DEVS-FIRE – used to size the renderer correctly */
    gridWidth?: number;
    /** Grid rows from DEVS-FIRE */
    gridHeight?: number;
    /** Cell IDs on the active fire perimeter at simulation end */
    perimeterCellIds?: number[];
  };
  durationMs: number;
}

export type { ThermalCell };

/** Shape of a single message in the conversation thread */
interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  /** ISO timestamp of when the message was added */
  timestamp: string;
  /** Optional structured data payload attached to an agent message */
  payload?: SimulationRunResult;
}

/** Processing states used to drive the UI loading indicators */
type ProcessingStep =
  | 'idle'
  | 'sending'
  | 'extracting'
  | 'simulating'
  | 'error';

interface ChatInterfaceProps {
  /** Called when the backend returns a completed simulation result */
  onSimulationResult: (result: SimulationRunResult) => void;
  /** Compact summary of all past runs; injected into Claude's context for comparison queries */
  simulationContext?: string;
}

// ── Helper ────────────────────────────────────────────────────────────────────

/** Generates a short pseudo-random message ID for React key props */
function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Formats milliseconds into a human-readable duration string */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Returns a descriptive label for each processing step */
function getStepLabel(step: ProcessingStep): string {
  switch (step) {
    case 'sending':    return 'Sending prompt…';
    case 'extracting': return 'Claude is extracting simulation parameters…';
    case 'simulating': return 'DEVS-FIRE simulation running…';
    case 'error':      return 'An error occurred.';
    default:           return '';
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  onSimulationResult,
  simulationContext,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: generateId(),
      role: 'system',
      content:
        'Welcome to Blazen Sim. Describe a wildland fire scenario in natural language and the ' +
        'system will extract simulation parameters, run the DEVS-FIRE model, and visualise ' +
        'the thermal output on the canvas to the right.',
      timestamp: new Date().toISOString(),
    },
  ]);

  const [inputValue, setInputValue] = useState('');
  const [processingStep, setProcessingStep] = useState<ProcessingStep>('idle');

  /** Ref to the bottom of the message list for auto-scroll */
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Auto-scroll on new messages ─────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Appends a new message to the thread */
  const appendMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages((prev) => [
      ...prev,
      { ...msg, id: generateId(), timestamp: new Date().toISOString() },
    ]);
  }, []);

  // ── Submission handler ──────────────────────────────────────────────────────

  /**
   * handleSubmit
   * Posts the current prompt to the backend and drives the UI through
   * each processing step while awaiting the response.
   */
  const handleSubmit = useCallback(async (): Promise<void> => {
    const prompt = inputValue.trim();
    if (!prompt || processingStep !== 'idle') return;

    // Add the user's message to the thread
    appendMessage({ role: 'user', content: prompt });
    setInputValue('');
    setProcessingStep('sending');

    try {
      // ── Step 1: Claude parameter extraction phase ─────────────────────────
      setProcessingStep('extracting');

      // ── Step 2: Call the backend run endpoint (Claude + DEVS-FIRE) ────────
      setProcessingStep('simulating');

      const response = await fetch('/api/v1/simulation/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, simulationContext }),
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMessage = `Server error: ${response.status}`;
        try {
          const errData = JSON.parse(errText) as { message?: string; error?: string };
          errMessage = errData.message ?? errData.error ?? errMessage;
        } catch { /* body was not JSON – use the status text fallback */ }
        throw new Error(errMessage);
      }

      const data = (await response.json()) as SimulationRunResult & {
        success: boolean;
        isReady: boolean;
        chatReply?: string;
      };

      // ── Step 3: Claude needs more info – show follow-up question ──────────
      if (!data.isReady) {
        appendMessage({
          role: 'agent',
          content: data.chatReply ?? 'Could you provide more details about the simulation?',
        });
        setProcessingStep('idle');
        return;
      }

      // ── Step 4: Simulation complete – show chatReply + summary ────────────
      const summary =
        data.chatReply ??
        data.simulationResult?.summary ??
        `Simulation completed in ${formatDuration(data.durationMs)}.`;

      appendMessage({
        role: 'agent',
        content: summary,
        payload: data,
      });

      // ── Step 5: Forward result to VisualizationPanel via parent ───────────
      onSimulationResult(data);

      setProcessingStep('idle');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      appendMessage({
        role: 'agent',
        content: `Error: ${message}`,
      });
      setProcessingStep('error');

      // Auto-recover to idle after a short delay
      setTimeout(() => setProcessingStep('idle'), 2000);
    }
  }, [inputValue, processingStep, appendMessage, onSimulationResult]);

  // ── Keyboard shortcut: Enter to submit ────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit]
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const isProcessing = processingStep !== 'idle' && processingStep !== 'error';

  return (
    <div className="chat-interface">

      {/* ── Message thread ── */}
      <div className="chat-interface__thread" role="log" aria-live="polite">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message chat-message--${msg.role}`}
            aria-label={`${msg.role} message`}
          >
            <span className="chat-message__role-badge">
              {msg.role === 'user' ? 'You' : msg.role === 'agent' ? 'Blazen' : 'System'}
            </span>
            <p className="chat-message__content">{msg.content}</p>

            {/* Extracted params display */}
            {msg.payload?.extractedParams && (
              <details className="chat-message__params">
                <summary className="chat-message__params-toggle text-muted">
                  View extracted parameters
                </summary>
                <pre className="chat-message__params-json">
                  {JSON.stringify(msg.payload.extractedParams, null, 2)}
                </pre>
              </details>
            )}

            <span className="chat-message__timestamp text-muted">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}

        {/* Processing indicator */}
        {isProcessing && (
          <div className="chat-processing" role="status" aria-live="assertive">
            <span className="chat-processing__dots" aria-hidden="true">
              <span /><span /><span />
            </span>
            <span className="chat-processing__label">
              {getStepLabel(processingStep)}
            </span>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="chat-interface__input-area">

        {/* ── Suggested prompts ── */}
        <div className="chat-interface__suggestions">
          <span className="text-muted">Try:</span>
          <button
            className="chat-interface__suggestion"
            onClick={() => setInputValue('A wildfire starts in a pine forest at 45.2°N, 121.5°W with 15mph winds from the southwest.')}
            disabled={isProcessing}
          >
            Pine forest fire with southwest winds
          </button>
          <button
            className="chat-interface__suggestion"
            onClick={() => setInputValue('Grassland fire at 38.9°N, 119.8°W with 25mph north winds and low humidity.')}
            disabled={isProcessing}
          >
            Fast grassland fire in dry conditions
          </button>
          <button
            className="chat-interface__suggestion"
            onClick={() => setInputValue('Mixed conifer forest at 47.6°N, 122.3°W with variable winds and steep terrain.')}
            disabled={isProcessing}
          >
            Mountain forest fire on steep terrain
          </button>
        </div>

        <div className="chat-interface__compose">
          <textarea
            className="chat-interface__textarea"
            placeholder="Describe a wildland fire scenario… (Ctrl+Enter to run)"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing}
            rows={4}
            maxLength={2000}
            aria-label="Simulation prompt"
          />
          <button
            className="btn-primary chat-interface__submit"
            onClick={() => void handleSubmit()}
            disabled={isProcessing || !inputValue.trim()}
            aria-label="Run simulation"
          >
            {isProcessing ? '⏳' : '▶ Run'}
          </button>
        </div>

        <p className="chat-interface__hint text-muted">
          Enter to submit, Shift+Enter for newline &nbsp;·&nbsp; {inputValue.length}/2000
        </p>
      </div>

    </div>
  );
};
