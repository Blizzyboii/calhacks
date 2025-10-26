import dotenv from 'dotenv';
dotenv.config();

import bolt from '@slack/bolt';
const { App, LogLevel } = bolt;

const app = new App({
  appToken: process.env.SLACK_APP_TOKEN,
  token: process.env.SLACK_BOT_TOKEN, 
  socketMode: true,
  logLevel: LogLevel.DEBUG,
});

console.log('🔍 Testing Slack connection...');
console.log('App Token:', process.env.SLACK_APP_TOKEN ? 'Set' : 'Missing');
console.log('Bot Token:', process.env.SLACK_BOT_TOKEN ? 'Set' : 'Missing');

app.event('app_mention', async ({ event, client, logger }) => {
  console.log('🎉 RECEIVED MENTION:', event);
  console.log('User:', event.user);
  console.log('Channel:', event.channel);
  console.log('Text:', event.text);
});

app.start().then(() => {
  console.log('✅ Slack app started successfully');
  console.log('Now try mentioning your bot in Slack...');
}).catch((error) => {
  console.error('❌ Slack app failed to start:', error);
  process.exit(1);
});
