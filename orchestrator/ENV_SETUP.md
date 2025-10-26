# Environment Variables Setup

Add these to your `orchestrator/.env` file:

## Lava API Configuration
```
LAVA_BASE_URL=https://api.lavapayments.com/v1
LAVA_FORWARD_TOKEN=your_lava_forward_token_here
LAVA_MODEL=gpt-4o-mini
```

## Letta Configuration (for archival memory)
```
LETTA_BASE_URL=https://api.letta.com
LETTA_API_KEY=your_letta_api_key_here
LETTA_AGENT_ID=your_letta_agent_id_here
```

## How to get Letta credentials:

1. **Sign up at Letta**: https://app.letta.com
2. **Create an API key**: Go to Settings → API Keys
3. **Create an agent**: 
   - Go to Agents → Create New Agent
   - Name it something like "Slack Memory Agent"
   - Copy the Agent ID
4. **Add to .env**: Paste your API key and Agent ID

## Testing

Once configured, the orchestrator will:
- Store all Slack messages in Letta's archival memory
- Query Letta for relevant past conversations
- Pass that context to Lava for better responses

If Letta is not configured, the bot will still work but without long-term memory.
