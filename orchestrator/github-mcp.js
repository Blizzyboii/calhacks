import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

let githubClient = null;

// Initialize GitHub MCP client
export async function initGitHubMCP(githubToken, owner, repo) {
  try {
    console.log('[INFO] Initializing GitHub MCP client...');
    
    // Create transport with command and args
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        '@modelcontextprotocol/server-github',
        githubToken,
        owner,
        repo
      ]
    });

    // Create client
    githubClient = new Client({
      name: 'github-mcp-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    // Connect
    await githubClient.connect(transport);
    
    console.log('[SUCCESS] GitHub MCP client initialized');
    return githubClient;
  } catch (error) {
    console.error('[ERROR] Failed to initialize GitHub MCP:', error);
    throw error;
  }
}

// Get recent commits
export async function getRecentCommits(since = '24h') {
  if (!githubClient) {
    throw new Error('GitHub MCP client not initialized');
  }

  try {
    console.log('[INFO] Fetching recent commits...');
    
    const result = await githubClient.callTool({
      name: 'list_commits',
      arguments: {
        since: since,
        limit: 20
      }
    });

    console.log('[DEBUG] Raw MCP result:', JSON.stringify(result, null, 2));
    
    // MCP returns result with content array
    if (result.content && Array.isArray(result.content)) {
      // Parse the text content which contains JSON
      const textContent = result.content.find(c => c.type === 'text');
      if (textContent && textContent.text) {
        try {
          const commits = JSON.parse(textContent.text);
          console.log('[INFO] Parsed commits:', commits.length);
          return commits;
        } catch (parseError) {
          console.error('[ERROR] Failed to parse commits JSON:', parseError);
          // Return the text as-is if parsing fails
          return textContent.text;
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('[ERROR] Failed to fetch commits:', error);
    throw error;
  }
}

// Create a GitHub issue
export async function createGitHubIssue(title, body, labels = []) {
  if (!githubClient) {
    throw new Error('GitHub MCP client not initialized');
  }

  try {
    console.log('[INFO] Creating GitHub issue:', title);
    
    const result = await githubClient.callTool({
      name: 'create_issue',
      arguments: {
        title: title,
        body: body,
        labels: labels
      }
    });

    console.log('[DEBUG] Raw MCP result:', JSON.stringify(result, null, 2));
    
    // MCP returns result with content array
    if (result.content && Array.isArray(result.content)) {
      const textContent = result.content.find(c => c.type === 'text');
      if (textContent && textContent.text) {
        try {
          const issue = JSON.parse(textContent.text);
          console.log('[SUCCESS] Issue created:', issue);
          return issue;
        } catch (parseError) {
          console.error('[ERROR] Failed to parse issue JSON:', parseError);
          // Return the text as-is if parsing fails
          return textContent.text;
        }
      }
    }
    
    console.log('[SUCCESS] Issue created (raw):', result);
    return result;
  } catch (error) {
    console.error('[ERROR] Failed to create issue:', error);
    throw error;
  }
}

// List open pull requests
export async function listPullRequests() {
  if (!githubClient) {
    throw new Error('GitHub MCP client not initialized');
  }

  try {
    console.log('[INFO] Fetching pull requests...');
    
    const result = await githubClient.callTool({
      name: 'list_pull_requests',
      arguments: {
        state: 'open'
      }
    });

    return result;
  } catch (error) {
    console.error('[ERROR] Failed to fetch PRs:', error);
    throw error;
  }
}

export { githubClient };
