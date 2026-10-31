import React from 'react';
import { RUNNER_TRANSPORT_FAILURES, sanitizeTurnFailure, type TurnFailure } from '../../../packages/core/src/session/failure';

const explanations: Record<TurnFailure['category'], { title: string; next: string }> = {
  'provider-overloaded': { title: 'Model provider at capacity', next: 'Wait before you manually retry, or choose another configured model.' },
  'provider-unavailable': { title: 'Model provider unavailable', next: 'Check the provider’s service status and manually retry later, or choose another configured model.' },
  'rate-limit': { title: 'Rate limit reached', next: 'Wait for the limit to reset before you manually retry.' },
  quota: { title: 'Usage limit reached', next: 'Check the configured usage allowance or session budget before you manually retry, or choose another configured model.' },
  authentication: { title: 'Authentication or configuration failed', next: 'Check the configured credentials and model access before you manually retry.' },
  rejection: { title: 'Request rejected', next: 'Review the request and model configuration before you manually retry.' },
  'context-limit': { title: 'Context limit reached', next: 'Reduce the context or start a new session with the information needed to continue.' },
  network: { title: 'Connection interrupted', next: 'Check your connection and the runner’s availability before you manually retry.' },
  'runner-process': { title: 'Runner process ended', next: 'Check that the runner is available, then reconnect and manually retry when ready.' },
  deck: { title: 'Deck could not finish orchestration', next: 'Check Deck’s diagnostics before you manually retry.' },
  unknown: { title: 'Turn failed', next: 'Check the runner and provider status before you decide whether to manually retry.' },
};
const origins: Record<TurnFailure['origin'], string> = {
  provider: 'The model provider reported a failure.',
  runner: 'The failure came from the runner.',
  deck: 'The failure occurred in Deck’s orchestration.',
  unknown: 'The source of this failure could not be confirmed.',
};
const possibleOrigins: Record<TurnFailure['origin'], string> = {
  provider: 'The failure may be with the model provider.',
  runner: 'The failure may be with the runner.',
  deck: 'The failure may be in Deck’s orchestration.',
  unknown: origins.unknown,
};
const possibleTitles: Record<TurnFailure['category'], string> = {
  'provider-overloaded': 'The model provider may be at capacity',
  'provider-unavailable': 'The model provider may be unavailable',
  'rate-limit': 'A rate limit may have been reached',
  quota: 'A usage limit may have been reached',
  authentication: 'Credentials or configuration may need attention',
  rejection: 'The request may have been rejected',
  'context-limit': 'The context limit may have been reached',
  network: 'The connection may have been interrupted',
  'runner-process': 'The runner may have stopped',
  deck: 'Deck may not have finished orchestration',
  unknown: 'Turn failed',
};

/** Shared by live and paged history; all new wording comes from fixed strings, never native prose. */
export function TurnFailureMessage({ data }: { data: Record<string, unknown> }) {
  const failure = sanitizeTurnFailure(data.failure);
  if (!failure) return <article className="message failed-message" role="alert"><p className="message-meta">Turn failed</p><p>{typeof data.error === 'string' && data.error ? data.error : 'The runner could not complete this turn. Try again.'}</p></article>;
  if (failure.category === 'deck' && failure.origin === 'deck' && failure.certainty === 'reported' && failure.code && Object.hasOwn(RUNNER_TRANSPORT_FAILURES, failure.code)) {
    const oversized = RUNNER_TRANSPORT_FAILURES[failure.code as keyof typeof RUNNER_TRANSPORT_FAILURES] === 'oversized';
    return <article className="message failed-message" role="alert">
      <p className="message-meta">{oversized ? 'Runner message exceeded the size limit' : 'Runner message was malformed'}</p>
      <p>{oversized ? 'Deck stopped this turn because a runner message exceeded the transport size limit.' : 'Deck stopped this turn because a runner message could not be decoded or parsed.'}</p>
      <p>Partial work may remain. Review it before you manually retry.</p>
    </article>;
  }
  const explanation = explanations[failure.category];
  const title = failure.origin === 'unknown' ? 'Turn failed' : failure.certainty === 'inferred' ? possibleTitles[failure.category] : explanation.title;
  return <article className="message failed-message" role="alert">
    <p className="message-meta">{title}</p>
    <p>{(failure.certainty === 'inferred' ? possibleOrigins : origins)[failure.origin]} {explanation.next}</p>
    {(failure.category === 'rate-limit' || failure.category === 'quota') && failure.resetAt && <p>Reported reset: <time dateTime={failure.resetAt}>{new Date(failure.resetAt).toUTCString()}</time>. Wait until then before retrying.</p>}
    <p>Partial work may remain. Review it before retrying.</p>
  </article>;
}
