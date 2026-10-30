// Protects restart recovery and refusal to launch Setup without its native role.
import { test } from 'bun:test';
import { exercisePreparationDelegation } from './preparation-delegation-fixture';

test.each(['restart', 'missing-role'] as const)(
  'Claude Lead repairs through Codex Setup with recovery: %s', exercisePreparationDelegation,
);
