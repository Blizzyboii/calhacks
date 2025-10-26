# Orchestrator with Letta + Lava Integration

This orchestrator service integrates **Letta** (for long-term memory) and **Lava** (for AI responses).

## Architecture

```
Slack Bot → Orchestrator → Letta (archival memory) → Lava (AI response) → Slack
```

### Flow:
1. **Receive message** from Slack bot
2. **Store in Letta** archival memory for long-term storage
3. **Query Letta** for relevant past conversations
4. **Send to Lava** with context from Letta
5. **Return response** to Slack

## Features

- **Long-term memory**: All Slack conversations stored in Letta
- **Context-aware responses**: Lava uses past conversation context
- **Conversation memory**: Recent messages kept in local memory
- **Graceful fallback**: Works without Letta if not configured

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment variables
See `ENV_SETUP.md` for detailed instructions.

Required:
- `LAVA_FORWARD_TOKEN` - Your Lava API token

Optional (for long-term memory):
- `LETTA_API_KEY` - Your Letta API key
- `LETTA_AGENT_ID` - Your Letta agent ID

### 3. Run the service
```bash
npm run dev
```

## API Endpoints

### POST `/api/process`
Process a message with Letta context and Lava AI.

**Request:**
```json
{
  "message": "What did we discuss yesterday?",
  "context": {
    "channelId": "C123",
    "userId": "U123",
    "conversationId": "C123_thread123"
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

**Response:**
```json
{
  "response": "Based on our conversation yesterday...",
  "memory": [...],
  "conversationId": "C123_thread123"
}
```

### GET `/health`
Health check endpoint.

### GET `/api/memory/:conversationId`
Get conversation memory for a specific conversation.

## How It Works

### Letta Integration
- **Storage**: Every message is stored in Letta's archival memory with timestamp and user info
- **Retrieval**: When processing a new message, Letta is queried for relevant past conversations
- **Context**: Retrieved memories are added to the system prompt for Lava

### Lava Integration
- **AI Processing**: Lava (via forward API) generates responses using GPT-4o-mini
- **Context-aware**: System prompt includes both recent messages and Letta context
- **Token management**: Only last 10 messages sent to avoid token limits

## Logs

The orchestrator provides detailed logging:
- Request received
- Stored in Letta
- Retrieved from Letta
- Context added
- Calling Lava
- Response generated

## Troubleshooting

**Letta not working?**
- Check `LETTA_API_KEY` and `LETTA_AGENT_ID` in `.env`
- Verify agent exists at https://app.letta.com
- Check logs for Letta errors

**Lava not working?**
- Check `LAVA_FORWARD_TOKEN` in `.env`
- Verify token is valid
- Check logs for Lava API errors

**No context in responses?**
- Letta needs time to index messages
- Try asking about recent conversations first
- Check if Letta is configured (logs will show warnings)
