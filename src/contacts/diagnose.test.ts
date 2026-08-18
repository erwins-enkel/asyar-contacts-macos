import { describe, expect, it } from 'vitest';
import { diagnoseError, diagnoseFailure, looksLikePermissionProblem } from './diagnose';

describe('looksLikePermissionProblem', () => {
  it('recognises the launcher permission gate’s own wording', () => {
    // Verbatim from asyar-launcher's pipeline.ts permissionGate — the message
    // an extension sees when its consent has been withheld. Note it says "not
    // declared" even when the manifest does declare it; read as "not granted".
    expect(
      looksLikePermissionProblem(
        'Permission denied: "preferences:read" is required but not declared in manifest.json',
      ),
    ).toBe(true);
  });

  it('recognises the SDK’s own phrasing', () => {
    expect(
      looksLikePermissionProblem(
        'Extension "dev.erwins-enkel.contacts" called "asyar:api:shell:spawn" but did not declare permission "shell:spawn"',
      ),
    ).toBe(true);
  });

  it('does not fire on an unrelated failure', () => {
    expect(looksLikePermissionProblem('ENOENT: no such file')).toBe(false);
  });
});

describe('diagnoseError', () => {
  it('sends a withheld-permission rejection to the review instructions', () => {
    const diagnosis = diagnoseError(new Error('Permission denied: "preferences:read"'));
    expect(diagnosis.kind).toBe('permissions');
    expect(diagnosis.detail).toContain('Extensions');
  });

  it('passes an unrelated message through verbatim', () => {
    expect(diagnoseError(new Error('boom'))).toEqual({ kind: 'failure', detail: 'boom' });
  });

  it('survives a rejection that is not an Error', () => {
    expect(diagnoseError('plain string')).toEqual({ kind: 'failure', detail: 'plain string' });
  });
});

describe('diagnoseFailure', () => {
  it('separates the macOS Contacts gate from the Asyar permission gate', () => {
    expect(diagnoseFailure({ kind: 'not-authorized', auth: 0 }).kind).toBe('contacts-access');
    expect(
      diagnoseFailure({ kind: 'spawn-failed', code: 'PERMISSION_DENIED', message: '' }).kind,
    ).toBe('permissions');
  });

  it('classifies a withheld spawn by its message when the code is generic', () => {
    expect(
      diagnoseFailure({
        kind: 'spawn-failed',
        code: 'SPAWN_FAILED',
        message: 'Extension called shell:spawn but did not declare permission',
      }).kind,
    ).toBe('permissions');
  });

  it('names the missing binary case specifically', () => {
    const diagnosis = diagnoseFailure({ kind: 'spawn-failed', code: 'NOT_FOUND', message: '' });
    expect(diagnosis.kind).toBe('failure');
    expect(diagnosis.detail).toContain('osascript');
  });

  it('reports the remaining failure modes as plain failures', () => {
    expect(diagnoseFailure({ kind: 'timeout' }).kind).toBe('failure');
    expect(diagnoseFailure({ kind: 'helper-error', token: 'enumerate_failed' }).detail).toContain(
      'enumerate_failed',
    );
    expect(diagnoseFailure({ kind: 'no-output', exitCode: 1 }).detail).toContain('1');
  });
});
