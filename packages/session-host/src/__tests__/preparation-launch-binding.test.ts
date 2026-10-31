// Protects repair refusal when the authenticated launch binding is absent or revoked.
import { test } from 'bun:test';
import { exercisePreparationDelegation } from './preparation-delegation-fixture';

test.each(['missing-binding', 'revoked-binding'] as const)(
  'Claude Lead repairs through Codex Setup with recovery: %s', exercisePreparationDelegation,
);
