/**
 * ZIP writer, deflating each entry with the platform's own `CompressionStream`.
 *
 * A .lottie is a zip, and fflate would be a dependency for ~40 lines of well-understood
 * header layout. This used to store entries uncompressed, on the theory that minified
 * JSON was already small — it is not: a baked composition is mostly repeated numeric
 * arrays and deflate takes it to 6–16% of its size, which is the difference between an
 * 800KB export and a 90KB one. `deflate-raw` is exactly the bit format zip's method 8
 * wants, so the entry is the stream's output with no wrapper.
 *
 * An entry deflate cannot shrink (a handful of bytes, where the block header costs more
 * than it saves) is written stored, per entry — the reader already handles both.
 */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array<ArrayBuffer> }

/** What a zip file says about itself, in the one field every tool shows. */
export const ZIP_COMMENT = 'Made with Blooby';

export async function writeZip(entries: ZipEntry[], comment = ZIP_COMMENT): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name) as Uint8Array<ArrayBuffer>;
    const crc = crc32(e.data);
    // the CRC and the uncompressed size are always of the ORIGINAL bytes
    const packed = await deflateRaw(e.data);
    const store = !packed || packed.length >= e.data.length;
    const body = store ? e.data : packed;
    const method = store ? 0 : 8;
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);   // version needed
    v.setUint16(6, 0, true);    // flags
    v.setUint16(8, method, true);
    v.setUint16(10, 0, true);   // time
    v.setUint16(12, 0x21, true); // date: 1996-01-01, deterministic output
    v.setUint32(14, crc, true);
    v.setUint32(18, body.length, true);
    v.setUint32(22, e.data.length, true);
    v.setUint16(26, name.length, true);
    v.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, body);

    const cd = new Uint8Array(46 + name.length);
    const c = new DataView(cd.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0, true);
    c.setUint16(10, method, true);
    c.setUint16(12, 0, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + body.length;
  }

  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const note = enc.encode(comment);
  const end = new Uint8Array(22 + note.length);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, note.length, true);
  end.set(note, 22);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

/** null when this runtime has no CompressionStream, which means "write it stored". */
async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer()) as Uint8Array<ArrayBuffer>;
}

/**
 * ZIP reader, inflating via the platform's own `DecompressionStream`.
 *
 * `DecompressionStream('deflate-raw')` has shipped in every browser and in
 * Node since 22, which makes a zip *library* still not worth a dependency. Entries are
 * read from the central directory (the authoritative index) rather than by scanning for
 * local headers, so a streamed archive with data descriptors reads correctly.
 */
export async function unzip(bytes: Uint8Array<ArrayBuffer>): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // end-of-central-directory, scanned backwards past a possible comment
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 0xffff; i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file.');

  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array<ArrayBuffer>>();
  const dec = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const compressed = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    // the local header's own name/extra lengths, not the central one's — they differ
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed) as Uint8Array<ArrayBuffer>;
    if (name.endsWith('/')) continue;
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new Error(`"${name}" uses an unsupported compression method (${method}).`);
  }
  return out;
}

async function inflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed .lottie files.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer()) as Uint8Array<ArrayBuffer>;
}
