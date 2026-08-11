/**
 * Quick Slack DM delivery test — run from pulse/backend:
 * npx ts-node scripts/test-slack-dm.ts [slackUserId]
 */
import 'dotenv/config';
import { WebClient } from '@slack/web-api';

async function main() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('SLACK_BOT_TOKEN missing');
    process.exit(1);
  }

  const slackUserId = process.argv[2] || 'U0BLV9YR87J'; // Karam default
  const client = new WebClient(token);

  const auth = await client.auth.test();
  console.log('Bot connected:', auth.user, 'team:', auth.team);

  const open = await client.conversations.open({ users: slackUserId });
  const channelId = open.channel?.id;
  console.log('DM channel:', channelId);

  if (!channelId) {
    console.error('Failed to open DM');
    process.exit(1);
  }

  const msg = await client.chat.postMessage({
    channel: channelId,
    text: '🧪 Pulse DM test — if you see this, chat.postMessage works.',
  });

  console.log('postMessage ok:', msg.ok, 'ts:', msg.ts);
}

main().catch((e) => {
  console.error('Error:', e.data || e.message || e);
  process.exit(1);
});
