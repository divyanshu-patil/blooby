import { it } from 'vitest';
import { check } from '../core/testkit';
import { closeTruncated, extractJson, parseTurn } from './parse';

const N = 'add_preset_to_timeline';
const fails = (s: string) => { try { parseTurn(s); return ''; } catch (e) { return (e as Error).message; } };

{
  // an escaped quote inside a string must not end the string, in either scanner
  it('extractJson skips escaped quotes', check(extractJson('{"a":"x\\"}y"} tail').json === '{"a":"x\\"}y"}'));
  it('closeTruncated skips escaped quotes', check(closeTruncated('{"a":"x\\"y') === '{"a":"x\\"y"}'));
  // cut off right after a backslash: the dangling escape is dropped
  it('closeTruncated drops a trailing backslash', check(closeTruncated('{"a":"x\\') === '{"a":"x"}'));

  // the call shapes a model might use
  it('arguments / parameters / input all count', check(
    [`{"tool":"${N}","arguments":{"p":1}}`, `{"function":"${N}","parameters":{"p":1}}`, `{"name":"${N}","input":{"p":1}}`]
      .every((s) => parseTurn(s).calls[0]?.args.p === 1)));
  it('a named call with scalar args gets {}', check(Object.keys(parseTurn(`{"name":"${N}","args":"nope"}`).calls[0].args).length === 0));
  it('a keyed call with scalar args gets {}', check(Object.keys(parseTurn(`{"${N}":"nope"}`).calls[0].args).length === 0));
  it('non-object list items are dropped', check(parseTurn(`[null, 5, {"name":"${N}"}]`).calls.length === 1));
  it('a bare call needs no wrapper', check(parseTurn(`{"${N}":{"preset":"Blink"}}`).calls[0].name === N));

  // failures: finished-but-wrong versus cut off
  it('unparseable but closed says it is not JSON', check(fails('{"a": nope}').startsWith('Model did not return JSON')));
  it('unparseable and unclosed says it was cut off', check(fails('{"a": tru').startsWith("Model's answer was cut off")));
  it('a truncated turn still yields its calls', check(parseTurn(`{"calls":[{"name":"${N}","args":{"p":1}},{"name":"${N}","args":{"p":`).calls.length >= 1));
}
