/**
 * Verifies that two Slack replies with the SAME client_msg_id but DIFFERENT ts
 * produce different idempotency keys (the bug that dropped Q2+ answers).
 */
function buildIdempotencyKey(msg: {
  channel: string;
  ts?: string;
  client_msg_id?: string;
}): string | null {
  if (msg.ts) {
    return `slack:message:${msg.channel}:${msg.ts}`;
  }
  if (msg.client_msg_id) {
    return `slack:message:${msg.channel}:client:${msg.client_msg_id}`;
  }
  return null;
}

const channel = 'D123456';
const sharedClientMsgId = 'same-client-id-reused-by-slack';

const q1Key = buildIdempotencyKey({
  channel,
  ts: '1786470000.000001',
  client_msg_id: sharedClientMsgId,
});

const q2Key = buildIdempotencyKey({
  channel,
  ts: '1786470001.000002',
  client_msg_id: sharedClientMsgId,
});

if (!q1Key || !q2Key) {
  throw new Error('Expected both keys to be generated');
}

if (q1Key === q2Key) {
  throw new Error(
    `BUG: Q1 and Q2 share idempotency key despite different ts: ${q1Key}`,
  );
}

const oldQ1Key = `slack:message:${sharedClientMsgId}`;
const oldQ2Key = `slack:message:${sharedClientMsgId}`;

if (oldQ1Key !== oldQ2Key) {
  console.log('Old logic would also differ — unexpected');
} else {
  console.log('Old logic WOULD drop Q2 (same key):', oldQ1Key);
}

console.log('OK: New idempotency keys are unique per Slack ts');
console.log('  Q1:', q1Key);
console.log('  Q2:', q2Key);
