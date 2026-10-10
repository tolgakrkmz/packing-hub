/* One permission model for the account editor and server authorization. */
((root, factory) => {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.HubPermissions = model;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const groups = [
    {title: 'Производство', module: 'production-log', view: 'canViewProduction', flags: {canViewProduction: 'Преглед на производството', canCreateProduction: 'Добавяне на производствени отчети', canEditProduction: 'Корекции и изтриване в производството', canManageProductionSettings: 'Промяна на производствената цел'}},
    {title: 'Престои', module: 'line-downtime', view: 'canViewDowntime', flags: {canViewDowntime: 'Преглед на престоите', canCreateDowntime: 'Добавяне на престои', canEditDowntime: 'Корекции и изтриване на престои', canManageDowntimeSettings: 'Управление на причините за престой'}},
    {title: 'Двойки', module: 'pair-targets', view: 'canViewPairs', flags: {canViewPairs: 'Преглед на двойките', canCreatePairs: 'Планиране и първи отчет на двойки', canEditPairs: 'Корекции на отчетени двойки'}},
    {title: 'Персонал', module: 'personnel', view: 'canViewPersonnel', flags: {canViewPersonnel: 'Преглед на персонала', canManagePersonnel: 'Управление на персонала'}},
    {title: 'Инструкции', module: 'package-instructions', view: 'canViewInstructions', flags: {canViewInstructions: 'Преглед на инструкциите', canManageInstructions: 'Управление на инструкции и приложения'}},
    {title: 'Статистика', module: 'statistics', view: 'canViewStatistics', flags: {canViewStatistics: 'Преглед на статистиката'}},
    {title: 'Задачи', module: 'tasks', view: 'canViewTasks', flags: {canViewTasks: 'Преглед на „Задачи“', canAssignTasks: 'Може да възлага задачи', canReportTasks: 'Отчитане на собствени задачи', canManageTasks: 'Редакция, отмяна и повторно отваряне', canReviewTasks: 'Потвърждаване и връщане за работа'}},
    {title: 'Акаунти', module: 'accounts', view: 'canViewAccounts', flags: {canViewAccounts: 'Преглед на акаунтите и правата', canManageAccounts: 'Управление на акаунти и права'}},
    {title: 'Потребителска активност', module: 'activity-log', view: 'canViewActivity', flags: {canViewActivity: 'Преглед на потребителската активност'}},
    {title: 'Статус на системата', module: 'system-status', view: 'canViewSystemStatus', flags: {canViewSystemStatus: 'Преглед на статуса на системата', canBackupSystem: 'Създаване на архив'}},
    {title: 'Импорт / експорт', module: 'data-import', flags: {canImportData: 'Импорт на данни', canExportReports: 'Експорт на отчети'}},
    {title: 'Общи права за отчетите', flags: {canCreateReports: 'Добавяне на отчети', canEditReports: 'Корекции и изтриване на отчети'}}
  ];
  const keys = groups.flatMap(group => Object.keys(group.flags));
  const reports = {
    'production-log': {view: 'canViewProduction', create: 'canCreateProduction', edit: 'canEditProduction', settings: 'canManageProductionSettings'},
    'line-downtime': {view: 'canViewDowntime', create: 'canCreateDowntime', edit: 'canEditDowntime', settings: 'canManageDowntimeSettings'},
    'pair-targets': {view: 'canViewPairs', create: 'canCreatePairs', edit: 'canEditPairs'}
  };
  const shared = new Set(['canExportReports', 'canViewProduction', 'canViewDowntime', 'canViewPairs', 'canViewInstructions']);
  const creation = new Set(['canCreateReports', ...Object.values(reports).map(report => report.create)]);
  function initialRight(role, key) {
    if (key === 'canReportTasks') return false; // Inherited from the task profile below.
    if (role === 'admin' || shared.has(key)) return true;
    if (role === 'operator' && creation.has(key)) return true;
    return role === 'observer' && key === 'canViewStatistics';
  }
  const defaults = Object.fromEntries(['admin', 'operator', 'observer'].map(role => [role,
    Object.fromEntries(keys.map(key => [key, initialRight(role, key)]))
  ]));
  function permissionsFor(user) {
    const base = user && Object.hasOwn(defaults, user.role) ? defaults[user.role] : null;
    if (!base) return Object.fromEntries(keys.map(key => [key, false]));
    const overrides = user.permissionOverrides || user.permissions || {};
    const explicit = key => Object.hasOwn(overrides, key);
    const result = Object.fromEntries(keys.map(key => [key, explicit(key) ? overrides[key] === true : base[key]]));
    if (!explicit('canReportTasks')) result.canReportTasks = user.taskSupervisor === true;
    for (const report of Object.values(reports)) {
      for (const [action, legacy] of [['create', 'canCreateReports'], ['edit', 'canEditReports']]) {
        if (!explicit(report[action])) result[report[action]] = result[legacy];
      }
      if (report.settings && !explicit(report.settings)) result[report.settings] = base[report.settings] && result.canEditReports;
    }
    for (const group of groups.filter(group => group.view)) {
      const actions = Object.keys(group.flags).filter(key => key !== group.view);
      const imports = ['production-log', 'line-downtime', 'pair-targets', 'personnel', 'package-instructions'].includes(group.module) && result.canImportData;
      if (!explicit(group.view)) result[group.view] ||= imports || actions.some(key => result[key]);
      if (!result[group.view]) for (const key of actions) result[key] = false;
    }
    return result;
  }
  function canViewModule(user, name) {
    const rights = permissionsFor(user);
    if (name === 'data-import') return rights.canImportData || rights.canExportReports;
    if (name === 'admin-panel') return ['canViewAccounts', 'canViewActivity', 'canViewSystemStatus', 'canImportData', 'canExportReports'].some(key => rights[key]);
    const group = groups.find(group => group.module === name);
    return !!group?.view && rights[group.view];
  }
  return {groups, keys, defaults, reports, permissionsFor, canViewModule};
});
