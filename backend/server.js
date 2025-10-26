import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import bolt from '@slack/bolt';
const { App, LogLevel } = bolt;
import { getRecentCommits, createIssue } from './github-api.js';

// Verify token is loaded
console.log('[INFO] SLACK_BOT_TOKEN loaded:', process.env.SLACK_BOT_TOKEN ? 'Yes' : 'No');

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
async function sendToOrchestrator(message, context = {}, storeOnly = false) {
  try {
    const endpoint = storeOnly ? '/api/store' : '/api/process';
    console.log(`[DEBUG] Calling orchestrator: ${ORCHESTRATOR_URL}${endpoint}`);
    const response = await axios.post(`${ORCHESTRATOR_URL}${endpoint}`, {
      message: message,
      context: context,
      timestamp: context.timestamp || new Date().toISOString()
    }, {
      headers: {
        'Authorization': `Bearer ${ORCHESTRATOR_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[DEBUG] Orchestrator responded with status: ${response.status}`);
    return response.data;
  } catch (error) {
    console.error('[ERROR] Error sending to orchestrator:', error.message);
    console.error('[ERROR] Full error:', error.response?.data || error);
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

// Helper function to extract and parse URLs from text
async function extractLinksContent(text) {
  // Slack wraps URLs in <>, so we need to handle both formats
  const urlRegex = /<?(https?:\/\/[^\s<>|]+)[|>]?/g;
  const matches = [...text.matchAll(urlRegex)];
  const urls = matches.map(match => match[1]);
  const extractedContent = [];
  
  for (const url of urls) {
    try {
      console.log(`[INFO] Extracting content from: ${url}`);
      
      // Check if it's a Google Doc
      if (url.includes('docs.google.com')) {
        // Convert to export URL for plain text
        const docId = url.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
        if (docId) {
          const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
          const response = await axios.get(exportUrl, { timeout: 10000 });
          extractedContent.push({
            url,
            type: 'google_doc',
            content: response.data,
            title: 'Google Doc'
          });
          console.log(`[SUCCESS] Extracted Google Doc content (${response.data.length} chars)`);
        }
      }
      // Check if it's a Notion page
      else if (url.includes('notion.so') || url.includes('notion.site')) {
        // Notion requires API key, so we'll use a web scraper approach
        const response = await axios.get(url, { 
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        // Basic HTML text extraction (you may want to use cheerio for better parsing)
        const text = response.data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        extractedContent.push({
          url,
          type: 'notion',
          content: text.substring(0, 5000), // Limit to 5000 chars
          title: 'Notion Page'
        });
        console.log(`[SUCCESS] Extracted Notion content (${text.length} chars)`);
      }
      // General web page
      else {
        const response = await axios.get(url, { 
          timeout: 10000,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const text = response.data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        extractedContent.push({
          url,
          type: 'webpage',
          content: text.substring(0, 3000), // Limit to 3000 chars
          title: 'Web Page'
        });
        console.log(`[SUCCESS] Extracted web content (${text.length} chars)`);
      }
    } catch (err) {
      console.error(`[ERROR] Failed to extract from ${url}: ${err.message}`);
    }
  }
  
  return extractedContent;
}

// Function to detect and extract media from Slack message
async function extractMediaFromMessage(message, slackClient = null) {
  const media = {
    hasMedia: false,
    images: [],
    videos: [],
    files: []
  };
  
  // Check for files attached to message
  if (message.files && message.files.length > 0) {
    for (const file of message.files) {
      const fileType = file.mimetype || '';
      
      if (fileType.startsWith('image/')) {
        try {
          console.log(`[INFO] Processing image: ${file.name}, ID: ${file.id}`);
          
          // Use Slack's files.info API (now we have files:read scope!)
          const fileInfo = await slackClient.files.info({
            file: file.id
          });
          
          console.log(`[DEBUG] File info retrieved, downloading...`);
          
          // Try URLs in order
          const urls = [
            fileInfo.file.url_private_download,
            fileInfo.file.url_private,
            file.url_private_download,
            file.url_private
          ].filter(Boolean);
          
          let imageData = null;
          let finalContentType = null;
          
          for (const url of urls) {
            try {
              console.log(`[DEBUG] Trying: ${url.substring(0, 50)}...`);
              const response = await axios.get(url, {
                headers: {
                  'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`
                },
                responseType: 'arraybuffer',
                timeout: 10000
              });
              
              const ct = response.headers['content-type'];
              if (ct && ct.startsWith('image/')) {
                imageData = response.data;
                finalContentType = ct;
                console.log(`[SUCCESS] ✓ Downloaded ${imageData.length} bytes`);
                break;
              }
            } catch (err) {
              console.log(`[WARN] Failed: ${err.message}`);
            }
          }
          
          if (!imageData) {
            throw new Error('All URLs failed');
          }
          
          const base64 = Buffer.from(imageData).toString('base64');
          const dataUrl = `data:${finalContentType};base64,${base64}`;
          
          media.images.push({
            url: dataUrl,
            name: file.name,
            mimetype: finalContentType,
            title: file.title
          });
          console.log(`[SUCCESS] ✓✓✓ Image ready: ${file.name}`);
          media.hasMedia = true;
        } catch (err) {
          console.error(`[ERROR] Image failed: ${err.message}`);
        }
      } else if (fileType.startsWith('video/')) {
        media.videos.push({
          url: file.url_private || file.permalink,
          name: file.name,
          mimetype: file.mimetype,
          title: file.title,
          slackToken: process.env.SLACK_BOT_TOKEN // Add token for auth
        });
        media.hasMedia = true;
      } else {
        media.files.push({
          url: file.url_private || file.permalink,
          name: file.name,
          mimetype: file.mimetype,
          title: file.title
        });
      }
    }
  }
  
  // Check for image URLs in text (common image hosting patterns)
  if (message.text) {
    const imageUrlPatterns = [
      /https?:\/\/.*\.(jpg|jpeg|png|gif|webp|bmp|svg)/gi,
      /https?:\/\/(i\.)?imgur\.com\/\w+/gi,
      /https?:\/\/.*giphy\.com\/.*\.gif/gi
    ];
    
    for (const pattern of imageUrlPatterns) {
      const matches = message.text.match(pattern);
      if (matches) {
        matches.forEach(url => {
          media.images.push({ url, source: 'text_link' });
          media.hasMedia = true;
        });
      }
    }
    
    // Check for video URLs
    const videoUrlPatterns = [
      /https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+/gi,
      /https?:\/\/(www\.)?vimeo\.com\/\d+/gi,
      /https?:\/\/.*\.(mp4|webm|mov|avi)/gi
    ];
    
    for (const pattern of videoUrlPatterns) {
      const matches = message.text.match(pattern);
      if (matches) {
        matches.forEach(url => {
          media.videos.push({ url, source: 'text_link' });
          media.hasMedia = true;
        });
      }
    }
  }
  
  return media;
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

// Store recent files per channel (for quick lookup)
const recentFiles = new Map(); // channelId -> [{file, timestamp}]

// Listen for file uploads
slackApp.event('file_shared', async ({ event, client }) => {
  console.log(`[INFO] File shared in channel ${event.channel_id}`);
  
  try {
    // Get file info
    const result = await client.files.info({
      file: event.file_id
    });
    
    const file = result.file;
    console.log(`[INFO] File details: ${file.name} (${file.mimetype})`);
    
    // If it's an image, download and analyze it immediately
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      console.log(`[INFO] Image detected, analyzing immediately...`);
      
      try {
        const fileInfo = await client.files.info({ file: file.id });
        const urls = [
          fileInfo.file.url_private_download,
          fileInfo.file.url_private
        ].filter(Boolean);
        
        let imageData = null;
        for (const url of urls) {
          try {
            const response = await axios.get(url, {
              headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}` },
              responseType: 'arraybuffer',
              timeout: 10000
            });
            
            if (response.headers['content-type']?.startsWith('image/')) {
              imageData = response.data;
              break;
            }
          } catch (err) {
            continue;
          }
        }
        
        if (imageData) {
          const base64 = Buffer.from(imageData).toString('base64');
          const dataUrl = `data:${file.mimetype};base64,${base64}`;
          
          // Send to orchestrator for immediate analysis
          const analysisResult = await sendToOrchestrator(`Analyze this image: ${file.name}`, {
            channelId: event.channel_id,
            userId: event.user_id,
            conversationId: event.channel_id,
            media: {
              hasMedia: true,
              images: [{ url: dataUrl, name: file.name, mimetype: file.mimetype }],
              videos: [],
              files: []
            }
          });
          
          console.log(`[SUCCESS] Image analyzed and stored: ${file.name}`);
          
          // Store the description in Letta for future reference
          await sendToOrchestrator(`Image "${file.name}" was uploaded. Description: ${analysisResult.response}`, {
            channelId: event.channel_id,
            userId: event.user_id,
            conversationId: event.channel_id,
            timestamp: new Date().toISOString()
          }, true);
          
          console.log(`[SUCCESS] Image description stored in Letta`);
        }
      } catch (analyzeErr) {
        console.error(`[ERROR] Failed to analyze image: ${analyzeErr.message}`);
      }
    }
    
    // Store file reference with timestamp
    const channelId = event.channel_id;
    if (!recentFiles.has(channelId)) {
      recentFiles.set(channelId, []);
    }
    
    const channelFilesList = recentFiles.get(channelId);
    channelFilesList.unshift({
      file: file,
      timestamp: Date.now()
    });
    
    // Keep only last 5 files per channel
    if (channelFilesList.length > 5) {
      channelFilesList.pop();
    }
    
    console.log(`[INFO] Stored file reference for channel ${channelId}`);
  } catch (error) {
    console.error('Error handling file_shared event:', error);
  }
});

// Listen to all messages in channels (for storing in Letta)
slackApp.event('message', async ({ event, client, logger }) => {
  // Ignore bot messages and message changes/deletes
  if (event.subtype || event.bot_id) {
    return;
  }
  
  console.log(`[INFO] Message in channel ${event.channel}: ${event.text}`);
  
  try {
    // Store all messages in Letta for context
    await sendToOrchestrator(event.text, {
      channelId: event.channel,
      userId: event.user,
      conversationId: event.channel,
      timestamp: new Date(parseFloat(event.ts) * 1000).toISOString()
    }, true); // true = store only, don't generate response
  } catch (error) {
    console.error('Error storing message in Letta:', error.message);
  }
});

// Handle app mentions
slackApp.event('app_mention', async ({ event, client, logger }) => {
  console.log(`[INFO] RECEIVED APP MENTION from ${event.user} in ${event.channel}`);
  console.log(`[INFO] Message: ${event.text}`);
  console.log(`[DEBUG] Event has files:`, event.files ? `Yes (${event.files.length})` : 'No');
  logger.info(`got app_mention from ${event.user} in ${event.channel}`);
  
  try {
    const channelId = event.channel;
    const userId = event.user;
    let messageText = event.text; // Changed to 'let' so we can modify it
    const threadTs = event.thread_ts || event.ts;
    const conversationId = `${channelId}_${threadTs}`;
    
    // Read recent messages for context (reduced from 100 to 20 for faster processing)
    const recentMessages = await readChannelMessages(channelId, 20);
    
    // Check if the question is about visual content
    const isVisualQuery = /\b(image|picture|photo|screenshot|show|see|look|visual|what'?s in|describe|analyze)\b/i.test(messageText);
    console.log(`[DEBUG] Is visual query: ${isVisualQuery}`);
    
    // Detect media - only if it's a visual query
    let media = { hasMedia: false, images: [], videos: [], files: [] };
    
    if (isVisualQuery) {
      media = await extractMediaFromMessage(event, client);
      
      if (!media.hasMedia) {
        // Check if there are recent files uploaded to this channel
        const channelFiles = recentFiles.get(channelId);
        if (channelFiles && channelFiles.length > 0) {
          console.log(`[INFO] Checking ${channelFiles.length} recent files in channel...`);
          
          // Use the most recent file (within last 2 minutes)
          const recentFile = channelFiles[0];
          const fileAge = Date.now() - recentFile.timestamp;
          
          if (fileAge < 120000) { // 2 minutes
            const file = recentFile.file;
            const fileType = file.mimetype || '';
            
            media = { hasMedia: true, images: [], videos: [], files: [] };
            
            if (fileType.startsWith('image/')) {
              // For Slack private URLs, we need to provide the public URL or download it
              // Use url_private_download which is more reliable
              const imageData = {
                url: file.url_private_download || file.url_private,
                name: file.name,
                mimetype: file.mimetype,
                title: file.title,
                slackToken: process.env.SLACK_BOT_TOKEN // Pass token for auth
              };
              media.images.push(imageData);
              console.log(`[INFO] Using recent file: ${file.name} (image)`);
              console.log(`[DEBUG] Image slackToken present: ${!!imageData.slackToken}`);
            } else if (fileType.startsWith('video/')) {
              media.videos.push({
                url: file.url_private,
                name: file.name,
                mimetype: file.mimetype,
                title: file.title
              });
              console.log(`[INFO] Using recent file: ${file.name} (video)`);
            }
          }
        }
      }
      
      // Fallback: check recent messages if still no media
      if (!media.hasMedia && recentMessages.length > 0) {
        console.log('[INFO] No recent files, checking recent messages...');
        for (let i = 0; i < Math.min(5, recentMessages.length); i++) {
          const msg = recentMessages[i];
          const msgMedia = await extractMediaFromMessage(msg, client);
          if (msgMedia.hasMedia) {
            media = msgMedia;
            console.log(`[INFO] Found media in recent message: ${media.images.length} images, ${media.videos.length} videos`);
            break;
          }
        }
      }
    } else {
      console.log('[INFO] Not a visual query, skipping image processing');
    }
    
    if (media.hasMedia) {
      console.log(`[INFO] Final media count: ${media.images.length} images, ${media.videos.length} videos`);
    }
    
    // Extract content from any links in the CURRENT message only
    const linkContent = await extractLinksContent(messageText);
    
    if (linkContent.length > 0) {
      console.log(`[INFO] Found ${linkContent.length} links in current message`);
      
      // Store each link's content in Letta for future reference
      for (const link of linkContent) {
        await sendToOrchestrator(
          `Document from ${link.url}: ${link.content}`,
          {
            channelId,
            userId,
            conversationId,
            timestamp: new Date().toISOString()
          },
          true // Store only, don't respond
        ).catch(err => console.error(`[ERROR] Failed to store link content: ${err.message}`));
      }
      console.log(`[SUCCESS] Stored ${linkContent.length} link contents in Letta`);
    }
    
    // Store all recent messages in Letta asynchronously (don't block response)
    console.log(`[INFO] Storing ${recentMessages.length} recent messages in Letta (async)...`);
    Promise.all(
      recentMessages
        .filter(msg => !msg.bot_id && msg.text)
        .slice(0, 10) // Only store last 10 for faster processing
        .map(msg => 
          sendToOrchestrator(msg.text, {
            channelId: channelId,
            userId: msg.user,
            conversationId: channelId,
            timestamp: new Date(parseFloat(msg.ts) * 1000).toISOString()
          }, true).catch(e => {}) // Ignore errors
        )
    ).then(() => console.log(`[INFO] Finished storing recent messages`));
    
    // Get existing memory from orchestrator
    const memory = await getOrchestratorMemory(conversationId);
    
    // Check if user is asking for GitHub features - CHECK ISSUE CREATION FIRST
    const isCreateIssue = /\b(create|file|open|make|add|new).*(issue|bug|ticket)\b/i.test(messageText);
    const isCommitSummary = /\b(commits?|standup|what did (i|we) (do|change|work on)|daily update|progress)\b/i.test(messageText);
    
    console.log(`[DEBUG] isCommitSummary: ${isCommitSummary}, isCreateIssue: ${isCreateIssue}`);
    console.log(`[DEBUG] GITHUB_TOKEN present: ${process.env.GITHUB_TOKEN ? 'YES' : 'NO'}`);
    
    // Handle issue creation FIRST (more specific)
    if (isCreateIssue && process.env.GITHUB_TOKEN) {
      try {
        console.log('[INFO] Creating GitHub issue...');
        const issueTitle = messageText.replace(/<@[A-Z0-9]+>/g, '').replace(/\b(create|file|open|make|add|new)\b/i, '').replace(/\b(an?|the)?\s*(issue|bug|ticket)\b/i, '').replace(/\b(for|about|regarding)\b/i, '').trim();
        
        // If title is empty or too short, use a default
        const finalTitle = (!issueTitle || issueTitle.length < 3) ? 'New issue from Slack' : issueTitle;
        
        const issue = await createIssue(
          process.env.GITHUB_OWNER || 'Blizzyboii',
          process.env.GITHUB_REPO || 'calhacks',
          process.env.GITHUB_TOKEN,
          finalTitle,
          `Created from Slack by <@${userId}>\n\nOriginal message: ${messageText}`,
          ['from-slack']
        );
        
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: `✅ *Issue Created!*\n\n*#${issue.number}: ${issue.title}*\n${issue.url}`
        });
        console.log('[SUCCESS] Created GitHub issue');
        return; // Done - skip orchestrator
      } catch (err) {
        console.error('[ERROR] GitHub issue creation failed:', err.message);
        // Fall through to orchestrator
      }
    }
    
    // Handle commit summary
    if (isCommitSummary && process.env.GITHUB_TOKEN) {
      try {
        console.log('[INFO] Fetching commits from GitHub API...');
        const commits = await getRecentCommits(
          process.env.GITHUB_OWNER || 'Blizzyboii',
          process.env.GITHUB_REPO || 'calhacks',
          process.env.GITHUB_TOKEN,
          3
        );
        
        let summary = `📊 *Daily Standup - Last 3 Commits*\n\n`;
        commits.forEach((commit, i) => {
          summary += `${i + 1}. *${commit.message}*\n`;
          summary += `   _by ${commit.author} on ${commit.date}_\n`;
          summary += `   <${commit.url}|${commit.sha}>\n\n`;
        });
        
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: summary
        });
        console.log('[SUCCESS] Posted commit summary to Slack');
        return; // Done - skip orchestrator
      } catch (err) {
        console.error('[ERROR] GitHub API failed:', err.message);
        // Fall through to orchestrator
      }
    }
    
    // Try to send to orchestrator for non-GitHub queries
    try {
      console.log('[INFO] Sending to orchestrator:', messageText.substring(0, 100) + '...');
      const orchestratorResponse = await sendToOrchestrator(messageText, {
        channelId,
        userId,
        recentMessages,
        memory,
        conversationId,
        media: media.hasMedia ? media : undefined
      });
      
      console.log('[INFO] Got orchestrator response:', orchestratorResponse ? 'YES' : 'NO');
      console.log('[DEBUG] Response:', JSON.stringify(orchestratorResponse).substring(0, 300));
      
      // Post orchestrator response back to Slack
      if (orchestratorResponse.response) {
        let responseText = orchestratorResponse.response;
        
        // Add citations - only if response actually uses context from messages
        if (recentMessages.length > 0 && responseText.length > 100) {
          // Extract keywords from user's question
          const questionKeywords = messageText
            .toLowerCase()
            .replace(/<@[A-Z0-9]+>/g, '')
            .split(/\s+/)
            .filter(word => word.length > 3 && !['what', 'when', 'where', 'which', 'that', 'this', 'with', 'from'].includes(word));
          
          // Find messages that contain keywords from the question or response
          const relevantMessages = recentMessages
            .filter(msg => {
              if (msg.bot_id || !msg.text || msg.user === userId) return false;
              
              // Skip system messages (joined, left, etc.)
              if (/has (joined|left) the (channel|server)/i.test(msg.text)) return false;
              
              const msgLower = msg.text.toLowerCase();
              
              // Check if message contains any keywords from the question
              const hasKeyword = questionKeywords.some(keyword => msgLower.includes(keyword));
              
              // Check if message is substantial (not just short reactions)
              const isSubstantial = msg.text.length > 20;
              
              return hasKeyword && isSubstantial;
            })
            .slice(0, 2); // Max 2 citations to keep it clean
          
          if (relevantMessages.length > 0) {
            responseText += '\n\n_Sources:_';
            for (const msg of relevantMessages) {
              const messageLink = `https://slack.com/archives/${channelId}/p${msg.ts.replace('.', '')}`;
              const preview = msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : '');
              responseText += `\n• <${messageLink}|${preview}>`;
            }
          }
        }
        
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: responseText
        });
      } else {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: "I processed your message but couldn't generate a response."
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
    console.log(`[INFO] Slack bot is running (Socket Mode)`);
  } catch (error) {
    console.error(`[ERROR] Failed to start Slack bot:`, error);
  }
}

start();

