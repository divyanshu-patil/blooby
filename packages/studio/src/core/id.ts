/** A short random id with a readable prefix. Its own module so anything can import it
 *  without pulling in defaults.ts and the presets behind it. */
export const uid = (p = 'n') => `${p}_${Math.random().toString(36).slice(2, 9)}`;
