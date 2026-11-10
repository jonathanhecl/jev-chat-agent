import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOUNCE_MAX_DETAIL,
  bitsAnnouncement,
  createAnnouncement,
  describePlan,
  genericRedemptionAnnouncement,
  mysteryGiftAnnouncement,
  resubAnnouncement,
  subAnnouncement,
  subGiftAnnouncement,
  truncateDetail,
} from './events.js';

test('truncateDetail collapses whitespace and clips long text', () => {
  assert.equal(truncateDetail('  hello \n  world  '), 'hello world');
  assert.equal(truncateDetail(''), '');
  assert.equal(truncateDetail(null), '');
  assert.equal(truncateDetail(undefined), '');

  const clipped = truncateDetail('a'.repeat(200));
  assert.equal(clipped.length, ANNOUNCE_MAX_DETAIL);
  assert.ok(clipped.endsWith('…'));

  assert.equal(truncateDetail('short', 10), 'short');
  assert.equal(truncateDetail('x'.repeat(30), 10).length, 10);
});

test('createAnnouncement builds the SSE payload shape', () => {
  const message = createAnnouncement({
    kind: 'redemption',
    title: 'Hydrate',
    username: 'alice',
    detail: 'extra water',
  });
  assert.equal(message.type, 'announcement');
  assert.equal(message.kind, 'redemption');
  assert.equal(message.title, 'Hydrate');
  assert.equal(message.username, 'alice');
  assert.equal(message.detail, 'extra water');
  assert.equal(message.important, false);
  assert.equal(typeof message.ts, 'number');
});

test('createAnnouncement rejects unknown kinds', () => {
  assert.throws(() => createAnnouncement({ kind: 'nope', title: 'x', username: 'y' }), /kind/);
});

test('generic redemption announcement is small and truncates input', () => {
  const message = genericRedemptionAnnouncement({
    rewardTitle: 'Hydrate',
    userName: 'alice',
    userInput: '  extra   water please  ',
  });
  assert.equal(message.type, 'announcement');
  assert.equal(message.kind, 'redemption');
  assert.equal(message.title, 'Hydrate');
  assert.equal(message.username, 'alice');
  assert.equal(message.detail, 'extra water please');
  assert.equal(message.important, false);

  const long = genericRedemptionAnnouncement({
    rewardTitle: 'Stretch',
    userName: 'bob',
    userInput: 'z'.repeat(300),
  });
  assert.ok(long.detail.length <= ANNOUNCE_MAX_DETAIL);
  assert.equal(long.important, false);
});

test('describePlan turns tmi plan values into readable labels', () => {
  assert.equal(describePlan('Prime'), 'Prime');
  assert.equal(describePlan('1000'), 'Tier 1');
  assert.equal(describePlan('2000'), 'Tier 2');
  assert.equal(describePlan('3000'), 'Tier 3');
  assert.equal(describePlan({ prime: true }), 'Prime');
  assert.equal(describePlan({ plan: '2000' }), 'Tier 2');
  assert.equal(describePlan(''), '');
  assert.equal(describePlan(null), '');
  assert.equal(describePlan('bogus-plan'), 'bogus-plan');
});

test('bits announcement is important with the cheer count', () => {
  const message = bitsAnnouncement('carol', 100, 'take my bits!');
  assert.equal(message.kind, 'bits');
  assert.equal(message.title, '100 bits');
  assert.equal(message.username, 'carol');
  assert.equal(message.detail, 'take my bits!');
  assert.equal(message.important, true);

  const singular = bitsAnnouncement('dave', 1, '');
  assert.equal(singular.title, '1 bit');
  assert.equal(singular.detail, '');
});

test('sub announcements are important with plan detail', () => {
  const fresh = subAnnouncement('erin', 'Prime', 'first sub!');
  assert.equal(fresh.kind, 'sub');
  assert.equal(fresh.title, 'Nuevo SUB');
  assert.equal(fresh.username, 'erin');
  assert.equal(fresh.detail, 'Prime · first sub!');
  assert.equal(fresh.important, true);

  const resub = resubAnnouncement('frank', 5, 'Tier 1', 'half a year');
  assert.equal(resub.title, 'SUB renovado x5');
  assert.equal(resub.username, 'frank');
  assert.ok(resub.detail.includes('Tier 1'));

  const gift = subGiftAnnouncement('grace', 'heidi', 'Tier 1');
  assert.equal(gift.title, 'SUB regalado');
  assert.equal(gift.username, 'grace');
  assert.ok(gift.detail.includes('para heidi'));

  const mystery = mysteryGiftAnnouncement('ivan', 3);
  assert.equal(mystery.title, '3 SUBs regalados');
  assert.equal(mystery.username, 'ivan');
  assert.equal(mystery.important, true);
});

test('generic redemption announcement falls back to Spanish title', () => {
  const message = genericRedemptionAnnouncement({ userName: 'alice' });
  assert.equal(message.title, 'Recompensa canjeada');
});
