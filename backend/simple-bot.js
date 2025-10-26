import dotenv from 'dotenv';
dotenv.config();

import bolt from '@slack/bolt';
const { App, LogLevel } = bolt;

const app = new App({
  appToken: process.env.SLACK_APP_TOKEN,
  token: process.env.SLACK_BOT_TOKEN, 
  socketMode: true,
  logLevel: LogLevel.INFO,
});

// Simple app mention handler
app.event('app_mention', async ({ event, client, logger }) => {
  logger.info(`🎉 RECEIVED MENTION from ${event.user} in ${event.channel}`);
  logger.info(`Message: ${event.text}`);
  
  try {
    await client.chat.postMessage({
      channel: event.channel,
      text: `Hello! I received your message: "${event.text}"`
    });
    logger.info('✅ Response sent successfully');
  } catch (error) {
    logger.error('❌ Failed to send response:', error);
  }
});

// Start the app
app.start().then(() => {
  console.log('🚀 Simple bot is running!');
  console.log('Try mentioning your bot in Slack...');
}).catch((error) => {
  console.error('❌ Failed to start bot:', error);
});
