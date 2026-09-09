import { it } from 'vitest';
import { check } from '../core/testkit';
import { relativeTime } from './index';

/**
 * The ladder every "Edited …" / "Joined …" / "Last seen …" label climbs.
 *
 * This stopped at hours once, which is how a project touched months ago came to read
 * "3,412 hours ago" in the dashboard. The boundaries below are the whole point of the
 * function, so they are pinned rather than eyeballed.
 */
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
const at = (msAgo: number) => relativeTime(Date.now() - msAgo);

// --- the units ----------------------------------------------------------------
it('a few seconds is "just now"', check(at(5 * S) === 'just now', at(5 * S)));
it('minutes', check(at(5 * M) === '5m ago', at(5 * M)));
it('hours', check(at(3 * H) === '3h ago', at(3 * H)));
it('days', check(at(3 * D) === '3d ago', at(3 * D)));
it('a week', check(at(7 * D) === '1w ago', at(7 * D)));
it('several weeks', check(at(21 * D) === '3w ago', at(21 * D)));
it('a month', check(at(31 * D) === '1mon ago', at(31 * D)));
it('several months', check(at(100 * D) === '3mon ago', at(100 * D)));
it('a year', check(at(365 * D) === '1y ago', at(365 * D)));
it('several years', check(at(3 * 365 * D) === '3y ago', at(3 * 365 * D)));

// --- the boundaries, which is where a relative formatter actually goes wrong ----
it('44 seconds is still "just now"', check(at(44 * S) === 'just now', at(44 * S)));
it('46 seconds has become a minute', check(at(46 * S) === '1m ago', at(46 * S)));
it('59 minutes stays in minutes', check(at(59 * M) === '59m ago', at(59 * M)));
it('61 minutes becomes an hour', check(at(61 * M) === '1h ago', at(61 * M)));
it('23 hours stays in hours', check(at(23 * H) === '23h ago', at(23 * H)));
it('25 hours becomes a day', check(at(25 * H) === '1d ago', at(25 * H)));
it('6 days stays in days', check(at(6 * D) === '6d ago', at(6 * D)));
it('29 days is still weeks, not a month', check(at(29 * D) === '4w ago', at(29 * D)));
it('11 months is still months', check(at(340 * D) === '11mon ago', at(340 * D)));

// the hours ceiling this function used to have: the label the fix exists to prevent
it('never falls back to a four-digit hour count', check(!/\d{4}h/.test(at(200 * D)), at(200 * D)));

// --- clocks that disagree, and dates that are not dates ------------------------
it('a timestamp slightly in the future reads "just now", not "-2m ago"', check(
  relativeTime(Date.now() + 2 * M) === 'just now', relativeTime(Date.now() + 2 * M)));
it('an unparseable date is not rendered as NaN', check(
  relativeTime(Date.parse('not a date')) === 'just now', relativeTime(Date.parse('not a date'))));
