const mongoose = require('mongoose');

// Schema-aware plugin: find all Decimal128 paths in the schema and only convert those fields
module.exports = function decimalTransformPlugin(schema) {
  const decimalPaths = [];

  schema.eachPath((path, schematype) => {
    if (schematype && schematype.instance === 'Decimal128') {
      decimalPaths.push(path);
    }
  });

  function convertFieldValue(val) {
    if (val == null) return val;
    if (val instanceof mongoose.Types.Decimal128) return parseFloat(val.toString());
    if (typeof val === 'object' && val.$numberDecimal) return parseFloat(val.$numberDecimal);
    return val;
  }

  function convertPathOnDoc(doc, path) {
    const parts = path.split('.');
    let cursor = doc;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (cursor == null) return;
      if (Array.isArray(cursor)) {
        // apply conversion for each element on remaining path
        cursor.forEach(item => convertPathOnDoc(item, parts.slice(i).join('.')));
        return;
      }
      if (i === parts.length - 1) {
        // final segment - convert value
        try {
          const v = cursor[part];
          cursor[part] = convertFieldValue(v);
        } catch (e) {}
        return;
      } else {
        cursor = cursor[part];
      }
    }
  }

  function convertDoc(doc) {
    if (!doc) return;
    for (const p of decimalPaths) {
      convertPathOnDoc(doc, p);
    }
  }

  schema.post('find', function(docs) {
    if (!docs) return;
    for (const d of docs) convertDoc(d);
  });

  schema.post('findOne', function(doc) {
    convertDoc(doc);
  });

  schema.post('findOneAndUpdate', function(doc) {
    convertDoc(doc);
  });

  schema.post('aggregate', function(result) {
    if (!result) return;
    for (const r of result) convertDoc(r);
  });
};
