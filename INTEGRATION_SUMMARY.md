# Letta + Lava Integration Summary

## What's Working Now

### 1. **All Messages Stored**
- Backend listens to ALL messages in channels (not just mentions)
- Every message is stored in Letta's archival memory
- Format: `[timestamp] User {userId} in conversation {channelId}: {message}`

### 2. **Context-Aware Responses**
- When bot is mentioned, it queries Letta for relevant context
- Retrieves top 5 most relevant past messages
- Passes context to Lava for intelligent responses

### 3. **Two Endpoints**
- **`POST /api/store`** - Store message in Letta only (no response)
- **`POST /api/process`** - Store + query Letta + generate response with Lava

## Flow Diagram

```
User sends message in Slack
         ↓
Backend receives message event
         ↓
POST /api/store → Letta archival memory
         ↓
(Message stored, no response)

---

User mentions bot
         ↓
Backend receives app_mention event
         ↓
POST /api/process
         ↓
1. Store in Letta
2. Query Letta for context (top 5 relevant)
3. Build system prompt with context
4. Send to Lava for response
         ↓
Response sent to Slack
```

## Example Conversation

**User:** "I don't like mangoes"
- Stored in Letta: `[2025-10-26T06:20:00Z] User U123 in conversation C456: I don't like mangoes`

**User:** "@bot based on previous information, do I like mangoes?"
- Queries Letta with: "based on previous information, do I like mangoes?"
- Letta returns: `[2025-10-26T06:20:00Z] User U123 in conversation C456: I don't like mangoes`
- System prompt includes: "Relevant context from past conversations: [2025-10-26T06:20:00Z] User U123 in conversation C456: I don't like mangoes"
- Lava responds: "Based on your previous message, you mentioned that you don't like mangoes."

## Configuration

Make sure your `orchestrator/.env` has:
```
LETTA_API_KEY=your_key_here
LETTA_AGENT_ID=your_agent_id_here
LETTA_BASE_URL=https://api.letta.com
```

## Logs to Watch

### Orchestrator:
- `Storing message:` - Message being stored
- `Stored in Letta archival memory` - Successful storage
- `Retrieved X relevant memories from Letta` - Context retrieved
- `Added Letta context to system prompt` - Context added

### Backend:
- `Message in channel X:` - All messages being captured
- `RECEIVED APP MENTION` - Bot mentioned

## Testing

1. Send normal messages in the channel (not mentioning bot)
2. Wait a few seconds for Letta to index
3. Mention the bot and ask about previous messages
4. Bot should have context from all previous messages!
