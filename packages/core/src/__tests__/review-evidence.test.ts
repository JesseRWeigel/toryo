import {describe, it, expect} from 'vitest';
import {captureReviewEvidence} from '../review-evidence.js';
import {tmpdir} from 'node:os';

describe('independent command evidence', () => {
  it('captures real exit codes and output without running a shell', async () => {
    const evidence = await captureReviewEvidence(tmpdir(), null, 'worker claims all tests pass', [
      {id:'test', command:process.execPath, args:['-e','console.log("failure evidence");process.exit(3)']},
    ]);
    expect(evidence.patch.diff).toBe('worker claims all tests pass');
    expect(evidence.checks[0].exitCode).toBe(3);
    expect(evidence.checks[0].stdout).toContain('failure evidence');
    expect(evidence.checks[0].id).toMatch(/^check:test:/);
  });
  it('captures timeouts and missing executables as failed checks', async () => {
    const evidence = await captureReviewEvidence(tmpdir(), null, '', [
      {id:'timeout', command:process.execPath, args:['-e','setInterval(()=>{},1000)'], timeoutMs:25},
      {id:'missing', command:'toryo-nonexistent-fixture-command'},
    ]);
    for (const check of evidence.checks) {expect(check.error).toBeTruthy();expect(check.exitCode).not.toBe(0);}
  });
  it('passes arguments literally instead of interpreting shell metacharacters', async () => {
    const evidence = await captureReviewEvidence(tmpdir(), null, '', [
      {id:'literal', command:process.execPath, args:['-e','console.log(process.argv[1])','$(echo injected); &']},
    ]);
    expect(evidence.checks[0].stdout.trim()).toBe('$(echo injected); &');
    expect(evidence.checks[0].exitCode).toBe(0);
  });
  it('keeps executed argument evidence unchanged when the caller edits its array', async () => {
    const args = ['-e','console.log("original")'];
    const evidence = await captureReviewEvidence(tmpdir(),null,'',[{id:'test',command:process.execPath,args}]);
    args[1] = 'different command';
    expect(evidence.checks[0].args[1]).toBe('console.log("original")');
  });

});
