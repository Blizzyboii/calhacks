# Slack Bot Backend with Orchestrator Integration

This backend service provides a Slack bot that can read messages, handle webhooks, and integrate with an orchestrator service for intelligent question answering using memory.

## Features

- **Message Reading**: Reads all messages from Slack channels
- **Webhook Integration**: Receives Slack events via webhooks
- **Orchestrator Integration**: Uses letta orchestrator for memory management and question answering
- **Context Awareness**: Maintains conversation context and memory
- **Real-time Processing**: Handles new messages and app mentions in real-time

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:
- `SLACK_BOT_TOKEN`: Your Slack bot token (starts with `xoxb-`)
- `SLACK_APP_TOKEN`: Your Slack app token (starts with `xapp-`)
- `SLACK_SIGNING_SECRET`: Your Slack app signing secret
- `ORCHESTRATOR_URL`: URL of your orchestrator service (default: http://localhost:8000)
- `ORCHESTRATOR_API_KEY`: API key for orchestrator authentication
- `PORT`: Server port (default: 3000)

### 2. Slack App Configuration

1. Create a new Slack app at https://api.slack.com/apps
2. Enable Socket Mode and get your App Token
3. Add the following OAuth scopes:
   - `app_mentions:read`
   - `channels:history`
   - `channels:read`
   - `chat:write`
   - `groups:history`
   - `groups:read`
   - `im:history`
   - `im:read`
   - `mpim:history`
   - `mpim:read`
4. Install the app to your workspace
5. Get your Bot Token and App Token

### 3. Webhook Configuration (Optional)

If you want to use webhooks instead of Socket Mode:

1. In your Slack app settings, go to "Event Subscriptions"
2. Enable events and add the following:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
   - `app_mention`
3. Set the Request URL to: `https://your-domain.com/slack/events`

### 4. Orchestrator Integration

The bot expects your orchestrator to have the following endpoints:

- `POST /api/process`: Process messages
- `GET /api/memory/{conversationId}`: Retrieve conversation memory

Expected request format for `/api/process`:
```json
{
  "message": "user message text",
  "context": {
    "channelId": "C1234567890",
    "userId": "U1234567890",
    "recentMessages": [...],
    "memory": {...},
    "conversationId": "C1234567890_1234567890.123456"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Expected response format:
```json
{
  "response": "orchestrator response text",
  "memory": {...}
}
```

## Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## API Endpoints

- `GET /health`: Health check endpoint
- `GET /memory/:conversationId`: Get conversation memory
- `POST /slack/events`: Slack webhook endpoint

## How It Works

1. **Message Reception**: The bot receives messages through Slack events (either via Socket Mode or webhooks)
2. **Context Gathering**: Reads recent messages from the channel for context
3. **Memory Retrieval**: Gets existing conversation memory from the orchestrator
4. **Orchestrator Processing**: Sends the message and context to the orchestrator
5. **Response Generation**: The orchestrator processes the message using its memory
6. **Response Delivery**: Posts the orchestrator's response back to Slack
7. **Memory Storage**: Stores the conversation context for future reference

## Conversation Memory

The bot maintains conversation memory using:
- **Conversation IDs**: Unique identifiers based on channel and thread
- **Recent Messages**: Last 10 messages for context
- **Orchestrator Memory**: Persistent memory from the orchestrator service
- **Local Memory**: Temporary storage for quick access

## Error Handling

The bot includes comprehensive error handling:
- Network errors when communicating with Slack API
- Orchestrator service unavailability
- Message processing failures
- Graceful fallback responses

## Development

To extend the bot functionality:

1. Add new event handlers in the main server file
2. Extend the orchestrator integration functions
3. Add new API endpoints as needed
4. Update the memory management system

## Troubleshooting

- Check your environment variables
- Ensure your Slack app has the correct permissions
- Verify your orchestrator service is running and accessible
- Check the console logs for detailed error messages
