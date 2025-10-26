import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import bolt from '@slack/bolt';
const { App, LogLevel } = bolt;

// Initialize Express app
const expressApp = express();
expressApp.use(bodyParser.json());
expressApp.use(bodyParser.urlencoded({ extended: true }));

// Initialize Slack app
const slackApp = new App({
  appToken: process.env.SLACK_APP_TOKEN,
  token: process.env.SLACK_BOT_TOKEN, 
  socketMode: true,
  logLevel: LogLevel.INFO,
});

// Orchestrator configuration
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8000';
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY;

// Memory storage for conversation context
const conversationMemory = new Map();

// Function to read messages from a Slack channel
async function readChannelMessages(channelId, limit = 100) {
  try {
    const result = await slackApp.client.conversations.history({
      channel: channelId,
      limit: limit
    });
    return result.messages || [];
  } catch (error) {
    console.error('Error reading channel messages:', error);
    return [];
  }
}

// Function to send message to orchestrator
async function sendToOrchestrator(message, context = {}) {
  try {
    const response = await axios.post(`${ORCHESTRATOR_URL}/api/process`, {
      message: message,
      context: context,
      timestamp: new Date().toISOString()
    }, {
      headers: {
        'Authorization': `Bearer ${ORCHESTRATOR_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error sending to orchestrator:', error);
    return { error: 'Failed to process with orchestrator' };
  }
}

// Function to get orchestrator memory
async function getOrchestratorMemory(conversationId) {
  try {
    const response = await axios.get(`${ORCHESTRATOR_URL}/api/memory/${conversationId}`, {
      headers: {
        'Authorization': `Bearer ${ORCHESTRATOR_API_KEY}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error getting orchestrator memory:', error);
    return null;
  }
}

// Webhook endpoint to receive Slack events
expressApp.post('/slack/events', async (req, res) => {
  const { type, event, challenge } = req.body;
  
  // Handle URL verification
  if (type === 'url_verification') {
    return res.send(challenge);
  }
  
  // Handle event callbacks
  if (type === 'event_callback') {
    console.log('Received Slack event:', event);
    
    // Handle new messages
    if (event.type === 'message' && !event.bot_id) {
      const channelId = event.channel;
      const userId = event.user;
      const messageText = event.text;
      const threadTs = event.thread_ts || event.ts;
      
      // Create conversation ID for memory
      const conversationId = `${channelId}_${threadTs}`;
      
      try {
        // Read recent messages for context
        const recentMessages = await readChannelMessages(channelId, 10);
        
        // Get existing memory from orchestrator
        const memory = await getOrchestratorMemory(conversationId);
        
        // Send to orchestrator for processing
        const orchestratorResponse = await sendToOrchestrator(messageText, {
          channelId,
          userId,
          recentMessages,
          memory,
          conversationId
        });
        
        // Store response in memory
        if (orchestratorResponse.response) {
          conversationMemory.set(conversationId, {
            lastResponse: orchestratorResponse.response,
            timestamp: new Date().toISOString()
          });
          
          // Post response back to Slack
          await slackApp.client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: orchestratorResponse.response
          });
        }
        
      } catch (error) {
        console.error('Error processing message:', error);
      }
    }
  }
  
  res.status(200).send('OK');
});

// Handle app mentions
slackApp.event('app_mention', async ({ event, client, logger }) => {
  console.log(`🎉 RECEIVED APP MENTION from ${event.user} in ${event.channel}`);
  console.log(`Message: ${event.text}`);
  logger.info(`got app_mention from ${event.user} in ${event.channel}`);
  
  try {
    const channelId = event.channel;
    const userId = event.user;
    const messageText = event.text;
    const threadTs = event.thread_ts || event.ts;
    const conversationId = `${channelId}_${threadTs}`;
    
    // Read recent messages for context
    const recentMessages = await readChannelMessages(channelId, 10);
    
    // Get existing memory from orchestrator
    const memory = await getOrchestratorMemory(conversationId);
    
    // Try to send to orchestrator, but fallback if it fails
    try {
      const orchestratorResponse = await sendToOrchestrator(messageText, {
        channelId,
        userId,
        recentMessages,
        memory,
        conversationId
      });
      
      // Post orchestrator response back to Slack
      if (orchestratorResponse.response) {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: orchestratorResponse.response
        });
      } else {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: 'I received your message but had trouble processing it. Please try again.'
        });
      }
    } catch (orchestratorError) {
      console.log('Orchestrator not available, sending simple response');
      // Fallback response when orchestrator is not available
      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: threadTs,
        text: `Hello! I received your message: "${messageText}". (Orchestrator not available - this is a fallback response)`
      });
    }
    
  } catch (error) {
    logger.error('Failed to process mention', error);
    await client.chat.postMessage({
      channel: event.channel,
      text: 'Sorry, I encountered an error processing your request.'
    });
  }
});

// Health check endpoint
expressApp.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Get conversation memory endpoint
expressApp.get('/memory/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  const memory = conversationMemory.get(conversationId);
  res.json({ conversationId, memory });
});

// Start both Express and Slack apps
async function start() {
  const port = process.env.PORT || 3000;
  
  // Start Express server
  expressApp.listen(port, () => {
    console.log(`Express server running on port ${port}`);
  });
  
  // Start Slack app (Socket Mode doesn't need a port)
  try {
    await slackApp.start();
    console.log(`✅ Slack bot is running (Socket Mode)`);
  } catch (error) {
    console.error(`❌ Failed to start Slack bot:`, error);
  }
}

start();

