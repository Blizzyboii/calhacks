import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bolt from '@slack/bolt';
const { App, LogLevel } = bolt;

// Initialize Express app
const expressApp = express();
expressApp.use(express.json());

// Initialize Slack app with Socket Mode
const slackApp = new App({
  appToken: process.env.SLACK_APP_TOKEN,
  token: process.env.SLACK_BOT_TOKEN, 
  socketMode: true,
  logLevel: LogLevel.DEBUG, // Enable debug logging
});

// Simple app mention handler
slackApp.event('app_mention', async ({ event, client, logger }) => {
  console.log('🎉 RECEIVED APP MENTION!');
  console.log('User:', event.user);
  console.log('Channel:', event.channel);
  console.log('Text:', event.text);
  
  try {
    await client.chat.postMessage({
      channel: event.channel,
      text: `Hello! I received your message: "${event.text}"`
    });
    console.log('✅ Response sent successfully');
  } catch (error) {
    console.error('❌ Failed to send response:', error);
  }
});

// Health check endpoint
expressApp.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start both apps
async function start() {
  const port = process.env.PORT || 3000;
  
  // Start Express server
  expressApp.listen(port, () => {
    console.log(`Express server running on port ${port}`);
  });
  
  // Start Slack app
  try {
    await slackApp.start();
    console.log('✅ Slack bot is running (Socket Mode)');
    console.log('Try mentioning your bot in Slack...');
  } catch (error) {
    console.error('❌ Failed to start Slack bot:', error);
  }
}

start();
