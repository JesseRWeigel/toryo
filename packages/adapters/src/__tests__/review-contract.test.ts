import {describe, it, expect, vi, afterEach} from 'vitest';
import {CliAdapter, ClaudeCodeAdapter, CodexAdapter, CursorAdapter, ClineAdapter,
  AiderAdapter, GeminiCliAdapter, CustomAdapter, OllamaAdapter} from '../index.js';
import {parseReview} from '../../../core/src/review.js';
const evidence = {patch:{id:'patch:fixture',base:null,head:null,diff:'fixture'},checks:[]};
const output = JSON.stringify({score:8,verdict:'pass',feedback:'Fixture evidence reviewed',evidenceRefs:['patch:fixture']});
afterEach(() => vi.unstubAllGlobals());
describe('structured review transport fixtures', () => {
  const adapters = [new ClaudeCodeAdapter(),new CodexAdapter(),new CursorAdapter(),new ClineAdapter(),
    new AiderAdapter(),new GeminiCliAdapter(),new CustomAdapter({name:'custom',command:'fixture',args:[]})];
  for (const adapter of adapters) {
    it(`accepts the JSON fixture through ${adapter.name}`, () => {
      expect(parseReview(adapter.parseOutput('  '+output+'\n'),6,evidence).verdict).toBe('pass');
    });
  }
  it('accepts the JSON fixture through mocked Ollama transport', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({response:output}))));
    const result = await new OllamaAdapter().send({agentId:'fixture',prompt:'review',timeout:1});
    expect(result.infraFailure).toBe(false);
    expect(parseReview(result.output,6,evidence).verdict).toBe('pass');
  });
  it('rejects a reviewer process that exits nonzero after emitting valid JSON', async () => {
    class FailedReviewer extends CliAdapter {
      name='failed-reviewer';
      buildCommand() {return {command:process.execPath,args:['-e',
        `process.stdin.resume();process.stdin.on('end',()=>{console.log(${JSON.stringify(output)});process.exit(1)})`],useStdin:true};}
      parseOutput(stdout:string) {return stdout.trim();}
      async isAvailable() {return true;}
    }
    const result=await new FailedReviewer().send({agentId:'fixture',prompt:'review',timeout:1});
    expect(result.infraFailure).toBe(true);
    expect(result.error).toContain('1');
  });
});
