import { it, vi } from 'vitest';
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

// --- the platform missing, and archives that are not what they claim -----------------------
{
  const anim = `{"layers":[${Array.from({ length: 400 }, (_, i) => `{"t":${i}}`).join(',')}]}`;
  const entries = [{ name: 'd/', data: bytes('') }, { name: 'a.json', data: bytes(anim) }];

  vi.stubGlobal('CompressionStream', undefined);
  const stored = await raw(await writeZip(entries));
  vi.unstubAllGlobals();
  it('with no CompressionStream everything is stored', check((await raw(await writeZip([]))).length > 0 && stored.length > anim.length));
  const back = await unzip(stored);
  it('a directory entry is skipped and a stored file read', check(!back.has('d/') && back.has('a.json')));

  const packed = await raw(await writeZip(entries));
  vi.stubGlobal('DecompressionStream', undefined);
  const nope = await unzip(packed).then(() => null, (e: Error) => e.message);
  vi.unstubAllGlobals();
  it('with no DecompressionStream a deflated entry says so', check(nope?.includes('cannot read compressed') === true));

  const notZip = await unzip(bytes('this is plainly not an archive, just text')).then(() => null, (e: Error) => e.message);
  it('something that is not a zip says so', check(notZip === 'Not a zip file.'));

  const dirAt = (z: Uint8Array<ArrayBuffer>) => new DataView(z.buffer, z.byteOffset).getUint32(z.length - ZIP_COMMENT.length - 22 + 16, true);
  const odd = packed.slice();
  new DataView(odd.buffer).setUint16(dirAt(odd) + 48 + 10, 99, true);
  const badMethod = await unzip(odd).then(() => null, (e: Error) => e.message);
  it('an unknown compression method is named', check(badMethod?.includes('unsupported compression method (99)') === true));

  const cut = packed.slice();
  new DataView(cut.buffer).setUint32(dirAt(cut), 0, true);
  it('a damaged directory ends the listing', check((await unzip(cut)).size === 0));
}
