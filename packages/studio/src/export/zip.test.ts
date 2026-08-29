import { it } from 'vitest';
import { check } from '../core/testkit';
import { crc32 } from './zip';

// --- zip: the CRC everything downstream depends on -----------------------------
it('crc32 of the check vector', check(crc32(new TextEncoder().encode('123456789') as Uint8Array<ArrayBuffer>) === 0xcbf43926));
