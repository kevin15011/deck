import { expect, test } from 'bun:test';
import { modelConfigurationFailureMessage } from './app';

// Protects actionable capacity diagnostics without exposing arbitrary exception text.
test('model configuration reports the bounded history capacity reason safely', () => {
  expect(modelConfigurationFailureMessage(new Error('runner-history-capacity'))).toContain('Runner ownership history exceeds its supported capacity');
  expect(modelConfigurationFailureMessage(new Error('runner-history-capacity /private/token'))).toBe('Model configuration failed. Apply error: unknown.');
  expect(modelConfigurationFailureMessage({ code: 'ENOSPC', message: 'private token' })).toBe('Model configuration failed. Apply error: ENOSPC.');
});

import { RunnerWriteSkippedError } from '../runner-mutation-admission';
// Oracle: a fence refusal must identify recovery before retry, without leaking paths or error text.
test('model configuration exposes bounded writer refusal reasons', () => {
  expect(modelConfigurationFailureMessage(new RunnerWriteSkippedError('runner-write-recovery-required'))).toContain('incomplete runner operation');
  expect(modelConfigurationFailureMessage(new RunnerWriteSkippedError('managed-by-newer-deck'))).toContain('newer Deck');
  expect(modelConfigurationFailureMessage(new RunnerWriteSkippedError('private-token'))).not.toContain('private-token');
});

import { rollbackFailureMessage } from './app';
test('rollback failures expose only bounded recovery reasons', () => {
  expect(rollbackFailureMessage(new RunnerWriteSkippedError('runner-write-recovery-required'))).toContain('incomplete runner operation');
  expect(rollbackFailureMessage({code:'runner-rollback-conflict',message:'/private/secret'})).toContain('Current files conflict');
  expect(rollbackFailureMessage({code:'EACCES',message:'/private/secret'})).toContain('Filesystem error: EACCES');
  expect(rollbackFailureMessage(new Error('/private/secret'))).not.toContain('/private/secret');
});
