/* Role limits always apply, including when an account has explicit overrides. */
const keys = ['canImportData', 'canExportReports', 'canCreateReports', 'canEditReports'];
const defaults = {
  admin: {canImportData: true, canExportReports: true, canCreateReports: true, canEditReports: true},
  operator: {canImportData: false, canExportReports: true, canCreateReports: true, canEditReports: false},
  observer: {canImportData: false, canExportReports: true, canCreateReports: false, canEditReports: false}
};
function validateOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key) || typeof value[key] !== 'boolean')) {
    throw Object.assign(new Error('INVALID_PERMISSIONS'), {status: 400, code: 'INVALID_PERMISSIONS'});
  }
  return Object.fromEntries(Object.entries(value));
}
function permissionsFor(user) {
  const base = defaults[user?.role];
  const overrides = user?.permissionOverrides || user?.permissions || {};
  return Object.fromEntries(keys.map(key => {
    const allowed = !!base && (key === 'canExportReports' || (key === 'canImportData' ? user.role === 'admin' : user.role !== 'observer'));
    return [key, allowed && (Object.hasOwn(overrides, key) ? overrides[key] === true : base[key])];
  }));
}
const can = (user, key) => permissionsFor(user)[key] === true;
module.exports = {keys, defaults, validateOverrides, permissionsFor, can};
