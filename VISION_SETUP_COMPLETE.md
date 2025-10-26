# Vision Model Integration - Complete Setup

## Current Configuration

### Model: Claude 3 Sonnet
- **Model ID**: `claude-3-sonnet`
- **Provider**: Anthropic via Lava
- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **Capabilities**: Excellent vision analysis for images

## Complete Flow

### 1. Image Detection (Backend)
```
file_shared event → Store file info → Pass to orchestrator with slackToken
```

### 2. Model Routing (Orchestrator)
```javascript
// When media detected:
selectModel(hasMedia=true) → returns 'claude-3-sonnet'
targetURL = ANTHROPIC_URL
```

### 3. Image Processing
```javascript
// Download Slack image with auth
downloadSlackImage(url, slackToken)
// Convert to base64
data:image/png;base64,iVBORw0KG...
```

### 4. Request Format (Claude-specific)
```javascript
{
  model: 'claude-3-sonnet',
  max_tokens: 4096,
  system: "You are a helpful AI assistant...",
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'What is in the image?' },
      { 
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KG...'
        }
      }
    ]
  }]
}
```

### 5. Headers
```javascript
{
  'Content-Type': 'application/json',
  'Authorization': 'Bearer ${LAVA_FORWARD_TOKEN}',
  'anthropic-version': '2023-06-01'  // Required by Claude
}
```

### 6. Response Parsing
```javascript
// Claude response format:
response.data.content[0].text
```

## Key Differences from OpenAI

| Feature | OpenAI | Claude |
|---------|--------|--------|
| Image type | `image_url` | `image` |
| Image format | `{ type: 'image_url', image_url: { url: '...' }}` | `{ type: 'image', source: { type: 'base64', media_type: '...', data: '...' }}` |
| System prompt | In messages array | Separate `system` field |
| Required headers | None | `anthropic-version` |
| Response path | `choices[0].message.content` | `content[0].text` |

## Verified Components

✅ Model selection: `claude-3-sonnet`
✅ Endpoint routing: Anthropic URL
✅ Image formatting: Claude format with `type: 'image'`
✅ Base64 conversion: Slack images downloaded and converted
✅ Headers: `anthropic-version` included
✅ Response parsing: `content[0].text`
✅ Max tokens: 4096 set
✅ System prompt: Separate field

## Testing

1. Upload image to Slack
2. Mention bot: "@bot what's in the image?"
3. Expected logs:
   ```
   [INFO] Media detected - routing to claude-3-sonnet
   [INFO] Downloading Slack image for Claude...
   [INFO] Added image to Claude request
   [DEBUG] Sending Claude format to Lava
   [INFO] Lava request ID: req_xxx
   ```

## Fallback Models

If Claude doesn't work, the system supports:
- **GPT-4o**: OpenAI vision model (use `gpt-4o`)
- **GPT-4 Vision**: Older OpenAI vision (use `gpt-4-vision-preview`)

To switch models, change line 184 in `orchestrator/index.js`:
```javascript
return 'gpt-4o';  // or 'gpt-4-vision-preview'
```

## Common Issues

### Issue: "anthropic-version header is required"
**Fix**: Already handled - header is added for Claude models

### Issue: "image_url not supported"
**Fix**: Already handled - using `type: 'image'` for Claude

### Issue: "model not found"
**Fix**: Using `claude-3-sonnet` (without version suffix)

### Issue: Image not accessible
**Fix**: Already handled - downloading with Slack token and converting to base64

## Architecture

```
Slack Upload
    ↓
file_shared event (backend)
    ↓
Store file with slackToken
    ↓
app_mention event
    ↓
Extract media from recent files
    ↓
Send to orchestrator with media
    ↓
Orchestrator detects media
    ↓
Route to claude-3-sonnet
    ↓
Download image with auth
    ↓
Convert to base64
    ↓
Format for Claude API
    ↓
Send via Lava forward
    ↓
Parse Claude response
    ↓
Return to Slack
```

## Status: READY TO TEST ✅

All components are in place and properly configured for Claude 3 Sonnet vision analysis.
