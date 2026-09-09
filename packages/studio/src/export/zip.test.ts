import { it } from 'vitest';
import { check } from '../core/testkit';
import { crc32, unzip, zipStore } from './zip';

// --- zip: the CRC everything downstream depends on -----------------------------
it('crc32 of the check vector', check(crc32(new TextEncoder().encode('123456789') as Uint8Array<ArrayBuffer>) === 0xcbf43926));

// --- unzip: the import path, including the deflate a real .lottie uses ---------
{
  const enc = new TextEncoder();
  const round = await unzip(new Uint8Array(await zipStore([
    { name: 'manifest.json', data: enc.encode('{"version":"2"}') as Uint8Array<ArrayBuffer> },
    { name: 'a/idle.json', data: enc.encode('{"fr":60}') as Uint8Array<ArrayBuffer> },
  ]).arrayBuffer()) as Uint8Array<ArrayBuffer>);
  it('reads back both stored entries', check(round.size === 2, [...round.keys()].join(',')));
  it('with their bytes intact', check(new TextDecoder().decode(round.get('a/idle.json')!) === '{"fr":60}'));

  // every .lottie not written by us is deflated, so that branch has to be exercised
  const payload = enc.encode('{"deflated":true,"pad":"' + 'x'.repeat(400) + '"}') as Uint8Array<ArrayBuffer>;
  const deflated = new Uint8Array(await new Response(
    new Blob([payload]).stream().pipeThrough(new CompressionStream('deflate-raw')),
  ).arrayBuffer()) as Uint8Array<ArrayBuffer>;
  const zip = deflatedZip('s/machine.json', payload, deflated);
  const out = await unzip(zip);
  it('a deflated entry inflates', check(
    new TextDecoder().decode(out.get('s/machine.json')!) === new TextDecoder().decode(payload)));
  it('and deflate actually shrank it, so the store path was not silently taken',
    check(deflated.length < payload.length));
}

/** A one-entry zip written with method 8 — the shape `zipStore` deliberately never emits. */
function deflatedZip(name: string, raw: Uint8Array<ArrayBuffer>, deflated: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const n = new TextEncoder().encode(name) as Uint8Array<ArrayBuffer>;
  const crc = crc32(raw);
  const local = new Uint8Array(30 + n.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true); // deflate
  lv.setUint32(14, crc, true);
  lv.setUint32(18, deflated.length, true);
  lv.setUint32(22, raw.length, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);

  const cd = new Uint8Array(46 + n.length);
  const cv = new DataView(cd.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(4, 20, true);
  cv.setUint16(6, 20, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, deflated.length, true);
  cv.setUint32(24, raw.length, true);
  cv.setUint16(28, n.length, true);
  cv.setUint32(42, 0, true);
  cd.set(n, 46);

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, local.length + deflated.length, true);

  const out = new Uint8Array(local.length + deflated.length + cd.length + end.length);
  out.set(local, 0);
  out.set(deflated, local.length);
  out.set(cd, local.length + deflated.length);
  out.set(end, local.length + deflated.length + cd.length);
  return out as Uint8Array<ArrayBuffer>;
}
