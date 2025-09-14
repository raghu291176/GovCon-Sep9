const axios = require('axios');

const endpoint = 'https://jayalakshmi2908-5196-resource.services.ai.azure.com';
const apiKey = 'NUZ91opnkwYkIe2BEDOl52ERYiKWajvZBSiwNNSqcmYnrtIOhVgeJQQJ99BIAC4f1cMXJ3w3AAAAACOGKCx0';
const apiVersion = '2025-05-01-preview';
const receiptAnalyzerId = 'receipt-analyzer';
const invoiceAnalyzerId = 'invoice-analyzer';

const testDocumentUrl = 'https://example.com/sample-receipt.jpg';

const testAnalyzer = async (analyzerId, label) => {
  const url = `${endpoint}/documentIntelligence/analyze?api-version=${apiVersion}`;

  const payload = {
    analyzerId: analyzerId,
    parameters: {
      modelVersion: 'latest'
    },
    input: {
      documents: [
        {
          location: testDocumentUrl
        }
      ]
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': apiKey
      }
    });

    console.log(`✅ ${label} responded with status ${response.status}`);
    console.log(response.data);
  } catch (error) {
    const status = error.response?.status || 'unknown';
    const message = error.response?.data || error.message;
    console.log(`❌ ${label} failed with status ${status}`);
    console.log(message);
  }
};

(async () => {
  await testAnalyzer(receiptAnalyzerId, 'Receipt Analyzer');
  await testAnalyzer(invoiceAnalyzerId, 'Invoice Analyzer');
})();
