const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'services', 'apService.js');
const content = fs.readFileSync(target, 'utf8');

function extractMethod(content, methodName) {
  const start = content.indexOf(`async ${methodName}`);
  if (start === -1) return '';
  let end = content.indexOf('async ', start + 1);
  if (end === -1) end = content.indexOf('module.exports', start);
  if (end === -1) end = content.length;
  return content.substring(start, end);
}

const header = content.substring(0, content.indexOf('async createPayment'));

const getAgingReport = extractMethod(content, 'getAgingReport');
const getSupplierStatement = extractMethod(content, 'getSupplierStatement');

const footerIdx = content.indexOf('module.exports');
const footer = content.substring(footerIdx);

const newContent = `${header}${getAgingReport}
${getSupplierStatement}
${footer}`;

fs.writeFileSync(target, newContent, 'utf8');
console.log('apService.js cleaned up successfully');
