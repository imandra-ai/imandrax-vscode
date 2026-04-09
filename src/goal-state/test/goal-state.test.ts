import { test } from '@jest/globals';

import * as assert from 'assert';
import * as fs from 'fs';

import * as IX from "../imandrax_types"
import * as GSC from "../state-converter";

test("Some state", () => {
  const data: string = fs.readFileSync('src/goal-state/test/some-state.json', 'utf-8');
  const p: IX.GoalState | undefined = JSON.parse(data) as IX.GoalState | undefined;
  assert.ok(p !== undefined);
  assert.equal(p.format_version, 1);
  assert.equal(p.goals.length, 28);
  assert.equal(p.goals[4].name, "thm1");
});

test("iMinimum_x_or_y state", async () => {
  // A previous version of the term formatter used to be too slow on this one.
  const data: string = fs.readFileSync('src/goal-state/test/tooslow.json', 'utf-8');
  const p: IX.GoalState | undefined = JSON.parse(data) as IX.GoalState | undefined;
  assert.ok(p !== undefined);
  assert.equal(p.format_version, 1);
  assert.equal(p.goals.length, 1);
  assert.equal(p.goals[0].name, "iMinimum_x_or_y");

  const gsc = new GSC.Converter(80);
  const html = await gsc.to_html(p, { showProvenGoals: false });
  assert.ok(html[0].length > 0);
});
