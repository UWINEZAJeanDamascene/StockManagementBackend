const axios = require('axios');

const API_BASE = 'http://localhost:3000/api';

async function testLedgerEndpoints() {
  try {
    // Step 1: Login to get token
    const loginRes = await axios.post(`${API_BASE}/auth/login`, {
      email: 'aimeeflorence@gmail.com',
      password: 'password123' // assuming this is the correct password
    });
    const token = loginRes.data.token;
    console.log('Token obtained:', token.substring(0, 20) + '...');

    const headers = { Authorization: `Bearer ${token}` };

    // Step 2: Fetch AP ledger transactions
    const apRes = await axios.get(`${API_BASE}/ap-reconciliation/transactions`, { headers });
    console.log('\nAP ledger response status:', apRes.status);
    console.log('AP data count:', apRes.data?.data?.length || 0);
    console.log('AP total:', apRes.data?.pagination?.total || 0);
    if (apRes.data?.data?.length > 0) {
      console.log('First AP entry:', {
        reference: apRes.data.data[0].referenceNo,
        amount: apRes.data.data[0].amount,
        supplier: apRes.data.data[0].supplier?.name
      });
    } else {
      console.log('AP data:', apRes.data);
    }

    // Step 3: Fetch AR ledger transactions
    const arRes = await axios.get(`${API_BASE}/ar-reconciliation/transactions`, { headers });
    console.log('\nAR ledger response status:', arRes.status);
    console.log('AR data count:', arRes.data?.data?.length || 0);
    console.log('AR total:', arRes.data?.pagination?.total || 0);
    if (arRes.data?.data?.length > 0) {
      console.log('First AR entry:', {
        reference: arRes.data.data[0].referenceNo,
        amount: arRes.data.data[0].amount,
        client: arRes.data.data[0].client?.name
      });
    } else {
      console.log('AR data:', arRes.data);
    }
  } catch (err) {
    if (err.response) {
      console.error('API error:', err.response.status, err.response.data);
    } else {
      console.error('Error:', err.message);
    }
  }
}

testLedgerEndpoints();
