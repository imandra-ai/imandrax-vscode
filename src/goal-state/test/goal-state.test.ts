import { test } from '@jest/globals';

import * as assert from 'assert';
import * as fs from 'fs';

import * as IX from "../imandrax_types"

test("Some state", () => {
  const data : string =  fs.readFileSync('./test/some-state.json', 'utf-8');
  const p : IX.GoalState | undefined = JSON.parse(data) as IX.GoalState;
  assert(p !== undefined);
  assert(p.format_version == 1);
  assert.equal(p.proof_obligations.length, 28);
  assert.equal(p.proof_obligations[4].name, "thm1");
});