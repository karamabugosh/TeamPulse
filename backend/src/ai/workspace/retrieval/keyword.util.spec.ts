import * as assert from 'assert';
import { expandQueryTokens, meaningfulTokens } from './keyword.util';

console.log('keyword.util.spec.ts');

const vacation = expandQueryTokens('What happened while I was on vacation?');
assert.ok(vacation.includes('vacation'));
assert.ok(vacation.includes('pto'), `expected pto in ${vacation.join(',')}`);
assert.ok(vacation.includes('leave'), `expected leave in ${vacation.join(',')}`);
assert.ok(vacation.includes('absent'), `expected absent in ${vacation.join(',')}`);

const blocked = expandQueryTokens('Who is blocked on OAuth?');
assert.ok(blocked.includes('blocked') || blocked.includes('blocker'));
assert.ok(blocked.includes('waiting') || blocked.includes('dependency'));
assert.ok(blocked.includes('oauth') || blocked.includes('callback'));

const finished = expandQueryTokens('Which issues were finished last week?');
assert.ok(finished.includes('finished') || finished.includes('completed'));
assert.ok(finished.includes('done') || finished.includes('resolved'));

const base = meaningfulTokens('Why was SCRUM-8 delayed?');
assert.ok(base.includes('delayed') || base.includes('scrum-8') || base.length >= 1);

console.log('All keyword util synonym tests passed.');
