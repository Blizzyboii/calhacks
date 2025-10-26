import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { LettaClient } from '@letta-ai/letta-client';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Lava API configuration
const LAVA_BASE_URL = process.env.LAVA_BASE_URL || 'https://api.lavapayments.com/v1';
const LAVA_FORWARD_TOKEN = process.env.LAVA_FORWARD_TOKEN;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const LAVA_API_URL = `${LAVA_BASE_URL}/forward?u=https://api.openai.com/v1/chat/completions`;
const LAVA_MODEL = process.env.LAVA_MODEL || 'gpt-4o-mini';

// Letta configuration
const LETTA_BASE_URL = process.env.LETTA_BASE_URL || 'https://api.letta.com';
const LETTA_API_KEY = process.env.LETTA_API_KEY;
const LETTA_AGENT_ID = process.env.LETTA_AGENT_ID;

// Initialize Letta client
let lettaClient = null;
if (LETTA_API_KEY) {
  lettaClient = new LettaClient({
    token: LETTA_API_KEY,
    baseURL: LETTA_BASE_URL
  });
  console.log('[INFO] Letta client initialized');
  if (!LETTA_AGENT_ID) {
    console.warn('[WARN] LETTA_AGENT_ID not found - Letta will not work without an agent ID!');
  } else {
    console.log(`[INFO] Letta Agent ID: ${LETTA_AGENT_ID}`);
  }
} else {
  console.warn('[WARN] LETTA_API_KEY not found - Letta integration disabled');
}

// Check if API key is provided
if (!LAVA_FORWARD_TOKEN) {
  console.warn('[WARN] LAVA_FORWARD_TOKEN not found in environment variables');
}

// Memory storage for conversations
const conversationMemory = new Map();

// Function to store message in Letta archival memory
async function storeInLettaArchival(conversationId, userId, message, timestamp) {
  if (!lettaClient || !LETTA_AGENT_ID) {
    console.log('[WARN] Letta not configured, skipping archival storage');
    return;
  }
  
  try {
    const archivalText = `[${timestamp}] User ${userId} in conversation ${conversationId}: ${message}`;
    // Store in agent's memory by sending a message
    await lettaClient.agents.messages.create(LETTA_AGENT_ID, {
      messages: [{
        role: 'user',
        content: `Remember this: ${archivalText}`
      }]
    });
    console.log('[INFO] Stored in Letta memory');
  } catch (error) {
    console.error('[ERROR] Error storing in Letta:', error.message);
  }
}

// Function to query Letta for relevant context
async function queryLettaContext(query, limit = 5) {
  if (!lettaClient || !LETTA_AGENT_ID) {
    console.log('[WARN] Letta not configured, skipping context retrieval');
    return [];
  }
  
  try {
    // Query the agent's memory by asking what it remembers
    const response = await lettaClient.agents.messages.create(LETTA_AGENT_ID, {
      messages: [{
        role: 'user',
        content: `Based on what you remember, ${query}`
      }]
    });
    
    // Extract relevant context from agent's response
    const context = [];
    if (response.messages) {
      for (const msg of response.messages) {
        if (msg.messageType === 'assistant_message' && msg.content) {
          context.push(msg.content);
        }
      }
    }
    
    if (context.length > 0) {
      console.log(`[INFO] Retrieved context from Letta: ${context.join(' ')}`);
      return context;
    }
    return [];
  } catch (error) {
    console.error('[ERROR] Error querying Letta context:', error.message);
    return [];
  }
}

// Function to call Lava API
async function callLavaAPI(messages, systemPrompt) {
  try {
    console.log('[INFO] Calling Lava API:', LAVA_API_URL);
    console.log('[INFO] Using Forward Token:', LAVA_FORWARD_TOKEN ? 'Present' : 'Missing');
    
    // Filter out timestamp field - OpenAI API only accepts role and content
    const cleanMessages = messages.map(({ role, content }) => ({ role, content }));
    
    console.log('[DEBUG] Sending to Lava:', JSON.stringify({
      model: LAVA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...cleanMessages
      ]
    }, null, 2));
    
    const response = await axios.post(LAVA_API_URL, {
      model: LAVA_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...cleanMessages
      ]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LAVA_FORWARD_TOKEN}`
      }
    });
    
    // Log Lava request ID for tracking
    const requestId = response.headers['x-lava-request-id'];
    if (requestId) {
      console.log('[INFO] Lava request ID:', requestId);
    }
    
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('[ERROR] Lava API Error:', error.response?.data || error.message);
    console.error('[ERROR] Full error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    throw new Error('Failed to get response from Lava API');
  }
}

// Process message endpoint
app.post('/api/process', async (req, res) => {
  console.log('[INFO] POST /api/process called');
  console.log('[DEBUG] Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { message, context, timestamp } = req.body;
    
    console.log('[INFO] Received message:', message);
    console.log('[DEBUG] Context:', {
      channelId: context.channelId,
      userId: context.userId,
      conversationId: context.conversationId
    });
    
    // Get conversation memory
    const conversationId = context.conversationId;
    const existingMemory = conversationMemory.get(conversationId) || [];
    
    // Add new message to memory
    const newMemory = [
      ...existingMemory,
      {
        role: 'user',
        content: message,
        timestamp: timestamp
      }
    ];
    
    // Keep only last 10 messages to avoid token limits
    const recentMemory = newMemory.slice(-10);
    
    // Store message in Letta archival memory
    await storeInLettaArchival(conversationId, context.userId, message, timestamp);
    
    // Query Letta for relevant context
    const lettaContext = await queryLettaContext(message, 5);
    
    // Build system prompt with Letta context
    let systemPrompt = `You are a helpful AI assistant integrated with Slack. 
    You have access to conversation history and can help users with questions and tasks.
    Be friendly, helpful, and concise in your responses.`;
    
    if (lettaContext.length > 0) {
      systemPrompt += `\n\nRelevant context from past conversations:\n${lettaContext.join('\n')}`;
      console.log('[INFO] Added Letta context to system prompt');
    }
    
    const response = await callLavaAPI(recentMemory, systemPrompt);
    
    // Add assistant response to memory
    const updatedMemory = [
      ...recentMemory,
      {
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString()
      }
    ];
    
    // Store updated memory
    conversationMemory.set(conversationId, updatedMemory);
    
    console.log('[INFO] Response generated:', response);
    
    res.json({
      response: response,
      memory: updatedMemory,
      conversationId: conversationId
    });
    
  } catch (error) {
    console.error('[ERROR] Error processing message:', error);
    res.status(500).json({
      error: 'Failed to process message',
      details: error.message
    });
  }
});

// Get conversation memory endpoint
app.get('/api/memory/:conversationId', (req, res) => {
  try {
    const { conversationId } = req.params;
    const memory = conversationMemory.get(conversationId) || [];
    
    res.json({
      conversationId,
      memory,
      messageCount: memory.length
    });
  } catch (error) {
    console.error('[ERROR] Error getting memory:', error);
    res.status(500).json({
      error: 'Failed to get memory',
      details: error.message
    });
  }
});

// Store message in Letta only (no response generation)
app.post('/api/store', async (req, res) => {
  try {
    const { message, context, timestamp } = req.body;
    
    console.log('[INFO] Storing message:', message);
    
    // Store message in Letta archival memory
    await storeInLettaArchival(
      context.conversationId || context.channelId,
      context.userId,
      message,
      timestamp
    );
    
    res.json({
      success: true,
      message: 'Stored in Letta archival memory'
    });
    
  } catch (error) {
    console.error('[ERROR] Error storing message:', error);
    res.status(500).json({
      error: 'Failed to store message',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    activeConversations: conversationMemory.size
  });
});

// Start server
app.listen(port, () => {
  console.log(`[INFO] Orchestrator server running on port ${port}`);
  console.log(`[INFO] Active conversations: ${conversationMemory.size}`);
  console.log(`[INFO] Using Lava API for AI processing`);
  console.log(`[INFO] Lava API URL: ${LAVA_API_URL}`);
  console.log(`[INFO] Token present: ${LAVA_FORWARD_TOKEN ? 'Yes' : 'No'}`);
});

export default app;
