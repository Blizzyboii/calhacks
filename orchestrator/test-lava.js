import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const LAVA_BASE_URL = process.env.LAVA_BASE_URL || 'https://api.lavapayments.com';
const LAVA_FORWARD_TOKEN = process.env.LAVA_FORWARD_TOKEN;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const LAVA_API_URL = `${LAVA_BASE_URL}/forward?u=https://api.openai.com/v1/chat/completions`;
const LAVA_MODEL = process.env.LAVA_MODEL || 'gpt-4o-mini';

console.log('🔥 Testing Lava API');
console.log('URL:', LAVA_API_URL);
console.log('Token present:', !!LAVA_FORWARD_TOKEN);
console.log('Model:', LAVA_MODEL);
console.log('');

async function testLava() {
  try {
    const payload = {
      model: LAVA_MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say hello' }
      ]
    };
    
    console.log('📤 Sending payload:', JSON.stringify(payload, null, 2));
    console.log('');
    
    const response = await axios.post(LAVA_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LAVA_FORWARD_TOKEN}`
      }
    });
    
    console.log('✅ Success!');
    console.log('Response:', response.data);
  } catch (error) {
    console.error('❌ Error occurred');
    console.error('Status:', error.response?.status);
    console.error('Status Text:', error.response?.statusText);
    console.error('Error Data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Error Message:', error.message);
    process.exit(1);
  }
}

testLava();
