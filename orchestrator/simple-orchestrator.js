import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Memory storage for conversations
const conversationMemory = new Map();

// Process message endpoint
app.post('/api/process', async (req, res) => {
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
    
    // Simple response without AI (for testing)
    const response = `I received your message: "${message}". This is a test response from the orchestrator. (AI integration coming soon!)`;
    
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
  console.log(`🚀 Simple Orchestrator server running on port ${port}`);
  console.log(`📊 Active conversations: ${conversationMemory.size}`);
  console.log(`🧠 Simple response mode (no AI yet)`);
});

export default app;
