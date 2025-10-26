import axios from 'axios';

export async function getRecentCommits(owner, repo, token, count = 3) {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/commits`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        params: {
          per_page: count
        }
      }
    );

    return response.data.map(commit => ({
      sha: commit.sha.substring(0, 7),
      message: commit.commit.message,
      author: commit.commit.author.name,
      date: new Date(commit.commit.author.date).toLocaleString(),
      url: commit.html_url
    }));
  } catch (error) {
    console.error('[ERROR] Failed to fetch commits:', error.message);
    throw error;
  }
}

export async function createIssue(owner, repo, token, title, body, labels = []) {
  try {
    const response = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        title,
        body,
        labels
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    return {
      number: response.data.number,
      title: response.data.title,
      url: response.data.html_url,
      state: response.data.state
    };
  } catch (error) {
    console.error('[ERROR] Failed to create issue:', error.message);
    throw error;
  }
}
