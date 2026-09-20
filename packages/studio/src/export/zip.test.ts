import { it } from 'vitest';
import { check } from '../core/testkit';
import { crc32, unzip, writeZip, ZIP_COMMENT } from './zip';

// --- zip: the CRC everything downstream depends on -----------------------------
it('crc32 of the check vector', check(crc32(new TextEncoder().encode('123456789') as Uint8Array<ArrayBuffer>) === 0xcbf43926));

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s) as Uint8Array<ArrayBuffer>;
const raw = async (b: Blob) => new Uint8Array(await b.arrayBuffer()) as Uint8Array<ArrayBuffer>;

// --- the round trip, over a payload big enough for deflate to bite -------------
{
  // a real animation is repeated numeric arrays, which is the shape deflate feeds on;
  // a two-line manifest is not, and is expected to come back out stored
  const anim = `{"layers":[${Array.from({ length: 400 }, (_, i) => `{"t":${i},"s":[0,0]}`).join(',')}]}`;
  const zip = await writeZip([
    { name: 'manifest.json', data: bytes('{"version":"2"}') },
    { name: 'a/idle.json', data: bytes(anim) },
  ]);
  const out = await unzip(await raw(zip));
  it('reads back both entries', check(out.size === 2, [...out.keys()].join(',')));
  it('with their bytes intact', check(new TextDecoder().decode(out.get('a/idle.json')!) === anim));
  it('and the manifest too', check(new TextDecoder().decode(out.get('manifest.json')!) === '{"version":"2"}'));

  /**
   * The whole point of the writer. A stored `.lottie` was running 800KB–3MB, because
   * nothing in the pipeline compressed and a baked composition is the most compressible
   * thing there is. If this ever goes back to storing, the exports quietly get 6× bigger
   * and nothing else complains.
   */
  it('the animation is deflated, not stored', check(
    new DataView(await zip.arrayBuffer()).getUint16(8, true) === 0 // manifest.json: too small, stored
    && (await raw(zip)).length < anim.length / 2, `${zip.size} vs ${anim.length}`));
}

// --- the credit every zip tool shows -------------------------------------------
{
  const zip = await raw(await writeZip([{ name: 'a.json', data: bytes('{}') }]));
  const tail = new TextDecoder().decode(zip.subarray(zip.length - ZIP_COMMENT.length));
  it('the archive comment says who made it', check(tail === ZIP_COMMENT, tail));
  // the reader scans backwards past exactly this comment to find the directory
  it('and a commented archive still reads', check((await unzip(zip)).has('a.json')));
}
