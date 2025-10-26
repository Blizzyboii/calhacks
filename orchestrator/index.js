import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';

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

// Check if API key is provided
if (!LAVA_FORWARD_TOKEN) {
  console.warn('⚠️  LAVA_FORWARD_TOKEN not found in environment variables');
}

// Memory storage for conversations
const conversationMemory = new Map();

// Function to call Lava API
async function callLavaAPI(messages, systemPrompt) {
  try {
    console.log('🔥 Calling Lava API:', LAVA_API_URL);
    console.log('🔑 Using Forward Token:', LAVA_FORWARD_TOKEN ? 'Present' : 'Missing');
    
    // Filter out timestamp field - OpenAI API only accepts role and content
    const cleanMessages = messages.map(({ role, content }) => ({ role, content }));
    
    console.log('📤 Sending to Lava:', JSON.stringify({
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
      console.log('📊 Lava request ID:', requestId);
    }
    
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('❌ Lava API Error:', error.response?.data || error.message);
    console.error('❌ Full error:', {
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
  console.log('🔔 POST /api/process called');
  console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { message, context, timestamp } = req.body;
    
    console.log('📨 Received message:', message);
    console.log('📊 Context:', {
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
    
    // Process with Lava API
    const systemPrompt = `You are a helpful AI assistant integrated with Slack. 
    You have access to conversation history and can help users with questions and tasks.
    Be friendly, helpful, and concise in your responses.`;
    
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
    
    console.log('✅ Response generated:', response);
    
    res.json({
      response: response,
      memory: updatedMemory,
      conversationId: conversationId
    });
    
  } catch (error) {
    console.error('❌ Error processing message:', error);
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
    console.error('❌ Error getting memory:', error);
    res.status(500).json({
      error: 'Failed to get memory',
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
  console.log(`🚀 Orchestrator server running on port ${port}`);
  console.log(`📊 Active conversations: ${conversationMemory.size}`);
  console.log(`🔥 Using Lava API for AI processing`);
  console.log(`🌐 Lava API URL: ${LAVA_API_URL}`);
  console.log(`🔑 Token present: ${LAVA_FORWARD_TOKEN ? 'Yes' : 'No'}`);
});

export default app;
