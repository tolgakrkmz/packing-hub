const model = require('../js/permission-model.js');
function validateOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !model.keys.includes(key) || typeof value[key] !== 'boolean')) {
    throw Object.assign(new Error('INVALID_PERMISSIONS'), {status: 400, code: 'INVALID_PERMISSIONS'});
  }
  return Object.fromEntries(Object.entries(value));
}
const can = (user, key) => model.permissionsFor(user)[key] === true;
module.exports = {...model, validateOverrides, can};
