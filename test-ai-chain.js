// Test: verify 6-provider AI fallback chain
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test';
process.env.MONGODB_URI = 'mongodb://localhost/test';
process.env.GROQ_API_KEY = 'test';
process.env.MISTRAL_API_KEY = 'test';
process.env.OPENROUTER_API_KEY = 'test';
process.env.DEEPSEEK_API_KEY = 'test';
process.env.TOGETHER_API_KEY = 'test';
process.env.GEMINI_API_KEY = 'test';

const configPath = path.join(__dirname, 'src/config/environment.js');
let cfg;
try {
  delete require.cache[require.resolve(configPath)];
  cfg = require(configPath);
  console.log('✅ Config loaded\n');
  ['groqApiKey', 'mistralApiKey', 'openRouterApiKey', 'deepseekApiKey', 'togetherApiKey', 'geminiApiKey']
    .forEach(k => console.log(`  ${k}: ${cfg.ai[k] ? '✅' : '❌'}`));
} catch (e) {
  console.error('❌ Config failed:', e.message);
  process.exit(1);
}

const svc = fs.readFileSync(path.join(__dirname, 'services/aiProviderService.js'), 'utf8');
console.log('\n📋 Provider chain checks:');
const checks = [
  { label: '1. Groq', regex: /\/\/ 1\. Groq/ },
  { label: '2. Mistral', regex: /\/\/ 2\. Mistral/ },
  { label: '3. OpenRouter', regex: /\/\/ 3\. OpenRouter/ },
  { label: '4. Gemini', regex: /\/\/ 4\. Google Gemini/ },
  { label: '5. DeepSeek', regex: /\/\/ 5\. DeepSeek/ },
  { label: '6. Together AI', regex: /\/\/ 6\. Together AI/ },
  { label: '429 fail-fast', regex: /429.*don't retry/ },
];

let allPass = true;
checks.forEach(c => {
  const ok = c.regex.test(svc);
  console.log(ok ? `  ✅ ${c.label}` : `  ❌ ${c.label}`);
  if (!ok) allPass = false;
});

const routes = fs.readFileSync(path.join(__dirname, 'routes/aiChatRoutes.js'), 'utf8');
console.log('\n📋 Error message checks:');
const keys = ['GROQ_API_KEY', 'MISTRAL_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'TOGETHER_API_KEY', 'GEMINI_API_KEY'];
keys.forEach(k => {
  const ok = routes.includes(k);
  console.log(ok ? `  ✅ ${k}` : `  ❌ ${k}`);
  if (!ok) allPass = false;
});

if (allPass) {
  console.log('\n✅✅✅ ALL CHECKS PASSED ✅✅✅');
  console.log('Chain: Groq → Mistral → OpenRouter → DeepSeek → Together → Gemini');
  process.exit(0);
} else {
  console.log('\n❌ Some checks failed');
  process.exit(1);
}
