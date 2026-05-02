const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'services', 'arService.js');
const content = fs.readFileSync(target, 'utf8');

// Find the line where getAgingReport starts - keep everything from there to end
const keepStart = content.indexOf('static async getAgingReport');
if (keepStart === -1) {
  console.error('Could not find getAgingReport in arService.js');
  process.exit(1);
}

// Find the line where writeOffBadDebt starts - keep everything from there too
const badDebtStart = content.indexOf('static async writeOffBadDebt');

// Find the line where postBadDebtWriteoff starts
const postBadDebtStart = content.indexOf('static async postBadDebtWriteoff');

// Find the line where reverseBadDebt starts
const reverseBadDebtStart = content.indexOf('static async reverseBadDebt');

// Find the line where getClientStatement starts
const clientStmtStart = content.indexOf('static async getClientStatement');

// We need to keep: getAgingReport, writeOffBadDebt, postBadDebtWriteoff, getClientStatement
// and remove everything else

// The structure is a class. Let's reconstruct the class with only the needed methods.

const header = content.substring(0, content.indexOf('static async createReceipt'));

// Extract each needed method using regex-like string searches
function extractMethod(content, methodName) {
  const start = content.indexOf(`static async ${methodName}`);
  if (start === -1) return '';
  // Find the next static async or the end of class
  let end = content.indexOf('static async ', start + 1);
  if (end === -1) end = content.indexOf('module.exports', start);
  if (end === -1) end = content.length;
  return content.substring(start, end);
}

const getAgingReport = extractMethod(content, 'getAgingReport');
const getClientStatement = extractMethod(content, 'getClientStatement');
const writeOffBadDebt = extractMethod(content, 'writeOffBadDebt');
const postBadDebtWriteoff = extractMethod(content, 'postBadDebtWriteoff');

const footerIdx = content.indexOf('module.exports');
const footer = content.substring(footerIdx);

const newContent = `${header}${getAgingReport}
${writeOffBadDebt}
${postBadDebtWriteoff}
${getClientStatement}
${footer}`;

fs.writeFileSync(target, newContent, 'utf8');
console.log('arService.js cleaned up successfully');
