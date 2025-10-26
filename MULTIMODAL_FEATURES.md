# Multimodal Agentic RAG with Intelligent Model Routing

## Overview

The system now supports **multimodal content** (images and videos) with **intelligent model routing** via Lava. When visual content is detected, the system automatically routes to vision-capable models like Gemini.

## Architecture

```
Slack Message (with image/video)
    ↓
Backend: Detect media (images, videos, files)
    ↓
Orchestrator: Analyze content type
    ↓
Lava Router: Select appropriate model
    ├─ Text only → GPT-4o-mini
    ├─ Images → Gemini-1.5-Flash (fast)
    └─ Videos → Gemini-1.5-Pro (powerful)
    ↓
Visual Analysis: Gemini describes content
    ↓
Letta Storage: Store with visual context
    ↓
Future queries: Use enriched context
```

## Features

### 1. Automatic Media Detection
- Detects images from Slack file uploads
- Detects videos from Slack file uploads
- Extracts image URLs from message text (imgur, giphy, etc.)
- Extracts video URLs (YouTube, Vimeo, direct links)

### 2. Intelligent Model Routing
- **GPT-4o-mini**: Text-only messages (default)
- **Gemini-1.5-Flash**: Image analysis (fast, efficient)
- **Gemini-1.5-Pro**: Video analysis (powerful, detailed)

### 3. Visual Content Analysis
- Automatically analyzes images/videos using Gemini
- Generates detailed descriptions
- Stores visual context in Letta for future reference

### 4. Context-Aware Responses
- Bot remembers visual content from past conversations
- Can answer questions about previously shared images/videos
- Enriched RAG with multimodal context

## Example Workflows

### Image Analysis
```
User: [uploads image of a sunset]
System:
  1. Detects image in Slack message
  2. Routes to Gemini-1.5-Flash
  3. Analyzes: "Beautiful sunset over ocean with orange/pink sky"
  4. Stores in Letta with visual description
  
Later...
User: "@bot what was that sunset image I shared?"
Bot: "You shared a beautiful sunset image over the ocean with 
      vibrant orange and pink colors in the sky."
```

### Video Analysis
```
User: [shares YouTube link] "@bot what's in this video?"
System:
  1. Detects video URL
  2. Routes to Gemini-1.5-Pro
  3. Analyzes video content
  4. Provides detailed summary
  5. Stores analysis in Letta
```

### Mixed Content
```
User: "Here are our product mockups" [uploads 3 images]
System:
  1. Detects 3 images
  2. Routes to Gemini-1.5-Flash
  3. Analyzes each image
  4. Stores: "User shared 3 product mockup images showing..."
  
Later...
User: "@bot remind me what mockups we discussed?"
Bot: [retrieves visual context from Letta]
     "You shared 3 product mockup images that showed..."
```

## Supported Media Types

### Images
- JPEG, PNG, GIF, WebP, BMP, SVG
- Slack file uploads
- Direct image URLs
- Imgur links
- Giphy GIFs

### Videos
- MP4, WebM, MOV, AVI
- YouTube links
- Vimeo links
- Direct video URLs

## Technical Implementation

### Backend (server.js)
```javascript
// Detects media in Slack messages
function extractMediaFromMessage(message) {
  // Checks files array
  // Parses URLs in text
  // Returns: { hasMedia, images[], videos[], files[] }
}
```

### Orchestrator (index.js)
```javascript
// Selects model based on content
function selectModel(hasMedia, mediaType) {
  if (mediaType === 'video') return 'gemini-1.5-pro';
  if (mediaType === 'image') return 'gemini-1.5-flash';
  return 'gpt-4o-mini';
}

// Analyzes visual content
async function analyzeVisualContent(media) {
  // Uses Gemini to describe images/videos
  // Returns detailed description
}

// Stores with visual context
async function storeInLettaArchival(
  conversationId, userId, message, timestamp, visualDescription
) {
  // Stores message + visual analysis in Letta
}
```

## Logs to Watch

```
[INFO] Detected media: 2 images, 0 videos
[INFO] Media detected - routing to gemini-1.5-flash
[INFO] Analyzing visual content with gemini-1.5-flash
[INFO] Visual analysis complete: A photograph showing...
[INFO] Stored in Letta memory (with visual context)
```

## Configuration

No additional configuration needed! The system automatically:
- Detects media in messages
- Routes to appropriate models via Lava
- Stores enriched context in Letta

Just ensure your Lava API key supports Gemini models.

## Benefits

1. **Automatic**: No manual model selection needed
2. **Efficient**: Uses fast models for images, powerful for videos
3. **Persistent**: Visual context stored in Letta
4. **Intelligent**: Bot remembers and references past visual content
5. **Scalable**: Handles multiple images/videos per message

## Testing

1. Upload an image to Slack
2. Mention the bot: "@bot what's in this image?"
3. Check logs for model routing
4. Later, ask: "@bot what image did I share earlier?"
5. Bot should recall the visual content!

## Future Enhancements

- Support for PDFs and documents
- Audio/voice message analysis
- Real-time video frame analysis
- Multi-image comparison
- Visual search across conversation history
