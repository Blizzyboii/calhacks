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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Lava API configuration
const LAVA_BASE_URL = process.env.LAVA_BASE_URL || 'https://api.lavapayments.com/v1';
const LAVA_FORWARD_TOKEN = process.env.LAVA_FORWARD_TOKEN;
const LAVA_MODEL = process.env.LAVA_MODEL || 'gpt-4o-mini';

// API URLs for different models
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent';

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

// Function to store message in Letta archival memory with visual context
async function storeInLettaArchival(conversationId, userId, message, timestamp, visualDescription = null) {
  if (!lettaClient || !LETTA_AGENT_ID) {
    console.log('[WARN] Letta not configured, skipping archival storage');
    return;
  }
  
  try {
    let archivalText = `[${timestamp}] User ${userId} in conversation ${conversationId}: ${message}`;
    
    // Add visual description if available
    if (visualDescription) {
      archivalText += `\n[Visual Content Analysis]: ${visualDescription}`;
    }
    
    // Store in agent's memory by sending a message
    await lettaClient.agents.messages.create(LETTA_AGENT_ID, {
      messages: [{
        role: 'user',
        content: `Remember this: ${archivalText}`
      }]
    });
    console.log('[INFO] Stored in Letta memory' + (visualDescription ? ' (with visual context)' : ''));
  } catch (error) {
    console.error('[ERROR] Error storing in Letta:', error.message);
  }
}

// Function to analyze visual content and get description
async function analyzeVisualContent(media) {
  if (!media || !media.hasMedia) {
    return null;
  }
  
  try {
    const hasVideos = media.videos && media.videos.length > 0;
    const hasImages = media.images && media.images.length > 0;
    
    // Build a prompt to analyze the visual content
    let analysisPrompt = 'Analyze this visual content and provide a detailed description: ';
    
    if (hasImages) {
      analysisPrompt += `\nImages (${media.images.length}): ${media.images.map(img => img.url).join(', ')}`;
    }
    
    if (hasVideos) {
      analysisPrompt += `\nVideos (${media.videos.length}): ${media.videos.map(vid => vid.url).join(', ')}`;
    }
    
    // Use vision model to analyze the visual content
    const selectedModel = selectModel(true, hasVideos ? 'video' : 'image');
    const messages = [{
      role: 'user',
      content: analysisPrompt
    }];
    
    const formattedMessages = await formatMessagesForOpenAI(messages, media);
    
    console.log('[INFO] Analyzing visual content with', selectedModel);
    
    // Build Lava forward URL for OpenAI (since we're using gpt-4o)
    const lavaURL = `${LAVA_BASE_URL}/forward?u=${encodeURIComponent(OPENAI_URL)}`;
    
    const response = await axios.post(lavaURL, {
      model: selectedModel,
      messages: [
        { role: 'system', content: 'You are a visual content analyzer. Provide detailed, concise descriptions of images and videos.' },
        ...formattedMessages.map(msg => ({ role: msg.role, content: msg.content }))
      ]
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LAVA_FORWARD_TOKEN}`
      }
    });
    
    const description = response.data.choices[0].message.content;
    console.log('[INFO] Visual analysis complete:', description.substring(0, 100) + '...');
    return description;
    
  } catch (error) {
    console.error('[ERROR] Error analyzing visual content:', error.message);
    return null;
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

// Function to select appropriate model based on content
function selectModel(hasMedia, mediaType) {
  // Use vision-capable models for visual content
  if (hasMedia) {
    // gpt-4o is the latest OpenAI vision model
    return 'gpt-4o';
  }
  // Default to GPT-4o-mini for text-only
  return LAVA_MODEL || 'gpt-4o-mini';
}

// Function to call Lava API with model routing
async function callLavaAPI(messages, systemPrompt, media = null) {
  try {
    // Select appropriate model based on media content
    let selectedModel = LAVA_MODEL;
    let enhancedMessages = messages;
    let targetURL = OPENAI_URL;
    
    if (media && media.hasMedia) {
      const hasVideos = media.videos && media.videos.length > 0;
      const hasImages = media.images && media.images.length > 0;
      
      selectedModel = selectModel(true, hasVideos ? 'video' : 'image');
      console.log(`[INFO] Media detected - routing to ${selectedModel}`);
      
      // Set endpoint based on model
      if (selectedModel.includes('gemini')) {
        targetURL = GEMINI_URL;
      } else if (selectedModel.includes('claude')) {
        targetURL = ANTHROPIC_URL;
      }
    } else {
      console.log(`[INFO] No media detected - using ${selectedModel}`);
    }
    
    // Build Lava forward URL with the target endpoint
    const lavaForwardURL = `${LAVA_BASE_URL}/forward?u=${encodeURIComponent(targetURL)}`;
    
    console.log('[INFO] Calling Lava API:', lavaForwardURL);
    console.log('[INFO] Using Forward Token:', LAVA_FORWARD_TOKEN ? 'Present' : 'Missing');
    console.log('[INFO] Selected Model:', selectedModel);
    
    let requestBody;
    
    // Format request based on model type
    if (selectedModel.includes('claude')) {
      // Claude/Anthropic format
      if (media && media.hasMedia) {
        enhancedMessages = await formatMessagesForClaude(messages, media);
      }
      const cleanMessages = enhancedMessages.map(({ role, content }) => ({ role, content }));
      
      // Claude uses a different format with system as separate field
      const userMessages = cleanMessages.filter(m => m.role === 'user');
      requestBody = {
        model: selectedModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages: userMessages
      };
      console.log('[DEBUG] Sending Claude format to Lava');
    } else if (selectedModel.includes('gemini')) {
      // Gemini API format
      requestBody = await formatMessagesForGemini(messages, systemPrompt, media);
      console.log('[DEBUG] Sending Gemini format to Lava');
    } else {
      // OpenAI format
      if (media && media.hasMedia) {
        enhancedMessages = await formatMessagesForOpenAI(messages, media);
      }
      const cleanMessages = enhancedMessages.map(({ role, content }) => ({ role, content }));
      requestBody = {
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          ...cleanMessages
        ]
      };
      console.log('[DEBUG] Sending OpenAI format to Lava');
    }
    
    // Build headers based on model
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LAVA_FORWARD_TOKEN}`
    };
    
    // Claude requires anthropic-version header
    if (selectedModel.includes('claude')) {
      headers['anthropic-version'] = '2023-06-01';
    }
    
    const response = await axios.post(lavaForwardURL, requestBody, { headers });
    
    // Log Lava request ID for tracking
    const requestId = response.headers['x-lava-request-id'];
    if (requestId) {
      console.log('[INFO] Lava request ID:', requestId);
    }
    
    // Parse response based on model type
    if (selectedModel.includes('claude')) {
      // Claude/Anthropic response format
      return response.data.content[0].text;
    } else if (selectedModel.includes('gemini')) {
      // Gemini response format
      return response.data.candidates[0].content.parts[0].text;
    } else {
      // OpenAI response format
      return response.data.choices[0].message.content;
    }
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

// Function to download Slack image and convert to base64
async function downloadSlackImage(url, slackToken) {
  try {
    console.log(`[DEBUG] Downloading from URL: ${url}`);
    
    // Try adding token as query parameter (some Slack endpoints support this)
    const urlWithToken = `${url}${url.includes('?') ? '&' : '?'}t=${slackToken}`;
    
    const response = await axios.get(urlWithToken, {
      headers: {
        'Authorization': `Bearer ${slackToken}`,
        'User-Agent': 'Mozilla/5.0'
      },
      responseType: 'arraybuffer',
      maxRedirects: 5,
      validateStatus: (status) => status < 400
    });
    
    const contentType = response.headers['content-type'];
    console.log(`[DEBUG] Response content-type: ${contentType}`);
    console.log(`[DEBUG] Response size: ${response.data.length} bytes`);
    
    // Check if we got HTML instead of an image
    if (contentType && contentType.includes('text/html')) {
      console.error('[ERROR] Received HTML instead of image - auth may have failed');
      const htmlPreview = Buffer.from(response.data).toString('utf-8').substring(0, 200);
      console.error(`[ERROR] HTML preview: ${htmlPreview}`);
      return null;
    }
    
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    let mimeType = contentType || 'image/png';
    
    // Ensure mime type is in supported format
    if (!mimeType.includes('image/')) {
      console.warn(`[WARN] Unexpected MIME type: ${mimeType}, defaulting to image/png`);
      mimeType = 'image/png';
    }
    
    // Normalize mime types
    if (mimeType.includes('jpg')) {
      mimeType = 'image/jpeg';
    }
    
    console.log(`[INFO] Image MIME type: ${mimeType}`);
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('[ERROR] Failed to download Slack image:', error.message);
    if (error.response) {
      console.error(`[ERROR] Response status: ${error.response.status}`);
      console.error(`[ERROR] Response headers:`, error.response.headers);
    }
    return null;
  }
}

// Function to format messages for OpenAI vision format
async function formatMessagesForOpenAI(messages, media) {
  const formattedMessages = [...messages];
  
  if (formattedMessages.length > 0) {
    const lastMessage = formattedMessages[formattedMessages.length - 1];
    
    // Convert content to array format for multimodal
    const contentParts = [
      { type: 'text', text: lastMessage.content }
    ];
    
    // Add images
    if (media.images && media.images.length > 0) {
      for (const img of media.images) {
        let imageUrl = img.url;
        
        console.log(`[DEBUG] Image URL: ${imageUrl}`);
        console.log(`[DEBUG] Has slackToken: ${!!img.slackToken}`);
        console.log(`[DEBUG] Is Slack URL: ${imageUrl.includes('slack.com')}`);
        
        // If this is a Slack private URL, download and convert to base64
        if (img.slackToken && imageUrl.includes('slack.com')) {
          console.log('[INFO] Downloading Slack image for base64 conversion...');
          const base64Url = await downloadSlackImage(imageUrl, img.slackToken);
          if (base64Url) {
            imageUrl = base64Url;
            console.log('[INFO] Converted Slack image to base64');
          } else {
            console.warn('[WARN] Failed to download/convert image, skipping');
            continue; // Skip this image
          }
        }
        
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: imageUrl,
            detail: 'high'
          }
        });
        console.log(`[DEBUG] Image URL format: ${imageUrl.substring(0, 50)}...`);
      }
      console.log(`[INFO] Added ${media.images.length} images to message content`);
    }
    
    // Replace simple string content with structured content array
    lastMessage.content = contentParts;
  }
  
  return formattedMessages;
}

// Function to format messages for Claude/Anthropic vision format
async function formatMessagesForClaude(messages, media) {
  const formattedMessages = [...messages];
  
  if (formattedMessages.length > 0) {
    const lastMessage = formattedMessages[formattedMessages.length - 1];
    
    // Convert content to array format for multimodal
    const contentParts = [
      { type: 'text', text: lastMessage.content }
    ];
    
    // Add images in Claude format
    if (media.images && media.images.length > 0) {
      for (const img of media.images) {
        // Download and convert Slack images to base64
        if (img.slackToken && img.url.includes('slack.com')) {
          console.log('[INFO] Downloading Slack image for Claude...');
          const base64Url = await downloadSlackImage(img.url, img.slackToken);
          if (base64Url) {
            // Extract base64 data from data URL
            const base64Match = base64Url.match(/^data:image\/(\w+);base64,(.+)$/);
            if (base64Match) {
              contentParts.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: `image/${base64Match[1]}`,
                  data: base64Match[2]
                }
              });
              console.log('[INFO] Added image to Claude request');
            }
          }
        }
      }
    }
    
    // Replace simple string content with structured content array
    lastMessage.content = contentParts;
  }
  
  return formattedMessages;
}

// Function to format messages for Gemini API format
async function formatMessagesForGemini(messages, systemPrompt, media) {
  const parts = [];
  
  // Add system prompt as text
  if (systemPrompt) {
    parts.push({ text: systemPrompt });
  }
  
  // Add user message
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    parts.push({ text: lastMessage.content });
  }
  
  // Add images
  if (media && media.images && media.images.length > 0) {
    for (const img of media.images) {
      let imageUrl = img.url;
      
      // Download and convert Slack images to base64
      if (img.slackToken && imageUrl.includes('slack.com')) {
        console.log('[INFO] Downloading Slack image for Gemini...');
        const base64Url = await downloadSlackImage(imageUrl, img.slackToken);
        if (base64Url) {
          // Extract base64 data from data URL
          const base64Match = base64Url.match(/^data:image\/(\w+);base64,(.+)$/);
          if (base64Match) {
            parts.push({
              inline_data: {
                mime_type: `image/${base64Match[1]}`,
                data: base64Match[2]
              }
            });
            console.log('[INFO] Added image to Gemini request');
          }
        }
      }
    }
  }
  
  return {
    contents: [{
      parts: parts
    }]
  };
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
    
    // Log media data if present
    if (context.media) {
      console.log('[DEBUG] Media received:', JSON.stringify(context.media, null, 2));
    }
    
    // Get conversation memory
    const conversationId = context.conversationId;
    // Get existing memory from orchestrator
    const memory = await getOrchestratorMemory(conversationId);
    
    // Add new message to memory
    const newMemory = [
      ...memory,
      {
        role: 'user',
        content: message,
        timestamp: timestamp
      }
    ];
    
    // Keep only last 10 messages to avoid token limits
    const recentMemory = newMemory.slice(-10);
    
    // Extract media information from context
    const media = context.media;
    
    // Analyze visual content if present
    let visualDescription = null;
    if (media && media.hasMedia) {
      console.log('[INFO] Visual content detected, analyzing...');
      visualDescription = await analyzeVisualContent(media);
    }
    
    // Store message in Letta archival memory with visual description
    await storeInLettaArchival(conversationId, context.userId, message, timestamp, visualDescription);
    
    // Query Letta for relevant context
    const lettaContext = await queryLettaContext(message, 5);
    
    // Build system prompt with Letta context and media awareness
    let systemPrompt = `You are a helpful AI assistant integrated with Slack. 
    You have access to conversation history and can help users with questions and tasks.
    Be friendly, helpful, and concise in your responses.`;
    
    if (media && media.hasMedia) {
      systemPrompt += `\n\nNote: This message contains visual content (${media.images?.length || 0} images, ${media.videos?.length || 0} videos). Analyze the visual content and provide insights.`;
    }
    
    if (lettaContext.length > 0) {
      systemPrompt += `\n\nRelevant context from past conversations:\n${lettaContext.join('\n')}`;
      console.log('[INFO] Added Letta context to system prompt');
    }
    
    const response = await callLavaAPI(recentMemory, systemPrompt, media);
    
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
  console.log(`[INFO] Lava Base URL: ${LAVA_BASE_URL}`);
  console.log(`[INFO] Token present: ${LAVA_FORWARD_TOKEN ? 'Yes' : 'No'}`);
});

export default app;
