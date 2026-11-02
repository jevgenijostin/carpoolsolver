import { readFileSync } from 'node:fs';
import { demo } from './demo.js';
import { importInstance } from './io.js';
import { solve } from './solver/index.js';
import { validate } from './validator/index.js';
import { naiveRoundRobin, spread } from './baseline.js';
import { parentMessage } from './messages.js';
const instance = process.argv[2] ? importInstance(readFileSync(process.argv[2], 'utf8')) : demo();
const result = solve(instance);
if (result.status === 'ok') {
  const check = validate(instance, result);
  if (!check.valid) throw new Error(JSON.stringify(check.errors));
  console.log('U10 Tigers — independently verified schedule');
  console.log(JSON.stringify(result, null, 2));
  const naive = naiveRoundRobin(instance);
  if (naive.schedule) {
    if (!validate(instance, naive.schedule).valid) throw new Error('Invalid naive baseline');
    const total = (s: typeof result) => Object.values(s.loads).reduce((a, b) => a + b, 0);
    console.log(`vs. naive: ${total(result) - total(naive.schedule)} min total, spread ${spread(instance, result) - spread(instance, naive.schedule)}`);
  } else console.log(naive.reason);
  for (const h of instance.households) console.log('\n' + parentMessage(instance, result, h.id));
} else { console.log(JSON.stringify(result, null, 2)); process.exitCode = 2; }
